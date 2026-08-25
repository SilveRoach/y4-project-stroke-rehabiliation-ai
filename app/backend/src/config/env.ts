// Environment/config loader — DB connection string, port, JWT secret, media path, etc.
// Fails fast at boot if anything required is missing, rather than surfacing a confusing
// error deep inside a request handler later.

import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  mediaStoragePath: process.env.MEDIA_STORAGE_PATH ?? "./media",
  nodeEnv: process.env.NODE_ENV ?? "development"
} as const;
