import React, { useEffect, useRef, useState } from 'react';
import {
  DetectedObject,
  GamePath,
  GripState,
  ItemTrackingState,
  Landmark,
  PathGameConfig,
  PathGamePhase,
  PathGameSnapshot,
  PathGameSummary,
  PathRoundResult,
  PathType,
  PathWidthLevel,
  TrackedItem,
} from '../types/ai';
import { HandLandmarkerService } from '../ai/handTracking/handLandmarkerService';
import { ObjectDetectorService } from '../ai/objectDetection/objectDetectorService';
import { ItemTracker, LOST_THRESHOLD_FRAMES } from '../ai/objectDetection/itemTracker';
import { OneEuroFilter } from '../ai/filters/oneEuroFilter';
import { drawHandSkeleton, WRIST_INDEX, MIDDLE_MCP_INDEX } from '../ai/render/handSkeletonRenderer';
import { classifyGripState } from '../ai/extractors/gripStateClassifier';
import { useOpennessCalibration, OpennessCalibrationCard, CalibrationOverlay } from './useOpennessCalibration';
import { PathDragFSM } from '../ai/evaluators/pathDragFSM';
import { computePathGameSummary } from '../ai/scoring/pathGameScoreEngine';
import { drawPathCorridor, drawPathGame } from '../ai/render/pathGameRenderer';
import {
  generatePath,
  PATH_HALF_WIDTH_PX,
  PATH_TYPE_LABEL_TH,
  PATH_WIDTH_LABEL_TH,
  SEGMENT_KIND_LABEL_TH,
} from '../ai/pathGame/pathGenerator';

// เหตุผลเดียวกับ VirtualGripView.tsx — WASM inference บล็อก main thread จึงไม่เรียกทุกเฟรมของ requestAnimationFrame
const HAND_DETECT_INTERVAL_MS = 66; // ~15 ครั้ง/วินาที
const OBJECT_DETECT_INTERVAL_MS = 200; // ~5 ครั้ง/วินาที

/** ระยะสูงสุด (สัดส่วนเส้นทแยงมุมเฟรม) ระหว่างจุดกึ่งกลางฝ่ามือกับจุดศูนย์กลางวัตถุก่อนถือว่า "หยิบติดแล้ว" — ค่าเดียวกับ
 *  VirtualGripView.tsx (heuristic ยังไม่ได้ calibrate) */
const ATTACH_DISTANCE_RATIO = 0.15;
/** ระยะที่ยังถือว่ามือเอื้อมถึงตอนเลือกวัตถุ — ค่าเดียวกับ VirtualGripView.tsx */
const SELECTION_REACH_RATIO = 0.35;

/** ค่าเริ่มต้นของเกม (ตามที่ผู้ใช้กำหนด: ~30 วินาทีต่อรอบ, 5 รอบ, ทางความกว้างกลาง) */
const DEFAULT_ROUND_TIME_SEC = 30;
const DEFAULT_TOTAL_ROUNDS = 5;

/** ความถี่อัปเดต state ของแผงข้อมูลข้าง canvas ระหว่างเล่น (ms) — ไม่ setState ทุกเฟรมเพื่อไม่ให้ React render ถี่เกินจำเป็น */
const PANEL_REFRESH_MS = 120;

const PATH_TYPES: PathType[] = ['straight', 'curve', 'zigzag', 'mixed'];
const PATH_TYPE_ICON: Record<PathType, string> = { straight: '➖', curve: '〰️', zigzag: '⚡', mixed: '🔀' };
const WIDTH_LEVELS: PathWidthLevel[] = ['wide', 'medium', 'narrow'];

type ItemPhase = ItemTrackingState | 'attached';
type GamePhase = 'setup' | 'playing' | 'summary';
type Rect = { x: number; y: number; width: number; height: number };

function filterCandidatesByHandReach(
  candidates: DetectedObject[],
  handPixel: { x: number; y: number } | null,
  video: HTMLVideoElement
): DetectedObject[] {
  if (!handPixel) return candidates;
  const diagonal = Math.sqrt(video.videoWidth ** 2 + video.videoHeight ** 2) || 1;
  return candidates.filter((c) => {
    const centerX = c.boundingBox.originX + c.boundingBox.width / 2;
    const centerY = c.boundingBox.originY + c.boundingBox.height / 2;
    return Math.hypot(centerX - handPixel.x, centerY - handPixel.y) / diagonal <= SELECTION_REACH_RATIO;
  });
}

/** แปลงกล่อง/จุดจากพิกเซลจริงของเฟรมวิดีโอ → พิกเซล canvas แล้วกลับด้านซ้าย-ขวาให้ตรงกับภาพที่ mirror ไว้ (เหมือน VirtualGripView) */
function toMirroredCanvasRect(
  box: { originX: number; originY: number; width: number; height: number },
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): Rect {
  const scaleX = canvas.width / (video.videoWidth || canvas.width);
  const scaleY = canvas.height / (video.videoHeight || canvas.height);
  const x = box.originX * scaleX;
  const y = box.originY * scaleY;
  const width = box.width * scaleX;
  const height = box.height * scaleY;
  return { x: canvas.width - (x + width), y, width, height };
}

