// Express app setup — middleware registration, mounts each module's routes
// (auth, user-management, therapist, exercise-program-library, session-results,
// admin).
//
// All six modules are now wired in.
//
// NOTE: if you're seeing "Route not found" for a route that's clearly mounted
// below, you're probably running a stale compiled build (dist/app.js can lag
// behind this file) — see this module's own investigation notes / README for
// the rebuild command. This file (src/app.ts) is the source of truth.

import cors from "cors";
import express, { Express, Request, Response } from "express";
import { errorHandler, notFoundHandler } from "./common/errors";
import { prisma } from "./config/prisma";
import { adminRouter } from "./modules/admin/admin.routes";
import { authRouter } from "./modules/auth/auth.routes";
import { exerciseRouter } from "./modules/exercise-program-library/exercise.routes";
import { sessionRouter } from "./modules/session-results/session.routes";
import { therapistRouter } from "./modules/therapist/therapist.routes";
import { userRouter } from "./modules/user-management/user.routes";

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Liveness: process is up.
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // Readiness: process is up AND can reach the database — useful for the docker
  // compose healthcheck / manual verification that the Postgres stack is wired up.
  app.get("/health/db", async (_req: Request, res: Response) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", database: "reachable" });
    } catch (err) {
      res.status(503).json({
        status: "error",
        database: "unreachable",
        message: err instanceof Error ? err.message : "Unknown error"
      });
    }
  });

  const apiRouter = express.Router();

  apiRouter.use("/auth", authRouter);
  apiRouter.use("/users", userRouter);
  apiRouter.use("/", therapistRouter); // modules/therapist/therapist.routes.ts — /therapists/:id/*, /patients/:id/report
  apiRouter.use("/", exerciseRouter); // modules/exercise-program-library/exercise.routes.ts — /exercises/*
  apiRouter.use("/", sessionRouter); // modules/session-results/session.routes.ts — /therapists/:id/sessions, /patients/:id/today
  apiRouter.use("/", adminRouter); // modules/admin/admin.routes.ts — /admin/dashboard

  app.use("/api/v1", apiRouter);

  // Must be registered after all routes.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
