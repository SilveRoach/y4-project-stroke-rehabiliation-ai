import { FilesType } from "@prisma/client";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { NotFoundError, ValidationError } from "../../common/errors";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import type { Express } from "express";

const MIME_TYPES: Array<[FilesType, string[]]> = [
  ["image", ["image/"]],
  ["video", ["video/"]],
  ["audio", ["audio/"]],
  ["document", ["application/pdf", "application/msword", "application/vnd.", "text/"]]
];

function inferFileType(mimeType: string | undefined): FilesType {
  if (!mimeType) return FilesType.other;
  const match = MIME_TYPES.find(([, prefixes]) => prefixes.some((prefix) => mimeType === prefix || mimeType.startsWith(prefix)));
  return match?.[0] ?? FilesType.other;
}

function toFileDto(file: {
  id: string;
  fileType: FilesType;
  originalName: string;
  storedName: string;
  mimeType: string | null;
  fileSize: bigint | null;
  storagePath: string;
  uploadedBy: string | null;
  createdAt: Date;
}) {
  return {
    ...file,
    fileSize: file.fileSize === null ? null : Number(file.fileSize)
  };
}

export async function createFile(uploadedBy: string, uploadedFile: Express.Multer.File) {
  if (!uploadedFile) throw new ValidationError("A file is required.");

  const storagePath = path.join(env.mediaStoragePath, uploadedFile.filename);
  try {
    const file = await prisma.file.create({
      data: {
        fileType: inferFileType(uploadedFile.mimetype),
        originalName: uploadedFile.originalname,
        storedName: uploadedFile.filename,
        mimeType: uploadedFile.mimetype || null,
        fileSize: BigInt(uploadedFile.size),
        storagePath,
        uploadedBy
      }
    });

    return toFileDto(file);
  } catch (error) {
    try {
      await fs.unlink(uploadedFile.path);
    } catch (cleanupError) {
      // Keep the database error as the request error, but make orphaned files visible.
      console.error("Failed to remove uploaded file after database error.", cleanupError);
    }
    throw error;
  }
}

export async function getFile(fileId: string) {
  const file = await prisma.file.findUnique({ where: { id: fileId } });
  if (!file) throw new NotFoundError("File not found.");
  return toFileDto(file);
}

export async function getFileContent(fileId: string) {
  const file = await prisma.file.findUnique({ where: { id: fileId } });
  if (!file) throw new NotFoundError("File not found.");
  return file;
}

export async function getVideoThumbnail(fileId: string): Promise<Buffer> {
  const file = await prisma.file.findUnique({ where: { id: fileId } });
  if (!file) throw new NotFoundError("File not found.");
  if (file.fileType !== "video") throw new ValidationError("Thumbnail generation requires a video file.");
  if (!ffmpegPath) throw new Error("Video thumbnail generation is unavailable.");
  const executablePath: string = ffmpegPath;

  return new Promise((resolve, reject) => {
    const ffmpegProcess = spawn(executablePath, [
      "-hide_banner",
      "-loglevel", "error",
      "-ss", "0",
      "-i", file.storagePath,
      "-frames:v", "1",
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "pipe:1"
    ]);
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];

    ffmpegProcess.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpegProcess.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    ffmpegProcess.on("error", reject);
    ffmpegProcess.on("close", (code: number | null) => {
      if (code !== 0 || chunks.length === 0) {
        reject(new Error(`Unable to generate video thumbnail${errors.length ? `: ${Buffer.concat(errors).toString()}` : "."}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}
