import { PathGameSummary, PathRoundResult, PathSegmentKind, PathType } from '../../types/ai';

/**
 * คะแนนเกม "ลากวัตถุจริงตามเส้นทาง" — มี 2 คะแนนที่ "แยกกัน ไม่รวมกัน":
 *
 * 1) คะแนนจำนวนรอบ — ทำสำเร็จกี่รอบจากทั้งหมดกี่รอบ (เช่น 3/5) รอบที่นับว่าสำเร็จคือลากถึงปลายทางทันเวลา
 *    นับแบบ 0/1 ต่อรอบ ไม่ให้คะแนนบางส่วน (แนวเดียวกับเกมบอลเสมือน/Box and Block Test ที่นับจำนวนครั้งที่ทำสำเร็จ)
 *
 * 2) คะแนนความแม่นยำของมือ (accuracy) — ตอนถือวัตถุลากอยู่ ตำแหน่งมือ (จุดกึ่งกลางฝ่ามือ) อยู่ในทางแค่ไหน ถ่วงด้วยเวลาที่ถือ:
 *    ตัวอย่างที่อยู่ในทาง (ระยะถึงเส้นกลาง ≤ ครึ่งความกว้างทาง) ได้เต็ม 1 ออกนอกทางลดลงเชิงเส้นจนเป็น 0 เมื่อห่างจากขอบ
 *    ทางออกไปอีกเท่าครึ่งความกว้างทาง การออกนอกทาง "ไม่ตัดสิทธิ์" แค่ลดคะแนนนี้ ขณะหยิบติด (attached) ตำแหน่งวัตถุ = ตำแหน่งมือ
 *    (วัตถุถูกมือบังจนตรวจจับไม่เจอ ดูหมายเหตุใน VirtualGripView.tsx) จึงวัดจากมือโดยตรง
 *    ค่าเฉลี่ยทั้งเกมคิดเฉพาะรอบที่มีข้อมูลความแม่นยำจริง (เคยถือวัตถุลาก) เพราะเรื่องรอบที่ไม่ได้ลากเลยมีคะแนนจำนวนรอบ
 *    สะท้อนอยู่แล้ว ไม่ควรไปดึงคะแนนความแม่นยำของรอบที่ลากจริงให้ต่ำลงซ้ำอีก
 */

/** ความกว้างช่วงลดคะแนนนอกทาง เป็นสัดส่วนของครึ่งความกว้างทาง — 1 = ห่างจากขอบทางออกไปเท่าครึ่งความกว้างทางคะแนนเป็น 0 */
const OFF_PATH_FALLOFF_RATIO = 1;

/** คุณภาพของตัวอย่าง 1 จุด 0..1 จากระยะถึงเส้นกลางทาง */
export function pathSampleQuality(distance: number, halfWidth: number): number {
  if (distance <= halfWidth) return 1;
  const falloff = Math.max(1e-6, halfWidth * OFF_PATH_FALLOFF_RATIO);
  return Math.max(0, 1 - (distance - halfWidth) / falloff);
}

export interface PathRoundInput {
  roundNumber: number;
  pathType: PathType;
  segmentKinds: PathSegmentKind[];
  completed: boolean;
  skipped: boolean;
  progressRatio: number;
  timeUsedSec: number;
  timeLimitSec: number;
  /** ผลรวมของ (เวลา ms × คุณภาพตัวอย่าง) เฉพาะช่วงที่ถือวัตถุอยู่ */
  qualityWeightedMs: number;
  /** เวลารวม ms ที่ถือวัตถุอยู่ (ตัวหารของความแม่นยำ) */
  holdingMs: number;
  /** เวลา ms ที่ถือวัตถุอยู่และอยู่ในทางจริง */
  onPathMs: number;
  dropCount: number;
}

