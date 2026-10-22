import { Landmark } from '../../types/ai';
import { GripState } from '../../types/ai';
import { WRIST_INDEX } from '../render/handSkeletonRenderer';

// จุดข้อโคนนิ้วกลาง (MCP) ใช้เป็นตัวอ้างอิงขนาดฝ่ามือ (คล้ายบทบาทเดียวกับ L_torso ใน torsoNormalizer.ts —
// ใช้ระยะทางในร่างกายตัวเองแทนหน่วยพิกเซล/เมตร กันปัญหาระยะห่างกล้อง/ขนาดมือแต่ละคนไม่เท่ากัน)
const MIDDLE_MCP_INDEX = 9;

// ปลายนิ้ว 4 นิ้ว (ไม่รวมโป้ง เพราะเรขาคณิตนิ้วโป้งต่างจากนิ้วอื่นมาก การเหยียด/งอโป้งเคลื่อนที่ในแนวขวางเป็นหลัก
// ไม่ใช่เข้า-ออกจากข้อมือตรงๆ เหมือน 4 นิ้วที่เหลือ ใช้แค่ 4 นิ้วนี้พอสำหรับเกณฑ์กำ/แบมือแบบหยาบ)
const GRIP_FINGERTIP_INDICES = [8, 12, 16, 20];

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * ค่า "การเหยียดมือ" ดิบ (ยังไม่ผ่านการสเกล) = ระยะเฉลี่ยปลายนิ้ว 4 นิ้ว→ข้อมือ หารด้วยขนาดฝ่ามือ (ข้อมือ→ข้อโคนนิ้วกลาง)
 * หน่วยเป็น "เท่าของขนาดฝ่ามือ" ไม่มีขอบเขตตายตัว (กำแน่นจริงราว 0.8-1.0, แบมือสุดบนภาพ 2 มิติราว 1.7-1.9 ขึ้นกับ
 * มุมมือที่หันเข้ากล้อง) — แยกออกมาเพื่อให้เกมที่ต้องสเกลเป็นรายคน (calibrate) ใช้ค่าดิบนี้ได้ตรงๆ
 */
export function computeHandExtension(landmarks: Landmark[]): number | null {
  const wrist = landmarks[WRIST_INDEX];
  const palmRef = landmarks[MIDDLE_MCP_INDEX];
  if (!wrist || !palmRef) return null;

  const palmSize = dist(wrist, palmRef) || 1e-6;

  const normalizedDistances = GRIP_FINGERTIP_INDICES.map((i) => {
    const tip = landmarks[i];
    if (!tip) return 0;
    return dist(tip, wrist) / palmSize;
  });

  return normalizedDistances.reduce((sum, v) => sum + v, 0) / normalizedDistances.length;
}

/**
 * คำนวณ "ค่าความแบมือ" ต่อเนื่อง 0 (กำมือแน่น) ถึง ~1 (แบมือสุด) จากระยะปลายนิ้ว→ข้อมือ normalize ด้วยขนาดฝ่ามือ
 * OPEN_REF/CLOSED_REF เป็นค่าประมาณคงที่ ยังไม่ได้ calibrate จากข้อมูลจริง — ปรับได้ถ้าเกณฑ์ไม่แม่น
 *
 * หมายเหตุ: ฟังก์ชันนี้ใช้ร่วมกับเกมบอล/เกมเส้นทาง/Tremor ที่ปรับเกณฑ์ (0.35/0.55 ฯลฯ) ไว้กับสเกลนี้แล้ว จึงไม่แก้ค่าคงที่ที่นี่
 * — ในทางปฏิบัติ OPEN_REF=2.7 สูงกว่าค่าที่มือแบสุดบนภาพ 2 มิติทำได้จริง (~1.8) แบมือสุดจึงได้ openness แค่ ~0.5 ส่วนเกมที่
 * ต้องการสเกลเต็ม 0-1 ให้ใช้ computeHandExtension + normalizeOpenness ด้านล่างแทน
 */
export function computeHandOpenness(landmarks: Landmark[]): number {
  const meanNormalizedDistance = computeHandExtension(landmarks);
  if (meanNormalizedDistance === null) return 0;

  // กำมือแน่น: ปลายนิ้วอยู่ใกล้ข้อมือ ~ 0.7-0.9 เท่าของขนาดฝ่ามือ
  // แบมือสุด: ปลายนิ้วอยู่ไกลข้อมือ ~ 2.6-2.8 เท่าของขนาดฝ่ามือ
  const CLOSED_REF = 0.8;
  const OPEN_REF = 2.7;

  const openness = (meanNormalizedDistance - CLOSED_REF) / (OPEN_REF - CLOSED_REF);
  return Math.max(0, Math.min(1, openness));
}

/** ค่าอ้างอิงเฉพาะบุคคลจากขั้นตอนสอบเทียบ (หน่วยเดียวกับ computeHandExtension) */
export interface OpennessCalibration {
  closedRef: number;
  openRef: number;
}

