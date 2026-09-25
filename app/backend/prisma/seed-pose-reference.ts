// Seed: attach pose references to the seeded pose exercises so the AI
// pose-tracking flow (PatientSessionPage, movementTracking=pose) can actually
// score repetitions.
//
// WHY THIS EXISTS: exercise_library.base_criteria for the seeded pose
// exercises only stores { targetAngleDeg | holdSeconds, repetitions } — no
// baseCriteria.poseReference block. Without one, GET /scheduled-exercises/:id/
// pose-reference returns null and POST /scheduled-exercises/:id/pose-rep-score
// fails with "no pose reference criteria stored" (by design — the final score
// must come from a stored reference, never invented client-side).
//
// WHAT IT WRITES: base_criteria.poseReference in the Rehab-AI
// reference_data.json shape — angleDefinition / secondaryAngleDefinition /
// fsmConfig / targetRom / bveThreshold / enableTrunkBve / masterSamples —
// where masterSamples are the reference skeleton FEATURE sequences
// (FrameFeature[]) the backend DTW/K-NN scoring compares patient reps against
// (they are normalized joint angles + trunk centroid, NOT raw video/landmarks;
// the same shape projectimport/Rehab-AI's CreateExerciseView produced from a
// therapist demo clip, synthesized here per exercise from its own criteria).
//
// IDEMPOTENT: merges poseReference into the existing baseCriteria JSON and
// skips exercises that already carry one. Safe to re-run.
//
// Run:  npm run prisma:seed:pose   (from app/backend)

import { PrismaClient } from "@prisma/client";
import type {
  AngleDefinition,
  ExerciseFSMConfig,
  FrameFeature,
  MasterSample
} from "../src/modules/pose-scoring/poseScoring.types";

const prisma = new PrismaClient();

// Shared bilateral definitions (MediaPipe Pose 33-point indices) — the same
// defaults the pose-scoring module falls back to.
const ELBOW_ANGLE: AngleDefinition = {
  type: "joint",
  bilateral: true,
  left: { a: 11, vertex: 13, c: 15 },
  right: { a: 12, vertex: 14, c: 16 }
};
const SHOULDER_ANGLE: AngleDefinition = {
  type: "joint",
  bilateral: true,
  left: { a: 23, vertex: 11, c: 13 },
  right: { a: 24, vertex: 12, c: 14 }
};
// Standing March tracks the KNEE (hip-knee-ankle) — proof criteria are
// config-driven per exercise, not hardcoded to the elbow.
const KNEE_ANGLE: AngleDefinition = {
  type: "joint",
  bilateral: true,
  left: { a: 23, vertex: 25, c: 27 },
  right: { a: 24, vertex: 26, c: 28 }
};
const HIP_TORSO_ANGLE: AngleDefinition = {
  type: "joint",
  bilateral: true,
  left: { a: 11, vertex: 23, c: 25 },
  right: { a: 12, vertex: 24, c: 26 }
};

interface PoseSeedDefinition {
  /** Exact exercise_library.name from seed-full.ts. */
  exerciseName: string;
  /** Thai label for the starting position prompt shown in the session UI. */
  label: string;
  angleDefinition: AngleDefinition;
  secondaryAngleDefinition: AngleDefinition;
  fsmConfig: ExerciseFSMConfig;
  /** Movement's target range (degrees) — feeds romScore in computeRepScore. */
  targetRom: number;
  /** Angle the primary joint rests at (the starting position). */
  restAngle: number;
  /** Angle at the movement's far end. */
  activeAngle: number;
  /** Frames per reference rep (~15fps pipeline => 30 frames ≈ 2s). */
  frames: number;
  bveThreshold: number;
}

