// Synthetic training-set generator — adapted from projectimport/Rehab-AI's
// frontend/src/ai/classifiers/syntheticData.ts. Builds "correct form"
// (label=1) and "incorrect form" (label=0) k-NN training examples from the
// exercise's stored master samples, so the form gate works for any pose
// exercise without real labeled patient data. The six negative distortions
// mirror the clinically-recognized wrong-form patterns (reduced ROM, trunk
// sway, asymmetry, jerk, too-fast, secondary-joint compensation).

import { FrameFeature, MasterSample } from "./poseScoring.types";
import { evaluateDTW } from "./dtwEvaluator";
import { LabeledExample, extractRepFeatures } from "./binaryKNN";

function cloneFrames(frames: FrameFeature[]): FrameFeature[] {
  return frames.map((f) => ({ ...f, trunkCentroid: { ...f.trunkCentroid } }));
}

function jitterFrames(frames: FrameFeature[], rng: () => number, magnitudeDeg = 2.5): FrameFeature[] {
  return frames.map((f) => {
    const noise = () => (rng() * 2 - 1) * magnitudeDeg;
    return {
      ...f,
      elbowAngle: f.elbowAngle + noise(),
      shoulderAngle: f.shoulderAngle + noise() * 0.5,
      leftElbowAngle: f.leftElbowAngle !== undefined ? f.leftElbowAngle + noise() : undefined,
      rightElbowAngle: f.rightElbowAngle !== undefined ? f.rightElbowAngle + noise() : undefined,
      trunkCentroid: {
        x: f.trunkCentroid.x + (rng() * 2 - 1) * 0.005,
        y: f.trunkCentroid.y + (rng() * 2 - 1) * 0.005
      }
    };
  });
}

/** Reduced ROM: pull every frame's angle toward the rep's baseline angle. */
function reduceRom(frames: FrameFeature[], severity: number): FrameFeature[] {
  if (frames.length === 0) return frames;
  const baseline = frames[0].elbowAngle;
  const baselineL = frames[0].leftElbowAngle;
  const baselineR = frames[0].rightElbowAngle;
  const pull = (v: number, base: number) => base + (v - base) * (1 - severity);

  return frames.map((f) => ({
    ...f,
    elbowAngle: pull(f.elbowAngle, baseline),
    leftElbowAngle:
      f.leftElbowAngle !== undefined && baselineL !== undefined ? pull(f.leftElbowAngle, baselineL) : f.leftElbowAngle,
    rightElbowAngle:
      f.rightElbowAngle !== undefined && baselineR !== undefined ? pull(f.rightElbowAngle, baselineR) : f.rightElbowAngle,
    trunkCentroid: { ...f.trunkCentroid }
  }));
}

/** Trunk sway: add an up-down drift curve to the trunk centroid (worst at peak effort). */
function addTrunkSway(frames: FrameFeature[], severity: number): FrameFeature[] {
  const n = frames.length;
  return frames.map((f, i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    const drift = severity * 0.2 * Math.sin(t * Math.PI);
    return { ...f, trunkCentroid: { x: f.trunkCentroid.x + drift, y: f.trunkCentroid.y + drift * 0.4 } };
  });
}

/** Asymmetry: lock one side near the baseline (like the unaffected side doing the work). */
function addAsymmetry(frames: FrameFeature[], severity: number): FrameFeature[] {
  if (frames.length === 0) return frames;
  const baselineR = frames[0].rightElbowAngle ?? frames[0].elbowAngle;

  return frames.map((f) => {
    const lockedRight =
      f.rightElbowAngle !== undefined ? baselineR + (f.rightElbowAngle - baselineR) * (1 - severity) : f.rightElbowAngle;
    const newElbow =
      f.leftElbowAngle !== undefined && lockedRight !== undefined ? (f.leftElbowAngle + lockedRight) / 2 : f.elbowAngle;
    return { ...f, elbowAngle: newElbow, rightElbowAngle: lockedRight, trunkCentroid: { ...f.trunkCentroid } };
  });
}

/** Jerk: high-frequency random noise on the primary angle (not controlled movement). */
function addJerkNoise(frames: FrameFeature[], severity: number, rng: () => number): FrameFeature[] {
  const magnitude = severity * 20;
  return frames.map((f) => ({
    ...f,
    elbowAngle: f.elbowAngle + (rng() * 2 - 1) * magnitude,
    trunkCentroid: { ...f.trunkCentroid }
  }));
}

