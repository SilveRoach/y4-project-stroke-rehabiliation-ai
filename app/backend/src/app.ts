// Express app setup — middleware registration, mounts each module's routes
// (auth, user-management, exercise-program-library, session-results).
//
// auth and user-management are now wired in. The other module routers are still NOT
// mounted — their routes/controller/service files are still TODO stubs. The mount
// points below are reserved so wiring a module in later is a one-line change once its
// router exports something real.

import cors from "cors";
import express, { Express, Request, Response } from "express";
import { errorHandler, notFoundHandler } from "./common/errors";
import { prisma } from "./config/prisma";
import { authRouter } from "./modules/auth/auth.routes";
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

  // Reserved mount points — uncomment each as its module is implemented:
  // apiRouter.use("/", exerciseRouter);                     // modules/exercise-program-library/exercise.routes.ts
  // apiRouter.use("/", sessionResultsRouter);               // modules/session-results/*.routes.ts

  app.use("/api/v1", apiRouter);

  // Must be registered after all routes.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
