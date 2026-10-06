// Hand → ball-game input helpers: grip classification (open/closed with
// hysteresis), palm anchor, and the visible-frame math for object-fit: cover.

import type { Landmark } from "../handDetection";
import { computeHandOpenness } from "../handDetection";
import type { BallGripVisibleFrame, GripState } from "./ballGripFSM";

// Hysteresis thresholds (reference gripStateClassifier): a value in the middle
// zone keeps its previous state instead of flickering grab/drop every frame.
const CLOSE_ENTER = 0.35;
const OPEN_ENTER = 0.55;

export function classifyGripState(openness: number, previousState: GripState | null): GripState {
  if (openness <= CLOSE_ENTER) return "closed";
  if (openness >= OPEN_ENTER) return "open";
  return previousState ?? (openness >= 0.45 ? "open" : "closed");
}

/**
 * Visible sub-frame of the video (normalized, NOT mirrored). The overlay canvas
 * is shown with object-fit: cover, so an aspect-mismatched container crops the
 * video symmetrically on one axis.
 */
export function computeGripVisibleFrame(
  videoWidth: number,
  videoHeight: number,
  clientWidth: number,
  clientHeight: number
): BallGripVisibleFrame {
  const full: BallGripVisibleFrame = { x0: 0, y0: 0, x1: 1, y1: 1 };
  if (!videoWidth || !videoHeight || !clientWidth || !clientHeight) return full;
  const videoAspect = videoWidth / videoHeight;
  const clientAspect = clientWidth / clientHeight;
  if (!Number.isFinite(videoAspect) || !Number.isFinite(clientAspect) || videoAspect <= 0 || clientAspect <= 0) {
    return full;
  }
  if (clientAspect > videoAspect) {
    const visibleHeight = videoAspect / clientAspect;
    const y0 = (1 - visibleHeight) / 2;
    return { x0: 0, y0, x1: 1, y1: y0 + visibleHeight };
  }
  const visibleWidth = clientAspect / videoAspect;
  const x0 = (1 - visibleWidth) / 2;
  return { x0, y0: 0, x1: x0 + visibleWidth, y1: 1 };
}

/** Same frame in mirrored space (x' = 1 - x), the space the ball game runs in. */
export function mirrorVisibleFrame(frame: BallGripVisibleFrame): BallGripVisibleFrame {
  return { x0: 1 - frame.x1, y0: frame.y0, x1: 1 - frame.x0, y1: frame.y1 };
}

/**
 * Palm centre in MIRRORED normalized space — midpoint of wrist and middle-finger
 * MCP, so the carried ball sits in the middle of the palm rather than at the wrist.
 */
export function computeMirroredPalmCenter(landmarks: Landmark[]): { x: number; y: number } | null {
  const wrist = landmarks[0];
  const middleMcp = landmarks[9];
  if (!wrist || !middleMcp) return null;
  return { x: 1 - (wrist.x + middleMcp.x) / 2, y: (wrist.y + middleMcp.y) / 2 };
}

export { computeHandOpenness };
