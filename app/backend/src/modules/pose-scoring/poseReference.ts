// Pose reference resolution — connects the Exercise Library's stored
// base_criteria JSON (exercise_library.base_criteria, Prisma Json column) to
// the scoring engine. The Rehab-AI reference_data.json format is stored under
// base_criteria.poseReference; angle definitions / FSM config fall back to
// the bilateral-elbow defaults the import project used so seeded exercises
// (which only store { targetAngleDeg, repetitions }) still work end-to-end.
//
// masterSamples stay server-side: they feed DTW/K-NN scoring only and are
// never sent to the client.

import {
  AngleDefinition,
  ExerciseFSMConfig,
  MasterSample,
  PoseReference,
  PoseReferencePublic
} from "./poseScoring.types";

// Defaults from projectimport/Rehab-AI's ai/config/exercisePresets.ts —
// bilateral elbow extension (MediaPipe Pose landmark indices 11/13/15, 12/14/16).
export const DEFAULT_PRIMARY_ANGLE_DEFINITION: AngleDefinition = {
  type: "joint",
  bilateral: true,
  left: { a: 11, vertex: 13, c: 15 },
  right: { a: 12, vertex: 14, c: 16 }
};

export const DEFAULT_SECONDARY_ANGLE_DEFINITION: AngleDefinition = {
  type: "joint",
  bilateral: true,
  left: { a: 23, vertex: 11, c: 13 },
  right: { a: 24, vertex: 12, c: 14 }
};

export const DEFAULT_FSM_CONFIG: ExerciseFSMConfig = {
  readyAngleThreshold: 85,
  readyComparator: "greaterThan",
  readyHoldSeconds: 1.5,
  activationThreshold: 45,
  activationComparator: "lessThan",
  returnThreshold: 80,
  returnComparator: "greaterThan",
  minRepFrames: 20,
  romReferenceAngle: 180
};

// Fallback scoring criteria (the import project's elbow-extension defaults).
const DEFAULT_TARGET_ROM = 90;
const DEFAULT_BVE_THRESHOLD = 0.03;
const DEFAULT_ENABLE_TRUNK_BVE = true;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeFSMConfig(raw: unknown): ExerciseFSMConfig {
  const cfg = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    readyAngleThreshold: isFiniteNumber(cfg.readyAngleThreshold) ? cfg.readyAngleThreshold : DEFAULT_FSM_CONFIG.readyAngleThreshold,
    readyComparator: cfg.readyComparator === "lessThan" ? "lessThan" : "greaterThan",
    readyHoldSeconds: isFiniteNumber(cfg.readyHoldSeconds) ? cfg.readyHoldSeconds : DEFAULT_FSM_CONFIG.readyHoldSeconds,
    activationThreshold: isFiniteNumber(cfg.activationThreshold) ? cfg.activationThreshold : DEFAULT_FSM_CONFIG.activationThreshold,
    activationComparator: cfg.activationComparator === "greaterThan" ? "greaterThan" : "lessThan",
    returnThreshold: isFiniteNumber(cfg.returnThreshold) ? cfg.returnThreshold : DEFAULT_FSM_CONFIG.returnThreshold,
    returnComparator: cfg.returnComparator === "lessThan" ? "lessThan" : "greaterThan",
    minRepFrames: isFiniteNumber(cfg.minRepFrames) ? Math.max(1, Math.round(cfg.minRepFrames)) : DEFAULT_FSM_CONFIG.minRepFrames,
    romReferenceAngle: isFiniteNumber(cfg.romReferenceAngle) ? cfg.romReferenceAngle : DEFAULT_FSM_CONFIG.romReferenceAngle,
    // Optional start-pose orientation gate — only present when authored.
    ...(isFiniteNumber(cfg.readySecondaryAngleTarget) ? { readySecondaryAngleTarget: cfg.readySecondaryAngleTarget } : {}),
    ...(isFiniteNumber(cfg.readySecondaryAngleTolerance) ? { readySecondaryAngleTolerance: cfg.readySecondaryAngleTolerance } : {})
  };
}

function normalizeAngleDefinition(raw: unknown, fallback: AngleDefinition): AngleDefinition {
  if (!raw || typeof raw !== "object") return fallback;
  const def = raw as Record<string, unknown>;
  if (def.type !== "joint" && def.type !== "vector") return fallback;
  return JSON.parse(JSON.stringify(def)) as AngleDefinition;
}

