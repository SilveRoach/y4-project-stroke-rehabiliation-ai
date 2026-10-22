import React, { useEffect, useRef, useState } from 'react';
import { GripState, Landmark } from '../types/ai';
import { HandLandmarkerService } from '../ai/handTracking/handLandmarkerService';
import { OneEuroFilter } from '../ai/filters/oneEuroFilter';
import { drawHandSkeleton, WRIST_INDEX, MIDDLE_MCP_INDEX } from '../ai/render/handSkeletonRenderer';
import { classifyGripState } from '../ai/extractors/gripStateClassifier';
import { useOpennessCalibration, OpennessCalibrationCard, CalibrationOverlay } from './useOpennessCalibration';
import {
  FallingCupGameFSM,
  DEFAULT_FALLING_CUP_CONFIG,
  classifyHandZone,
  FallingCupPauseReason,
  FallingCupSnapshot,
  FallingCupStatus,
} from '../ai/evaluators/fallingCupGameFSM';
import { computeFallingCupGameSummary, FallingCupGameSummary } from '../ai/scoring/fallingCupGameScoreEngine';
import { drawFallingCupGame } from '../ai/render/fallingCupRenderer';

const HAND_DETECT_INTERVAL_MS = 66; // ~15 ครั้ง/วินาที เหตุผลเดียวกับ VirtualGripView.tsx (กัน WASM บล็อก main thread)
const CANVAS_W = 640;
const CANVAS_H = 480;
const BANNER_MS = 900;

type Phase = 'setup' | 'playing' | 'summary';

const PAUSE_MESSAGE: Record<FallingCupPauseReason, string> = {
  'no-hand': '✋ ไม่พบมือ — ยกมือเข้ามาในกรอบกลางจอ เกมจะเล่นต่อให้เอง',
  'too-high': '⬇️ มือสูงเกินไป — ลดมือลงมาอยู่ในกรอบกลางจอ',
  'too-low': '⬆️ มือต่ำเกินไป — ยกมือขึ้นมาอยู่ในกรอบกลางจอ',
};

const SETUP_ZONE_MESSAGE: Record<'ok' | FallingCupPauseReason, string> = {
  ok: '✅ มืออยู่ในโซนกลางจอแล้ว',
  'no-hand': '— ไม่พบมือในกล้อง —',
  'too-high': '⬇️ มือสูงเกินโซน',
  'too-low': '⬆️ มือต่ำเกินโซน',
};

/**
 * เกมของตกลงถ้วย: มีของ (ผลไม้) ทยอยตกลงมาจากด้านบนจอช้าๆ ผู้ป่วยกำมือจับของ เคลื่อนไปเหนือถ้วย แล้วแบมือปล่อยให้ตกลงถ้วย
 * ได้ 1 แต้มต่อชิ้นที่ลงถ้วย จำนวนของตายตัว เล่นจนชิ้นสุดท้ายถูกตัดสินแล้วจบเกม (ดู ai/evaluators/fallingCupGameFSM.ts)
 *
 * กติกาโซนมือ: มือต้องอยู่ในช่วงความสูงกลางจอ ถ้ามือหลุดจอหรือสูง/ต่ำเกิน เกมจะ pause ทั้งหมดแล้วรอจนมือกลับเข้าโซน
 *
 * ก่อนเล่นต้อง "สอบเทียบ" ช่วงการกำ/แบมือก่อน (เหมือนเกมอื่น) เพื่อให้เกณฑ์จับ/ปล่อยเหมาะกับมือของผู้เล่นแต่ละคน
 * ใช้ ref คู่ state สำหรับค่าที่ processFrame (อยู่ใน rAF loop ที่ผูก closure ไว้ตอน mount) ต้องอ่านค่าปัจจุบัน
 */
