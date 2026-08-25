// Shared error classes / centralized error-handling middleware for the backend.
// Modules throw these; app.ts's error handler (registered last) turns them into the
// standard { error: { code, message } } shape from docs/04-design/api-design.md.

import { NextFunction, Request, Response } from "express";

export class AppError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, "VALIDATION_ERROR", message);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Authentication required.") {
    super(401, "UNAUTHENTICATED", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do that.") {
    super(403, "FORBIDDEN", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found.") {
    super(404, "NOT_FOUND", message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, "CONFLICT", message);
  }
}

// Registered last in app.ts, after all routes. Express recognizes this as an
// error-handling middleware by its 4-argument signature.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }

  // Unexpected/unhandled error — log for diagnosis, don't leak internals to the client.
  // eslint-disable-next-line no-console
  console.error(err);
  return res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." }
  });
}

// Mounted as the final route, after all module routers. Anything reaching here means
// no route matched.
export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found." } });
}