function toMirroredCanvasPoint(
  px: number,
  py: number,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): { x: number; y: number } {
  const scaleX = canvas.width / (video.videoWidth || canvas.width);
  const scaleY = canvas.height / (video.videoHeight || canvas.height);
  return { x: canvas.width - px * scaleX, y: py * scaleY };
}

function scoreColor(score: number): string {
  return score >= 80 ? '#00e676' : score >= 60 ? '#ffca28' : '#ff7043';
}

const panelStyle: React.CSSProperties = {
  backgroundColor: '#1e1e1e',
  borderRadius: '8px',
  padding: '16px',
  marginBottom: '16px',
};

const inputStyle: React.CSSProperties = {
  width: '70px',
  padding: '6px 8px',
  backgroundColor: '#2a2a2a',
  color: '#fff',
  border: '1px solid #444',
  borderRadius: '6px',
  fontSize: '13px',
};

const choiceButtonStyle = (active: boolean, color: string): React.CSSProperties => ({
  flex: 1,
  padding: '8px 6px',
  backgroundColor: active ? color : '#2a2a2a',
  color: active ? '#000' : '#fff',
  fontWeight: 'bold',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '12px',
});

/**
 * เกม "ลากวัตถุจริงตามเส้นทาง" (Virtual Grip: Path Drag) — ผู้ป่วยถือวัตถุจริง (ตรวจจับด้วย object detection + หยิบติดด้วย
 * ท่ากำมือ ใช้ตรรกะ attach/release ชุดเดียวกับ VirtualGripView.tsx) แล้วลากไปตามเส้นทางที่วาดทับภาพกล้อง
 *
 * 4 แบบเส้นทาง: ตรง / โค้ง / ซิกแซ็ก / ผสม (แต่ละรอบสุ่มแบบใดแบบหนึ่งใน 3 แบบ สลับกันไปครบทุกแบบ) เปลี่ยนเส้นทางใหม่ทุกรอบ เลือกความกว้างทางได้ 3 ระดับ
 * ปรับเวลาต่อรอบ (ค่าเริ่มต้น 30 วินาที) และจำนวนรอบ (ค่าเริ่มต้น 5) ได้ที่หน้าตั้งค่า
 *
 * ให้คะแนน 2 ตัวแยกกัน (ไม่รวม): ทำสำเร็จกี่รอบจากทั้งหมดกี่รอบ (ลากถึงปลายทางทันเวลา) กับคะแนนความแม่นยำของมือ (อยู่ในทางแค่ไหน) —
 * ดูสูตรใน ai/scoring/pathGameScoreEngine.ts ออกนอกทางไม่ตัดสิทธิ์ แค่ลดความแม่นยำ ตำแหน่งที่ใช้เทียบเส้นคือจุดกึ่งกลางฝ่ามือ
 * (ขณะหยิบติด ตำแหน่งวัตถุ = ตำแหน่งมือ เพราะวัตถุถูกกำมือบังจนตรวจจับไม่เจอ ดูคอมเมนต์ใน VirtualGripView.tsx)
 *
 * gamePhase 3 สถานะ ('setup'/'playing'/'summary') มี ref คู่กัน (gamePhaseRef) เพราะ processFrame ถูกเรียกจาก rAF loop ที่
 * capture ไว้ตอน mount — อ่าน state ตรงๆ จะเห็นแต่ค่าตอน mount (stale closure เดียวกับที่ VirtualGripView.tsx แก้ไว้)
 */
