// Live webcam hand tracking on top of @mediapipe/tasks-vision's HandLandmarker.
//
// Fulfills this file's original TODO stub ("MediaPipe Tasks Vision hand landmark
// detection, client-side, per ADR-002") — lives in ai/ alongside poseDetection.ts
// and scoring.ts, which consume its landmarks. Modeled on the Rehab-AI reference
// implementation (handLandmarkerService.ts + handSkeletonRenderer.ts at the repo
// root). Unlike the reference — which pulls its `Landmark` type from a shared
// types/ai module — this file is self-contained and defines its own Landmark type.
//
// NOTE: getUserMedia (the browser camera API used by the view component) only
// works on localhost or HTTPS. The model/WASM assets load from CDN on first
// init() — both URLs are injectable via the constructor so the app can be
// pointed at self-hosted copies later for offline use.

import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

/** Normalized 21-point hand landmark as produced by MediaPipe (0..1 coordinates). */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

const DEFAULT_WASM_BASE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm";
const DEFAULT_HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export interface HandTrackerOptions {
  /** Base URL serving the tasks-vision WASM fileset (defaults to jsdelivr CDN). */
  wasmBaseUrl?: string;
  /** URL of the .task hand-landmarker model (defaults to Google's CDN). */
  modelUrl?: string;
  /** Max hands to track (default 1). */
  numHands?: number;
}

/**
 * Wrapper around MediaPipe's HandLandmarker (tasks-vision, pull-style
 * detectForVideo API — different from the legacy push/onResults @mediapipe/pose).
 *
 * init() is idempotent and safe to call while already loading; it tries the GPU
 * delegate first and transparently falls back to CPU on failure (some
 * browsers — notably iOS Safari — have unstable WebGL delegates).
 */
export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private loading: Promise<void> | null = null;
  private readonly wasmBaseUrl: string;
  private readonly modelUrl: string;
  private readonly numHands: number;

  constructor(options: HandTrackerOptions = {}) {
    this.wasmBaseUrl = options.wasmBaseUrl ?? DEFAULT_WASM_BASE_URL;
    this.modelUrl = options.modelUrl ?? DEFAULT_HAND_MODEL_URL;
    this.numHands = options.numHands ?? 1;
  }

  /** Load WASM runtime + model. Repeated/overlapping calls are safe. */
  async init(): Promise<void> {
    if (this.landmarker) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const vision = await FilesetResolver.forVisionTasks(this.wasmBaseUrl);
      const commonOptions = {
        runningMode: "VIDEO" as const,
        numHands: this.numHands,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      };
      try {
        this.landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: this.modelUrl, delegate: "GPU" },
          ...commonOptions,
        });
      } catch {
        // GPU/WebGL init failed — retry on the CPU delegate instead of failing outright.
        this.landmarker = await HandLandmarker.createFromOptions(vision, {
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
   * Detect one frame. Returns the first hand's 21 normalized landmarks, or null
   * when not ready / no hand / video not decodable yet. Never throws: frames
   * with out-of-order timestamps (e.g. after a video swap) are silently skipped.
   */
  detect(video: HTMLVideoElement, timestampMs: number): Landmark[] | null {
    if (!this.landmarker || video.readyState < 2) return null;
    try {
      const result = this.landmarker.detectForVideo(video, timestampMs);
      const first = result.landmarks?.[0];
      if (!first || first.length === 0) return null;
      return first.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    } catch {
      return null;
    }
  }

  /**
   * Convenience accessor for a single key point of a detected hand, e.g.
   * tracker.getLandmark(landmarks, KEY_LANDMARKS.indexTip).
   */
  getLandmark(landmarks: Landmark[] | null, index: number): Landmark | null {
    if (!landmarks || index < 0 || index >= landmarks.length) return null;
    return landmarks[index];
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}

/** Key landmark indices in the 21-point MediaPipe hand topology. */
export const KEY_LANDMARKS = {
  wrist: 0,
  thumbTip: 4,
  indexTip: 8,
  middleTip: 12,
  ringTip: 16,
  pinkyTip: 20,
} as const;

/** Hand skeleton topology (21-point MediaPipe Hands connections). */
export const HAND_CONNECTIONS: Array<[number, number]> = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle
  [9, 10], [10, 11], [11, 12],
  // Ring
  [13, 14], [14, 15], [15, 16],
  // Pinky
  [17, 18], [18, 19], [19, 20],
  // Palm (base knuckles chained back to the wrist)
  [5, 9], [9, 13], [13, 17], [0, 17],
];

export const WRIST_INDEX = 0;

/**
 * Draw a mirrored hand skeleton on a canvas. Does not clear/fill the background —
 * the caller is responsible for preparing it (the view draws the mirrored video
 * frame first). Mirrored to match the camera-preview style patients see.
 */
export function drawHandSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  width: number,
  height: number,
  mirror = true
): void {
  if (!landmarks || landmarks.length === 0) return;

  ctx.save();
  ctx.strokeStyle = "#29b6f6";
  ctx.fillStyle = "#ffca28";
  ctx.lineWidth = 3;

  const toCanvasX = (x: number) => (mirror ? 1 - x : x) * width;

  HAND_CONNECTIONS.forEach(([i, j]) => {
    const p1 = landmarks[i];
    const p2 = landmarks[j];
    if (!p1 || !p2) return;
    ctx.beginPath();
    ctx.moveTo(toCanvasX(p1.x), p1.y * height);
    ctx.lineTo(toCanvasX(p2.x), p2.y * height);
    ctx.stroke();
  });

  landmarks.forEach((p) => {
    if (!p) return;
    ctx.beginPath();
    ctx.arc(toCanvasX(p.x), p.y * height, 4, 0, 2 * Math.PI);
    ctx.fill();
  });

  ctx.restore();
}

/**
 * Hand openness in 0..1 (0 = fist, 1 = fully open), from the reference
 * extractors/gripStateClassifier.ts idea: average fingertip distance from the
 * wrist, normalized by hand size (wrist→middle-finger-MCP distance) so the
 * metric is stable at different camera distances.
 */
export function computeHandOpenness(landmarks: Landmark[]): number {
  const wrist = landmarks[WRIST_INDEX];
  const middleMcp = landmarks[9];
  if (!wrist || !middleMcp) return 0;

  const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);

  const handSize = dist(wrist, middleMcp);
  if (handSize === 0) return 0;

  const tips = [
    KEY_LANDMARKS.indexTip,
    KEY_LANDMARKS.middleTip,
    KEY_LANDMARKS.ringTip,
    KEY_LANDMARKS.pinkyTip,
  ];

  const avgTipDistance =
    tips.reduce((sum, index) => {
      const tip = landmarks[index];
      return tip ? sum + dist(tip, wrist) : sum;
    }, 0) / tips.length;

  // Empirical clamp: a closed fist puts fingertips near the wrist (~0.8× hand
  // size), a wide-open hand puts them around ~2.2× hand size.
  const raw = (avgTipDistance / handSize - 0.8) / (2.2 - 0.8);
  return Math.min(1, Math.max(0, raw));
}