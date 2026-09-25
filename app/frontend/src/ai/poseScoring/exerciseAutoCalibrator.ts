// Exercise auto-calibrator — adapted from projectimport/Rehab-AI's
// ai/analysis/exerciseAutoCalibrator.ts (same candidate set, same scoring
// formula range²/total-variation, same FSM derivation with margin scaling).
// Types are this project's: PoseLandmark (ai/poseDetection.ts) instead of the
// import's Landmark, and the shared poseScoringTypes.

import type { PoseLandmark } from "../poseDetection";
import { extractConfiguredAngle } from "./angleExtraction";
import type { AngleDefinition, ExerciseFSMConfig } from "./poseScoringTypes";

export interface CandidateAngleDefinition {
  id: string;
  label: string;
  angleDefinition: AngleDefinition;
}

// Default candidate set — covers elbow flexion/extension, shoulder raise,
// and forearm-direction (vector) movements like external rotation. Poses that
// need z-depth or distance features (oblique twists, scapular protraction)
// are not covered; the calibrator then suggests the closest candidate and
// flags low confidence.
export const CANDIDATE_ANGLE_DEFINITIONS: CandidateAngleDefinition[] = [
  {
    id: "bilateral_elbow",
    label: "Elbow flexion/extension angle (both sides)",
    angleDefinition: { type: "joint", bilateral: true, left: { a: 11, vertex: 13, c: 15 }, right: { a: 12, vertex: 14, c: 16 } }
  },
  {
    id: "bilateral_shoulder",
    label: "Shoulder raise/abduction angle (both sides)",
    angleDefinition: { type: "joint", bilateral: true, left: { a: 23, vertex: 11, c: 13 }, right: { a: 24, vertex: 12, c: 14 } }
  },
  {
    id: "bilateral_forearm_vertical",
    label: "Forearm direction vs vertical (both sides) — rotation poses",
    angleDefinition: {
      type: "vector",
      bilateral: true,
      left: { from: 13, to: 15, reference: "vertical" },
      right: { from: 14, to: 16, reference: "vertical" }
    }
  },
  {
    id: "bilateral_forearm_horizontal",
    label: "Forearm direction vs horizontal (both sides)",
    angleDefinition: {
      type: "vector",
      bilateral: true,
      left: { from: 13, to: 15, reference: "horizontal" },
      right: { from: 14, to: 16, reference: "horizontal" }
    }
  }
];

export interface FrameSample {
  landmarks: PoseLandmark[];
  trunkCentroid: { x: number; y: number };
  timestampMs: number;
  /** Position on the demo clip (video.currentTime at scan time, seconds). */
  videoTimeSeconds: number;
}

export interface ScoredCandidate {
  id: string;
  label: string;
  angleDefinition: AngleDefinition;
  series: number[];
  range: number;
  score: number;
}

function computeSeries(frames: FrameSample[], def: AngleDefinition): number[] {
  return frames.map((f) => extractConfiguredAngle(f.landmarks, def).mean);
}

/** score = (actual angular range)² / (total variation) — high for angles that move far AND smoothly. */
function scoreSeries(series: number[]): { range: number; score: number } {
  if (series.length < 2) return { range: 0, score: 0 };
  let min = Infinity;
  let max = -Infinity;
  let totalVariation = 0;
  for (let i = 0; i < series.length; i++) {
    if (series[i] < min) min = series[i];
    if (series[i] > max) max = series[i];
    if (i > 0) totalVariation += Math.abs(series[i] - series[i - 1]);
  }
  const range = max - min;
  const score = totalVariation > 0 ? (range * range) / totalVariation : 0;
  return { range, score };
}

