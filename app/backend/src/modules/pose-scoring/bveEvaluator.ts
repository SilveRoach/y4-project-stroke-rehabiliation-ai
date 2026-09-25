// BVE (baseline variation error) evaluator — adapted verbatim from
// projectimport/Rehab-AI's frontend/src/ai/evaluators/bveEvaluator.ts.
// RMS deviation of the trunk centroid from the rep's baseline — the trunk-sway
// signal scoreEngine turns into a score penalty.

export function calculateBVE(points: { x: number; y: number }[], basePoint: { x: number; y: number }): number {
  const N = points.length;
  if (N === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < N; i++) {
    const dx = points[i].x - basePoint.x;
    const dy = points[i].y - basePoint.y;
    sumSq += dx * dx + dy * dy;
  }
  return Math.sqrt(sumSq / N);
}
