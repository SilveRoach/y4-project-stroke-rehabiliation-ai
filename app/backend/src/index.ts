// Server entry point — starts the Express app (app.ts) on the configured port.

import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";

const app = createApp();

const server = app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${env.port} (${env.nodeEnv})`);
});

async function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`${signal} received, shutting down...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