/** ช่วงห่างขั้นต่ำระหว่างค่ากำกับค่าแบ (หน่วยเท่าของขนาดฝ่ามือ) — แคบกว่านี้ถือว่าสอบเทียบไม่สำเร็จ
 *  (มือเคลื่อนไหวน้อยเกินหรือยังไม่ได้ทำท่าจริง) เพราะการหารด้วยช่วงแคบๆ จะขยาย noise จนค่ากระโดด */
export const MIN_CALIBRATION_SPAN = 0.45;

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * สร้างค่าสอบเทียบจากตัวอย่างค่าดิบตอน "แบมือสุด" และ "กำมือแน่น" ของผู้ใช้คนนั้น
 * ใช้เปอร์เซนไทล์แทน max/min เพื่อไม่ให้เฟรมที่ landmark กระโดดเพี้ยนครั้งเดียวมากำหนดสเกลทั้งเกม
 * (แบมือ = เปอร์เซนไทล์ที่ 75 ของตัวอย่างแบมือ, กำมือ = เปอร์เซนไทล์ที่ 25 ของตัวอย่างกำมือ — ตัวอย่างช่วงต้นที่
 * มือยังเคลื่อนไม่ถึงท่าจะอยู่ปลายอีกด้านของการกระจาย จึงไม่ฉุดค่าอ้างอิง) คืน null ถ้าตัวอย่างไม่พอหรือช่วงแคบเกิน
 */
export function buildOpennessCalibration(
  openSamples: number[],
  closedSamples: number[],
  minSamples = 8
): OpennessCalibration | null {
  if (openSamples.length < minSamples || closedSamples.length < minSamples) return null;
  const openSorted = [...openSamples].sort((a, b) => a - b);
  const closedSorted = [...closedSamples].sort((a, b) => a - b);
  const openRef = percentile(openSorted, 0.75);
  const closedRef = percentile(closedSorted, 0.25);
  if (!Number.isFinite(openRef) || !Number.isFinite(closedRef)) return null;
  if (openRef - closedRef < MIN_CALIBRATION_SPAN) return null;
  return { closedRef, openRef };
}

/** แปลงค่าเหยียดดิบเป็น openness 0-1 ตามช่วงของคนนั้น (0 = กำสุดของเขา, 1 = แบสุดของเขา) */
export function normalizeOpenness(rawExtension: number, calibration: OpennessCalibration): number {
  const span = calibration.openRef - calibration.closedRef;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, (rawExtension - calibration.closedRef) / span));
}

// เกณฑ์แบบ hysteresis (สองเกณฑ์ ไม่ใช่เกณฑ์เดียว) กันสถานะกระพริบตอนค่าแกว่งอยู่ใกล้จุดกึ่งกลาง — เข้าเกณฑ์
// "ปิด" ต้องต่ำกว่า closeEnter, เข้าเกณฑ์ "เปิด" ต้องสูงกว่า openEnter, ถ้าอยู่ระหว่างกลางให้คงสถานะเดิมไว้
export interface GripThresholds {
  closeEnter: number;
  openEnter: number;
}

/** เกณฑ์เดิม ปรับไว้กับสูตร openness คงที่ (computeHandOpenness) ที่แบมือสุดได้แค่ ~0.5 — ใช้เฉพาะตอนยังไม่สอบเทียบ */
export const LEGACY_GRIP_THRESHOLDS: GripThresholds = { closeEnter: 0.35, openEnter: 0.55 };

/** เกณฑ์สำหรับ openness ที่สอบเทียบแล้ว (0 = กำสุดของผู้เล่น, 1 = แบสุดของผู้เล่น) — ผ่อนปรนกว่าเกมทดสอบกำ-แบมือ
 *  (0.3/0.7) เล็กน้อย เพราะเกมที่เล่นจริงต้องการให้จับ/ปล่อยได้ลื่น ไม่ต้องกำ/แบให้สุดช่วงทุกครั้ง */
export const CALIBRATED_GRIP_THRESHOLDS: GripThresholds = { closeEnter: 0.35, openEnter: 0.65 };

/** แปลง openness score ต่อเนื่องเป็นสถานะ 2 ค่า (open/closed) พร้อม hysteresis กันกระพริบ
 *  ส่ง previousState เข้ามาด้วยทุกครั้ง (state จากเฟรมก่อนหน้า) — เฟรมแรกที่ยังไม่มี previousState ให้ส่ง null มา
 *  thresholds ปล่อยว่างได้ (ใช้เกณฑ์เดิม) แต่ถ้า openness มาจาก normalizeOpenness ต้องส่ง CALIBRATED_GRIP_THRESHOLDS */
export function classifyGripState(
  openness: number,
  previousState: GripState | null,
  thresholds: GripThresholds = LEGACY_GRIP_THRESHOLDS
): GripState {
  if (openness <= thresholds.closeEnter) return 'closed';
  if (openness >= thresholds.openEnter) return 'open';
  // อยู่ในโซนกลาง — คงสถานะเดิม ถ้ายังไม่เคยมีสถานะมาก่อนเลยให้ตัดสินคร่าวๆ จากจุดกึ่งกลางของสองเกณฑ์
  return previousState ?? (openness >= (thresholds.closeEnter + thresholds.openEnter) / 2 ? 'open' : 'closed');
}
