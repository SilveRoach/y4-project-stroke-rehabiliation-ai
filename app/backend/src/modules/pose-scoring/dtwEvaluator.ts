// DTW evaluator — adapted verbatim from projectimport/Rehab-AI's
// frontend/src/ai/evaluators/dtwEvaluator.ts (same DP recurrence, same
// path-length normalization, same gamma, same per-sequence primary-angle
// normalization). Types come from poseScoring.types.ts.

import { FrameFeature } from "./poseScoring.types";

/** Min-max range of the primary angle (elbowAngle) across one sequence, used
 *  to normalize it before DTW comparison. Falls back to a range of 1 when the
 *  sequence never moves, to avoid dividing by zero. */
interface PrimaryAngleRange {
  min: number;
  range: number;
}

function computePrimaryAngleRange(frames: FrameFeature[]): PrimaryAngleRange {
  if (frames.length === 0) return { min: 0, range: 1 };
  let min = Infinity;
  let max = -Infinity;
  for (const f of frames) {
    if (f.elbowAngle < min) min = f.elbowAngle;
    if (f.elbowAngle > max) max = f.elbowAngle;
  }
  return { min, range: max - min || 1 };
}

// Compares the "shape/timing" of the primary angle (elbowAngle) by normalizing
// each sequence to its own achieved range (0-100 scale) before comparing,
// rather than comparing raw absolute degrees. Without this, a patient whose
// ROM falls short of the target but otherwise moves correctly (same
// timing/shape as the master clip, just a smaller range) gets penalized on
// dtwScore too — even though romScore already penalizes the ROM shortfall
// separately (see scoreEngine.ts), so it would be double-penalized for the
// same root cause. shoulderAngle (the secondary angle, used to detect "a
// different joint compensating") is still compared as raw absolute degrees,
// deliberately NOT normalized — the real magnitude of that deviation is the
// signal that needs to be caught, and normalizing it here would shrink an
// obvious compensation down to its own sequence's range instead of letting it
// stand out.
function featureDistance(
  a: FrameFeature,
  aRange: PrimaryAngleRange,
  b: FrameFeature,
  bRange: PrimaryAngleRange
): number {
  const aElbowNorm = ((a.elbowAngle - aRange.min) / aRange.range) * 100;
  const bElbowNorm = ((b.elbowAngle - bRange.min) / bRange.range) * 100;
  const dElbow = aElbowNorm - bElbowNorm;
  const dShoulder = a.shoulderAngle - b.shoulderAngle;
  return Math.hypot(dElbow, dShoulder);
}

// Cost matrix stored as one flat Float64Array (index = i*m+j) instead of a
// nested number[][] — identical DP recurrence and identical numbers.
export class DynamicTimeWarping {
  private seq1: FrameFeature[];
  private seq2: FrameFeature[];
  private n: number;
  private m: number;
  private matrix: Float64Array;
  private range1: PrimaryAngleRange;
  private range2: PrimaryAngleRange;

  constructor(seq1: FrameFeature[], seq2: FrameFeature[]) {
    this.seq1 = seq1;
    this.seq2 = seq2;
    this.n = seq1.length;
    this.m = seq2.length;
    this.matrix = new Float64Array(Math.max(1, this.n * this.m));
    this.range1 = computePrimaryAngleRange(seq1);
    this.range2 = computePrimaryAngleRange(seq2);
    this.computeMatrix();
  }

  private at(i: number, j: number): number {
    return this.matrix[i * this.m + j];
  }
  private set(i: number, j: number, v: number): void {
    this.matrix[i * this.m + j] = v;
  }

  private dist(i: number, j: number): number {
    return featureDistance(this.seq1[i], this.range1, this.seq2[j], this.range2);
  }

  private computeMatrix(): void {
    const { n, m } = this;
    if (n === 0 || m === 0) return;

    this.set(0, 0, this.dist(0, 0));

    for (let i = 1; i < n; i++) {
      this.set(i, 0, this.at(i - 1, 0) + this.dist(i, 0));
    }
    for (let j = 1; j < m; j++) {
      this.set(0, j, this.at(0, j - 1) + this.dist(0, j));
    }
    for (let i = 1; i < n; i++) {
      for (let j = 1; j < m; j++) {
        const cost = this.dist(i, j);
        const up = this.at(i - 1, j);
        const left = this.at(i, j - 1);
        const diag = this.at(i - 1, j - 1);
        this.set(i, j, cost + Math.min(up, left, diag));
      }
    }
  }

  public getDistance(): number {
    if (this.n === 0 || this.m === 0) return 0;
    return this.at(this.n - 1, this.m - 1);
  }

  public getPath(): [number, number][] {
    let i = this.n - 1;
    let j = this.m - 1;
    const path: [number, number][] = [[i, j]];

    while (i > 0 || j > 0) {
      if (i === 0) {
        j--;
      } else if (j === 0) {
        i--;
      } else {
        const diag = this.at(i - 1, j - 1);
        const up = this.at(i - 1, j);
        const left = this.at(i, j - 1);
        const minVal = Math.min(diag, up, left);
        if (minVal === diag) {
          i--;
          j--;
        } else if (minVal === up) {
          i--;
        } else {
          j--;
        }
      }
      path.unshift([i, j]);
    }

    return path;
  }
}

export function evaluateDTW(
  patientSeq: FrameFeature[],
  masterSamples: FrameFeature[][]
): { bestDistance: number; dtwScore: number } {
  let minNormDistance = Infinity;

  if (!masterSamples || masterSamples.length === 0 || patientSeq.length === 0) {
    // No reference samples stored for this exercise — DTW cannot judge the
    // movement pattern, so it abstains with a neutral perfect score (the
    // import project's documented fallback behavior).
    return { bestDistance: 0, dtwScore: 100 };
  }

  for (const master of masterSamples) {
    if (!master || master.length === 0) continue;
    const dtw = new DynamicTimeWarping(patientSeq, master);
    const rawDist = dtw.getDistance();
    const path = dtw.getPath();
    const normDist = rawDist / (path.length || 1);

    if (normDist < minNormDistance) {
      minNormDistance = normDist;
    }
  }

  const gamma = 0.02;
  const dtwScore = Math.max(0, Math.min(100, Math.round(100 * Math.exp(-gamma * minNormDistance))));

  return { bestDistance: minNormDistance, dtwScore };
}
