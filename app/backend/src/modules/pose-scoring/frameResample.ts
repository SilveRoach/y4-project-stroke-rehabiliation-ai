// Frame-rate normalization for scoring.
//
// The reference clips (master / wrong-form samples) are scanned offline at a
// fixed 30 fps (frontend videoPoseScanner SCAN_FPS), but a live session only
// runs pose detection at ~15 fps (PatientSessionPage throttles it). Several
// scored features are NOT frame-rate invariant: the K-NN gate uses per-frame
// jerk (second difference of the angle — about 4x larger at half the frame
// rate for the same movement) and the rep length in frames, so identical,
// correct movement looked "unlike the reference" at 15 fps and lost 10 points
// to the K-NN penalty. Resampling the patient's rep to the reference rate
// (linear interpolation by timestamp) makes the comparison like-for-like.

import { FrameFeature } from "./poseScoring.types";

/** Sampling rate the reference samples were captured at (videoPoseScanner SCAN_FPS). */
export const REFERENCE_SAMPLE_FPS = 30;

const NUMERIC_KEYS = [
  "elbowAngle",
  "shoulderAngle",
  "leftElbowAngle",
  "rightElbowAngle",
  "pinchDistance",
  "shoulderWidthNorm",
  "wristDistanceNorm"
] as const;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolate(a: FrameFeature, b: FrameFeature, t: number, timestampMs: number): FrameFeature {
  const out: FrameFeature = {
    ...a,
    trunkCentroid: { x: lerp(a.trunkCentroid.x, b.trunkCentroid.x, t), y: lerp(a.trunkCentroid.y, b.trunkCentroid.y, t) },
    timestampMs
  };
  for (const key of NUMERIC_KEYS) {
    const av = a[key];
    const bv = b[key];
    if (av !== undefined && bv !== undefined) out[key] = lerp(av, bv, t);
  }
  if (a.rawTrunkCentroid && b.rawTrunkCentroid) {
    out.rawTrunkCentroid = {
      x: lerp(a.rawTrunkCentroid.x, b.rawTrunkCentroid.x, t),
      y: lerp(a.rawTrunkCentroid.y, b.rawTrunkCentroid.y, t)
    };
  }
  return out;
}

/**
 * Resamples a rep's frames to a uniform `fps` using each frame's timestampMs.
 * Returns the input unchanged when timestamps are missing/invalid or the rep
 * is already at (or above) the target rate, so older clients keep working.
 */
export function resampleFramesToRate(frames: FrameFeature[], fps: number = REFERENCE_SAMPLE_FPS): FrameFeature[] {
  if (frames.length < 2) return frames;
  const times = frames.map((f) => f.timestampMs);
  if (times.some((t) => t === undefined || !Number.isFinite(t))) return frames;
  const ts = times as number[];
  for (let i = 1; i < ts.length; i++) if (ts[i] <= ts[i - 1]) return frames;

  const stepMs = 1000 / fps;
  const meanIntervalMs = (ts[ts.length - 1] - ts[0]) / (ts.length - 1);
  if (meanIntervalMs <= stepMs * 1.15) return frames; // already ~at/above the reference rate

  const out: FrameFeature[] = [];
  let segment = 0;
  for (let t = ts[0]; t <= ts[ts.length - 1] + 1e-6; t += stepMs) {
    while (segment < ts.length - 2 && ts[segment + 1] < t) segment++;
    const span = ts[segment + 1] - ts[segment];
    const ratio = span > 0 ? Math.min(1, Math.max(0, (t - ts[segment]) / span)) : 0;
    out.push(interpolate(frames[segment], frames[segment + 1], ratio, t));
  }
  return out;
}
