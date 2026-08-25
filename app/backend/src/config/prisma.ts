// Singleton PrismaClient — avoids exhausting DB connections from creating a new
// client per request/module, and avoids multiple instances during ts-node/tsx
// hot-reload in dev.

import { PrismaClient } from "@prisma/client";
import { env } from "./env";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: env.nodeEnv === "development" ? ["warn", "error"] : ["error"]
  });

if (env.nodeEnv === "development") {
  global.__prisma = prisma;
}
