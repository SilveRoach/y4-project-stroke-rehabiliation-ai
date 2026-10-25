/**
 * ฟังก์ชันช่วยเหลือสำหรับการประมวลผลข้อมูลมือ (hand tracking helpers)
 * รับค่า landmark จาก MediaPipe hand model และคำนวณต่างๆ ที่ใช้ในเกมและการติดตาม
 */

import type { Landmark } from '../../types/ai';
import { computeHandOpenness } from '../handDetection';
import {
  classifyGripState,
  computeHandExtension,
  normalizeOpenness,
  CALIBRATED_GRIP_THRESHOLDS,
  LEGACY_GRIP_THRESHOLDS
} from '../extractors/gripStateClassifier';
import { loadStoredCalibration } from '../extractors/opennessCalibrator';

/**
 * แปลง normalized palm center มาเป็น pixel coordinates บน canvas
 * @param palm - object หรือ landmark ของจุดกึ่งกลางฝ่ามือ
 * @param canvasWidth - ความกว้างของ canvas
 * @param canvasHeight - ความสูงของ canvas
 * @returns object ที่มี x, y เป็นพิกเซล coordinates หรือ null หากไม่พบ
 */
export function palmCenterToCanvasPixels(
  palm: { x: number; y: number } | Landmark | Landmark[] | null | undefined,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } | null {
  if (!palm) return null;
  const landmark = Array.isArray(palm) ? palm[0] : palm;
  if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return null;
  const x = landmark.x * canvasWidth;
  const y = landmark.y * canvasHeight;
  return { x, y };
}

/**
 * คำนวณ center ของ palm แล้ว mirror (สะท้อน) ตามแกนแกว่ง
 * ใช้สำหรับการปรับปรุงทิศทางของการจับให้สอดคล้องกับมุมมองเซลฟี่
 * @param landmarks - array of 21 hand landmarks from MediaPipe
 * @returns normalized palm center {x, y} ที่ถูก mirror และ normalize แล้ว หรือ null หากไม่พบมือ
 */
export function computeMirroredPalmCenterNormalized(
  landmarks: Landmark[] | null | undefined
): { x: number; y: number } | null {
  if (!landmarks || landmarks.length < 21) return null;

  // จุดศูนย์กลางของ palm คือ กึ่งกลางระหว่างข้อมือ (wrist, landmark 0) และโคนนิ้วกลาง (middle MCP, landmark 9)
  const wrist = landmarks[0];
  const midPalm = landmarks[9];
  if (!wrist || !midPalm) return null;

  const centerX = (wrist.x + midPalm.x) / 2;
  const centerY = (wrist.y + midPalm.y) / 2;

  // mirror x coordinate (สะท้อนแกน x เพื่อปรับทิศทาง)
  const mirroredX = 1 - centerX;

  return { x: mirroredX, y: centerY };
}

/**
 * จัดประเภทการจับ (grip) จาก hand landmark
 * ประเมิน openness (ความกางของ 4 นิ้วเทียบกับขนาดฝ่ามือ) ร่วมกับ hysteresis กันกระพริบ
 * รองรับทั้งกรณีสอบเทียบแล้ว (calibrated) และค่าเริ่มต้น (legacy)
 * @param landmarks - array of 21 hand landmarks from MediaPipe
 * @param previousGrip - สถานะก่อนหน้า ('open' | 'closed') เพื่อคงสถานะเดิมในโซน hysteresis
 * @returns 'closed' หากกำมือ หรือ 'open' หากแบมือ
 */
export function classifyGripFromLandmarks(
  landmarks: Landmark[] | null | undefined,
  previousGrip: 'open' | 'closed' | null = null
): 'closed' | 'open' {
  if (!landmarks || landmarks.length < 21) {
    return previousGrip ?? 'open';
  }

  const calib = loadStoredCalibration();
  let openness: number;
  let thresholds = LEGACY_GRIP_THRESHOLDS;
  if (calib) {
    const ext = computeHandExtension(landmarks);
    openness = ext !== null ? normalizeOpenness(ext, calib) : 0;
    thresholds = CALIBRATED_GRIP_THRESHOLDS;
  } else {
    openness = computeHandOpenness(landmarks);
  }

  return classifyGripState(openness, previousGrip, thresholds);
}
