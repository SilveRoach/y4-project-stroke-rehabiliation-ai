// Auth module — HTTP handlers for login, logout, token refresh.

import { NextFunction, Request, Response } from "express";
import { UnauthenticatedError, ValidationError } from "../../common/errors";
import * as authService from "./auth.service";

function requireStringField(body: unknown, field: string): string {
  const value = (body as Record<string, unknown> | null)?.[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`"${field}" is required.`);
  }
  return value;
}

export async function registerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const phoneNumber = requireStringField(req.body, "phoneNumber");
    const password = requireStringField(req.body, "password");
    const result = await authService.register(phoneNumber, password);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function loginHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const identifier = requireStringField(req.body, "identifier");
    const password = requireStringField(req.body, "password");
    const result = await authService.login(identifier, password);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function changePasswordHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const currentPassword = requireStringField(req.body, "currentPassword");
    const newPassword = requireStringField(req.body, "newPassword");
    if (!req.user) throw new UnauthenticatedError();
    await authService.changePassword(req.user.sub, currentPassword, newPassword);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// No server-side session/token store exists (stateless JWT), so there's nothing to
// invalidate here yet — this endpoint mainly exists so the client has a real call to
// make on logout (per FR-AUTH-02) and so requireAuth is exercised. The frontend
// already discards its local token/localStorage regardless of this response.
export function logoutHandler(_req: Request, res: Response) {
  res.status(204).send();
}
