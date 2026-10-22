import React, { useRef, useState } from 'react';
import { Landmark } from '../types/ai';
import {
  CALIBRATED_GRIP_THRESHOLDS,
  LEGACY_GRIP_THRESHOLDS,
  GripThresholds,
  OpennessCalibration,
  computeHandExtension,
  computeHandOpenness,
  normalizeOpenness,
} from '../ai/extractors/gripStateClassifier';
import {
  OpennessCalibrator,
  CalibratorStatus,
  loadStoredCalibration,
  saveStoredCalibration,
  clearStoredCalibration,
} from '../ai/extractors/opennessCalibrator';

/**
 * ตัวช่วยสอบเทียบ openness ที่ทุกเกม Virtual Grip ใช้ร่วมกัน (วางวัตถุ/บอลเสมือน/ลากเส้นทาง/กำ-แบมือ) — สอบเทียบครั้งเดียว
 * ค่าถูกเก็บไว้ข้ามแท็บ (ดู ai/extractors/opennessCalibrator.ts) ให้ openness ครอบคลุม 0-1 เต็มช่วงของผู้เล่นคนนั้น
 *
 * `api` เป็นออบเจ็กต์ที่ reference คงที่ตลอดอายุ component และอ่านค่าผ่าน ref เสมอ — เรียกจากใน rAF loop ที่ผูก closure ไว้ตอน
 * mount ได้โดยไม่เจอปัญหา stale closure (ปัญหาเดียวกับ gamePhaseRef ในแต่ละหน้า) ส่วน `calibration`/`status` เป็น state
 * ไว้ใช้กับ JSX
 */
export interface OpennessCalibrationApi {
  /** openness 0-1 — สอบเทียบแล้วใช้สเกลของผู้เล่น ยังไม่สอบเทียบใช้สูตรคงที่เดิม (ไว้โชว์เฉยๆ ไม่ควรใช้ตัดสินเกม) */
  openness(landmarks: Landmark[]): number;
  /** เกณฑ์กำ/แบที่เข้ากับสเกลที่ openness() ให้อยู่ตอนนี้ — ส่งเข้า classifyGripState */
  thresholds(): GripThresholds;
  isCalibrated(): boolean;
  /** เรียกทุกเฟรมที่ประมวลผล (ส่ง landmarks เป็น null ถ้าไม่พบมือ) — ขับขั้นตอนสอบเทียบเมื่อกำลังสอบเทียบอยู่ */
  feed(nowMs: number, landmarks: Landmark[] | null): void;
  start(): void;
  reset(): void;
}

export function useOpennessCalibration() {
  const calibRef = useRef<OpennessCalibration | null>(loadStoredCalibration());
  const calibratorRef = useRef(new OpennessCalibrator());
  const lastStatusRef = useRef<CalibratorStatus>({ step: 'idle', progress: 0, error: null });
  const [calibration, setCalibration] = useState<OpennessCalibration | null>(calibRef.current);
  const [status, setStatus] = useState<CalibratorStatus>(lastStatusRef.current);

  const apiRef = useRef<OpennessCalibrationApi | null>(null);
  if (!apiRef.current) {
    const pushStatus = (s: CalibratorStatus) => {
      const prev = lastStatusRef.current;
      if (prev.step === s.step && prev.progress === s.progress && prev.error === s.error) return;
      lastStatusRef.current = s;
      setStatus(s);
    };
    apiRef.current = {
      openness(landmarks) {
        const calib = calibRef.current;
        if (!calib) return computeHandOpenness(landmarks);
        const ext = computeHandExtension(landmarks);
        return ext === null ? 0 : normalizeOpenness(ext, calib);
      },
      thresholds() {
        return calibRef.current ? CALIBRATED_GRIP_THRESHOLDS : LEGACY_GRIP_THRESHOLDS;
      },
      isCalibrated() {
        return calibRef.current !== null;
      },
      feed(nowMs, landmarks) {
        const calibrator = calibratorRef.current;
        if (!calibrator.active) return;
        const result = calibrator.feed(nowMs, landmarks ? computeHandExtension(landmarks) : null);
        pushStatus(result.status);
        if (result.finished && result.calibration) {
          calibRef.current = result.calibration;
          saveStoredCalibration(result.calibration);
          setCalibration(result.calibration);
        }
      },
      start() {
        pushStatus(calibratorRef.current.start(performance.now()));
      },
      reset() {
        calibratorRef.current.cancel();
        calibRef.current = null;
        clearStoredCalibration();
        setCalibration(null);
        pushStatus({ step: 'idle', progress: 0, error: null });
      },
    };
  }
  const api = apiRef.current;

  return { api, calibration, status, calibrating: status.step !== 'idle' };
}

