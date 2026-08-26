// Express middleware — JWT/session verification, RBAC guard for protected routes.

import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { ForbiddenError, UnauthenticatedError } from "../common/errors";
import { env } from "../config/env";
import { JwtPayload } from "../types";

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new UnauthenticatedError());
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = jwt.verify(token, env.jwtSecret) as JwtPayload;
    req.user = payload;
    next();
  } catch {
    next(new UnauthenticatedError("Session expired or invalid. Please log in again."));
  }
}

// RBAC guard — use after requireAuth. Already wired into
// modules/therapist/therapist.routes.ts and
// modules/exercise-program-library/exercise.routes.ts; kept exported here so
// user-management/session-results can reuse it too as they're built out.
export function requireRole(...roles: JwtPayload["role"][]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthenticatedError());
    }
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError());
    }
    next();
  };
}