/** Smooth out-and-back reference curve with light deterministic jitter. */
function buildReferenceFrames(seed: PoseSeedDefinition, rngSeed: number): FrameFeature[] {
  let state = rngSeed;
  const rng = () => {
    // Deterministic LCG so the seed is reproducible run-to-run.
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const noise = (magnitude: number) => (rng() * 2 - 1) * magnitude;

  return Array.from({ length: seed.frames }, (_, frameIndex) => {
    // 0..1..0 smoothstep triangle across the rep (out and back to start pose).
    const half = (seed.frames - 1) / 2;
    const t = 1 - Math.abs(frameIndex - half) / half;
    const eased = t * t * (3 - 2 * t);
    const primaryAngle = seed.restAngle + (seed.activeAngle - seed.restAngle) * eased + noise(1.5);
    const secondaryAngle = (seed.restAngle + seed.activeAngle) / 2 + noise(2);
    return {
      elbowAngle: primaryAngle,
      shoulderAngle: secondaryAngle,
      leftElbowAngle: primaryAngle + noise(1),
      rightElbowAngle: primaryAngle + noise(1),
      pinchDistance: 0,
      trunkCentroid: { x: 0.5 + noise(0.004), y: 0.5 + noise(0.004) }
    };
  });
}

const SEEDS: PoseSeedDefinition[] = [
  {
    exerciseName: "งอศอกกับดัมเบลเบา (Weighted Elbow Curl)",
    label: "ยืดแขนตรงลงข้างลำตัว",
    angleDefinition: ELBOW_ANGLE,
    secondaryAngleDefinition: SHOULDER_ANGLE,
    fsmConfig: {
      readyAngleThreshold: 140,
      readyComparator: "greaterThan",
      readyHoldSeconds: 1.5,
      activationThreshold: 60,
      activationComparator: "lessThan",
      returnThreshold: 130,
      returnComparator: "greaterThan",
      minRepFrames: 20,
      romReferenceAngle: 180
    },
    targetRom: 120,
    restAngle: 165,
    activeAngle: 55,
    frames: 30,
    bveThreshold: 0.03
  },
  {
    exerciseName: "ยืดกล้ามเนื้อไหล่ขึ้นตึง (Shoulder Flexion Stretch)",
    label: "ห้อยแขนลงข้างลำตัว",
    angleDefinition: SHOULDER_ANGLE,
    secondaryAngleDefinition: ELBOW_ANGLE,
    fsmConfig: {
      readyAngleThreshold: 55,
      readyComparator: "lessThan",
      readyHoldSeconds: 1.5,
      activationThreshold: 85,
      activationComparator: "greaterThan",
      returnThreshold: 45,
      returnComparator: "lessThan",
      minRepFrames: 20,
      romReferenceAngle: 180
    },
    targetRom: 90,
    restAngle: 40,
    activeAngle: 130,
    frames: 34,
    bveThreshold: 0.03
  },
  {
    exerciseName: "ยกเข่ายืนเหยียบตรง (Assisted Standing March)",
    label: "ยืนตรง ขาแตะพื้นสองข้าง",
    angleDefinition: KNEE_ANGLE,
    secondaryAngleDefinition: HIP_TORSO_ANGLE,
    fsmConfig: {
      readyAngleThreshold: 160,
      readyComparator: "greaterThan",
      readyHoldSeconds: 1.5,
      activationThreshold: 100,
      activationComparator: "lessThan",
      returnThreshold: 150,
      returnComparator: "greaterThan",
      minRepFrames: 20,
      romReferenceAngle: 180
    },
    targetRom: 60,
    restAngle: 172,
    activeAngle: 95,
    frames: 30,
    bveThreshold: 0.03
  }
];

function buildMasterSamples(seed: PoseSeedDefinition, seedIndex: number): MasterSample[] {
  // Three takes of the same reference movement (like a therapist demoing the
  // exercise a few times) so DTW picks the closest one.
  return [1, 2, 3].map((take) => {
    const frames = buildReferenceFrames(seed, 12345 + (seedIndex * 10 + take) * 7919);
    return {
      sampleId: take,
      description: `${seed.label} — take ${take}`,
      totalFrames: frames.length,
      frames
    };
  });
}

async function main() {
  let updated = 0;
  let skipped = 0;

  for (const [index, seed] of SEEDS.entries()) {
    const exercise = await prisma.exerciseLibrary.findFirst({
      where: { name: seed.exerciseName },
      orderBy: { versionNumber: "desc" }
    });
    if (!exercise) {
      console.log(`Seed-pose: skipped "${seed.exerciseName}" (not found — run prisma:seed first).`);
      skipped += 1;
      continue;
    }

    const baseCriteria =
      exercise.baseCriteria && typeof exercise.baseCriteria === "object" && !Array.isArray(exercise.baseCriteria)
        ? (exercise.baseCriteria as Record<string, unknown>)
        : {};
    if (baseCriteria.poseReference) {
      console.log(`Seed-pose: skipped "${seed.exerciseName}" (poseReference already present).`);
      skipped += 1;
      continue;
    }

    await prisma.exerciseLibrary.update({
      where: { id: exercise.id },
      data: {
        baseCriteria: {
          ...baseCriteria,
          poseReference: {
            label: seed.label,
            angleDefinition: seed.angleDefinition,
            secondaryAngleDefinition: seed.secondaryAngleDefinition,
            fsmConfig: seed.fsmConfig,
            targetRom: seed.targetRom,
            bveThreshold: seed.bveThreshold,
            enableTrunkBve: true,
            masterSamples: buildMasterSamples(seed, index)
          }
        }
      }
    });
    console.log(`Seed-pose: attached poseReference to "${seed.exerciseName}" (v${exercise.versionNumber}).`);
    updated += 1;
  }

  console.log(`Seed-pose done: ${updated} updated, ${skipped} skipped.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