function normalizeMasterSamples(raw: unknown): MasterSample[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
    .map((sample, index) => {
      const frames = Array.isArray(sample.frames) ? (sample.frames as MasterSample["frames"]) : [];
      return {
        sampleId: isFiniteNumber(sample.sampleId) ? sample.sampleId : index,
        description: typeof sample.description === "string" ? sample.description : `sample-${index}`,
        totalFrames: isFiniteNumber(sample.totalFrames) ? sample.totalFrames : frames.length,
        frames
      };
    })
    .filter((s) => s.frames.length > 0);
}

// Keeps only what detailedFeedback needs from the authoring autoAnalysis block
// (secondary candidate id + ranked candidates' id/label); anything malformed =>
// undefined, which makes the secondary-joint feedback axis skip itself.
function normalizeAutoAnalysis(raw: unknown): PoseReference["autoAnalysis"] {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Record<string, unknown>;
  if (typeof a.secondaryCandidateId !== "string" || !Array.isArray(a.rankedCandidates)) return undefined;
  const rankedCandidates = a.rankedCandidates
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
    .filter((c) => typeof c.id === "string" && typeof c.label === "string")
    .map((c) => ({ id: c.id as string, label: c.label as string }));
  if (rankedCandidates.length === 0) return undefined;
  return { secondaryCandidateId: a.secondaryCandidateId, rankedCandidates };
}

/**
 * Reads the pose reference out of one exercise_library row's base_criteria.
 * Returns null when the exercise has no poseReference block at all.
 */
export function resolvePoseReference(baseCriteria: unknown): PoseReference | null {
  if (!baseCriteria || typeof baseCriteria !== "object" || Array.isArray(baseCriteria)) return null;
  const raw = (baseCriteria as Record<string, unknown>).poseReference;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const ref = raw as Record<string, unknown>;
  const masterSamples = normalizeMasterSamples(ref.masterSamples);
  const wrongFormSamples = normalizeMasterSamples(ref.wrongFormSamples);

  return {
    angleDefinition: normalizeAngleDefinition(ref.angleDefinition, DEFAULT_PRIMARY_ANGLE_DEFINITION),
    secondaryAngleDefinition: normalizeAngleDefinition(ref.secondaryAngleDefinition, DEFAULT_SECONDARY_ANGLE_DEFINITION),
    fsmConfig: normalizeFSMConfig(ref.fsmConfig),
    targetRom: isFiniteNumber(ref.targetRom) ? ref.targetRom : DEFAULT_TARGET_ROM,
    bveThreshold: isFiniteNumber(ref.bveThreshold) ? ref.bveThreshold : DEFAULT_BVE_THRESHOLD,
    enableTrunkBve: typeof ref.enableTrunkBve === "boolean" ? ref.enableTrunkBve : DEFAULT_ENABLE_TRUNK_BVE,
    // Not set = false (penalty enabled per the vector-type rule) — see comment
    // on PoseReferencePublic.allowsTorsoMovement in poseScoring.types.ts.
    allowsTorsoMovement: typeof ref.allowsTorsoMovement === "boolean" ? ref.allowsTorsoMovement : false,
    // Not set = false (no hand-separation penalty, the previous behavior) —
    // see comment on PoseReferencePublic.checksHandProximity.
    checksHandProximity: typeof ref.checksHandProximity === "boolean" ? ref.checksHandProximity : false,
    targetJoint: typeof ref.targetJoint === "string" ? ref.targetJoint : undefined,
    autoAnalysis: normalizeAutoAnalysis(ref.autoAnalysis),
    masterSamples,
    wrongFormSamples: wrongFormSamples.length > 0 ? wrongFormSamples : undefined
  };
}

/** Client-visible projection: everything needed to detect/track reps, no reference samples. */
export function toPublicReference(reference: PoseReference): PoseReferencePublic {
  return {
    angleDefinition: reference.angleDefinition,
    secondaryAngleDefinition: reference.secondaryAngleDefinition,
    fsmConfig: reference.fsmConfig,
    targetRom: reference.targetRom,
    bveThreshold: reference.bveThreshold,
    enableTrunkBve: reference.enableTrunkBve,
    allowsTorsoMovement: reference.allowsTorsoMovement,
    checksHandProximity: reference.checksHandProximity
  };
}
