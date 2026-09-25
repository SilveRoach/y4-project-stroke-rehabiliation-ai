// Configured angle extraction — adapted from projectimport/Rehab-AI's
// ai/extractors/angleExtractor.ts + configuredAngleExtractor.ts, typed against
// this project's PoseLandmark (ai/poseDetection.ts) instead of the import
// project's own Landmark. Computes the exercise's primary/secondary angles
// from live MediaPipe pose landmarks according to the AngleDefinition stored
// with the exercise in the Exercise Library (no per-exercise hardcoding).

import type { PoseLandmark } from "../poseDetection";
import type { AngleDefinition } from "./poseScoringTypes";

export function calculateJointAngle(pA: PoseLandmark, pB: PoseLandmark, pC: PoseLandmark): number {
  const u = { x: pA.x - pB.x, y: pA.y - pB.y };
  const v = { x: pC.x - pB.x, y: pC.y - pB.y };

  const dot = u.x * v.x + u.y * v.y;
  const magU = Math.hypot(u.x, u.y);
  const magV = Math.hypot(v.x, v.y);

  if (magU === 0 || magV === 0) return 0;
  const cosine = Math.min(1.0, Math.max(-1.0, dot / (magU * magV)));
  return (Math.acos(cosine) * 180) / Math.PI;
}

/**
 * Angle of vector (from -> to) against a reference axis — for movements that
 * are not a plain 3-point joint flexion (e.g. external rotation where the
 * elbow stays pinned and the forearm rotates away from the torso).
 */
export function calculateVectorAngle(
  from: PoseLandmark,
  to: PoseLandmark,
  reference: "vertical" | "horizontal" = "vertical"
): number {
  const v = { x: to.x - from.x, y: to.y - from.y };
  const magV = Math.hypot(v.x, v.y);
  if (magV === 0) return 0;

  // Image coordinate system: y points down, so "vertical" reference (0,1)
  // points straight down and "horizontal" (1,0) points right.
  const ref = reference === "vertical" ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const dot = v.x * ref.x + v.y * ref.y;
  const cosine = Math.min(1.0, Math.max(-1.0, dot / magV));
  return (Math.acos(cosine) * 180) / Math.PI;
}

export interface ConfiguredAngleResult {
  mean: number;
  left?: number;
  right?: number;
}

/**
 * Computes the angle defined by the exercise's AngleDefinition (from the
 * Exercise Library). Supports both 3-point joint angles (type: "joint") and
 * vector-vs-reference-axis angles (type: "vector") so no per-exercise angle
 * formula is hardcoded.
 */
export function extractConfiguredAngle(landmarks: PoseLandmark[], def: AngleDefinition): ConfiguredAngleResult {
  if (def.type === "joint") {
    if (def.bilateral && def.left && def.right) {
      const left = calculateJointAngle(landmarks[def.left.a], landmarks[def.left.vertex], landmarks[def.left.c]);
      const right = calculateJointAngle(landmarks[def.right.a], landmarks[def.right.vertex], landmarks[def.right.c]);
      return { mean: (left + right) / 2, left, right };
    }
    if (def.single) {
      const value = calculateJointAngle(landmarks[def.single.a], landmarks[def.single.vertex], landmarks[def.single.c]);
      return { mean: value };
    }
  } else if (def.type === "vector") {
    if (def.bilateral && def.left && def.right) {
      const left = calculateVectorAngle(landmarks[def.left.from], landmarks[def.left.to], def.left.reference);
      const right = calculateVectorAngle(landmarks[def.right.from], landmarks[def.right.to], def.right.reference);
      return { mean: (left + right) / 2, left, right };
    }
    if (def.single) {
      const value = calculateVectorAngle(landmarks[def.single.from], landmarks[def.single.to], def.single.reference);
      return { mean: value };
    }
  }

  return { mean: 0 };
}