/** Secondary-joint compensation: primary angle reaches target, secondary angle deviates mid-rep. */
function addSecondaryJointCompensation(frames: FrameFeature[], severity: number): FrameFeature[] {
  const n = frames.length;
  return frames.map((f, i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    const deviation = severity * 45 * Math.sin(t * Math.PI);
    return { ...f, shoulderAngle: f.shoulderAngle + deviation, trunkCentroid: { ...f.trunkCentroid } };
  });
}

/** Too fast: compress the frame count (equal-spaced resample), simulating an uncontrolled rushed rep. */
function compressDuration(frames: FrameFeature[], factor: number): FrameFeature[] {
  const targetLen = Math.max(3, Math.round(frames.length * factor));
  const result: FrameFeature[] = [];
  for (let i = 0; i < targetLen; i++) {
    const srcIndex = Math.min(frames.length - 1, Math.round((i / (targetLen - 1 || 1)) * (frames.length - 1)));
    result.push(cloneFrames([frames[srcIndex]])[0]);
  }
  return result;
}

function computeDtwDistance(sequence: FrameFeature[], allMasterFrameArrays: FrameFeature[][]): number {
  const { bestDistance } = evaluateDTW(sequence, allMasterFrameArrays);
  return bestDistance;
}

/** Entry point: builds the k-NN training set from an exercise's master samples. */
export function generateSyntheticTrainingSet(
  masterSamples: MasterSample[],
  rng: () => number = Math.random
): LabeledExample[] {
  const validSamples = masterSamples.filter((s) => s.frames.length >= 6);
  if (validSamples.length === 0) return [];

  const allMasterFrameArrays = validSamples.map((s) => s.frames);
  const examples: LabeledExample[] = [];

  const POSITIVE_JITTER_COUNT = 5;
  const NEGATIVE_GENERATORS: { sourceType: string; build: (frames: FrameFeature[]) => FrameFeature[] }[] = [
    { sourceType: "reduced-rom", build: (f) => reduceRom(f, 0.5 + rng() * 0.3) },
    { sourceType: "trunk-sway", build: (f) => addTrunkSway(f, 0.6 + rng() * 0.4) },
    { sourceType: "asymmetry", build: (f) => addAsymmetry(f, 0.6 + rng() * 0.4) },
    { sourceType: "jerk-noise", build: (f) => addJerkNoise(f, 0.6 + rng() * 0.4, rng) },
    { sourceType: "too-fast", build: (f) => compressDuration(f, 0.35 + rng() * 0.2) },
    { sourceType: "joint-compensation", build: (f) => addSecondaryJointCompensation(f, 0.6 + rng() * 0.4) }
  ];

  for (const sample of validSamples) {
    // Correct: the exact master sample + small natural-jitter copies.
    examples.push({
      features: extractRepFeatures(sample.frames, computeDtwDistance(sample.frames, allMasterFrameArrays)),
      label: 1,
      sourceType: "exact"
    });
    for (let i = 0; i < POSITIVE_JITTER_COUNT; i++) {
      const jittered = jitterFrames(sample.frames, rng);
      examples.push({
        features: extractRepFeatures(jittered, computeDtwDistance(jittered, allMasterFrameArrays)),
        label: 1,
        sourceType: "jitter"
      });
    }

    // Incorrect: the six clinically-modeled wrong-form distortions.
    for (const gen of NEGATIVE_GENERATORS) {
      const corrupted = gen.build(cloneFrames(sample.frames));
      examples.push({
        features: extractRepFeatures(corrupted, computeDtwDistance(corrupted, allMasterFrameArrays)),
        label: 0,
        sourceType: gen.sourceType
      });
    }
  }

  return examples;
}

/** Real "wrong form" recordings (wrongFormSamples), feature-extracted like real reps. */
export function buildRealWrongFormExamples(
  wrongFormSamples: MasterSample[] | undefined,
  masterSamples: MasterSample[]
): LabeledExample[] {
  if (!wrongFormSamples || wrongFormSamples.length === 0) return [];

  const validMasterFrameArrays = masterSamples.filter((s) => s.frames.length >= 6).map((s) => s.frames);

  return wrongFormSamples
    .filter((s) => s.frames.length >= 6)
    .map((sample) => {
      const dtwDistance = computeDtwDistance(sample.frames, validMasterFrameArrays);
      return {
        features: extractRepFeatures(sample.frames, dtwDistance),
        label: 0 as const,
        sourceType: "real-wrong-demo"
      };
    });
}