function buildRoundFeedback(r: {
  completed: boolean;
  skipped: boolean;
  progressRatio: number;
  accuracyScore: number;
  accuracyMeasured: boolean;
  dropCount: number;
}): string {
  if (r.skipped) return 'ข้ามรอบนี้';
  const parts: string[] = [];
  if (r.completed) parts.push('ลากถึงปลายทางได้สำเร็จ');
  else if (r.progressRatio >= 0.5) parts.push(`ลากไปได้ ${Math.round(r.progressRatio * 100)}% ของเส้นทาง แต่หมดเวลาก่อน`);
  else parts.push(`ลากไปได้ ${Math.round(r.progressRatio * 100)}% ของเส้นทาง`);

  if (r.accuracyMeasured) {
    if (r.accuracyScore >= 85) parts.push('มืออยู่ในทางได้แม่นยำมาก');
    else if (r.accuracyScore >= 60) parts.push('มือออกนอกทางบ้างเล็กน้อย');
    else parts.push('มือออกนอกทางค่อนข้างมาก ลองลากช้าลงและมองเส้นทางล่วงหน้า');
  }
  if (r.dropCount > 0) parts.push(`ปล่อยวัตถุหลุด ${r.dropCount} ครั้ง`);
  return parts.join(' · ');
}

export function computePathRoundResult(input: PathRoundInput): PathRoundResult {
  const accuracyMeasured = input.holdingMs > 0;
  const accuracyScore = accuracyMeasured ? Math.round((100 * input.qualityWeightedMs) / input.holdingMs) : 0;
  const onPathRatio = accuracyMeasured ? Math.min(1, input.onPathMs / input.holdingMs) : 0;
  const progressRatio = Math.max(0, Math.min(1, input.progressRatio));
  return {
    roundNumber: input.roundNumber,
    pathType: input.pathType,
    segmentKinds: input.segmentKinds,
    completed: input.completed,
    skipped: input.skipped,
    progressRatio,
    timeUsedSec: input.timeUsedSec,
    timeLimitSec: input.timeLimitSec,
    accuracyScore,
    accuracyMeasured,
    onPathRatio,
    dropCount: input.dropCount,
    feedbackText: buildRoundFeedback({
      completed: input.completed,
      skipped: input.skipped,
      progressRatio,
      accuracyScore,
      accuracyMeasured,
      dropCount: input.dropCount,
    }),
  };
}

export function computePathGameSummary(rounds: PathRoundResult[], targetRounds: number): PathGameSummary {
  const completedRounds = rounds.filter((r) => r.completed).length;
  const measured = rounds.filter((r) => r.accuracyMeasured);
  const accuracyScore =
    measured.length > 0 ? Math.round(measured.reduce((sum, r) => sum + r.accuracyScore, 0) / measured.length) : 0;
  const avgOnPathRatio =
    measured.length > 0 ? measured.reduce((sum, r) => sum + r.onPathRatio, 0) / measured.length : 0;
  const totalDrops = rounds.reduce((sum, r) => sum + r.dropCount, 0);

  const parts: string[] = [`ทำสำเร็จ ${completedRounds}/${targetRounds} รอบ`];
  if (completedRounds === targetRounds) parts.push('ทำครบทุกรอบ');
  else if (completedRounds === 0) parts.push('ลองเพิ่มเวลาต่อรอบหรือเลือกทางที่กว้างขึ้น');
  if (measured.length > 0) {
    if (accuracyScore >= 85) parts.push('มืออยู่ในทางได้แม่นยำมาก');
    else if (accuracyScore >= 60) parts.push('ความแม่นยำของมืออยู่ในเกณฑ์ดี ยังออกนอกทางบ้างบางช่วง');
    else parts.push('ความแม่นยำของมือยังต่ำ ลองลากช้าลงหรือเลือกทางที่กว้างขึ้น');
  }
  if (totalDrops > 0) parts.push(`ปล่อยวัตถุหลุดรวม ${totalDrops} ครั้ง`);

  return {
    targetRounds,
    completedRounds,
    accuracyScore,
    avgOnPathRatio,
    totalDrops,
    feedbackText: parts.join(' · '),
    rounds,
  };
}
