/**
 * ฟังก์ชันช่วยเหลือสำหรับการประมวลผลข้อมูลมือ (hand tracking helpers)
 * รับค่า landmark จาก MediaPipe hand model และคำนวณต่างๆ ที่ใช้ในเกมและการติดตาม
 */

import type { Landmark } from '../../types/ai';

/**
 * แปลง normalized palm center มาเป็น pixel coordinates บน canvas
 * @param palm - landmark array of palm center (typically 1 landmark at index 0)
 * @param canvasWidth - ความกว้างของ canvas
 * @param canvasHeight - ความสูงของ canvas
 * @returns object ที่มี x, y เป็นพิกเซล coordinates
 */
export function palmCenterToCanvasPixels(
  palm: { x: number; y: number } | Landmark | Landmark[],
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } {
  const landmark = Array.isArray(palm) ? palm[0] : palm;
  const x = landmark.x * canvasWidth;
  const y = landmark.y * canvasHeight;
  return { x, y };
}

/**
 * จัดประเภทการจับ握 (grip) จาก hand landmark
 * @param landmarks - array of 21 hand landmarks from MediaPipe
 * @param gripType - 'open' เพื่อตรวจสอบการเปิดมือ หรือ null เพื่อตรวจสอบการปิดมือ
 * @returns 'closed' หากการจับแน่น หรือ 'open' หากมือเปิด
 */
export function classifyGripFromLandmarks(
  landmarks: Landmark[],
  gripType: 'open' | null
): 'closed' | 'open' {
  if (!landmarks || landmarks.length < 21) return gripType === 'open' ? 'open' : 'closed';

  // ใช้จุดสำคัญของนิ้วและThumb เพื่อตัดสินการจับ
  const thumbTip = landmarks[4];
  const thumbIp = landmarks[3];
  const indexTip = landmarks[8];
  const indexPip = landmarks[6];
  const middleTip = landmarks[12];
  const middlePip = landmarks[10];
  const ringTip = landmarks[16];
  const ringPip = landmarks[14];
  const pinkyTip = landmarks[20];
  const pinkyPip = landmarks[18];

  // คำนวณระยะห่างสำคัญ
  const thumbIndexDist = Math.hypot(
    thumbTip.x - indexTip.x,
    thumbTip.y - indexTip.y
  );
  const thumbIndexIpDist = Math.hypot(
    thumbIp.x - indexPip.x,
    thumbIp.y - indexPip.y
  );

  // ตรวจสอบว่า thumb ได้เคลื่อนที่ไปใกล้ index finger หรือไม่
  const isGripClosed =
    thumbIndexDist < 0.4 && thumbIndexIpDist < 0.45;

  return isGripClosed ? 'closed' : 'open';
}

/**
 * คำนวณ center ของ palm แล้ว mirror (สะท้อน) ตามแกนแกว่ง
 * ใช้สำหรับการปรับปรุงทิศทางของการจับให้สอดคล้องกับมุมมอง
 * @param landmarks - array of 21 hand landmarks from MediaPipe
 * @returns normalized palm center {x, y} ที่ถูก mirror dan normalize แล้ว
 */
export function computeMirroredPalmCenterNormalized(
  landmarks: Landmark[]
): { x: number; y: number } {
  if (!landmarks || landmarks.length < 21) return { x: 0.5, y: 0.5 };

  // จุดศูนย์กลางของ palm มักจะอยู่ที่ข้อมือ (wrist) ที่ landmark index 0
  // และจุดที่ 9 (mid palm) ใช้เป็น reference ในบางโมเดล
  const wrist = landmarks[0];
  const midPalm = landmarks[9];

  // คำนวณ center เป็น average ของ wrist และ mid palm
  const centerX = (wrist.x + midPalm.x) / 2;
  const centerY = (wrist.y + midPalm.y) / 2;

  // mirror x coordinate (สะท้อนแกน x เพื่อปรับทิศทาง)
  const mirroredX = 1 - centerX;

  return { x: mirroredX, y: centerY };
}