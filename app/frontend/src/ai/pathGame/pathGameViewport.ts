import type { PathPoint } from "../../types/ai";
import { PATH_CANVAS_HEIGHT, PATH_CANVAS_WIDTH } from "./pathGenerator";

export interface PathGameViewport {
  left: number;
  top: number;
  scale: number;
}

export function computePathGameViewport(
  videoWidth: number,
  videoHeight: number,
  clientWidth: number,
  clientHeight: number,
  canvasWidth: number,
  canvasHeight: number
): PathGameViewport {
  const fullFrame: PathGameViewport = {
    left: (canvasWidth - PATH_CANVAS_WIDTH * Math.min(canvasWidth / PATH_CANVAS_WIDTH, canvasHeight / PATH_CANVAS_HEIGHT)) / 2,
    top: (canvasHeight - PATH_CANVAS_HEIGHT * Math.min(canvasWidth / PATH_CANVAS_WIDTH, canvasHeight / PATH_CANVAS_HEIGHT)) / 2,
    scale: Math.min(canvasWidth / PATH_CANVAS_WIDTH, canvasHeight / PATH_CANVAS_HEIGHT)
  };
  if (!videoWidth || !videoHeight || !clientWidth || !clientHeight || !canvasWidth || !canvasHeight) {
    return fullFrame;
  }

  const videoAspect = videoWidth / videoHeight;
  const clientAspect = clientWidth / clientHeight;
  if (!Number.isFinite(videoAspect) || !Number.isFinite(clientAspect) || videoAspect <= 0 || clientAspect <= 0) {
    return fullFrame;
  }

  let visibleLeft = 0;
  let visibleTop = 0;
  let visibleWidth = canvasWidth;
  let visibleHeight = canvasHeight;
  if (clientAspect > videoAspect) {
    visibleHeight = (videoAspect / clientAspect) * canvasHeight;
    visibleTop = (canvasHeight - visibleHeight) / 2;
  } else {
    visibleWidth = (clientAspect / videoAspect) * canvasWidth;
    visibleLeft = (canvasWidth - visibleWidth) / 2;
  }

  const scale = Math.min(visibleWidth / PATH_CANVAS_WIDTH, visibleHeight / PATH_CANVAS_HEIGHT);
  const width = PATH_CANVAS_WIDTH * scale;
  const height = PATH_CANVAS_HEIGHT * scale;
  return {
    left: visibleLeft + (visibleWidth - width) / 2,
    top: visibleTop + (visibleHeight - height) / 2,
    scale
  };
}

export function mapVideoPointToPath(
  point: { x: number; y: number },
  viewport: PathGameViewport,
  canvasWidth: number,
  canvasHeight: number
): PathPoint {
  return {
    x: (point.x * canvasWidth - viewport.left) / viewport.scale,
    y: (point.y * canvasHeight - viewport.top) / viewport.scale
  };
}
