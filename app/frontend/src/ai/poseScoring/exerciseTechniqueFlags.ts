/**
 * ตรวจ "เทคนิคเฉพาะของท่า" 2 อย่างจากคลิปสาธิตของแพทย์โดยอัตโนมัติ แทนที่จะให้แพทย์ติ๊กเอง
 *
 *   - checksHandProximity : ท่านี้ต้องประกบ/กุมมือไว้ตลอดท่า -> เปิดการหักคะแนนเมื่อมือแยกจากกัน
 *   - allowsTorsoMovement : ท่านี้ต้องขยับลำตัวช่วยตามธรรมชาติ -> ปิดการหักคะแนนบิดลำตัว
 *
 * หลักคิด: "ท่าสาธิตของแพทย์ต้องผ่านเกณฑ์ของตัวเองเสมอ" — ถ้าเกณฑ์ข้อไหนจะหักคะแนนท่าสาธิตของแพทย์เอง
 * แสดงว่าเกณฑ์นั้นไม่ควรเปิดใช้กับท่านี้ (allowsTorsoMovement) และถ้าคลิปแสดงชัดว่ามือประกบกันตลอดท่า
 * ก็เปิดตัวตรวจมือให้ (checksHandProximity)
 *
 * ไฟล์นี้เป็น pure TypeScript ไม่ import อะไรเลย ใช้ได้ทั้งใน repo ของเรา (FrameFeature ที่มี
 * shoulderWidthNorm/wristDistanceNorm อยู่แล้ว) และ repo ของเพื่อน (คำนวณจาก landmark ดิบ)
 * ตัวเลขทุกตัวใช้นิยามเดียวกับ scoreEngine/poseScoring.service ฝั่ง backend:
 *   shoulderWidthNorm = ระยะไหล่ซ้าย-ขวา / lTorso     (lTorso = ระยะเฉลี่ยจากกึ่งกลางไหล่ไปสะโพกแต่ละข้าง)
 *   wristDistanceNorm = ระยะข้อมือซ้าย-ขวา / lTorso
 *   torsoTwist        = max(0, 1 - shoulderWidthNorm / baseline)
 *   handSeparation    = max(0, wristDistanceNorm - baseline)
 */

export interface TechniqueFrame {
  shoulderWidthNorm: number;
  wristDistanceNorm: number;
  /** false = ไหล่/สะโพกเฟรมนี้มองไม่ชัด (visibility ต่ำ) ค่า norm ของเฟรมนี้ไม่น่าเชื่อถือ ข้ามไป */
  torsoOk?: boolean;
}

export interface LandmarkLike {
  x: number;
  y: number;
  visibility?: number;
}

/** ค่าตัดสินทั้งหมดอยู่ตรงนี้ที่เดียว ปรับได้โดยไม่ต้องแตะตรรกะ */
export const TECHNIQUE_FLAG_PARAMS = {
  /** มือถือว่า "ประกบกันตลอดท่า" เมื่อ median ของระยะข้อมือ (หน่วยความยาวลำตัว) ไม่เกินค่านี้ */
  handClaspedMedianMax: 0.3,
  /** ...และ percentile 95 ไม่เกินค่านี้ (กันท่าที่มือแยกออกช่วงหนึ่ง) */
  handClaspedP95Max: 0.5,
  /** เท่ากับ HAND_SEPARATION_THRESHOLD ใน scoreEngine — ถ้าคลิปแพทย์เองเกินค่านี้ ห้ามเปิดตัวตรวจ */
  handSelfPenaltyThreshold: 0.15,
  /** บิดลำตัว (p95) ของคลิปแพทย์เกินค่านี้ = ท่าสาธิตจะโดนหักราว 5 คะแนนขึ้นไป
   *  (TORSO_TWIST_THRESHOLD 0.08 + 5/75) -> ถือว่าท่านี้ขยับลำตัวตามธรรมชาติ */
  torsoTwistAllowMin: 0.15,
  /** baseline = median ของ N เฟรมแรกที่ใช้ได้ของแต่ละคลิป */
  baselineFrames: 5,
  /** ต้องมีเฟรมที่ลำตัวมองเห็นอย่างน้อยสัดส่วนนี้ ไม่งั้นไม่ตัดสิน (ปิดทั้งสองข้อ) */
  minTorsoVisibleRatio: 0.5,
  /** visibility ขั้นต่ำของไหล่/สะโพกต่อเฟรม */
  minVisibility: 0.4,
} as const;

export interface TechniqueFlagsEvidence {
  version: 1;
  clipsUsed: number;
  framesUsed: number;
  torsoVisibleRatio: number;
  handMedian: number | null;
  handP95: number | null;
  handMaxDelta: number | null;
  twistP95: number | null;
  handReason: string;
  torsoReason: string;
}

export interface TechniqueFlagsResult {
  checksHandProximity: boolean;
  allowsTorsoMovement: boolean;
  evidence: TechniqueFlagsEvidence;
}

export interface TechniqueFlagsInput {
  /** ชนิดของมุมหลักของท่า: บิดลำตัวมีผลต่อคะแนนเฉพาะท่าแบบ vector */
  angleType: 'joint' | 'vector';
  /** คลิปสาธิตของแพทย์ทุกคลิป (คลิปฐาน + คลิปต้นแบบเพิ่มเติม) — ไม่รวมคลิปท่าผิด */
  clips: TechniqueFrame[][];
}

// ---------------------------------------------------------------------------

