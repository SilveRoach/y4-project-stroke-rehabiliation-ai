import fs from "fs";
import path from "path";
import multer from "multer";
import { randomUUID } from "crypto";
import { env } from "../../config/env";

export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    const directory = path.resolve(env.mediaStoragePath);
    fs.mkdir(directory, { recursive: true }, (error) => callback(error, directory));
  },
  filename: (_req, file, callback) => {
    callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
  }
});

export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 }
});
