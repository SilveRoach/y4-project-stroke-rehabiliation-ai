// User-management module — HTTP handlers.
// SCOPE: only POST /users (create Therapist/Admin account) is implemented this pass —
// see user.service.ts for what's deliberately deferred.

import { NextFunction, Request, Response } from "express";
import { ValidationError } from "../../common/errors";
import * as userService from "./user.service";

function requireStringField(body: unknown, field: string): string {
  const value = (body as Record<string, unknown> | null)?.[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`"${field}" is required.`);
  }
  return value;
}

export async function createAccountHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const role = requireStringField(req.body, "role");
    const username = requireStringField(req.body, "username");
    const password = requireStringField(req.body, "password");

    // req.user is guaranteed set here — this handler is always mounted behind
    // requireAuth in user.routes.ts.
    const createdById = req.user!.sub;

    const account = await userService.createAccount(role, username, password, createdById);
    res.status(201).json({ user: account });
  } catch (err) {
    next(err);
  }
}
