// Exercise auto-calibrator — adapted from projectimport/Rehab-AI's
// ai/analysis/exerciseAutoCalibrator.ts (same candidate set, same scoring
// formula range²/total-variation, same FSM derivation with margin scaling).
// Types are this project's: PoseLandmark (ai/poseDetection.ts) instead of the
// import's Landmark, and the shared poseScoringTypes.

import type { PoseLandmark } from "../poseDetection";
import { extractConfiguredAngle } from "./angleExtraction";
import type { AngleDefinition, ExerciseFSMConfig, PoseLandmarkTriplet, PoseVectorPair } from "./poseScoringTypes";

export interface CandidateAngleDefinition {
  id: string;
  label: string;
  angleDefinition: AngleDefinition;
}

interface MovementTypeDef {
  id: string;
  label: string;
  type: "joint" | "vector";
  left: PoseLandmarkTriplet | PoseVectorPair;
  right: PoseLandmarkTriplet | PoseVectorPair;
}

// Movement types covered — elbow flexion/extension, shoulder raise, and
// forearm-direction (vector) movements like external rotation. Poses that
// need z-depth or distance features (oblique twists, scapular protraction)
// are not covered; the calibrator then suggests the closest candidate and
// flags low confidence.
const MOVEMENT_TYPE_DEFS: MovementTypeDef[] = [
  {
    id: "elbow",
    label: "Elbow flexion/extension angle",
    type: "joint",
    left: { a: 11, vertex: 13, c: 15 },
    right: { a: 12, vertex: 14, c: 16 }
  },
  {
    id: "shoulder",
    label: "Shoulder raise/abduction angle",
    type: "joint",
    left: { a: 23, vertex: 11, c: 13 },
    right: { a: 24, vertex: 12, c: 14 }
  },
  {
    id: "forearm_vertical",
    label: "Forearm direction vs vertical — rotation poses",
    type: "vector",
    left: { from: 13, to: 15, reference: "vertical" },
    right: { from: 14, to: 16, reference: "vertical" }
  },
  {
    id: "forearm_horizontal",
    label: "Forearm direction vs horizontal",
    type: "vector",
    left: { from: 13, to: 15, reference: "horizontal" },
    right: { from: 14, to: 16, reference: "horizontal" }
  }
];

function buildBilateralDef(m: MovementTypeDef): AngleDefinition {
  return m.type === "joint"
    ? { type: "joint", bilateral: true, left: m.left as PoseLandmarkTriplet, right: m.right as PoseLandmarkTriplet }
    : { type: "vector", bilateral: true, left: m.left as PoseVectorPair, right: m.right as PoseVectorPair };
}

function buildSingleDef(m: MovementTypeDef, side: "left" | "right"): AngleDefinition {
  const point = m[side];
  return m.type === "joint"
    ? { type: "joint", bilateral: false, single: point as PoseLandmarkTriplet }
    : { type: "vector", bilateral: false, single: point as PoseVectorPair };
}

// Legacy bilateral-only candidate set — kept for reference/back-compat, no
// longer used as the default for rankCandidates/calibrateFromFrames (see
// buildLateralityAwareCandidates below).
export const CANDIDATE_ANGLE_DEFINITIONS: CandidateAngleDefinition[] = MOVEMENT_TYPE_DEFS.map((m) => ({
  id: `bilateral_${m.id}`,
  label: `${m.label} (both sides)`,
  angleDefinition: buildBilateralDef(m)
}));

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

// Below this range (degrees), a side isn't considered to have moved at all —
// guards against a resting arm's tiny tracking jitter being counted as motion
// (same threshold as the confidence:'low' cutoff in deriveFsmConfigFromSeries
// below, so "did it really move" reads consistently across this file).
export const MIN_MEANINGFUL_RANGE_DEG = 8;

// If the less-active side's range is below this fraction of the dominant
// side's range, treat the clip as a single-arm exercise. 0.35 leaves room for
// a weaker arm that still moves a little even when both arms are intended.
export const UNILATERAL_RANGE_RATIO_THRESHOLD = 0.35;

/**
 * Checks each movement type against this clip's actual left/right range of
 * motion and returns one appropriate candidate per movement type — a
 * bilateral candidate when both arms moved together, or a single-sided
 * candidate for whichever arm actually moved when the clip is unilateral.
 */
export function buildLateralityAwareCandidates(frames: FrameSample[]): CandidateAngleDefinition[] {
  return MOVEMENT_TYPE_DEFS.map((m) => {
    const leftDef = buildSingleDef(m, "left");
    const rightDef = buildSingleDef(m, "right");
    const leftRange = scoreSeries(computeSeries(frames, leftDef)).range;
    const rightRange = scoreSeries(computeSeries(frames, rightDef)).range;
    const dominantRange = Math.max(leftRange, rightRange);
    const minorRange = Math.min(leftRange, rightRange);
    const ratio = dominantRange > 0 ? minorRange / dominantRange : 1;
    const isUnilateral = dominantRange >= MIN_MEANINGFUL_RANGE_DEG && ratio < UNILATERAL_RANGE_RATIO_THRESHOLD;

    if (isUnilateral) {
      const dominantIsRight = rightRange >= leftRange;
      return {
        id: `${m.id}_single_${dominantIsRight ? "right" : "left"}`,
        label: `${m.label} (${dominantIsRight ? "right" : "left"} arm only)`,
        angleDefinition: dominantIsRight ? rightDef : leftDef
      };
    }

    return { id: `bilateral_${m.id}`, label: `${m.label} (both sides)`, angleDefinition: buildBilateralDef(m) };
  });
}

export function rankCandidates(
  frames: FrameSample[],
  candidates: CandidateAngleDefinition[] = buildLateralityAwareCandidates(frames)
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

/** Entry point: analyzes the whole demo clip (landmark frame sequence). The
 *  default candidates come from buildLateralityAwareCandidates(frames) — a
 *  pure function of this same frame set, so it always agrees with a
 *  rankCandidates(frames) call made from the same frames, wherever it's
 *  called from. */
export function calibrateFromFrames(
  frames: FrameSample[],
  candidates: CandidateAngleDefinition[] = buildLateralityAwareCandidates(frames)
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

