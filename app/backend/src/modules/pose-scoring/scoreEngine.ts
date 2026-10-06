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
//
// Tuned 45/20 -> 60/10: with DTW normalizing the primary angle by each
// sequence's own range (see dtwEvaluator.ts), a roughly-monotonic movement
// that reaches the angle but doesn't match the master rarely scores below
// ~45-55 DTW, so the old gate almost never fired for the "reached the angle
// but wrong movement" case (scores floated around 50-67). Raising the floor
// widens the range the gate covers, and the smaller allowance keeps the cap
// from being looser than the raw score (previously dtwScore=50 capped at 70,
// i.e. no effect). Deliberately NOT tuned via the DTW gamma or the 65/35
// weights — those affect every rep, including well-performed ones. Both
// numbers are starting points, not yet calibrated on real reps.
const DTW_HARD_FLOOR = 60;
const DTW_HARD_FLOOR_ALLOWANCE = 10;
// The hard floor deliberately targets only "ROM reached target but a
// different joint compensated" — not patients whose targetRom was lowered
// by their therapist to match limited ability. DTW compares raw angles, so
// limited-mobility patients naturally score lower; the ROM gate below keeps
// the floor from unfairly capping them a second time.
const DTW_HARD_FLOOR_ROM_GATE = 85;

// "Whole-torso twist" penalty threshold/multiplier — separate from bvePenalty
// because it's a different compensation mechanism (twisting/rotating, not
// leaning/swaying). Only applies to exercises that measure a vector angle
// against a fixed reference axis (e.g. External Rotation), where twisting the
// torso instead of rotating the shoulder makes the measured angle "fake" for
// the whole rep (not just an untidy rep — the number itself is wrong), so it
// should be penalized harder than bvePenalty. The 0.08 threshold (~8% shoulder
// width shrink, roughly a 23° torso twist) and the multiplier/cap below mirror
// the values calibrated against real pose-tracking clips in the frontend
// version of this file (see the import project's ai/scoring/scoreEngine.ts).
const TORSO_TWIST_THRESHOLD = 0.08;
const TORSO_TWIST_MULTIPLIER = 75;
const TORSO_TWIST_PENALTY_CAP = 30;

// "Released the hands" penalty — only for references with checksHandProximity
// (e.g. Shoulder Rotation, where one hand guides the other). Without this
// signal a patient who lets go and pushes with one arm still scored high on
// dtwScore/romScore, which only look at the tracked arm's angle. Units are
// fractions of torso length (wristDistanceNorm). Threshold/multiplier/cap are
// uncalibrated starting points. The cap sits above TORSO_TWIST_PENALTY_CAP on
// purpose: letting go IS the main technique error of such an exercise.
const HAND_SEPARATION_THRESHOLD = 0.15;
const HAND_SEPARATION_MULTIPLIER = 100;
const HAND_SEPARATION_PENALTY_CAP = 35;

// "One arm doing the work of both" penalty — only for exercises whose primary
// angle is bilateral. The primary angle is the left/right mean, so moving a
// single arm through its full range still moves the mean about half the
// target range, and DTW (range-normalized) sees the same "shape". 12 degrees
// matches ASYMMETRY_THRESHOLD_DEG in detailedFeedback.ts, so a penalty starts
// where the text feedback already warns. Multiplier/cap are uncalibrated; the
// cap is the highest of all penalties because the other arm trained nothing.
const ASYMMETRY_PENALTY_THRESHOLD_DEG = 12;
const ASYMMETRY_PENALTY_MULTIPLIER = 2.5;
const ASYMMETRY_PENALTY_CAP = 40;

