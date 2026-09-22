// Live full-body pose tracking on top of @mediapipe/tasks-vision's PoseLandmarker.
//
// Fulfills this file's original TODO stub ("MediaPipe Tasks Vision pose landmark
// detection, client-side, per ADR-002") — the direct sibling of handDetection.ts:
// same pull-style detectForVideo API, GPU→CPU delegate fallback, injectable CDN
// URLs, and a never-throws detect(). The skeleton drawing follows the Rehab-AI
// reference skeletonRenderer.ts (SKELETON_CONNECTIONS + drawSkeleton, green
// skeleton / yellow joints, minVisibility gating so low-confidence joints don't
// make the skeleton flicker). Self-contained: defines its own PoseLandmark type
// (Landmark + MediaPipe's optional visibility confidence) instead of importing a
// shared types module.
//
// NOTE: getUserMedia only works on localhost or HTTPS; the model/WASM load from
// CDN on first init() — URLs are injectable for self-hosting/offline use.

import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

/** Normalized pose landmark; `visibility` is MediaPipe's joint confidence (0..1). */
export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

const DEFAULT_WASM_BASE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm";
// Lite model: fastest of the pose variants — the right trade-off for a live,
// throttled in-session overlay (accurate joint lines, not millimeter precision).
const DEFAULT_POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker.task";

export interface PoseTrackerOptions {
  /** Base URL serving the tasks-vision WASM fileset (defaults to jsdelivr CDN). */
  wasmBaseUrl?: string;
  /** URL of the .task pose-landmarker model (defaults to Google's CDN). */
  modelUrl?: string;
  /** Max poses to track (default 1 — one patient per camera). */
  numPoses?: number;
}

/**
 * Wrapper around MediaPipe's PoseLandmarker — mirrors HandTracker's contract:
 * init() is idempotent/overlapping-safe, tries the GPU delegate first and falls
 * back to CPU, and detect() returns null instead of throwing on unusable frames
 * (out-of-order timestamps, video not decodable yet, no person in frame).
 */
export class PoseTracker {
  private landmarker: PoseLandmarker | null = null;
  private loading: Promise<void> | null = null;
  private readonly wasmBaseUrl: string;
  private readonly modelUrl: string;
  private readonly numPoses: number;

  constructor(options: PoseTrackerOptions = {}) {
    this.wasmBaseUrl = options.wasmBaseUrl ?? DEFAULT_WASM_BASE_URL;
    this.modelUrl = options.modelUrl ?? DEFAULT_POSE_MODEL_URL;
    this.numPoses = options.numPoses ?? 1;
  }

  /** Load WASM runtime + model. Repeated/overlapping calls are safe. */
  async init(): Promise<void> {
    if (this.landmarker) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const vision = await FilesetResolver.forVisionTasks(this.wasmBaseUrl);
      const commonOptions = {
        runningMode: "VIDEO" as const,
        numPoses: this.numPoses,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      };
      try {
        this.landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: this.modelUrl, delegate: "GPU" },
          ...commonOptions,
        });
      } catch {
        // GPU/WebGL init failed — retry on the CPU delegate instead of failing outright.
        this.landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: this.modelUrl, delegate: "CPU" },
          ...commonOptions,
        });
      }
    })();

    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  get isReady(): boolean {
    return this.landmarker !== null;
  }

  /**
   * Detect one frame. Returns the first pose's normalized landmarks (with
   * visibility), or null when not ready / no person / video not decodable yet.
   * Never throws: out-of-order timestamp frames are silently skipped.
   */
  detect(video: HTMLVideoElement, timestampMs: number): PoseLandmark[] | null {
    if (!this.landmarker || video.readyState < 2) return null;
    try {
      const result = this.landmarker.detectForVideo(video, timestampMs);
      const first = result.landmarks?.[0];
      if (!first || first.length === 0) return null;
      // The 0.10.3 typings omit `visibility` on NormalizedLandmark even though
      // the runtime bundle provides it (typed in later versions) — cast to the
      // shape the model actually returns.
      type LandmarkWithVisibility = typeof first[number] & { visibility?: number };
      return first.map((p) => {
        const landmark = p as LandmarkWithVisibility;
        return { x: landmark.x, y: landmark.y, z: landmark.z, visibility: landmark.visibility };
      });
    } catch {
      return null;
    }
  }

  /** Convenience accessor for a single key joint (returns null out of range). */
  getLandmark(landmarks: PoseLandmark[] | null, index: number): PoseLandmark | null {
    if (!landmarks || index < 0 || index >= landmarks.length) return null;
    return landmarks[index];
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}

/** Key joint indices in MediaPipe Pose's 33-point topology (upper-body set). */
export const POSE_KEY_LANDMARKS = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
} as const;

/**
 * Joint connections drawn over the live video — shoulders/elbows/wrists plus
 * hips, the upper-body skeleton the reference skeletonRenderer.ts uses for
 * rehabilitation exercise feedback (torso bridge + both arms).
 */
export const SKELETON_CONNECTIONS: Array<[number, number]> = [
  [11, 12], // shoulders
  [11, 13], // left upper arm
  [13, 15], // left forearm
  [12, 14], // right upper arm
  [14, 16], // right forearm
  [11, 23], // left torso
  [12, 24], // right torso
  [23, 24], // hips
  [15, 16], // wrists (virtual "grip line" between the hands)
];

export interface DrawSkeletonOptions {
  /** Mirror left-right to match the camera's selfie flip (default true). */
  mirror?: boolean;
  strokeStyle?: string;
  jointFillStyle?: string;
  lineWidth?: number;
  jointRadius?: number;
  /** Skip lines/joints below this visibility confidence (prevents flicker). */
  minVisibility?: number;
}

/**
 * Draw one pose skeleton frame onto a canvas context. Does not clear or paint a
 * background — the caller prepares it (the session view draws the mirrored video
 * frame first). Reference skeletonRenderer.ts styling: green lines, yellow
 * joints, a joint circle at both ends of every connection so each bone reads
 * clearly over the video.
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: PoseLandmark[],
  width: number,
  height: number,
  options: DrawSkeletonOptions = {}
): void {
  const {
    mirror = true,
    strokeStyle = "#00e676",
    jointFillStyle = "#ffeb3b",
    lineWidth = 4,
    jointRadius = 6,
    minVisibility = 0.4,
  } = options;

  if (!landmarks || landmarks.length === 0) return;

  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.fillStyle = jointFillStyle;
  ctx.lineWidth = lineWidth;

  const toCanvasX = (x: number) => (mirror ? 1 - x : x) * width;

  SKELETON_CONNECTIONS.forEach(([i, j]) => {
    const p1 = landmarks[i];
    const p2 = landmarks[j];
    if (!p1 || !p2) return;
    if ((p1.visibility ?? 1) <= minVisibility || (p2.visibility ?? 1) <= minVisibility) return;

    const x1 = toCanvasX(p1.x);
    const y1 = p1.y * height;
    const x2 = toCanvasX(p2.x);
    const y2 = p2.y * height;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x1, y1, jointRadius, 0, 2 * Math.PI);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x2, y2, jointRadius, 0, 2 * Math.PI);
    ctx.fill();
  });

  ctx.restore();
}
