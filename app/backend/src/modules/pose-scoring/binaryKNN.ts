// Binary K-NN form gate — adapted from projectimport/Rehab-AI's
// frontend/src/ai/classifiers/binaryKNN.ts (identical feature extraction,
// z-score normalization, and k-NN voting logic). Types come from
// poseScoring.types.ts.

import { FrameFeature } from "./poseScoring.types";

export interface RepFeatureVector {
  /** Actual primary-angle range of this rep (max - min across its frames). */
  peakRom: number;
  /** Mean deviation of the trunk centroid from the rep's first frame. */
  meanBve: number;
  /** Path-length-normalized DTW distance to the nearest master sample. */
  dtwDistance: number;
  /** Mean |leftAngle - rightAngle| across the rep — high = asymmetric. */
  asymmetry: number;
  /** Primary-angle jerk (mean |acceleration change|) — high = uncontrolled. */
  jerk: number;
  /** Frame count of this rep (abnormally long/short suggests poor pacing). */
  durationFrames: number;
}

const FEATURE_KEYS: (keyof RepFeatureVector)[] = [
  "peakRom",
  "meanBve",
  "dtwDistance",
  "asymmetry",
  "jerk",
  "durationFrames"
];

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Extracts one rep's feature vector from its frame sequence. */
export function extractRepFeatures(frames: FrameFeature[], dtwDistance: number): RepFeatureVector {
  if (frames.length === 0) {
    return { peakRom: 0, meanBve: 0, dtwDistance, asymmetry: 0, jerk: 0, durationFrames: 0 };
  }

  const angles = frames.map((f) => f.elbowAngle);
  const peakRom = Math.max(...angles) - Math.min(...angles);

  const base = frames[0].trunkCentroid;
  const meanBve = mean(frames.map((f) => Math.hypot(f.trunkCentroid.x - base.x, f.trunkCentroid.y - base.y)));

  const asymmetryValues = frames
    .filter((f) => f.leftElbowAngle !== undefined && f.rightElbowAngle !== undefined)
    .map((f) => Math.abs((f.leftElbowAngle as number) - (f.rightElbowAngle as number)));
  const asymmetry = mean(asymmetryValues);

  let jerkSum = 0;
  for (let i = 2; i < angles.length; i++) {
    const d1 = angles[i] - angles[i - 1];
    const d0 = angles[i - 1] - angles[i - 2];
    jerkSum += Math.abs(d1 - d0);
  }
  const jerk = angles.length > 2 ? jerkSum / (angles.length - 2) : 0;

  return { peakRom, meanBve, dtwDistance, asymmetry, jerk, durationFrames: frames.length };
}

function toVector(f: RepFeatureVector): number[] {
  return FEATURE_KEYS.map((k) => f[k]);
}

function euclidean(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export interface LabeledExample {
  features: RepFeatureVector;
  label: 0 | 1; // 1 = correct form (pass), 0 = incorrect form (fail)
  sourceType: string; // debug: which synthetic/real generator produced this
}

export interface KnnModel {
  trainingVectors: { vector: number[]; label: 0 | 1 }[];
  featureMeans: number[];
  featureStdDevs: number[];
}

/** "Training" for k-NN = precomputing the normalization statistics only. */
export function trainKnnModel(examples: LabeledExample[]): KnnModel {
  const vectors = examples.map((e) => toVector(e.features));
  const dims = FEATURE_KEYS.length;

  const featureMeans = Array(dims).fill(0);
  const featureStdDevs = Array(dims).fill(1);

  if (vectors.length > 0) {
    for (let d = 0; d < dims; d++) {
      featureMeans[d] = mean(vectors.map((v) => v[d]));
    }
    for (let d = 0; d < dims; d++) {
      const variance = mean(vectors.map((v) => (v[d] - featureMeans[d]) ** 2));
      featureStdDevs[d] = Math.sqrt(variance) || 1;
    }
  }

  const trainingVectors = vectors.map((v, i) => ({
    vector: v.map((val, d) => (val - featureMeans[d]) / featureStdDevs[d]),
    label: examples[i].label
  }));

  return { trainingVectors, featureMeans, featureStdDevs };
}

export interface KnnClassification {
  isPass: boolean;
  confidence: number; // neighbor vote share (0.5-1.0)
  neighborLabels: (0 | 1)[];
}

const DEFAULT_K = 5;

/** No training data (e.g. exercise has no masterSamples) => always pass. */
export function classifyRep(model: KnnModel, features: RepFeatureVector, k: number = DEFAULT_K): KnnClassification {
  if (model.trainingVectors.length === 0) {
    return { isPass: true, confidence: 1, neighborLabels: [] };
  }

  const raw = toVector(features);
  const query = raw.map((val, d) => (val - model.featureMeans[d]) / model.featureStdDevs[d]);

  const distances = model.trainingVectors
    .map((t) => ({ label: t.label, dist: euclidean(query, t.vector) }))
    .sort((a, b) => a.dist - b.dist);

  const neighbors = distances.slice(0, Math.min(k, distances.length));
  const passVotes = neighbors.filter((n) => n.label === 1).length;
  const failVotes = neighbors.length - passVotes;

  // Exact tie => fail (strict-by-default).
  const isPass = passVotes > failVotes;
  const confidence = neighbors.length > 0 ? Math.max(passVotes, failVotes) / neighbors.length : 1;

  return { isPass, confidence, neighborLabels: neighbors.map((n) => n.label) };
}