export const VirtualGripFallingCupView: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handServiceRef = useRef<HandLandmarkerService>(new HandLandmarkerService());
  const fsmRef = useRef<FallingCupGameFSM>(new FallingCupGameFSM());
  const runningRef = useRef(false);
  const animationFrameId = useRef<number | null>(null);
  const lastHandDetectMsRef = useRef(0);
  const lastLandmarksRef = useRef<Landmark[] | null>(null);
  const bannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ตำแหน่งมือ (normalized มิเรอร์แล้ว) ปรับเรียบด้วย One-Euro ในหน่วยพิกเซล canvas แล้วหารกลับ
  const handFilterXRef = useRef(new OneEuroFilter(1.5, 0.3));
  const handFilterYRef = useRef(new OneEuroFilter(1.5, 0.3));
  const handPosRef = useRef<{ x: number; y: number } | null>(null);
  const gripRef = useRef<GripState>('open');

  const phaseRef = useRef<Phase>('setup');
  const targetObjectsRef = useRef(DEFAULT_FALLING_CUP_CONFIG.totalObjects);
  const uiKeyRef = useRef('');

  const [cameraStatus, setCameraStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [statusMsg, setStatusMsg] = useState('กำลังโหลดโมเดลมือ...');
  const [handDetected, setHandDetected] = useState(false);

  const cal = useOpennessCalibration();
  const [phase, setPhase] = useState<Phase>('setup');
  const [targetObjects, setTargetObjects] = useState(DEFAULT_FALLING_CUP_CONFIG.totalObjects);
  const [ui, setUi] = useState<{
    status: FallingCupStatus;
    pauseReason: FallingCupPauseReason | null;
    resumeProgress: number;
    caught: number;
    resolved: number;
    spawned: number;
  }>({ status: 'paused', pauseReason: 'no-hand', resumeProgress: 0, caught: 0, resolved: 0, spawned: 0 });
  const [gripShown, setGripShown] = useState<GripState>('open');
  const [setupZone, setSetupZone] = useState<'ok' | FallingCupPauseReason>('no-hand');
  const [summary, setSummary] = useState<FallingCupGameSummary | null>(null);
  const [banner, setBanner] = useState<{ text: string; good: boolean } | null>(null);

  useEffect(() => {
    runningRef.current = true;
    startCamera();
    return () => {
      runningRef.current = false;
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      }
      handServiceRef.current.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCamera = async () => {
    try {
      await handServiceRef.current.init(1);
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('เบราว์เซอร์นี้ไม่รองรับการเข้าถึงกล้อง Webcam');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: CANVAS_W, height: CANVAS_H, facingMode: 'user' },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current!.play();
          setCameraStatus('ready');
          setStatusMsg('สอบเทียบ (ถ้ายังไม่ได้ทำ) แล้วตั้งจำนวนของ กดเริ่มเกม');
          renderLoop();
        };
      }
    } catch (err: any) {
      setCameraStatus('error');
      setStatusMsg(`❌ เปิดกล้อง/โมเดลไม่สำเร็จ: ${err.message}`);
    }
  };

  const renderLoop = () => {
    if (!runningRef.current) return;
    processFrame();
    animationFrameId.current = requestAnimationFrame(renderLoop);
  };

  const processFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    const now = performance.now();

    // --- มือ (ตรวจทุก ~66 ms ระหว่างนั้นใช้ค่าล่าสุด) ---
    if (now - lastHandDetectMsRef.current >= HAND_DETECT_INTERVAL_MS) {
      lastHandDetectMsRef.current = now;
      const lm = handServiceRef.current.detect(video, now);
      lastLandmarksRef.current = lm;
      cal.api.feed(now, lm); // ขับขั้นตอนสอบเทียบเมื่อกำลังสอบเทียบอยู่
      if (lm) {
        // กึ่งกลางฝ่ามือ (มิดพอยต์ข้อมือ↔โคนนิ้วกลาง) เหมือนเกมอื่น — มิเรอร์ x ให้ตรงกับที่เห็นบนจอ
        const palmX = 1 - (lm[WRIST_INDEX].x + lm[MIDDLE_MCP_INDEX].x) / 2;
        const palmY = (lm[WRIST_INDEX].y + lm[MIDDLE_MCP_INDEX].y) / 2;
        handPosRef.current = {
          x: handFilterXRef.current.filter(palmX * CANVAS_W, now) / CANVAS_W,
          y: handFilterYRef.current.filter(palmY * CANVAS_H, now) / CANVAS_H,
        };
        gripRef.current = classifyGripState(cal.api.openness(lm), gripRef.current, cal.api.thresholds());
        setGripShown(gripRef.current);
        setHandDetected(true);
      } else {
        // ไม่พบมือ: เก็บท่ากำ/แบล่าสุดไว้ (FSM ยอมให้หลุดสั้นๆ ได้ — ถ้าส่ง 'open' ของที่ถืออยู่จะหลุดมือทันที)
        handPosRef.current = null;
        handFilterXRef.current.reset();
        handFilterYRef.current.reset();
        setHandDetected(false);
      }
    }
    const landmarks = lastLandmarksRef.current;
    if (landmarks) drawHandSkeleton(ctx, landmarks, canvas.width, canvas.height);

    const fsm = fsmRef.current;
    const cfg = fsm.config;

    if (phaseRef.current === 'playing') {
      const results = fsm.update({ timestampMs: now, handPos: handPosRef.current, gripState: gripRef.current });
      const snap = fsm.snapshot();
      for (const r of results) {
        showBanner(r.caught ? '+1 แต้ม!' : 'พลาด — ไม่ลงถ้วย', r.caught);
      }
      drawFallingCupGame(ctx, snap, canvas.width, canvas.height, {
        bandWarning: snap.status === 'paused',
        dimOutsideBand: snap.status === 'paused',
      });
      syncUi(snap);
      if (snap.status === 'finished') finishGame(false);
    } else {
      // setup / summary: วาดถ้วย+โซนมือให้ผู้เล่นซ้อมวางมือ ไม่มีของ
      const zone = classifyHandZone(handPosRef.current, cfg);
      drawFallingCupGame(ctx, fsm.snapshot(), canvas.width, canvas.height, {
        bandWarning: zone !== 'ok',
        hideObjects: true,
      });
      if (phaseRef.current === 'setup') setSetupZone((prev) => (prev === zone ? prev : zone));
    }
  };

  /** อัปเดต state ของ UI เฉพาะเมื่อค่าที่แสดงเปลี่ยนจริง (processFrame ทำงานทุกเฟรม กัน re-render รัว) */
  const syncUi = (snap: FallingCupSnapshot) => {
    const key = `${snap.status}|${snap.pauseReason}|${Math.round(snap.resumeProgress * 10)}|${snap.caught}|${snap.resolved}|${snap.spawned}`;
    if (key === uiKeyRef.current) return;
    uiKeyRef.current = key;
    setUi({
      status: snap.status,
      pauseReason: snap.pauseReason,
      resumeProgress: Math.round(snap.resumeProgress * 10) / 10,
      caught: snap.caught,
      resolved: snap.resolved,
      spawned: snap.spawned,
    });
  };

  const showBanner = (text: string, good: boolean) => {
    if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
    setBanner({ text, good });
    bannerTimeoutRef.current = setTimeout(() => setBanner(null), BANNER_MS);
  };

  const finishGame = (stoppedEarly: boolean) => {
    if (phaseRef.current !== 'playing') return;
    const fsm = fsmRef.current;
    setSummary(computeFallingCupGameSummary(fsm.getResults(), targetObjectsRef.current, fsm.getStats(), stoppedEarly));
    phaseRef.current = 'summary';
    setPhase('summary');
  };

  const handleStartGame = () => {
    if (!cal.api.isCalibrated()) return;
    fsmRef.current = new FallingCupGameFSM({ totalObjects: targetObjects });
    targetObjectsRef.current = targetObjects;
    uiKeyRef.current = '';
    gripRef.current = 'open';
    setSummary(null);
    setBanner(null);
    setUi({ status: 'paused', pauseReason: 'no-hand', resumeProgress: 0, caught: 0, resolved: 0, spawned: 0 });
    phaseRef.current = 'playing';
    setPhase('playing');
  };

  /** หยุดเกมกลางคัน — ชิ้นที่ยังไม่ถูกตัดสินไม่ได้คะแนน แต่ยังสรุปผลให้ดูได้ */
  const handleStopGame = () => finishGame(true);

  const handlePlayAgain = () => {
    setSummary(null);
    fsmRef.current = new FallingCupGameFSM({ totalObjects: targetObjects });
    phaseRef.current = 'setup';
    setPhase('setup');
  };

  const cfg = DEFAULT_FALLING_CUP_CONFIG;
  const cardStyle: React.CSSProperties = { backgroundColor: '#1e1e1e', borderRadius: '8px', padding: '16px', marginBottom: '16px' };
  const primaryBtn = (enabled: boolean, color: string): React.CSSProperties => ({
    padding: '10px 16px',
    backgroundColor: enabled ? color : '#2a2a2a',
    color: enabled ? '#000' : '#666',
    fontWeight: 'bold',
    border: 'none',
    borderRadius: '6px',
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontSize: '14px',
    width: '100%',
  });
  const ghostBtn: React.CSSProperties = {
    padding: '6px 12px',
    backgroundColor: 'transparent',
    color: '#aaa',
    border: '1px solid #444',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
  };

  const calibration = cal.calibration;
  const canStart = cameraStatus === 'ready' && !!calibration && !cal.calibrating;
  const paused = phase === 'playing' && ui.status === 'paused';

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <h2 style={{ color: '#ff7043' }}>🥤 Virtual Grip — เกมของตกลงถ้วย</h2>
      <p style={{ color: '#aaa', fontSize: '14px' }}>
        มีของตกลงมาจากด้านบนจอช้าๆ กำมือจับของ เคลื่อนไปเหนือถ้วย แล้วแบมือปล่อยให้ตกลงถ้วย ได้ 1 แต้มต่อชิ้นที่ลงถ้วย
        ให้มืออยู่ในกรอบกลางจอ ถ้ามือหลุดจอหรือสูง/ต่ำเกินไป เกมจะหยุดรอจนมือกลับเข้ากรอบ ก่อนเล่นต้องสอบเทียบช่วงการกำ-แบมือก่อน 1 ครั้ง
      </p>

      <div className="camera-test-row" style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
        <div className="camera-frame" style={{ position: 'relative', width: '640px', maxWidth: '100%' }}>
          <video ref={videoRef} style={{ display: 'none' }} playsInline muted />
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={{ width: '100%', borderRadius: '8px', backgroundColor: '#000', border: '1px solid #333' }}
          />

          <CalibrationOverlay status={cal.status} />

          {phase === 'playing' && (
            <>
              <div
                style={{
                  position: 'absolute', top: '16px', left: '16px', padding: '4px 12px', borderRadius: '999px',
                  backgroundColor: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: '13px', fontWeight: 'bold', pointerEvents: 'none',
                }}
              >
                🍎 ของที่ออกมา {ui.spawned}/{targetObjects}
              </div>
              <div
                style={{
                  position: 'absolute', top: '16px', right: '16px', padding: '4px 12px', borderRadius: '999px',
                  backgroundColor: 'rgba(0,0,0,0.65)', color: '#00e676', fontSize: '13px', fontWeight: 'bold', pointerEvents: 'none',
                }}
              >
                🏆 ลงถ้วย {ui.caught}/{targetObjects}
              </div>

              {paused && ui.pauseReason && (
                <div
                  style={{
                    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                    width: '78%', padding: '14px 20px', borderRadius: '12px', backgroundColor: 'rgba(0,0,0,0.82)',
                    border: '2px solid #ffca28', color: '#ffca28', textAlign: 'center', pointerEvents: 'none',
                  }}
                >
                  <div style={{ fontSize: '12px', letterSpacing: '1px', marginBottom: '4px', color: '#bbb' }}>⏸ เกมหยุดอยู่</div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '10px' }}>{PAUSE_MESSAGE[ui.pauseReason]}</div>
                  <div style={{ height: '6px', backgroundColor: '#333', borderRadius: '3px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%', width: `${ui.resumeProgress * 100}%`, backgroundColor: '#00e676',
                        transition: 'width 0.1s linear',
                      }}
                    />
                  </div>
                </div>
              )}

              {banner && (
                <div
                  style={{
                    position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
                    padding: '8px 20px', borderRadius: '999px', backgroundColor: 'rgba(0,0,0,0.75)',
                    border: `2px solid ${banner.good ? '#00e676' : '#ff7043'}`, color: banner.good ? '#00e676' : '#ff7043',
                    fontSize: '20px', fontWeight: 'bold', pointerEvents: 'none', whiteSpace: 'nowrap',
                  }}
                >
                  {banner.text}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ flex: 1, minWidth: '240px' }}>
          <OpennessCalibrationCard cal={cal} locked={phase === 'playing'} cameraReady={cameraStatus === 'ready'} />
          <div style={cardStyle}>
            <div style={{ color: '#aaa', fontSize: '13px', marginBottom: '8px' }}>{statusMsg}</div>
            {cameraStatus === 'ready' && (
              <div style={{ fontSize: '12px', color: '#888' }}>
                {handDetected ? `ท่ามือตอนนี้: ${gripShown === 'closed' ? '✊ กำ' : '🖐️ แบ'}` : '— ไม่พบมือในกล้อง —'}
                {!calibration && ' · ยังไม่สอบเทียบ'}
              </div>
            )}
          </div>

          <div style={{ ...cardStyle, marginBottom: 0 }}>
            {phase === 'setup' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                  <label style={{ fontSize: '13px', color: '#ccc', minWidth: '90px' }}>จำนวนของ:</label>
                  <input
                    type="number" min={3} max={30} value={targetObjects}
                    onChange={(e) => setTargetObjects(Math.max(3, Math.min(30, Number(e.target.value) || 3)))}
                    style={{ width: '60px', padding: '6px 8px', backgroundColor: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: '6px', fontSize: '13px' }}
                  />
                  <span style={{ fontSize: '11px', color: '#777' }}>ปล่อยทีละชิ้น ทุก ~{cfg.spawnIntervalSec} วินาที</span>
                </div>
                <div style={{ fontSize: '12px', marginBottom: '14px', color: setupZone === 'ok' ? '#00e676' : '#ffca28' }}>
                  {SETUP_ZONE_MESSAGE[setupZone]}
                  {setupZone !== 'ok' && ' — ซ้อมวางมือให้อยู่ในกรอบกลางจอ'}
                </div>
                <button onClick={handleStartGame} disabled={!canStart} style={primaryBtn(canStart, '#00e676')}>
                  ▶️ เริ่มเกม
                </button>
                {!calibration && (
                  <div style={{ marginTop: '8px', fontSize: '12px', color: '#ffca28' }}>ต้องสอบเทียบด้านบนก่อนถึงจะเริ่มเกมได้</div>
                )}
              </>
            )}

            {phase === 'playing' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#00e676' }}>
                    ลงถ้วยแล้ว {ui.caught}/{targetObjects} ชิ้น
                  </div>
                  <button onClick={handleStopGame} style={{ ...ghostBtn, color: '#ff7043', borderColor: '#ff7043' }}>
                    ⏹ หยุดเกม
                  </button>
                </div>
                <div style={{ fontSize: '13px', color: paused ? '#ffca28' : '#aaa', marginBottom: '6px' }}>
                  {paused ? '⏸ เกมหยุดอยู่ — ดูข้อความบนจอ' : '✊ กำมือจับของ → เลื่อนไปเหนือถ้วย → 🖐️ แบมือปล่อย'}
                </div>
                <div style={{ fontSize: '12px', color: '#888' }}>
                  ตัดสินแล้ว {ui.resolved}/{targetObjects} ชิ้น · ยังไม่ออกมาอีก {targetObjects - ui.spawned} ชิ้น
                </div>
              </>
            )}

            {phase === 'summary' && summary && (
              <>
                <div style={{ fontSize: '13px', color: '#aaa', marginBottom: '8px' }}>
                  {summary.stoppedEarly ? '⏹ หยุดเกมแล้ว' : '🏁 จบเกม!'}
                </div>
                <div style={{ textAlign: 'center', marginBottom: '14px' }}>
                  <div
                    style={{
                      fontSize: '40px', fontWeight: 'bold',
                      color: summary.gameScore >= 80 ? '#00e676' : summary.gameScore >= 50 ? '#ffca28' : '#ff7043',
                    }}
                  >
                    {summary.caught}/{summary.totalObjects}
                  </div>
                  <div style={{ fontSize: '12px', color: '#888' }}>ชิ้นที่ลงถ้วย · คิดเป็น {summary.gameScore}%</div>
                </div>
                <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '10px' }}>{summary.feedbackText}</div>
                <div style={{ fontSize: '12px', color: '#888', marginBottom: '12px', lineHeight: 1.6 }}>
                  {summary.avgSecondsToCup !== null && <>เวลาเฉลี่ยจากของปรากฏจนลงถ้วย {summary.avgSecondsToCup} วินาที<br /></>}
                  ปล่อยแล้วไม่ลงถ้วย {summary.missed} ชิ้น
                  {summary.unplayed > 0 && <> · ไม่ทันเล่น {summary.unplayed} ชิ้น</>}
                  <br />
                  เกมถูกหยุดเพราะมือหลุดโซน {summary.pauseCount} ครั้ง (รวม {summary.pausedSeconds} วินาที)
                </div>
                <button onClick={handlePlayAgain} style={primaryBtn(true, '#29b6f6')}>🔁 เล่นอีกครั้ง</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
