// Rep scoring engine — adapted verbatim from projectimport/Rehab-AI's
// frontend/src/ai/scoring/scoreEngine.ts (same weights, hard floor, and
// Thai feedback text generation). This is the SINGLE scoring algorithm this
// project uses for pose exercises; it now runs server-side per repetition.

import { RepResult } from "./poseScoring.types";

// w1 (DTW) is deliberately weighted above w2 (ROM) — ROM only measures "did
// the terminal angle reach the target", which a wrong-form movement can
// still hit by accident (e.g. shoulder-hiking instead of elbow flexion),
// while DTW compares the whole movement trajectory against the master clip.
const DTW_WEIGHT = 0.65;
const ROM_WEIGHT = 0.35;

// Hard-floor gate: a very low DTW score means the rep's whole movement
// pattern is far from the master sample (possibly a completely different
// movement) — even a perfect ROM score must not lift the total above
// dtwScore + a small allowance.
const DTW_HARD_FLOOR = 45;
const DTW_HARD_FLOOR_ALLOWANCE = 20;
// The hard floor deliberately targets only "ROM reached target but a
// different joint compensated" — not patients whose targetRom was lowered
// by their therapist to match limited ability. DTW compares raw angles, so
// limited-mobility patients naturally score lower; the ROM gate below keeps
// the floor from unfairly capping them a second time.
const DTW_HARD_FLOOR_ROM_GATE = 85;

export function computeRepScore(
  repNum: number,
  dtwScore: number,
  dtwDistance: number,
  peakRom: number,
  targetRom: number,
  meanBve: number,
  bveThreshold: number,
  isKnnPass: boolean,
  isTrunkBveEnabled: boolean
): RepResult {
  const romScore = Math.min(100, Math.round((peakRom / targetRom) * 100));

  let bvePenalty = 0;
  if (isTrunkBveEnabled && meanBve > bveThreshold) {
    bvePenalty = Math.min(25, Math.round((meanBve - bveThreshold) * 2));
  }

  let rawScore = DTW_WEIGHT * dtwScore + ROM_WEIGHT * romScore - bvePenalty;
  if (!isKnnPass) rawScore -= 10; // penalize reps the form gate classifies as failing

  // DTW hard floor — see comments above. Requires a high romScore too, so
  // patients with a therapist-lowered targetRom aren't double-capped.
  const isPatternMismatch = romScore >= DTW_HARD_FLOOR_ROM_GATE && dtwScore < DTW_HARD_FLOOR;
  if (isPatternMismatch) {
    rawScore = Math.min(rawScore, dtwScore + DTW_HARD_FLOOR_ALLOWANCE);
  }

  const finalRepScore = Math.max(0, Math.min(100, Math.round(rawScore)));

  // Natural-language (Thai) AI feedback generation.
  let feedbackText = `รอบที่ ${repNum}: `;
  if (isTrunkBveEnabled && meanBve > bveThreshold) {
    feedbackText += "ระวังอย่าเอียงลำตัวช่วยยก ให้เกร็งหน้าท้องไว้ ";
  }
  if (romScore < 80) {
    feedbackText += "พยายามยกแขนให้สุดช่วงองศาเพิ่มอีกนิด ";
  }
  if (isPatternMismatch) {
    feedbackText +=
      "แม้จะได้มุมองศาถึงเป้าหมาย แต่รูปแบบการเคลื่อนไหวทั้งรอบต่างจากคลิปต้นแบบมาก (อาจใช้ข้อต่ออื่นช่วยเคลื่อนไหวแทนข้อต่อที่ควรฝึก) ลองสังเกตวิธีการเคลื่อนไหวจากวิดีโอต้นแบบให้ใกล้เคียงที่สุด ";
  } else if (dtwScore < 70) {
    feedbackText += "ปรับจังหวะการเคลื่อนไหวให้ช้าลงและลื่นไหลตามคลิปต้นแบบ ";
  }
  if (!isKnnPass) {
    feedbackText +=
      "รูปแบบการเคลื่อนไหวโดยรวมของรอบนี้ต่างจากท่าที่ถูกต้องพอสมควร (เช่น ระยะไม่ถึง เอียงตัวช่วย ไม่สมมาตร หรือกระตุก) ลองทำช้าลงและควบคุมท่าให้นิ่งขึ้น ";
  }
  if (finalRepScore >= 80 && bvePenalty === 0) {
    feedbackText += "ทำได้ดีมาก ท่าทางถูกต้องและสม่ำเสมอ!";
  }

  return {
    repNumber: repNum,
    dtwDistance,
    dtwScore,
    peakRom,
    romScore,
    meanBve,
    bvePenalty,
    isKnnPass,
    finalRepScore,
    feedbackText
  };
}