export type OpennessCalibrationState = ReturnType<typeof useOpennessCalibration>;

/** ป้ายคำสั่งลอยบนกล้องระหว่างสอบเทียบ — วางไว้ในกรอบกล้อง (div ที่ position: relative) */
export const CalibrationOverlay: React.FC<{ status: CalibratorStatus }> = ({ status }) => {
  if (status.step === 'idle') return null;
  return (
    <div
      style={{
        position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)',
        padding: '8px 22px', borderRadius: '999px', backgroundColor: 'rgba(0,0,0,0.75)',
        border: '2px solid #29b6f6', color: '#fff', fontSize: '20px', fontWeight: 'bold',
        pointerEvents: 'none', textAlign: 'center', whiteSpace: 'nowrap',
      }}
    >
      {status.step === 'open' ? '🖐️ แบมือให้กางนิ้วสุด' : '✊ กำมือให้แน่นที่สุด'}
      <div style={{ fontSize: '12px', fontWeight: 'normal', color: '#aaa' }}>
        {status.progress === 0 ? 'เตรียมท่า…' : `กำลังวัด ${Math.round(status.progress * 100)}%`}
      </div>
    </div>
  );
};

/** การ์ดสอบเทียบสำหรับแผงด้านข้างของทุกเกม — locked = ห้ามเริ่มสอบเทียบตอนนี้ (เช่นกำลังเล่นเกมอยู่) */
export const OpennessCalibrationCard: React.FC<{
  cal: OpennessCalibrationState;
  locked?: boolean;
  cameraReady?: boolean;
}> = ({ cal, locked = false, cameraReady = true }) => {
  const { calibration, status, api } = cal;
  const box: React.CSSProperties = { backgroundColor: '#1e1e1e', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px' };
  const btn = (enabled: boolean, primary: boolean): React.CSSProperties => ({
    padding: primary ? '8px 14px' : '4px 10px',
    backgroundColor: primary ? (enabled ? '#29b6f6' : '#2a2a2a') : 'transparent',
    color: primary ? (enabled ? '#000' : '#666') : '#aaa',
    fontWeight: primary ? 'bold' : 'normal',
    border: primary ? 'none' : '1px solid #444',
    borderRadius: '6px',
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontSize: primary ? '13px' : '11px',
    opacity: enabled ? 1 : 0.6,
  });

  if (status.step !== 'idle') {
    return (
      <div style={box}>
        <div style={{ fontSize: '13px', color: '#29b6f6', fontWeight: 'bold' }}>
          📏 กำลังสอบเทียบ — {status.step === 'open' ? 'แบมือสุด' : 'กำมือแน่น'}
        </div>
        <div style={{ height: '6px', backgroundColor: '#333', borderRadius: '3px', overflow: 'hidden', marginTop: '8px' }}>
          <div style={{ height: '100%', width: `${status.progress * 100}%`, backgroundColor: '#29b6f6' }} />
        </div>
      </div>
    );
  }

  const canStart = cameraReady && !locked;
  if (!calibration) {
    return (
      <div style={box}>
        <div style={{ fontSize: '13px', color: '#ffca28', marginBottom: '8px' }}>
          📏 ต้องสอบเทียบการกำ-แบมือก่อนเล่น 1 ครั้ง (แบมือสุด แล้วกำแน่น อย่างละ ~3.5 วินาที) เพื่อให้เกมวัดตามช่วงการเคลื่อนไหวของมือคุณเอง
          ค่าที่วัดได้จะใช้ร่วมกันทุกเกม
        </div>
        {status.error && <div style={{ fontSize: '12px', color: '#ff7043', marginBottom: '8px' }}>⚠️ {status.error}</div>}
        <button onClick={() => api.start()} disabled={!canStart} style={btn(canStart, true)}>
          📏 เริ่มสอบเทียบ
        </button>
      </div>
    );
  }

  return (
    <div style={{ ...box, display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
      <div style={{ fontSize: '12px', color: '#9ccc65' }}>
        ✅ สอบเทียบแล้ว
        <span style={{ color: '#777' }}>
          {' '}(กำสุด {calibration.closedRef.toFixed(2)} · แบสุด {calibration.openRef.toFixed(2)})
        </span>
      </div>
      <button onClick={() => api.start()} disabled={!canStart} style={btn(canStart, false)}>
        สอบเทียบใหม่
      </button>
      {status.error && <div style={{ fontSize: '11px', color: '#ff7043', flexBasis: '100%' }}>⚠️ {status.error} (ยังใช้ค่าเดิมอยู่)</div>}
    </div>
  );
};
