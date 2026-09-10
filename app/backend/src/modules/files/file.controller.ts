import { NextFunction, Request, Response } from "express";
import path from "path";
import { UnauthenticatedError, ValidationError } from "../../common/errors";
import * as fileService from "./file.service";

function requireUser(req: Request) {
  if (!req.user) throw new UnauthenticatedError();
  return req.user;
}

export async function uploadFileHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    if (!req.file) throw new ValidationError('A file is required in the "file" field.');
    const file = await fileService.createFile(user.sub, req.file);
    res.status(201).json({ file });
  } catch (error) {
    next(error);
  }
}

export async function getFileContentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    requireUser(req);
    const file = await fileService.getFileContent(String(req.params.fileId));
    if (file.mimeType) res.type(file.mimeType);
    res.sendFile(path.resolve(file.storagePath));
  } catch (error) {
    next(error);
  }
}

export async function getVideoThumbnailHandler(req: Request, res: Response, next: NextFunction) {
  try {
    requireUser(req);
    const thumbnail = await fileService.getVideoThumbnail(String(req.params.fileId));
    res.type("image/jpeg").send(thumbnail);
  } catch (error) {
    next(error);
  }
}