export function computeRepScore(
  repNum: number,
  dtwScore: number,
  dtwDistance: number,
  peakRom: number,
  targetRom: number,
  meanBve: number,
  meanTrunkDrift: number,
  bveThreshold: number,
  peakTorsoTwist: number,
  peakHandSeparation: number,
  peakAsymmetryDeg: number,
  isKnnPass: boolean,
  isTrunkBveEnabled: boolean,
  isVectorAngleExercise: boolean,
  isHandProximityExercise: boolean,
  isBilateralExercise: boolean
): RepResult {
  const romScore = Math.min(100, Math.round((peakRom / targetRom) * 100));

  // bvePenalty combines two signals: meanBve catches "bending at the waist"
  // (shoulder/hip proportions change), meanTrunkDrift catches "swaying the
  // whole body rigidly", which meanBve cannot see. Capped at 25 as before —
  // either cause (or both together) can reach the cap.
  let bvePenalty = 0;
  if (isTrunkBveEnabled) {
    const shapePenalty = meanBve > bveThreshold ? Math.round((meanBve - bveThreshold) * 2) : 0;
    const driftPenalty = meanTrunkDrift > bveThreshold ? Math.round((meanTrunkDrift - bveThreshold) * 2) : 0;
    bvePenalty = Math.min(25, shapePenalty + driftPenalty);
  }

  // Additive and independently capped from bvePenalty — a rep that both
  // leans/sways AND twists the torso should be penalized for both.
  let torsoTwistPenalty = 0;
  if (isVectorAngleExercise && peakTorsoTwist > TORSO_TWIST_THRESHOLD) {
    torsoTwistPenalty = Math.min(
      TORSO_TWIST_PENALTY_CAP,
      Math.round((peakTorsoTwist - TORSO_TWIST_THRESHOLD) * TORSO_TWIST_MULTIPLIER)
    );
  }

  // Independently capped, like torsoTwistPenalty — a different compensation
  // mechanism (letting go of the hands), only for checksHandProximity exercises.
  let handSeparationPenalty = 0;
  if (isHandProximityExercise && peakHandSeparation > HAND_SEPARATION_THRESHOLD) {
    handSeparationPenalty = Math.min(
      HAND_SEPARATION_PENALTY_CAP,
      Math.round((peakHandSeparation - HAND_SEPARATION_THRESHOLD) * HAND_SEPARATION_MULTIPLIER)
    );
  }

  // Independently capped as well — one arm used instead of both, only for
  // exercises whose primary angle is bilateral.
  let bilateralAsymmetryPenalty = 0;
  if (isBilateralExercise && peakAsymmetryDeg > ASYMMETRY_PENALTY_THRESHOLD_DEG) {
    bilateralAsymmetryPenalty = Math.min(
      ASYMMETRY_PENALTY_CAP,
      Math.round((peakAsymmetryDeg - ASYMMETRY_PENALTY_THRESHOLD_DEG) * ASYMMETRY_PENALTY_MULTIPLIER)
    );
  }

  let rawScore =
    DTW_WEIGHT * dtwScore +
    ROM_WEIGHT * romScore -
    bvePenalty -
    torsoTwistPenalty -
    handSeparationPenalty -
    bilateralAsymmetryPenalty;
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
  if (isTrunkBveEnabled && (meanBve > bveThreshold || meanTrunkDrift > bveThreshold)) {
    feedbackText += "ระวังอย่าเอียง/โยกลำตัวช่วยยก ให้เกร็งหน้าท้องไว้ ";
  }
  if (torsoTwistPenalty > 0) {
    feedbackText += "ระวังอย่าบิดลำตัวช่วยหมุนแขน ให้หันหน้าเข้ากล้องตลอดท่าและขยับแค่แขน ";
  }
  if (handSeparationPenalty > 0) {
    feedbackText += "มือทั้งสองข้างแยกห่างออกจากกันระหว่างท่า ให้กุม/ประกบมือไว้ตลอดจนกว่าจะกลับสู่ท่าเริ่มต้น ";
  }
  if (bilateralAsymmetryPenalty > 0) {
    feedbackText += "แขนสองข้างขยับได้ไม่เท่ากัน เหมือนใช้แขนข้างเดียวทำแทน ให้ขยับแขนทั้งสองข้างไปพร้อมกันเท่าๆ กันตลอดท่า ";
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
  if (
    finalRepScore >= 80 &&
    bvePenalty === 0 &&
    torsoTwistPenalty === 0 &&
    handSeparationPenalty === 0 &&
    bilateralAsymmetryPenalty === 0
  ) {
    feedbackText += "ทำได้ดีมาก ท่าทางถูกต้องและสม่ำเสมอ!";
  }

  return {
    repNumber: repNum,
    dtwDistance,
    dtwScore,
    peakRom,
    romScore,
    meanBve,
    meanTrunkDrift,
    bvePenalty,
    peakTorsoTwist,
    torsoTwistPenalty,
    peakHandSeparation,
    handSeparationPenalty,
    peakAsymmetryDeg,
    bilateralAsymmetryPenalty,
    isKnnPass,
    finalRepScore,
    feedbackText
  };
}