/** คำนวณ feature จาก landmark ดิบ (MediaPipe Pose 33 จุด) — ใช้ใน repo ที่ FrameSample ไม่มี feature สำเร็จรูป */
export function techniqueFramesFromLandmarks(landmarks: LandmarkLike[][]): TechniqueFrame[] {
  const minVis = TECHNIQUE_FLAG_PARAMS.minVisibility;
  return landmarks.map((lm) => {
    const ls = lm[11], rs = lm[12], lh = lm[23], rh = lm[24], lw = lm[15], rw = lm[16];
    if (!ls || !rs || !lh || !rh || !lw || !rw) {
      return { shoulderWidthNorm: NaN, wristDistanceNorm: NaN, torsoOk: false };
    }
    const neckX = (ls.x + rs.x) / 2;
    const neckY = (ls.y + rs.y) / 2;
    const lTorso = (Math.hypot(neckX - lh.x, neckY - lh.y) + Math.hypot(neckX - rh.x, neckY - rh.y)) / 2;
    const vis = (p: LandmarkLike) => (p.visibility === undefined ? 1 : p.visibility);
    const torsoOk = lTorso > 1e-6 && Math.min(vis(ls), vis(rs), vis(lh), vis(rh)) >= minVis;
    return {
      shoulderWidthNorm: Math.hypot(ls.x - rs.x, ls.y - rs.y) / (lTorso || 1),
      wristDistanceNorm: Math.hypot(lw.x - rw.x, lw.y - rw.y) / (lTorso || 1),
      torsoOk,
    };
  });
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function inferTechniqueFlags(input: TechniqueFlagsInput): TechniqueFlagsResult {
  const P = TECHNIQUE_FLAG_PARAMS;
  let total = 0;
  let usable = 0;

  const clipStats: { handMedian: number; handP95: number; handMaxDelta: number; twistP95: number }[] = [];

  for (const clip of input.clips) {
    total += clip.length;
    const ok = clip.filter(
      (f) => f.torsoOk !== false && Number.isFinite(f.shoulderWidthNorm) && Number.isFinite(f.wristDistanceNorm)
    );
    usable += ok.length;
    if (ok.length < 10) continue;

    const head = ok.slice(0, P.baselineFrames);
    const baseShoulder = median(head.map((f) => f.shoulderWidthNorm)) || 1;
    const baseWrist = median(head.map((f) => f.wristDistanceNorm));

    const wrist = ok.map((f) => f.wristDistanceNorm);
    const twist = ok.map((f) => Math.max(0, 1 - f.shoulderWidthNorm / baseShoulder));
    clipStats.push({
      handMedian: median(wrist),
      handP95: percentile(wrist, 0.95),
      handMaxDelta: Math.max(0, ...wrist.map((w) => w - baseWrist)),
      twistP95: percentile(twist, 0.95),
    });
  }

  const torsoVisibleRatio = total > 0 ? usable / total : 0;
  const evidenceBase = {
    version: 1 as const,
    clipsUsed: clipStats.length,
    framesUsed: usable,
    torsoVisibleRatio: r3(torsoVisibleRatio),
  };

  if (clipStats.length === 0 || torsoVisibleRatio < P.minTorsoVisibleRatio) {
    const reason = 'ตัดสินไม่ได้: ลำตัว (ไหล่/สะโพก) ในคลิปสาธิตมองเห็นไม่พอ จึงไม่เปิดเกณฑ์ทั้งสองข้อ';
    return {
      checksHandProximity: false,
      allowsTorsoMovement: false,
      evidence: { ...evidenceBase, handMedian: null, handP95: null, handMaxDelta: null, twistP95: null, handReason: reason, torsoReason: reason },
    };
  }

  const handMedian = Math.max(...clipStats.map((c) => c.handMedian));
  const handP95 = Math.max(...clipStats.map((c) => c.handP95));
  const handMaxDelta = Math.max(...clipStats.map((c) => c.handMaxDelta));
  const twistP95 = median(clipStats.map((c) => c.twistP95));

  // ---- มือ ----
  const clasped = handMedian <= P.handClaspedMedianMax && handP95 <= P.handClaspedP95Max;
  let checksHandProximity = false;
  let handReason: string;
  if (!clasped) {
    handReason = 'มือไม่ได้ประกบกันตลอดท่าในคลิปสาธิต จึงไม่ตรวจการแยกมือ';
  } else if (handMaxDelta > P.handSelfPenaltyThreshold) {
    handReason = 'มือประกบกัน แต่ในคลิปสาธิตเองมือก็ขยับห่างเกินเกณฑ์ที่จะหักคะแนน จึงไม่เปิดตัวตรวจ (กันหักท่าสาธิตของแพทย์เอง)';
  } else {
    checksHandProximity = true;
    handReason = 'มือประกบกันตลอดท่าในคลิปสาธิต จึงตรวจการแยกมือ';
  }

  // ---- ลำตัว ----
  let allowsTorsoMovement = false;
  let torsoReason: string;
  if (input.angleType !== 'vector') {
    torsoReason = 'ท่านี้ใช้มุมข้อต่อ ไม่มีการหักคะแนนบิดลำตัวอยู่แล้ว จึงไม่ต้องตั้งค่า';
  } else if (twistP95 > P.torsoTwistAllowMin) {
    allowsTorsoMovement = true;
    torsoReason = 'ลำตัวของแพทย์ขยับ/บิดตามธรรมชาติของท่า จึงปิดการหักคะแนนบิดลำตัว';
  } else {
    torsoReason = 'ลำตัวนิ่งตลอดท่าในคลิปสาธิต จึงคงการหักคะแนนบิดลำตัวไว้';
  }

  return {
    checksHandProximity,
    allowsTorsoMovement,
    evidence: {
      ...evidenceBase,
      handMedian: r3(handMedian),
      handP95: r3(handP95),
      handMaxDelta: r3(handMaxDelta),
      twistP95: r3(twistP95),
      handReason,
      torsoReason,
    },
  };
}
