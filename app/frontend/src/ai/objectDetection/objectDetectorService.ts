import { FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision';
import { DetectedObject } from '../../types/ai';

/**
 * สกัฟโฟลด์ object detection สำหรับ virtual grip ในอนาคต — ฟีเจอร์ทดลอง/optional เท่านั้น ไม่ผูกกับ FSM/scoring
 * เปิดจาก UI toggle เท่านั้น (ดู VirtualGripView.tsx) ไม่โหลดโมเดลอัตโนมัติตอนเปิดหน้า
 *
 * ใช้โมเดล EfficientDet-Lite2 ของ Google (COCO dataset, ~80 คลาส) ไม่ได้เทรนเฉพาะสำหรับกายภาพบำบัด
 * เปลี่ยนจาก Lite0 มาเป็น Lite2 เพราะวัตถุผิวใส/สะท้อนแสง (เช่นขวดน้ำ) ได้คะแนนต่ำจน filter ตกบ่อย — Lite2 ช้ากว่า
 * แต่แม่นกว่า และคอขวดจริงอยู่ที่ throttle ~5 ครั้ง/วิ ไม่ใช่ inference speed จึงไม่กระทบความลื่นของภาพ
 */

const WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm';
const OBJECT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/latest/efficientdet_lite2.tflite';

export class ObjectDetectorService {
  private detector: ObjectDetector | null = null;
  private loading: Promise<void> | null = null;

  // ลดจาก 0.4 เดิม — วัตถุผิวใส/สะท้อนแสง (เช่นขวดน้ำ) มักได้คะแนนต่ำจนถูกกรองตกเกินจำเป็น
  // ค่าต่ำลงนี้แลกกับผลลัพธ์ปลอมมากขึ้นบ้าง แต่ผู้ใช้ยืนยันเองด้วยการแตะเลือกอยู่แล้ว
  async init(maxResults: number = 5, scoreThreshold: number = 0.25): Promise<void> {
    if (this.detector) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
      const commonOptions = { runningMode: 'VIDEO' as const, maxResults, scoreThreshold };
      try {
        // เหตุผลเดียวกับ handLandmarkerService.ts — ลอง GPU ก่อน ถอยไป CPU ถ้า init ล้มเหลว กันมือถือบางรุ่นพังทั้งฟีเจอร์
        this.detector = await ObjectDetector.createFromOptions(vision, {
          baseOptions: { modelAssetPath: OBJECT_MODEL_URL, delegate: 'GPU' },
          ...commonOptions,
        });
      } catch {
        this.detector = await ObjectDetector.createFromOptions(vision, {
          baseOptions: { modelAssetPath: OBJECT_MODEL_URL, delegate: 'CPU' },
          ...commonOptions,
        });
      }
    })();

    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  get isReady(): boolean {
    return this.detector !== null;
  }

  detect(video: HTMLVideoElement, timestampMs: number): DetectedObject[] {
    if (!this.detector || video.readyState < 2) return [];
    try {
      const result = this.detector.detectForVideo(video, timestampMs);
      return result.detections
        .filter((d) => d.boundingBox)
        // ตัดคลาส "person" ออกเสมอ — โมเดลตรวจจับตัวผู้ป่วย/แพทย์ในเฟรมด้วย แต่ไม่มีทางเป็นวัตถุที่จะทดสอบ
        // กรองที่ต้นทางนี้ที่เดียว ครอบคลุมทั้งช่วงเลือกวัตถุและช่วงติดตาม (ItemTracker.update)
        .filter((d) => d.categories[0]?.categoryName !== 'person')
        .map((d) => ({
          label: d.categories[0]?.categoryName ?? 'ไม่ทราบชนิด',
          score: d.categories[0]?.score ?? 0,
          boundingBox: d.boundingBox!,
        }));
    } catch {
      return [];
    }
  }

  dispose(): void {
    this.detector?.close();
    this.detector = null;
  }
}
