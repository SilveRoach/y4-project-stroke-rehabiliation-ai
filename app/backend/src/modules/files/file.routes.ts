import { Router } from "express";
import multer from "multer";
import { ValidationError } from "../../common/errors";
import { requireAuth } from "../../middleware/auth.middleware";
import { getFileContentHandler, getVideoThumbnailHandler, uploadFileHandler } from "./file.controller";
import { uploadMiddleware } from "./file.storage";

export const fileRouter = Router();

fileRouter.post(
  "/files",
  requireAuth,
  (req, res, next) => {
    uploadMiddleware.single("file")(req, res, (error) => {
      if (error instanceof multer.MulterError) {
        const message = error.code === "LIMIT_FILE_SIZE"
          ? "File exceeds the 100 MB size limit."
          : error.message;
        return next(new ValidationError(message));
      }
      if (error) return next(error);
      next();
    });
  },
  uploadFileHandler
);

fileRouter.get("/files/:fileId/content", requireAuth, getFileContentHandler);
fileRouter.get("/files/:fileId/thumbnail", requireAuth, getVideoThumbnailHandler);
