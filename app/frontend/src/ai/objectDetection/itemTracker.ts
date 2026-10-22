import { DetectedObject, ItemTrackingState, TrackedItem } from '../../types/ai';
import { OneEuroFilter } from '../filters/oneEuroFilter';

/**
 * ติดตามวัตถุที่ล็อกไว้ 1 ชิ้นข้ามเฟรม ต่อยอดจาก ObjectDetectorService (ตรวจจับได้แค่ต่อเฟรม ไม่มี identity ข้ามเฟรม)
 * ใช้วิธี tracking-by-detection: เทียบผล detect ใหม่กับตำแหน่ง/label ล่าสุด เลือกตัวที่ label ตรงและใกล้ที่สุด
 *
 * พิกัดเป็นพิกเซลจริงของเฟรมวิดีโอ (caller ต้องส่ง videoWidth/videoHeight จริงตาม video element)
 * ระยะห่างระหว่างจุดศูนย์กลาง normalize ด้วยเส้นทแยงมุมของเฟรม เพื่อให้เกณฑ์ใช้ได้เหมือนกันทุกความละเอียด
 */

/** ระยะห่างสูงสุดที่ยอมรับว่าเป็นวัตถุเดียวกัน เมื่อผลตรวจจับมี label ตรงกับที่ล็อกไว้ (สัดส่วนของเส้นทแยงมุมเฟรม)
 *  — ตั้งไว้ค่อนข้างกว้างเพราะ object detection รันแค่ ~5fps (ทุก 200ms) วัตถุอาจขยับได้พอสมควรระหว่างเฟรมตรวจจับ
 *  2 ครั้ง โดยเฉพาะถ้าผู้ป่วยขยับมือเร็ว */
const MAX_MATCH_DISTANCE_RATIO = 0.25;

/** เกณฑ์ระยะเมื่อ label "ไม่ตรง" กับที่ล็อกไว้ (แคบกว่า MAX_MATCH_DISTANCE_RATIO มาก) — กันกรณีโมเดลจัดประเภทผิด
 *  ชั่วคราว (เช่น bottle สลับเป็น cup) ไม่ให้ถือว่าหลุดการติดตาม โดยไม่เปลี่ยน lockedLabel ตาม */
const MAX_MATCH_DISTANCE_RATIO_ANY_LABEL = 0.12;

/** จำนวนเฟรม (ที่เรียก update จริง ไม่ใช่ทุก requestAnimationFrame) ที่ไม่เจอวัตถุตรงเกณฑ์ติดต่อกัน ก่อนถือว่า
 *  "หลุดการติดตาม" — object detection รันที่ ~5fps (OBJECT_DETECT_INTERVAL_MS=200 ในหน้า UI) ดังนั้น 15 เฟรม ≈ 3
 *  วินาทีของการหาไม่เจอต่อเนื่อง ถึงจะถือว่าหลุดจริงๆ ไม่ใช่แค่เฟรมเดียวที่ detect พลาด */
export const LOST_THRESHOLD_FRAMES = 15;

/** ค่า minCutoff/beta ของ OneEuroFilter สำหรับกรองตำแหน่ง marker — ตั้งให้นุ่มกว่าที่ใช้กรอง landmark ท่าแขน
 *  (ExerciseLiveView) เล็กน้อย เพราะ object detection รันช้ากว่ามาก (~5fps เทียบกับ ~15fps ของมือ/~30fps ของท่าแขน)
 *  สัญญาณตำแหน่งจึงมีช่วงห่างระหว่างตัวอย่างมากกว่า ถ้า minCutoff สูงไปจะเห็นมาร์กเกอร์กระตุกตามกรอบ detect ที่ขยับ */
const MARKER_MIN_CUTOFF = 0.8;
const MARKER_BETA = 0.3;

function centroidOf(box: DetectedObject['boundingBox']): { x: number; y: number } {
  return { x: box.originX + box.width / 2, y: box.originY + box.height / 2 };
}

export class ItemTracker {
  private lockedLabel: string | null = null;
  private lastCentroid: { x: number; y: number } | null = null;
  private lastBoundingBox: DetectedObject['boundingBox'] | null = null;
  private lastScore = 0;
  private framesSinceSeen = 0;
  private filterX = new OneEuroFilter(MARKER_MIN_CUTOFF, MARKER_BETA);
  private filterY = new OneEuroFilter(MARKER_MIN_CUTOFF, MARKER_BETA);

  get state(): ItemTrackingState {
    if (!this.lockedLabel) return 'selecting';
    return this.framesSinceSeen > LOST_THRESHOLD_FRAMES ? 'lost' : 'tracking';
  }

  /** ล็อกวัตถุใหม่จากผลตรวจจับ 1 รายการที่ผู้ใช้เลือก (หรือแตะเลือก) — รีเซ็ต filter ทั้งหมด กัน marker
   *  กระโดดข้ามจากตำแหน่งวัตถุเก่าที่เคยล็อกไว้ก่อนหน้า (ถ้ามี) ไปยังวัตถุใหม่แบบไม่นุ่มนวล */
  lock(candidate: DetectedObject, timestampMs: number): TrackedItem {
    this.lockedLabel = candidate.label;
    this.framesSinceSeen = 0;
    this.lastBoundingBox = candidate.boundingBox;
    this.lastScore = candidate.score;
    this.filterX.reset();
    this.filterY.reset();
    const raw = centroidOf(candidate.boundingBox);
    const x = this.filterX.filter(raw.x, timestampMs);
    const y = this.filterY.filter(raw.y, timestampMs);
    this.lastCentroid = { x, y };
    return this.snapshot();
  }

