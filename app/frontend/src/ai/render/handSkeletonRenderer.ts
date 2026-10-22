import { Landmark } from '../../types/ai';

/**
 * จุดเชื่อม skeleton มือ ตามโครง 21 landmark มาตรฐานของ MediaPipe Hands/HandLandmarker
 * (0=ข้อมือ, 1-4=นิ้วโป้ง, 5-8=นิ้วชี้, 9-12=นิ้วกลาง, 13-16=นิ้วนาง, 17-20=นิ้วก้อย) คนละชุดกับ SKELETON_CONNECTIONS (ร่างกาย)
 */
export const HAND_CONNECTIONS: [number, number][] = [
  // นิ้วโป้ง
  [0, 1], [1, 2], [2, 3], [3, 4],
  // นิ้วชี้
  [0, 5], [5, 6], [6, 7], [7, 8],
  // นิ้วกลาง
  [9, 10], [10, 11], [11, 12],
  // นิ้วนาง
  [13, 14], [14, 15], [15, 16],
  // นิ้วก้อย
  [17, 18], [18, 19], [19, 20],
  // ฝ่ามือ (เชื่อมฐานนิ้วแต่ละนิ้วเข้าด้วยกัน + กลับมาข้อมือ)
  [5, 9], [9, 13], [13, 17], [0, 17],
];

/** ปลายนิ้วทั้ง 5 (ใช้บ่อยใน grip classifier / จุดสังเกตอื่นๆ) */
export const FINGERTIP_INDICES = [4, 8, 12, 16, 20] as const;
export const WRIST_INDEX = 0;
/** จุดข้อโคนนิ้วกลาง (MCP) — ใช้เป็นจุดอ้างอิงขนาด/จุดศูนย์กลางฝ่ามือ (เช่น มิดพอยต์ wrist↔MIDDLE_MCP ประมาณจุด
 *  กึ่งกลางฝ่ามือ ใช้ติดตามตำแหน่งมือใน VirtualGripBallView.tsx — wrist เดี่ยวๆ จะอยู่ค่อนไปทางโคนมือ ไม่ใช่กลางฝ่ามือ) */
export const MIDDLE_MCP_INDEX = 9;

export interface DrawHandSkeletonOptions {
  /** true = กลับด้านซ้าย-ขวาเหมือนกระจก ให้ตรงกับภาพที่ผู้ป่วยเห็นตัวเองระหว่างฝึก (ค่าเริ่มต้นเหมือน skeletonRenderer.ts) */
  mirror?: boolean;
  strokeStyle?: string;
  jointFillStyle?: string;
  lineWidth?: number;
  jointRadius?: number;
}

/** วาด skeleton มือ 1 ข้าง ลงบน canvas context ที่กำหนด — ไม่ clear/วาดพื้นหลังให้ ผู้เรียกต้องเตรียมพื้นหลังเอง
 *  (มิเรอร์สไตล์เดียวกับ drawSkeleton ใน skeletonRenderer.ts) */
export function drawHandSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  width: number,
  height: number,
  options: DrawHandSkeletonOptions = {}
): void {
  const {
    mirror = true,
    strokeStyle = '#29b6f6',
    jointFillStyle = '#ffca28',
    lineWidth = 3,
    jointRadius = 4,
  } = options;

  if (!landmarks || landmarks.length === 0) return;

  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.fillStyle = jointFillStyle;
  ctx.lineWidth = lineWidth;

  const toCanvasX = (x: number) => (mirror ? 1 - x : x) * width;

  HAND_CONNECTIONS.forEach(([i, j]) => {
    const p1 = landmarks[i];
    const p2 = landmarks[j];
    if (!p1 || !p2) return;

    const x1 = toCanvasX(p1.x);
    const y1 = p1.y * height;
    const x2 = toCanvasX(p2.x);
    const y2 = p2.y * height;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  });

  landmarks.forEach((p) => {
    if (!p) return;
    ctx.beginPath();
    ctx.arc(toCanvasX(p.x), p.y * height, jointRadius, 0, 2 * Math.PI);
    ctx.fill();
  });

  ctx.restore();
}