export const VirtualGripPathView: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cal = useOpennessCalibration();
  const handServiceRef = useRef<HandLandmarkerService>(new HandLandmarkerService());
  const objectServiceRef = useRef<ObjectDetectorService>(new ObjectDetectorService());
  const trackerRef = useRef<ItemTracker>(new ItemTracker());
  const runningRef = useRef(false);
  const animationFrameId = useRef<number | null>(null);
  const previousGripStateRef = useRef<GripState | null>(null);

  const lastHandDetectMsRef = useRef(0);
  const lastLandmarksRef = useRef<Landmark[] | null>(null);
  const handPixelPosRef = useRef<{ x: number; y: number } | null>(null);
  // ตำแหน่งมือพิกเซล canvas (มิเรอร์แล้ว) หลังกรองด้วย One-Euro — อัปเดตเฉพาะตอน detect มือได้ผลใหม่
  const handCanvasPointRef = useRef<{ x: number; y: number } | null>(null);
  const handFilterXRef = useRef(new OneEuroFilter(1.5, 0.3));
  const handFilterYRef = useRef(new OneEuroFilter(1.5, 0.3));

  const lastObjectDetectMsRef = useRef(0);
  const lastCandidatesRef = useRef<DetectedObject[]>([]);
  const lastTrackedItemRef = useRef<TrackedItem | null>(null);
  const itemStateRef = useRef<ItemTrackingState>('selecting');
  const attachedRef = useRef(false);

  // --- เกม ---
  const fsmRef = useRef<PathDragFSM | null>(null);
  const gamePhaseRef = useRef<GamePhase>('setup');
  const gameRoundsRef = useRef<PathRoundResult[]>([]);
  const configRef = useRef<PathGameConfig>({
    pathType: 'straight',
    widthLevel: 'medium',
    roundTimeSec: DEFAULT_ROUND_TIME_SEC,
    totalRounds: DEFAULT_TOTAL_ROUNDS,
  });
  const previewPathRef = useRef<GamePath | null>(null);
  const lastPanelRefreshMsRef = useRef(0);

  const [cameraStatus, setCameraStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [statusMsg, setStatusMsg] = useState('กำลังโหลดโมเดล (มือ + ตรวจจับวัตถุ)...');
  const [gripState, setGripState] = useState<GripState | null>(null);
  const [handDetected, setHandDetected] = useState(false);

  const [itemTrackingState, setItemTrackingState] = useState<ItemTrackingState>('selecting');
  const [attached, setAttached] = useState(false);
  const [candidates, setCandidates] = useState<DetectedObject[]>([]);
  const [trackedItem, setTrackedItem] = useState<TrackedItem | null>(null);

  const [gamePhase, setGamePhase] = useState<GamePhase>('setup');
  const [pathType, setPathType] = useState<PathType>('straight');
  const [widthLevel, setWidthLevel] = useState<PathWidthLevel>('medium');
  const [roundTimeSec, setRoundTimeSec] = useState(DEFAULT_ROUND_TIME_SEC);
  const [totalRounds, setTotalRounds] = useState(DEFAULT_TOTAL_ROUNDS);
  const [gameSnapshot, setGameSnapshot] = useState<PathGameSnapshot | null>(null);
  const [gameRounds, setGameRounds] = useState<PathRoundResult[]>([]);
  const [gameSummary, setGameSummary] = useState<PathGameSummary | null>(null);

  const itemPhase: ItemPhase = attached ? 'attached' : itemTrackingState;
  const itemReady = itemPhase === 'tracking' || itemPhase === 'attached';
  const gameReady = itemReady && !!cal.calibration && !cal.calibrating;

  // ตัวอย่างเส้นทางในหน้าตั้งค่า (สุ่มใหม่เมื่อเปลี่ยนแบบ/ความกว้าง)
  useEffect(() => {
    previewPathRef.current = generatePath(pathType, widthLevel, 1);
  }, [pathType, widthLevel]);

  useEffect(() => {
    runningRef.current = true;
    startCamera();
    return () => {
      runningRef.current = false;
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      }
      handServiceRef.current.dispose();
      objectServiceRef.current.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCamera = async () => {
    try {
      await Promise.all([handServiceRef.current.init(1), objectServiceRef.current.init(5, 0.25)]);

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('เบราว์เซอร์นี้ไม่รองรับการเข้าถึงกล้อง Webcam');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current!.play();
          setCameraStatus('ready');
          setStatusMsg('ถือของที่จะใช้เล่นให้เห็นในกล้อง แล้วเลือกวัตถุจากรายการด้านล่างก่อนเริ่มเกม');
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

  /** รับผลรอบที่เพิ่งจบ (ถึงปลายทาง/หมดเวลา/ข้าม) — เก็บเข้าลิสต์ และถ้าเป็นรอบสุดท้ายให้สรุปเกม */
  const handleRoundResult = (result: PathRoundResult) => {
    const updated = [...gameRoundsRef.current, result];
    gameRoundsRef.current = updated;
    setGameRounds(updated);
    const fsm = fsmRef.current;
    if (fsm && fsm.snapshot().phase === 'gameOver') {
      setGameSummary(computePathGameSummary(updated, configRef.current.totalRounds));
      gamePhaseRef.current = 'summary';
      setGamePhase('summary');
      setGameSnapshot(fsm.snapshot());
    }
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

    // --- มือ ---
    let handPixel: { x: number; y: number } | null = null;
    if (now - lastHandDetectMsRef.current >= HAND_DETECT_INTERVAL_MS) {
      lastHandDetectMsRef.current = now;
      lastLandmarksRef.current = handServiceRef.current.detect(video, now);
      const lm = lastLandmarksRef.current;
      cal.api.feed(now, lm); // ขับขั้นตอนสอบเทียบเมื่อกำลังสอบเทียบอยู่
      if (lm) {
        const state = classifyGripState(cal.api.openness(lm), previousGripStateRef.current, cal.api.thresholds());
        previousGripStateRef.current = state;
        setHandDetected(true);
        setGripState(state);
        // จุดอ้างอิงมือ = กึ่งกลางฝ่ามือ (มิดพอยต์ข้อมือ↔โคนนิ้วกลาง) เหมือน VirtualGripView.tsx
        const palmX = (lm[WRIST_INDEX].x + lm[MIDDLE_MCP_INDEX].x) / 2;
        const palmY = (lm[WRIST_INDEX].y + lm[MIDDLE_MCP_INDEX].y) / 2;
        const raw = toMirroredCanvasPoint(palmX * video.videoWidth, palmY * video.videoHeight, video, canvas);
        handCanvasPointRef.current = {
          x: handFilterXRef.current.filter(raw.x, now),
          y: handFilterYRef.current.filter(raw.y, now),
        };
      } else {
        setHandDetected(false);
        handCanvasPointRef.current = null;
        handFilterXRef.current.reset();
        handFilterYRef.current.reset();
      }
    }
    const landmarks = lastLandmarksRef.current;

    if (landmarks) {
      drawHandSkeleton(ctx, landmarks, canvas.width, canvas.height);
      const wrist = landmarks[WRIST_INDEX];
      const middleMcp = landmarks[MIDDLE_MCP_INDEX];
      handPixel = {
        x: ((wrist.x + middleMcp.x) / 2) * video.videoWidth,
        y: ((wrist.y + middleMcp.y) / 2) * video.videoHeight,
      };
      handPixelPosRef.current = handPixel;
      updateItemTracking(video, now, previousGripStateRef.current, handPixel);
    } else {
      handPixelPosRef.current = null;
      updateItemTracking(video, now, null, null);
    }

    // --- เส้นทาง/เกม ---
    const fsm = fsmRef.current;
    if (gamePhaseRef.current === 'playing' && fsm) {
      const result = fsm.update({
        timestampMs: now,
        handPoint: handCanvasPointRef.current,
        attached: attachedRef.current,
      });
      if (result) handleRoundResult(result);
      const snapshot = fsm.snapshot();
      drawPathGame(ctx, snapshot, { gripPoint: handCanvasPointRef.current, nowMs: now });
      if (now - lastPanelRefreshMsRef.current >= PANEL_REFRESH_MS) {
        lastPanelRefreshMsRef.current = now;
        setGameSnapshot(snapshot);
      }
    } else if (gamePhaseRef.current === 'setup' && previewPathRef.current) {
      drawPathCorridor(ctx, previewPathRef.current, 0.75);
    }

    // --- วาด marker ของวัตถุที่กำลังติดตาม/เลือก ---
    if (itemStateRef.current === 'selecting') {
      drawCandidateBoxes(ctx, lastCandidatesRef.current, video, canvas);
    } else if (attachedRef.current && handPixelPosRef.current) {
      const p = toMirroredCanvasPoint(handPixelPosRef.current.x, handPixelPosRef.current.y, video, canvas);
      drawAttachedMarker(ctx, p, lastTrackedItemRef.current?.label ?? '');
    } else if (lastTrackedItemRef.current) {
      drawTrackedMarker(ctx, lastTrackedItemRef.current, itemStateRef.current === 'lost', video, canvas);
    }
  };

  /** object detection แบบ throttle + ItemTracker + ตรรกะ attach/release — ชุดเดียวกับ VirtualGripView.tsx (ไม่มี FSM ของเกมเก่า) */
  const updateItemTracking = (
    video: HTMLVideoElement,
    now: number,
    handState: GripState | null,
    handPixel: { x: number; y: number } | null
  ) => {
    if (itemStateRef.current === 'selecting') {
      if (now - lastObjectDetectMsRef.current >= OBJECT_DETECT_INTERVAL_MS && objectServiceRef.current.isReady) {
        lastObjectDetectMsRef.current = now;
        const detections = objectServiceRef.current.detect(video, now);
        const filtered = filterCandidatesByHandReach(detections, handPixel, video);
        lastCandidatesRef.current = filtered;
        setCandidates(filtered);
      }
      return;
    }

    // ติดอยู่กับมือแล้ว — เช็คแค่ว่าจะปล่อยหรือยัง ไม่เรียก object detection (วัตถุถูกกำมือบัง)
    if (attachedRef.current) {
      if (handState !== 'closed') {
        attachedRef.current = false;
        setAttached(false);
        if (handPixel) trackerRef.current.reanchor(handPixel, now);
      }
      return;
    }

    if (now - lastObjectDetectMsRef.current >= OBJECT_DETECT_INTERVAL_MS && objectServiceRef.current.isReady) {
      lastObjectDetectMsRef.current = now;
      const detections = objectServiceRef.current.detect(video, now);
      const updated = trackerRef.current.update(detections, video.videoWidth, video.videoHeight, now);
      lastTrackedItemRef.current = updated;

      const nextState = trackerRef.current.state;
      if (nextState !== itemStateRef.current) {
        itemStateRef.current = nextState;
        setItemTrackingState(nextState);
      }
      setTrackedItem(updated);

      if (updated && handPixel && handState === 'closed' && nextState === 'tracking') {
        const diagonal = Math.sqrt(video.videoWidth ** 2 + video.videoHeight ** 2) || 1;
        const distance = Math.hypot(updated.centroid.x - handPixel.x, updated.centroid.y - handPixel.y) / diagonal;
        if (distance <= ATTACH_DISTANCE_RATIO) {
          attachedRef.current = true;
          setAttached(true);
        }
      }
    }
  };

  const drawCandidateBoxes = (
    ctx: CanvasRenderingContext2D,
    objects: DetectedObject[],
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement
  ) => {
    ctx.save();
    ctx.strokeStyle = '#ff7043';
    ctx.fillStyle = '#ff7043';
    ctx.lineWidth = 2;
    ctx.font = 'bold 14px sans-serif';
    objects.forEach((obj, i) => {
      const rect = toMirroredCanvasRect(obj.boundingBox, video, canvas);
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      ctx.fillText(`${i + 1}. ${obj.label} (${Math.round(obj.score * 100)}%)`, rect.x + 4, Math.max(48, rect.y - 6));
    });
    ctx.restore();
  };

  const drawTrackedMarker = (
    ctx: CanvasRenderingContext2D,
    item: TrackedItem,
    lost: boolean,
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement
  ) => {
    const p = toMirroredCanvasPoint(item.centroid.x, item.centroid.y, video, canvas);
    const color = lost ? '#ff5252' : '#00e676';
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.globalAlpha = lost ? 0.5 : 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 22, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(lost ? `${item.label} (หลุดการติดตาม)` : item.label, p.x + 28, p.y + 5);
    ctx.restore();
  };

  const drawAttachedMarker = (ctx: CanvasRenderingContext2D, p: { x: number; y: number }, label: string) => {
    ctx.save();
    ctx.strokeStyle = '#ffca28';
    ctx.fillStyle = '#ffca28';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 26, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`🤝 ${label}`, p.x + 32, p.y + 5);
    ctx.restore();
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (itemTrackingState !== 'selecting') return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const clickY = (e.clientY - rect.top) * (canvas.height / rect.height);
    const hit = lastCandidatesRef.current.find((obj) => {
      const r = toMirroredCanvasRect(obj.boundingBox, video, canvas);
      return clickX >= r.x && clickX <= r.x + r.width && clickY >= r.y && clickY <= r.y + r.height;
    });
    if (hit) handleLockItem(hit);
  };

  const handleLockItem = (candidate: DetectedObject) => {
    const now = performance.now();
    const locked = trackerRef.current.lock(candidate, now);
    lastTrackedItemRef.current = locked;
    itemStateRef.current = 'tracking';
    setItemTrackingState('tracking');
    setTrackedItem(locked);
    setCandidates([]);
    attachedRef.current = false;
    setAttached(false);
  };

  const handleReselect = () => {
    trackerRef.current.reset();
    lastTrackedItemRef.current = null;
    itemStateRef.current = 'selecting';
    setItemTrackingState('selecting');
    setTrackedItem(null);
    setCandidates([]);
    attachedRef.current = false;
    setAttached(false);
  };

  // --- ควบคุมเกม ---
  const handleStartGame = () => {
    if (!cal.api.isCalibrated()) return; // ต้องสอบเทียบก่อน — openness ต้องอยู่บนสเกลของผู้เล่น
    const config: PathGameConfig = { pathType, widthLevel, roundTimeSec, totalRounds };
    configRef.current = config;
    // สร้าง FSM ใหม่ทุกครั้งที่เริ่มเกม (ไม่ reuse instance เก่าใน ref) — กันกรณี hot reload ตอนพัฒนา: ref ค้าง instance
    // ของคลาสเวอร์ชันเก่าไว้ ทำให้ผลรอบมาจากสูตรเก่าแต่สรุปเกมคิดด้วยสูตรใหม่ แล้วค่าไม่ตรงกัน
    fsmRef.current = new PathDragFSM(config);
    gameRoundsRef.current = [];
    setGameRounds([]);
    setGameSummary(null);
    setGameSnapshot(fsmRef.current.snapshot());
    gamePhaseRef.current = 'playing';
    setGamePhase('playing');
  };

  const handleSkipRound = () => {
    const fsm = fsmRef.current;
    if (!fsm || gamePhaseRef.current !== 'playing') return;
    const result = fsm.skipRound(performance.now());
    if (result) handleRoundResult(result);
  };

  /** ยกเลิกเกมกลางคัน หรือกลับไปหน้าตั้งค่าจากหน้าสรุป — ไม่นับเป็นผลเกม */
  const handleBackToSetup = () => {
    gameRoundsRef.current = [];
    setGameRounds([]);
    setGameSummary(null);
    setGameSnapshot(null);
    gamePhaseRef.current = 'setup';
    setGamePhase('setup');
  };

  const handleRerollPreview = () => {
    previewPathRef.current = generatePath(pathType, widthLevel, 1);
  };

  const itemStatusText = (): { text: string; color: string } => {
    if (itemPhase === 'selecting') return { text: 'ยังไม่ได้เลือกวัตถุที่จะใช้เล่น', color: '#ccc' };
    if (itemPhase === 'attached') return { text: `🤝 ถือวัตถุอยู่: ${trackedItem?.label ?? ''}`, color: '#ffca28' };
    if (itemPhase === 'lost') return { text: `❌ หลุดการติดตาม: ${trackedItem?.label ?? ''}`, color: '#ff5252' };
    return { text: `👁️ กำลังติดตามวัตถุ: ${trackedItem?.label ?? ''}`, color: '#00e676' };
  };

  const phaseText = (phase: PathGamePhase | undefined): string => {
    if (phase === 'ready') return 'นำวัตถุไปวางที่จุด "เริ่ม" (ยังไม่จับเวลา)';
    if (phase === 'dragging') return 'กำลังลากตามทาง';
    if (phase === 'roundEnd') return 'จบรอบ — เตรียมรอบถัดไป...';
    return '';
  };

  const roundLabel = (r: PathRoundResult): string => {
    // โหมดผสม: แสดงแบบที่สุ่มได้จริงของรอบนั้น
    if (r.pathType === 'mixed') return `${PATH_TYPE_LABEL_TH.mixed} (ได้เส้น${SEGMENT_KIND_LABEL_TH[r.segmentKinds[0]]})`;
    return PATH_TYPE_LABEL_TH[r.pathType];
  };

  const renderRoundRow = (r: PathRoundResult) => (
    <div key={r.roundNumber} style={{ borderBottom: '1px solid #2a2a2a', paddingBottom: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '13px' }}>
        <span style={{ color: '#ccc' }}>
          รอบที่ {r.roundNumber}: {r.skipped ? '⏭️ ข้าม' : r.completed ? '✅ ถึงปลายทาง' : '⏱️ ไม่ถึงปลายทาง'}
        </span>
        <span>
          <span style={{ color: r.accuracyMeasured ? scoreColor(r.accuracyScore) : '#666', fontWeight: 'bold' }}>
            {r.accuracyMeasured ? r.accuracyScore : '—'}
          </span>
        </span>
      </div>
      <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
        {roundLabel(r)} &middot; ลากได้ {Math.round(r.progressRatio * 100)}% &middot; ใช้เวลา {r.timeUsedSec.toFixed(1)}/
        {r.timeLimitSec}s &middot; อยู่ในทาง {Math.round(r.onPathRatio * 100)}%
      </div>
      <div style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>{r.feedbackText}</div>
    </div>
  );

  const snap = gameSnapshot;

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <h2 style={{ color: '#ffca28' }}>🛤️ Virtual Grip: ลากวัตถุตามเส้นทาง (ทดลอง)</h2>
      <p style={{ color: '#aaa', fontSize: '14px' }}>
        ถือวัตถุจริง (กำมือที่วัตถุ) แล้วลากไปตามทางสีฟ้าบนจอจากวง &quot;เริ่ม&quot; ไปวง &quot;จบ&quot; ทุกรอบเปลี่ยนเส้นทางใหม่ — ได้ 2
        คะแนนแยกกัน คือทำสำเร็จกี่รอบจากทั้งหมด (ลากถึงปลายทางทันเวลา) และคะแนนความแม่นยำของมือ (มืออยู่ในทางแค่ไหน) ออกนอกทางไม่ตัดสิทธิ์
        แค่ลดคะแนนความแม่นยำ
      </p>

      <div className="camera-test-row" style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
        <div className="camera-frame grip-camera-frame" style={{ position: 'relative', width: '640px', maxWidth: '100%' }}>
          <video ref={videoRef} style={{ display: 'none' }} playsInline muted />
          <CalibrationOverlay status={cal.status} />
          <canvas
            ref={canvasRef}
            width={640}
            height={480}
            onClick={handleCanvasClick}
            style={{
              width: '100%',
              borderRadius: '8px',
              backgroundColor: '#000',
              border: '1px solid #333',
              cursor: itemTrackingState === 'selecting' ? 'pointer' : 'default',
            }}
          />
        </div>

        <div style={{ flex: 1, minWidth: '260px' }}>
          <OpennessCalibrationCard cal={cal} locked={gamePhase === 'playing'} cameraReady={cameraStatus === 'ready'} />
          {/* สถานะกล้อง + มือ */}
          <div style={panelStyle}>
            <div style={{ color: '#aaa', fontSize: '13px', marginBottom: '8px' }}>{statusMsg}</div>
            {cameraStatus === 'ready' && (
              <div
                style={{
                  fontSize: '20px',
                  fontWeight: 'bold',
                  color: !handDetected ? '#666' : gripState === 'closed' ? '#ff7043' : '#00e676',
                }}
              >
                {!handDetected ? '— ไม่พบมือในกล้อง —' : gripState === 'closed' ? '✊ กำมือ' : '🖐️ แบมือ'}
              </div>
            )}
          </div>

          {/* วัตถุ */}
          <div style={panelStyle}>
            <div style={{ fontSize: '15px', fontWeight: 'bold', color: itemStatusText().color, marginBottom: '8px' }}>
              {itemStatusText().text}
            </div>

            {itemPhase === 'tracking' && trackedItem && trackedItem.framesSinceSeen > 0 && (
              <div style={{ fontSize: '12px', color: '#ffca28', marginBottom: '8px' }}>
                ⚠️ หาวัตถุไม่เจอชั่วคราว ({trackedItem.framesSinceSeen}/{LOST_THRESHOLD_FRAMES})
              </div>
            )}

            {(itemPhase === 'tracking' || itemPhase === 'attached' || itemPhase === 'lost') && (
              <button
                onClick={handleReselect}
                style={{
                  padding: '8px 14px',
                  backgroundColor: itemPhase === 'lost' ? '#ff7043' : '#2a2a2a',
                  color: itemPhase === 'lost' ? '#000' : '#fff',
                  fontWeight: itemPhase === 'lost' ? 'bold' : 'normal',
                  border: itemPhase === 'lost' ? 'none' : '1px solid #444',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                เลือกวัตถุใหม่
              </button>
            )}

            {itemPhase === 'selecting' && (
              <>
                <div style={{ fontSize: '13px', color: '#ccc', marginBottom: candidates.length > 0 ? '10px' : 0 }}>
                  {candidates.length === 0
                    ? 'ยังไม่พบวัตถุในกล้อง — ถือของไว้ใกล้มือให้เห็นชัดเจน'
                    : 'แตะรายการด้านล่าง (หรือแตะกรอบบนภาพ) เพื่อเลือกวัตถุที่จะใช้เล่น'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {candidates.map((obj, i) => (
                    <button
                      key={i}
                      onClick={() => handleLockItem(obj)}
                      style={{
                        textAlign: 'left',
                        padding: '10px 12px',
                        backgroundColor: '#2a2a2a',
                        color: '#fff',
                        border: '1px solid #444',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '13px',
                      }}
                    >
                      {i + 1}. {obj.label} — {Math.round(obj.score * 100)}%
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ตั้งค่าเกม */}
          {gamePhase === 'setup' && (
            <div style={panelStyle}>
              <div style={{ fontSize: '13px', color: '#aaa', marginBottom: '10px' }}>รูปแบบเส้นทาง</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px' }}>
                {PATH_TYPES.map((t) => (
                  <button key={t} onClick={() => setPathType(t)} style={choiceButtonStyle(pathType === t, '#ffca28')}>
                    {PATH_TYPE_ICON[t]} {PATH_TYPE_LABEL_TH[t]}
                  </button>
                ))}
              </div>
              {pathType === 'mixed' && (
                <div style={{ fontSize: '11px', color: '#888', marginBottom: '12px' }}>
                  แต่ละรอบสุ่มแบบเส้นทางใดแบบหนึ่ง (ตรง / โค้ง / ซิกแซ็ก) สลับกันไปให้ครบทุกแบบ
                </div>
              )}

              <div style={{ fontSize: '13px', color: '#aaa', marginBottom: '10px' }}>ความกว้างของทาง</div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                {WIDTH_LEVELS.map((w) => (
                  <button key={w} onClick={() => setWidthLevel(w)} style={choiceButtonStyle(widthLevel === w, '#29b6f6')}>
                    {PATH_WIDTH_LABEL_TH[w]} ({PATH_HALF_WIDTH_PX[w] * 2}px)
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <label style={{ fontSize: '13px', color: '#ccc', width: '110px' }}>เวลาต่อรอบ (วินาที):</label>
                <input
                  type="number"
                  min={10}
                  max={120}
                  step={5}
                  value={roundTimeSec}
                  onChange={(e) => setRoundTimeSec(Math.max(10, Math.min(120, Number(e.target.value) || 10)))}
                  style={inputStyle}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <label style={{ fontSize: '13px', color: '#ccc', width: '110px' }}>จำนวนรอบ:</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={totalRounds}
                  onChange={(e) => setTotalRounds(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                  style={inputStyle}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px' }}>
                <button
                  onClick={handleStartGame}
                  disabled={!gameReady}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    backgroundColor: gameReady ? '#00e676' : '#333',
                    color: gameReady ? '#000' : '#777',
                    fontWeight: 'bold',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: gameReady ? 'pointer' : 'not-allowed',
                    fontSize: '14px',
                  }}
                >
                  ▶️ เริ่มเกม
                </button>
                <button
                  onClick={handleRerollPreview}
                  style={{
                    padding: '10px 12px',
                    backgroundColor: '#2a2a2a',
                    color: '#fff',
                    border: '1px solid #444',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  🎲 ตัวอย่างอื่น
                </button>
              </div>
              {!itemReady && (
                <div style={{ fontSize: '12px', color: '#ffca28' }}>
                  ต้องเลือกวัตถุด้านบนก่อนถึงจะเริ่มเกมได้ (เส้นสีฟ้าบนจอคือตัวอย่างเส้นทางตามที่เลือก)
                </div>
              )}
            </div>
          )}

          {/* ระหว่างเล่น */}
          {gamePhase === 'playing' && snap && (
            <div style={panelStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#ffca28' }}>
                  รอบที่ {snap.roundNumber}/{snap.totalRounds}
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={handleSkipRound}
                    style={{
                      padding: '4px 10px',
                      backgroundColor: 'transparent',
                      color: '#ccc',
                      border: '1px solid #555',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '11px',
                    }}
                  >
                    ข้ามรอบ
                  </button>
                  <button
                    onClick={handleBackToSetup}
                    style={{
                      padding: '4px 10px',
                      backgroundColor: 'transparent',
                      color: '#888',
                      border: '1px solid #444',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '11px',
                    }}
                  >
                    ยกเลิกเกม
                  </button>
                </div>
              </div>
              <div style={{ fontSize: '13px', color: '#ccc', marginBottom: '10px' }}>{phaseText(snap.phase)}</div>

              <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>
                ความคืบหน้าตามเส้นทาง {Math.round(snap.progressRatio * 100)}%
              </div>
              <div style={{ height: '8px', backgroundColor: '#333', borderRadius: '4px', overflow: 'hidden', marginBottom: '10px' }}>
                <div style={{ height: '100%', width: `${Math.round(snap.progressRatio * 100)}%`, backgroundColor: '#00e676' }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#aaa' }}>
                <span>
                  ความแม่นยำมือตอนนี้:{' '}
                  <b style={{ color: snap.liveAccuracy === null ? '#666' : scoreColor(snap.liveAccuracy * 100) }}>
                    {snap.liveAccuracy === null ? '—' : Math.round(snap.liveAccuracy * 100)}
                  </b>
                </span>
                <span>
                  {snap.holding ? (snap.onPath === false ? '🟠 นอกทาง' : '🟢 ในทาง') : '✋ ไม่ได้ถือวัตถุ'}
                </span>
                <span>หลุด {snap.dropCount} ครั้ง</span>
              </div>

              {itemPhase === 'lost' && (
                <div style={{ fontSize: '12px', color: '#ff5252', marginTop: '8px' }}>
                  ระบบหาวัตถุไม่เจอ — กด &quot;เลือกวัตถุใหม่&quot; ด้านบนเพื่อเลือกวัตถุอีกครั้ง
                </div>
              )}

              {gameRounds.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '14px' }}>
                  <div style={{ fontSize: '12px', color: '#888' }}>รอบที่จบแล้ว (ความแม่นยำของมือ)</div>
                  {gameRounds.map(renderRoundRow)}
                </div>
              )}
            </div>
          )}

          {/* สรุปผล */}
          {gamePhase === 'summary' && gameSummary && (
            <div style={panelStyle}>
              <div style={{ fontSize: '13px', color: '#aaa', marginBottom: '10px' }}>🏁 จบเกม!</div>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
                <div style={{ flex: 1, textAlign: 'center', backgroundColor: '#262626', borderRadius: '8px', padding: '12px 6px' }}>
                  <div
                    style={{
                      fontSize: '36px',
                      fontWeight: 'bold',
                      color: scoreColor((gameSummary.completedRounds / Math.max(1, gameSummary.targetRounds)) * 100),
                    }}
                  >
                    {gameSummary.completedRounds}/{gameSummary.targetRounds}
                  </div>
                  <div style={{ fontSize: '12px', color: '#aaa' }}>ทำสำเร็จ (รอบ)</div>
                  <div style={{ fontSize: '11px', color: '#777', marginTop: '2px' }}>ลากถึงปลายทางทันเวลา</div>
                </div>
                <div style={{ flex: 1, textAlign: 'center', backgroundColor: '#262626', borderRadius: '8px', padding: '12px 6px' }}>
                  <div style={{ fontSize: '36px', fontWeight: 'bold', color: scoreColor(gameSummary.accuracyScore) }}>
                    {gameSummary.accuracyScore}
                  </div>
                  <div style={{ fontSize: '12px', color: '#aaa' }}>ความแม่นยำของมือ / 100</div>
                  <div style={{ fontSize: '11px', color: '#777', marginTop: '2px' }}>
                    อยู่ในทาง {Math.round(gameSummary.avgOnPathRatio * 100)}% ของเวลา
                  </div>
                </div>
              </div>
              <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '12px' }}>{gameSummary.feedbackText}</div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
                <div style={{ fontSize: '12px', color: '#888' }}>รายรอบ (ความแม่นยำของมือ)</div>
                {gameSummary.rounds.map(renderRoundRow)}
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={handleStartGame}
                  disabled={!gameReady}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    backgroundColor: gameReady ? '#00e676' : '#333',
                    color: gameReady ? '#000' : '#777',
                    fontWeight: 'bold',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: gameReady ? 'pointer' : 'not-allowed',
                    fontSize: '14px',
                  }}
                >
                  🔁 เล่นใหม่
                </button>
                <button
                  onClick={handleBackToSetup}
                  style={{
                    padding: '10px 14px',
                    backgroundColor: '#2a2a2a',
                    color: '#fff',
                    border: '1px solid #444',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px',
                  }}
                >
                  เปลี่ยนการตั้งค่า
                </button>
              </div>
            </div>
          )}

          <div style={{ fontSize: '12px', color: '#888', backgroundColor: '#1e1e1e', borderRadius: '8px', padding: '12px' }}>
            เวลาเริ่มนับเมื่อถือวัตถุมาถึงวง &quot;เริ่ม&quot; แล้ว (ไม่รวมเวลาหยิบของ) ปล่อยวัตถุกลางทางได้ หยิบใหม่แล้วลากต่อจากจุดเดิม
            — ขณะถือวัตถุ ระบบใช้ตำแหน่งฝ่ามือแทนตำแหน่งวัตถุ (วัตถุถูกมือบัง) ความกว้างทางและเกณฑ์ต่างๆ เป็นค่า heuristic
            ยังไม่ได้ calibrate กับผู้ป่วยจริง
          </div>
        </div>
      </div>
    </div>
  );
};
