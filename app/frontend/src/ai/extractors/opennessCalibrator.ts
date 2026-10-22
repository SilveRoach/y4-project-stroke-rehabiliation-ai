import { OpennessCalibration, buildOpennessCalibration, MIN_CALIBRATION_SPAN } from './gripStateClassifier';

/**
 * ขั้นตอนสอบเทียบ openness ของผู้เล่น (แบมือสุด → กำแน่น) แยกเป็นคลาสล้วนๆ ไม่ผูกกับ React เพื่อให้ทุกเกมใช้ร่วมกันได้ผ่าน
 * hook ใน components/useOpennessCalibration.tsx และทดสอบด้วยข้อมูลจำลองได้ — ค่าที่ได้เก็บแบบข้ามแท็บ/ข้ามการรีเฟรชด้วย
 * localStorage (ดู loadStoredCalibration) สอบเทียบครั้งเดียวใช้ได้ทุกเกมจนกว่าจะกด "สอบเทียบใหม่" (เช่นเปลี่ยนผู้เล่น)
 */

export const CALIB_SETTLE_MS = 1500; // รอให้มือเข้าท่า (ไม่เก็บตัวอย่าง)
export const CALIB_SAMPLE_MS = 2000; // ช่วงเก็บตัวอย่างต่อท่า

export type CalibStep = 'idle' | 'open' | 'closed';

export interface CalibratorStatus {
  step: CalibStep;
  /** ความคืบหน้าช่วงเก็บตัวอย่างของท่าปัจจุบัน 0..1 (0 = ยังอยู่ช่วงเตรียมท่า) ปัดทีละ 5% */
  progress: number;
  /** ข้อความผิดพลาดจากครั้งล่าสุด (null = ไม่มี) */
  error: string | null;
}

export interface CalibratorFeedResult {
  status: CalibratorStatus;
  /** true ในเฟรมที่ขั้นตอนจบพอดี (สำเร็จหรือล้มเหลว) */
  finished: boolean;
  calibration: OpennessCalibration | null;
}

export class OpennessCalibrator {
  private step: CalibStep = 'idle';
  private stepStartMs = 0;
  private openSamples: number[] = [];
  private closedSamples: number[] = [];
  private error: string | null = null;

  get active(): boolean {
    return this.step !== 'idle';
  }

  start(nowMs: number): CalibratorStatus {
    this.step = 'open';
    this.stepStartMs = nowMs;
    this.openSamples = [];
    this.closedSamples = [];
    this.error = null;
    return this.status(0);
  }

  cancel(): CalibratorStatus {
    this.step = 'idle';
    return this.status(0);
  }

  /** ป้อนค่าเหยียดดิบ (computeHandExtension) ทุกเฟรม — null เมื่อไม่พบมือ */
  feed(nowMs: number, rawExtension: number | null): CalibratorFeedResult {
    if (this.step === 'idle') return { status: this.status(0), finished: false, calibration: null };

    const elapsed = nowMs - this.stepStartMs;
    if (elapsed >= CALIB_SETTLE_MS && elapsed <= CALIB_SETTLE_MS + CALIB_SAMPLE_MS && rawExtension !== null) {
      (this.step === 'open' ? this.openSamples : this.closedSamples).push(rawExtension);
    }
    const progress = Math.max(0, Math.min(1, (elapsed - CALIB_SETTLE_MS) / CALIB_SAMPLE_MS));

    if (elapsed <= CALIB_SETTLE_MS + CALIB_SAMPLE_MS) {
      return { status: this.status(progress), finished: false, calibration: null };
    }

    if (this.step === 'open') {
      this.step = 'closed';
      this.stepStartMs = nowMs;
      return { status: this.status(0), finished: false, calibration: null };
    }

    const result = buildOpennessCalibration(this.openSamples, this.closedSamples);
    const enough = this.openSamples.length >= 8 && this.closedSamples.length >= 8;
    this.step = 'idle';
    this.error = result
      ? null
      : enough
        ? `ช่วงระหว่างท่ากำกับท่าแบแคบเกินไป (ต้องห่างกันอย่างน้อย ${MIN_CALIBRATION_SPAN} เท่าของขนาดฝ่ามือ) — แบมือให้กางนิ้วเต็มที่ และกำให้แน่นขึ้นแล้วลองใหม่`
        : 'ไม่พบมือในกล้องนานพอระหว่างสอบเทียบ — วางมือให้อยู่กลางภาพและเห็นทั้งมือ แล้วลองใหม่';
    return { status: this.status(0), finished: true, calibration: result };
  }

  private status(progress: number): CalibratorStatus {
    return { step: this.step, progress: Math.round(progress * 20) / 20, error: this.error };
  }
}

// ---------- เก็บค่าที่สอบเทียบแล้ว (ข้ามแท็บ/รีเฟรช) ----------
const STORAGE_KEY = 'rehab.opennessCalibration.v1';
let memoryCalibration: OpennessCalibration | null = null;

function isValid(c: any): c is OpennessCalibration {
  return (
    c && Number.isFinite(c.closedRef) && Number.isFinite(c.openRef) && c.openRef - c.closedRef >= MIN_CALIBRATION_SPAN
  );
}

/** อ่านค่าสอบเทียบล่าสุด (localStorage ถ้าใช้ได้ ไม่งั้นค่าในหน่วยความจำ) — คืน null ถ้ายังไม่เคยสอบเทียบหรือค่าเสีย */
export function loadStoredCalibration(): OpennessCalibration | null {
  if (memoryCalibration) return memoryCalibration;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isValid(parsed)) {
        memoryCalibration = { closedRef: parsed.closedRef, openRef: parsed.openRef };
        return memoryCalibration;
      }
    }
  } catch {
    // localStorage ใช้ไม่ได้ (โหมดส่วนตัว/ถูกบล็อก) — ใช้แค่ค่าในหน่วยความจำ
  }
  return null;
}

export function saveStoredCalibration(c: OpennessCalibration): void {
  memoryCalibration = c;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    // ไม่เป็นไร — ยังใช้ค่าในหน่วยความจำต่อได้ในเซสชันนี้
  }
}

export function clearStoredCalibration(): void {
  memoryCalibration = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
