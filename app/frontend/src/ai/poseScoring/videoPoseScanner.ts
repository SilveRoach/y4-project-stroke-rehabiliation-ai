// Offline demo-clip pose scanner — the CreateExerciseView scanning pipeline,
// adapted to this project: instead of the legacy @mediapipe/pose push API, it
// reuses ai/poseDetection.ts's PoseTracker (tasks-vision) with a monotonic
// timestamp counter across seeked frames, and applies the same One-Euro
// smoothing per landmark coordinate as the reference pipeline before storing
// samples. Output: FrameSample[] for exerciseAutoCalibrator.calibrateFromFrames.

import { PoseTracker, drawSkeleton } from "../poseDetection";
import { OneEuroFilter } from "./oneEuroFilter";
import type { FrameSample } from "./exerciseAutoCalibrator";

const SCAN_FPS = 30;

function seekTo(video: HTMLVideoElement, timeSeconds: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = timeSeconds;
  });
}

export interface ScanProgress {
  currentTimeSeconds: number;
  durationSeconds: number;
  sampledFrames: number;
}

export interface ScanPreviewTarget {
  /** Canvas drawn each scanned frame (video frame + tracked skeleton). */
  canvas: HTMLCanvasElement;
  /** Timeout label while no skeleton was detected on this frame. */
  onStatus?: (message: string) => void;
}

/**
 * Scans a demo video clip frame-by-frame (at SCAN_FPS) and returns pose
 * landmark samples. Never throws for individual untrackable frames (they are
 * skipped); hard failures (unreadable video, model load failure) reject.
 */
export async function scanVideoPoseFrames(
  file: File,
  onProgress: (progress: ScanProgress) => void,
  preview?: ScanPreviewTarget
): Promise<FrameSample[]> {
  const tracker = new PoseTracker();
  await tracker.init();

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = objectUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("This video file could not be opened (corrupt or unsupported format)."));
    });

    const samples: FrameSample[] = [];
    const filters: Array<{ x: OneEuroFilter; y: OneEuroFilter }> = [];
    // tasks-vision VIDEO mode requires strictly increasing timestamps across
    // detectForVideo calls — a synthetic monotonic clock independent of the
    // seek positions keeps that guarantee.
    let monotonicMs = 0;
    const interval = 1 / SCAN_FPS;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const previewCtx = preview?.canvas.getContext("2d") ?? null;

    await seekTo(video, 0);
    while (duration > 0 && video.currentTime < duration - 1e-3) {
      const nextTime = Math.min(duration, video.currentTime + interval);
      await seekTo(video, nextTime);
      monotonicMs += 1000 / SCAN_FPS;

      const raw = tracker.detect(video, monotonicMs);
      let filtered: FrameSample["landmarks"] | null = null;
      if (raw) {
        filtered = raw.map((p, index) => {
          const pair =
            filters[index] ?? (filters[index] = { x: new OneEuroFilter(1.0, 0.005), y: new OneEuroFilter(1.0, 0.005) });
          return { ...p, x: pair.x.filter(p.x, monotonicMs), y: pair.y.filter(p.y, monotonicMs) };
        });
        // Trunk centroid from shoulders (11/12) + hips (23/24) — same signal
        // the reference pipeline stores per frame.
        const cx = (filtered[11].x + filtered[12].x + filtered[23].x + filtered[24].x) / 4;
        const cy = (filtered[11].y + filtered[12].y + filtered[23].y + filtered[24].y) / 4;
        samples.push({
          landmarks: filtered,
          trunkCentroid: { x: cx, y: cy },
          timestampMs: monotonicMs,
          videoTimeSeconds: video.currentTime
        });
      }

      // Live scan preview (reference behavior): the current video frame plus
      // the tracked skeleton, drawn as each frame is processed.
      if (previewCtx && preview) {
        const canvas = preview.canvas;
        canvas.width = video.videoWidth || canvas.width || 640;
        canvas.height = video.videoHeight || canvas.height || 480;
        previewCtx.clearRect(0, 0, canvas.width, canvas.height);
        previewCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (filtered) {
          // mirror: false — this is a plain uploaded demo clip drawn straight
          // (ctx.drawImage above applies no flip), not a live selfie camera
          // feed. drawSkeleton's mirror:true default assumes the caller
          // already CSS-mirrored the video (see its JSDoc) — without this
          // override the skeleton is drawn flipped relative to the frame it's
          // overlaid on.
          drawSkeleton(previewCtx, filtered, canvas.width, canvas.height, {
            lineWidth: 3,
            jointRadius: 5,
            mirror: false
          });
        }
      }
      if (preview?.onStatus && !filtered) {
        preview.onStatus("No pose detected in this frame — make sure the full body is visible.");
      }

      onProgress({ currentTimeSeconds: video.currentTime, durationSeconds: duration, sampledFrames: samples.length });
    }

    return samples;
  } finally {
    tracker.dispose();
    video.src = "";
    URL.revokeObjectURL(objectUrl);
  }
}

