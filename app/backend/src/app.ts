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
import { poseScoringRouter } from "./modules/pose-scoring/poseScoring.routes";
import { sessionRouter } from "./modules/session-results/session.routes";
import { therapistRouter } from "./modules/therapist/therapist.routes";
import { userRouter } from "./modules/user-management/user.routes";
import rehabPlansRouter from "./modules/rehabilitation-plans/rehab.routes";
import { fileRouter } from "./modules/files/file.routes";

export function createApp(): Express {
  const app = express();

  app.use(cors());

  // Safety net for Postgres BIGINT columns: Prisma surfaces them as JS bigints
  // (e.g. files.file_size) and JSON.stringify throws "Do not know how to
  // serialize a BigInt", which 500s the whole request. Services convert file
  // rows explicitly (files/file.service.ts#toFileDto), so this only guarantees a
  // stray bigint degrades to a JSON number instead of failing the response —
  // it is what previously broke PatientDetailPage for any patient whose plan had
  // an attached medical file.
  app.set("json replacer", (_key: string, value: unknown) => (typeof value === "bigint" ? Number(value) : value));
  // Exercise-authoring payloads carry per-frame pose data for every master/
  // wrong-form take (masterSamples/wrongFormSamples in poseReference) — a
  // handful of demo clips easily exceeds express.json()'s 100kb default,
  // which throws a raw (non-AppError) PayloadTooLargeError that the generic
  // error handler below reports as an unhelpful "Something went wrong."
  app.use(express.json({ limit: "10mb" }));

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
  apiRouter.use("/", fileRouter);
  apiRouter.use("/users", userRouter);
  apiRouter.use("/", therapistRouter); // modules/therapist/therapist.routes.ts — /therapists/:id/*, /patients/:id/report
  apiRouter.use("/", exerciseRouter); // modules/exercise-program-library/exercise.routes.ts — /exercises/*
  apiRouter.use("/", sessionRouter); // modules/session-results/session.routes.ts — /therapists/:id/sessions, /patients/:id/today
  apiRouter.use("/", poseScoringRouter); // modules/pose-scoring/poseScoring.routes.ts — /scheduled-exercises/:id/pose-reference, /scheduled-exercises/:id/pose-rep-score
  apiRouter.use("/", rehabPlansRouter); // modules/rehab-plans/rehab.routes.ts — /patients/:id/plans and plan operations
  apiRouter.use("/", adminRouter); // modules/admin/admin.routes.ts — /admin/dashboard

  app.use("/api/v1", apiRouter);

  // Must be registered after all routes.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
