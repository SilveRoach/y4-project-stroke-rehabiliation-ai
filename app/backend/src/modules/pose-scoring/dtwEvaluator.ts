// DTW evaluator — adapted verbatim from projectimport/Rehab-AI's
// frontend/src/ai/evaluators/dtwEvaluator.ts (same DP recurrence, same
// path-length normalization, same gamma). Types come from poseScoring.types.ts.

import { FrameFeature } from "./poseScoring.types";

function featureDistance(a: FrameFeature, b: FrameFeature): number {
  const dElbow = a.elbowAngle - b.elbowAngle;
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

  constructor(seq1: FrameFeature[], seq2: FrameFeature[]) {
    this.seq1 = seq1;
    this.seq2 = seq2;
    this.n = seq1.length;
    this.m = seq2.length;
    this.matrix = new Float64Array(Math.max(1, this.n * this.m));
    this.computeMatrix();
  }

  private at(i: number, j: number): number {
    return this.matrix[i * this.m + j];
  }
  private set(i: number, j: number, v: number): void {
    this.matrix[i * this.m + j] = v;
  }

  private computeMatrix(): void {
    const { n, m } = this;
    if (n === 0 || m === 0) return;

    this.set(0, 0, featureDistance(this.seq1[0], this.seq2[0]));

    for (let i = 1; i < n; i++) {
      this.set(i, 0, this.at(i - 1, 0) + featureDistance(this.seq1[i], this.seq2[0]));
    }
    for (let j = 1; j < m; j++) {
      this.set(0, j, this.at(0, j - 1) + featureDistance(this.seq1[0], this.seq2[j]));
    }
    for (let i = 1; i < n; i++) {
      for (let j = 1; j < m; j++) {
        const cost = featureDistance(this.seq1[i], this.seq2[j]);
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
