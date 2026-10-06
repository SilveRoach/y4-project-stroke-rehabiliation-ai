// Scoring for the virtual-grip ball game — ported from the AI team's
// ballGripScoreEngine.ts / ballGripGameScoreEngine.ts. Each round is
// all-or-nothing (Box and Block Test style): 1 point if the ball was released
// inside the ring in time, else 0. Drag efficiency / target accuracy are
// diagnostic extras that never change the point.

export type BallGripRepReason = "success" | "missed" | "timeout" | "lost_tracking";

export interface BallGripRepResult {
  repNumber: number;
  success: boolean;
  point: 0 | 1;
  reason: BallGripRepReason;
  timeTakenSeconds: number;
  timeLimitSeconds: number;
  /** straight-line / travelled distance of the drag, 0..1 (1 = perfectly straight). */
  dragPathEfficiency: number;
  dragEfficiencyScore: number;
  /** 1 = released at ring centre, 0 = ring edge; null when nothing was grabbed. */
  targetAccuracy: number | null;
  targetAccuracyScore: number | null;
  /** point * 100 so it sits on the same 0-100 scale as pose rep scores. */
  finalRepScore: number;
  feedbackText: string;
}

export function computeBallGripRepScore(
  repNumber: number,
  success: boolean,
  reason: BallGripRepReason,
  timeTakenSeconds: number,
  timeLimitSeconds: number,
  dragPathEfficiency: number,
  targetAccuracy: number | null
): BallGripRepResult {
  const dragEfficiencyScore = Math.round(dragPathEfficiency * 100);
  const targetAccuracyScore = targetAccuracy === null ? null : Math.round(targetAccuracy * 100);
  const point: 0 | 1 = success ? 1 : 0;

  let feedbackText = `รอบที่ ${repNumber}: `;
  switch (reason) {
    case "success":
      feedbackText += `วางบอลเข้าเป้าทันเวลา (${timeTakenSeconds.toFixed(1)}/${timeLimitSeconds} วินาที) ได้ 1 แต้ม!`;
      break;
    case "missed":
      feedbackText += "แบมือปล่อยบอลไม่ตรงวงเป้าหมาย ลองเล็งให้แม่นขึ้นก่อนปล่อย ไม่ได้แต้ม";
      break;
    case "timeout":
      feedbackText +=
        targetAccuracy === null
          ? `หมดเวลา ${timeLimitSeconds} วินาทีก่อนจะจับบอลได้ทัน ลองสังเกตตำแหน่งบอลให้เร็วขึ้น ไม่ได้แต้ม`
          : `หมดเวลา ${timeLimitSeconds} วินาทีก่อนจะวางบอลได้ทัน ไม่ได้แต้ม`;
      break;
    case "lost_tracking":
      feedbackText += "กล้องจับมือไม่เจอระหว่างลากบอล ไม่ได้แต้ม";
      break;
  }
  if (dragEfficiencyScore < 60 && targetAccuracy !== null) {
    feedbackText += " เส้นทางที่ลากอ้อมไปมา ลองลากตรงเข้าเป้าหมายให้มากขึ้น";
  }

  return {
    repNumber,
    success,
    point,
    reason,
    timeTakenSeconds,
    timeLimitSeconds,
    dragPathEfficiency,
    dragEfficiencyScore,
    targetAccuracy,
    targetAccuracyScore,
    finalRepScore: point * 100,
    feedbackText: feedbackText.trim()
  };
}

export interface BallGripGameSummary {
  targetRounds: number;
  successfulRounds: number;
  /** round(100 * successfulRounds / targetRounds). */
  gameScore: number;
  feedbackText: string;
  rounds: BallGripRepResult[];
}

/** Whole-session summary after the prescribed number of rounds. */
export function computeBallGripGameSummary(rounds: BallGripRepResult[], targetRounds: number): BallGripGameSummary {
  const successfulRounds = rounds.filter((r) => r.success).length;
  const denominator = targetRounds > 0 ? targetRounds : rounds.length;
  const gameScore = denominator > 0 ? Math.round((successfulRounds / denominator) * 100) : 0;

  let feedbackText = `จบเกม ${denominator} รอบ — ได้ ${successfulRounds}/${denominator} แต้ม `;
  if (gameScore < 40) {
    feedbackText += "ลองฝึกต่ออีกสักเกม เน้นสังเกตตำแหน่งบอล/เป้าหมายให้เร็วขึ้นก่อนเวลาหมด";
  } else if (gameScore < 80) {
    feedbackText += "ทำได้ดี ลองเพิ่มความเร็ว/ความแม่นตอนปล่อยบอลให้มากขึ้นอีกหน่อย";
  } else {
    feedbackText += "ทำได้ดีมาก!";
  }

  return { targetRounds: denominator, successfulRounds, gameScore, feedbackText: feedbackText.trim(), rounds };
}

/** Failure-reason counts, used by the end-of-session comment. */
export function countGripFailures(rounds: BallGripRepResult[]): Record<Exclude<BallGripRepReason, "success">, number> {
  const counts = { missed: 0, timeout: 0, lost_tracking: 0 };
  for (const r of rounds) {
    if (r.reason !== "success") counts[r.reason] += 1;
  }
  return counts;
}
