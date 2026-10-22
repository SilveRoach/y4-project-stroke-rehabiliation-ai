import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { Landmark } from '../../types/ai';

/**
 * ห่อการใช้งาน HandLandmarker จาก @mediapipe/tasks-vision — คนละ API กับ @mediapipe/pose ที่ใช้กับร่างกาย
 * (ตัวนี้เป็น pull-based detectForVideo) โมเดล .task โหลดจาก CDN ตอน init() แล้วรันในเครื่อง ไม่ใช่เรียก API ทุกเฟรม
 */

const WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm';
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class HandLandmarkerService {
  private landmarker: HandLandmarker | null = null;
  private loading: Promise<void> | null = null;

  /** โหลดโมเดล + WASM runtime — เรียกครั้งเดียวตอนเปิดหน้า (เรียกซ้ำได้ปลอดภัย รอ instance เดิมถ้ากำลังโหลดอยู่) */
  async init(numHands: number = 1): Promise<void> {
    if (this.landmarker) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
      const commonOptions = {
        runningMode: 'VIDEO' as const,
        numHands,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      };
      try {
        // ลอง GPU delegate ก่อน (ปกติเร็วกว่า) แต่มือถือบางรุ่น/เบราว์เซอร์รองรับ WebGL delegate ไม่เสถียร
        // (โดยเฉพาะ Safari บน iOS) ถ้า init ล้มเหลวให้ถอยไปใช้ CPU delegate แทนแทนที่จะพังทั้งฟีเจอร์ไปเลย
        this.landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: 'GPU' },
          ...commonOptions,
        });
      } catch {
        this.landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: 'CPU' },
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
    return this.landmarker !== null;
  }

  /**
   * ตรวจจับมือ 1 เฟรมจาก video element — คืน landmark ของมือแรกที่เจอ (normalized 21 จุด) หรือ null ถ้าไม่เจอมือเลย
   * ต้องเรียก init() ให้เสร็จก่อน (ถ้ายังไม่พร้อมจะคืน null เฉยๆ ไม่ throw กันพังทั้งลูป render)
   */
  detect(video: HTMLVideoElement, timestampMs: number): Landmark[] | null {
    if (!this.landmarker || video.readyState < 2) return null;
    try {
      const result = this.landmarker.detectForVideo(video, timestampMs);
      const first = result.landmarks?.[0];
      if (!first || first.length === 0) return null;
      return first.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    } catch {
      // เฟรมบางเฟรมอาจ detect ไม่ผ่าน (เช่น timestamp ไม่เรียงลำดับตอนสลับวิดีโอ) — ข้ามเฟรมนั้นไปเฉยๆ
      return null;
    }
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