export function rankCandidates(
  frames: FrameSample[],
  candidates: CandidateAngleDefinition[] = CANDIDATE_ANGLE_DEFINITIONS
): ScoredCandidate[] {
  return candidates
    .map((c) => {
      const series = computeSeries(frames, c.angleDefinition);
      const { range, score } = scoreSeries(series);
      return { id: c.id, label: c.label, angleDefinition: c.angleDefinition, series, range, score };
    })
    .sort((a, b) => b.score - a.score);
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const READY_MARGIN_RATIO = 0.15;
const ACTIVATION_MARGIN_RATIO = 0.15;
const RETURN_MARGIN_RATIO = 0.3;
const DEFAULT_MIN_REP_FRAMES = 15;
const DEFAULT_READY_HOLD_SECONDS = 1.5;

/** Default rep-counting strictness — identical behavior at scale = 1. */
export const DEFAULT_FSM_MARGIN_SCALE = 1;
/** Bounds so margins can never become nonsensical (e.g. return crossing into activation). */
export const FSM_MARGIN_SCALE_MIN = 0.4;
export const FSM_MARGIN_SCALE_MAX = 1.6;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export interface DerivedFsmResult {
  fsmConfig: ExerciseFSMConfig;
  direction: "increase" | "decrease";
  baseline: number;
  extreme: number;
  range: number;
  confidence: "low" | "medium" | "high";
}

/**
 * Derives the FSM criteria (ready/activation/return + direction) from one
 * selected angle time-series. marginScale (default 1 = identical behavior) is
 * the single "rep-counting strictness" knob: it scales all three margins at
 * once — <1 stricter, >1 more forgiving.
 */
export function deriveFsmConfigFromSeries(series: number[], marginScale: number = DEFAULT_FSM_MARGIN_SCALE): DerivedFsmResult {
  const scale = clamp(marginScale, FSM_MARGIN_SCALE_MIN, FSM_MARGIN_SCALE_MAX);
  const readyMargin = READY_MARGIN_RATIO * scale;
  const activationMargin = clamp(ACTIVATION_MARGIN_RATIO * scale, 0, 0.45);
  const returnMargin = clamp(RETURN_MARGIN_RATIO * scale, 0, 0.6);

  if (series.length < 2) {
    return {
      fsmConfig: {
        readyAngleThreshold: 85,
        readyComparator: "greaterThan",
        readyHoldSeconds: DEFAULT_READY_HOLD_SECONDS,
        activationThreshold: 45,
        activationComparator: "lessThan",
        returnThreshold: 80,
        returnComparator: "greaterThan",
        minRepFrames: DEFAULT_MIN_REP_FRAMES,
        romReferenceAngle: 180
      },
      direction: "decrease",
      baseline: 0,
      extreme: 0,
      range: 0,
      confidence: "low"
    };
  }

  const baselineWindowSize = Math.max(3, Math.round(series.length * 0.15));
  const baseline = median(series.slice(0, baselineWindowSize));
  const min = Math.min(...series);
  const max = Math.max(...series);

  const decreaseDistance = baseline - min;
  const increaseDistance = max - baseline;
  const direction: "decrease" | "increase" = decreaseDistance >= increaseDistance ? "decrease" : "increase";
  const extreme = direction === "decrease" ? min : max;
  const range = Math.max(Math.abs(extreme - baseline), 1e-6);

  const fsmConfig: ExerciseFSMConfig =
    direction === "decrease"
      ? {
          readyAngleThreshold: round1(baseline - readyMargin * range),
          readyComparator: "greaterThan",
          readyHoldSeconds: DEFAULT_READY_HOLD_SECONDS,
          activationThreshold: round1(extreme + activationMargin * range),
          activationComparator: "lessThan",
          returnThreshold: round1(baseline - returnMargin * range),
          returnComparator: "greaterThan",
          minRepFrames: DEFAULT_MIN_REP_FRAMES,
          romReferenceAngle: 180
        }
      : {
          readyAngleThreshold: round1(baseline + readyMargin * range),
          readyComparator: "lessThan",
          readyHoldSeconds: DEFAULT_READY_HOLD_SECONDS,
          activationThreshold: round1(extreme - activationMargin * range),
          activationComparator: "greaterThan",
          returnThreshold: round1(baseline + returnMargin * range),
          returnComparator: "lessThan",
          minRepFrames: DEFAULT_MIN_REP_FRAMES,
          romReferenceAngle: 0
        };

  const confidence: DerivedFsmResult["confidence"] = range < 8 ? "low" : range < 20 ? "medium" : "high";

  return { fsmConfig, direction, baseline: round1(baseline), extreme: round1(extreme), range: round1(range), confidence };
}

/**
 * Derives the FSM criteria from therapist-marked checkpoints (ready/active/
 * return angles) instead of statistically inferring the baseline — more
 * accurate when the clip lacks a long enough still opening. marginScale has
 * the same meaning as in deriveFsmConfigFromSeries.
 */
export function deriveFsmConfigFromCheckpoints(
  readyAngle: number,
  activeAngle: number,
  returnAngle: number,
  marginScale: number = DEFAULT_FSM_MARGIN_SCALE
): DerivedFsmResult {
  const scale = clamp(marginScale, FSM_MARGIN_SCALE_MIN, FSM_MARGIN_SCALE_MAX);
  const readyMargin = READY_MARGIN_RATIO * scale;
  const activationMargin = clamp(ACTIVATION_MARGIN_RATIO * scale, 0, 0.45);
  const returnMargin = clamp(RETURN_MARGIN_RATIO * scale, 0, 0.6);

  const baseline = readyAngle;
  const extreme = activeAngle;
  const range = Math.max(Math.abs(extreme - baseline), 1e-6);
  const direction: "decrease" | "increase" = extreme <= baseline ? "decrease" : "increase";

  const fsmConfig: ExerciseFSMConfig =
    direction === "decrease"
      ? {
          readyAngleThreshold: round1(baseline - readyMargin * range),
          readyComparator: "greaterThan",
          readyHoldSeconds: DEFAULT_READY_HOLD_SECONDS,
          activationThreshold: round1(extreme + activationMargin * range),
          activationComparator: "lessThan",
          returnThreshold: round1(returnAngle - returnMargin * range),
          returnComparator: "greaterThan",
          minRepFrames: DEFAULT_MIN_REP_FRAMES,
          romReferenceAngle: 180
        }
      : {
          readyAngleThreshold: round1(baseline + readyMargin * range),
          readyComparator: "lessThan",
          readyHoldSeconds: DEFAULT_READY_HOLD_SECONDS,
          activationThreshold: round1(extreme - activationMargin * range),
          activationComparator: "greaterThan",
          returnThreshold: round1(returnAngle + returnMargin * range),
          returnComparator: "lessThan",
          minRepFrames: DEFAULT_MIN_REP_FRAMES,
          romReferenceAngle: 0
        };

  const confidence: DerivedFsmResult["confidence"] = range < 8 ? "low" : range < 20 ? "medium" : "high";

  return { fsmConfig, direction, baseline: round1(baseline), extreme: round1(extreme), range: round1(range), confidence };
}

export interface CalibrationResult {
  primary: { id: string; label: string; angleDefinition: AngleDefinition };
  secondary: { id: string; label: string; angleDefinition: AngleDefinition };
  derived: DerivedFsmResult;
  suggestedTargetRom: number;
  rankedCandidates: { id: string; label: string; range: number; score: number }[];
}

/** Entry point: analyzes the whole demo clip (landmark frame sequence). */
export function calibrateFromFrames(
  frames: FrameSample[],
  candidates: CandidateAngleDefinition[] = CANDIDATE_ANGLE_DEFINITIONS
): CalibrationResult {
  const ranked = rankCandidates(frames, candidates);
  const primaryCandidate = ranked[0];
  const secondaryCandidate = ranked.find((c) => c.id !== primaryCandidate.id) ?? primaryCandidate;
  const derived = deriveFsmConfigFromSeries(primaryCandidate.series);

  return {
    primary: { id: primaryCandidate.id, label: primaryCandidate.label, angleDefinition: primaryCandidate.angleDefinition },
    secondary: { id: secondaryCandidate.id, label: secondaryCandidate.label, angleDefinition: secondaryCandidate.angleDefinition },
    derived,
    suggestedTargetRom: Math.max(10, Math.round(derived.range)),
    rankedCandidates: ranked.map(({ id, label, range, score }) => ({
      id,
      label,
      range: round1(range),
      score: Math.round(score * 100) / 100
    }))
  };
}

