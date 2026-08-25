// Shared backend TypeScript types (request/response DTOs, JWT payload shape, etc.)

export interface JwtPayload {
  sub: string; // user id
  role: "patient" | "therapist" | "admin";
}

// Augments Express's Request type so `req.user` (set by the auth middleware) is
// recognized by TypeScript in every controller, without needing a cast at each call site.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export {};