  /** เลิกล็อก กลับสู่สถานะ 'selecting' — ใช้ตอนผู้ใช้กด "เลือกวัตถุใหม่" เอง หรือจะให้กดล็อกใหม่หลังหลุดติดตาม */
  reset(): void {
    this.lockedLabel = null;
    this.lastCentroid = null;
    this.lastBoundingBox = null;
    this.lastScore = 0;
    this.framesSinceSeen = 0;
    this.filterX.reset();
    this.filterY.reset();
  }

  /** ย้ายตำแหน่งอ้างอิงสำหรับ update() รอบถัดไป โดยไม่เปลี่ยน lockedLabel — ใช้ตอนวัตถุถูกกำมือบังชั่วคราวแล้ว
   *  ปล่อยออก ให้เริ่มค้นหาใกล้ตำแหน่งมือล่าสุดแทนตำแหน่งเดิม รีเซ็ต filter กัน marker กระโดด */
  reanchor(centroid: { x: number; y: number }, timestampMs: number): void {
    if (!this.lockedLabel) return;
    this.filterX.reset();
    this.filterY.reset();
    const x = this.filterX.filter(centroid.x, timestampMs);
    const y = this.filterY.filter(centroid.y, timestampMs);
    this.lastCentroid = { x, y };
    this.framesSinceSeen = 0;
  }

  /** เรียกทุกครั้งที่มีผล object detection ใหม่ — จับคู่วัตถุที่ล็อกไว้กับผลตรวจจับรอบนี้ อัปเดตตำแหน่งที่กรองแล้ว
   *  คืน TrackedItem ล่าสุด (null ถ้ายังไม่เคยล็อก) หาผู้สมัคร 2 ระดับ: label ตรง (เกณฑ์กว้าง) เป็นหลัก, label
   *  ไม่ตรง (เกณฑ์แคบกว่า) เป็นตัวสำรองเมื่อไม่มี label ตรงในเกณฑ์เลย */
  update(
    candidates: DetectedObject[],
    videoWidth: number,
    videoHeight: number,
    timestampMs: number
  ): TrackedItem | null {
    if (!this.lockedLabel) return null;

    const diagonal = Math.sqrt(videoWidth * videoWidth + videoHeight * videoHeight) || 1;
    const anchor = this.lastCentroid ?? (this.lastBoundingBox ? centroidOf(this.lastBoundingBox) : null);

    let bestSameLabel: DetectedObject | null = null;
    let bestSameLabelDistance = Infinity;
    let bestAnyLabel: DetectedObject | null = null;
    let bestAnyLabelDistance = Infinity;

    if (anchor) {
      for (const candidate of candidates) {
        const c = centroidOf(candidate.boundingBox);
        const distance = Math.hypot(c.x - anchor.x, c.y - anchor.y) / diagonal;
        if (candidate.label === this.lockedLabel) {
          if (distance < bestSameLabelDistance) {
            bestSameLabelDistance = distance;
            bestSameLabel = candidate;
          }
        } else if (distance < bestAnyLabelDistance) {
          bestAnyLabelDistance = distance;
          bestAnyLabel = candidate;
        }
      }
    }

    let matched: DetectedObject | null = null;
    if (bestSameLabel && bestSameLabelDistance <= MAX_MATCH_DISTANCE_RATIO) {
      matched = bestSameLabel;
    } else if (bestAnyLabel && bestAnyLabelDistance <= MAX_MATCH_DISTANCE_RATIO_ANY_LABEL) {
      matched = bestAnyLabel; // label ไม่ตรงแต่อยู่ใกล้ตำแหน่งเดิมมากพอ — ไม่แก้ lockedLabel ตาม (ดูคอมเมนต์ค่าคงที่ด้านบน)
    }

    if (matched) {
      this.framesSinceSeen = 0;
      this.lastBoundingBox = matched.boundingBox;
      this.lastScore = matched.score;
      const raw = centroidOf(matched.boundingBox);
      const x = this.filterX.filter(raw.x, timestampMs);
      const y = this.filterY.filter(raw.y, timestampMs);
      this.lastCentroid = { x, y };
    } else {
      // ไม่เจอวัตถุที่ตรงเกณฑ์ไหนเลยรอบนี้ — คงตำแหน่งล่าสุดไว้ก่อน (ไม่ขยับ marker ไปไหนเอง) แค่นับเฟรมที่หาไม่
      // เจอเพิ่ม
      this.framesSinceSeen += 1;
    }

    return this.snapshot();
  }

  private snapshot(): TrackedItem {
    return {
      label: this.lockedLabel as string,
      centroid: this.lastCentroid as { x: number; y: number },
      boundingBox: this.lastBoundingBox as DetectedObject['boundingBox'],
      score: this.lastScore,
      framesSinceSeen: this.framesSinceSeen,
    };
  }
}
