// ⚠️ ไฟล์นี้เป็น "ชุดย่อย" ที่ตัดมาจาก types/ai.d.ts ของ frontend เดิม (เฉพาะ type ที่เกมลากตามเส้นทาง + เกมของตกลงถ้วยใช้ + type ที่มันอ้างถึงต่อกัน)
// เอาไปรวมกับไฟล์ types ของโปรเจกต์ปลายทาง — ถ้าชื่อซ้ำกับของเดิม (เช่น Landmark) ให้ตรวจว่าโครงสร้างเหมือนกันก่อนรวม

export interface Landmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

/** สถานะมือแบบง่าย 2 สถานะ — ได้จาก ai/extractors/gripStateClassifier.ts (เกณฑ์ระยะทางเรขาคณิต ไม่ใช่โมเดลที่เทรน) */
export type GripState = 'open' | 'closed';

/** กล่องขอบเขตวัตถุที่ตรวจพบ — พิกัดเป็นพิกเซลจริงของเฟรมวิดีโอ (ไม่ใช่ normalized) ต้องคูณอัตราส่วน
 *  canvas.width/video.videoWidth เองก่อนวาดถ้าขนาดต่างกัน (ดู itemTracker.ts: toCanvasSpace) */
export interface DetectedObject {
  label: string;
  score: number;
  boundingBox: { originX: number; originY: number; width: number; height: number };
}

// ---------------------------------------------------------------------------
// Virtual Item — ล็อกวัตถุที่ผู้ป่วยถือจากกล้อง แล้ววาด marker ติดตามตำแหน่งต่อเนื่อง (tracking-by-detection)
// ai/objectDetection/itemTracker.ts จับคู่วัตถุข้ามเฟรมด้วย label + ตำแหน่งใกล้เคียง แล้วกรองนุ่มด้วย OneEuroFilter
// ---------------------------------------------------------------------------

/** สถานะการล็อก/ติดตามวัตถุ — 'selecting' รอเลือกวัตถุ, 'tracking' กำลังติดตาม, 'lost' หลุด ต้องเลือกใหม่ */
export type ItemTrackingState = 'selecting' | 'tracking' | 'lost';

/** วัตถุที่กำลังถูกล็อก/ติดตามอยู่ 1 ชิ้น — ตำแหน่งเป็นพิกเซลจริงของเฟรมวิดีโอต้นฉบับเหมือน DetectedObject
 *  (centroid/boundingBox ผ่านการกรองด้วย OneEuroFilter แล้ว ไม่ใช่ค่าดิบจาก ObjectDetector ตรงๆ) */
export interface TrackedItem {
  label: string;
  /** จุดศูนย์กลางของวัตถุหลังกรองความสั่นแล้ว (พิกเซลจริงของเฟรมวิดีโอ) */
  centroid: { x: number; y: number };
  /** กรอบขอบเขตล่าสุดที่จับคู่ได้จริง (ไม่ได้กรอง — ใช้วาดกรอบอ้างอิงเสริมจาก marker หลัก ถ้าต้องการ) */
  boundingBox: { originX: number; originY: number; width: number; height: number };
  /** คะแนนความมั่นใจของเฟรมที่จับคู่ล่าสุด (ไม่ใช่ค่าเฉลี่ยสะสม) */
  score: number;
  /** จำนวนเฟรมติดต่อกันที่ "ไม่เจอ" วัตถุที่ตรงเกณฑ์เลย นับจากครั้งล่าสุดที่เจอ — รีเซ็ตเป็น 0 ทุกครั้งที่จับคู่ได้ */
  framesSinceSeen: number;
}

// ---------------------------------------------------------------------------
// Multi-Item (วัตถุกลมหลายชิ้นพร้อมกัน) — ใช้ Hough Circle Transform ตรวจจับรูปทรงวงกลม (ไม่ต้องเทรนโมเดล)
// แล้วใช้ MultiItemTracker (ai/objectDetection/multiItemTracker.ts) จับคู่/ให้ id คงที่ข้ามเฟรม
// ---------------------------------------------------------------------------

export type PathType = 'straight' | 'curve' | 'zigzag' | 'mixed';

export type PathSegmentKind = 'straight' | 'curve' | 'zigzag';

export type PathWidthLevel = 'wide' | 'medium' | 'narrow';

export interface PathPoint {
  x: number;
  y: number;
}

/** เส้นทาง 1 เส้น เก็บเป็น polyline ที่ resample ให้จุดห่างกันเท่าๆ กัน (ประมาณ 4px) พร้อมระยะสะสม (arc length) ต่อจุด */
export interface GamePath {
  type: PathType;
  /** แบบของเส้นนี้ — มี 1 ค่าเสมอ (โหมด 'mixed' ของเกมสุ่มแบบใดแบบหนึ่งต่อรอบ ไม่ได้ต่อหลายแบบในเส้นเดียว) ดู GamePath.type */
  segmentKinds: PathSegmentKind[];
  points: PathPoint[];
  /** ระยะสะสมตามเส้นจากจุดเริ่มถึงจุดที่ i (พิกเซล) — cumulative[0] = 0, cumulative[last] = totalLength */
  cumulative: number[];
  totalLength: number;
  /** ครึ่งความกว้างของทาง (พิกเซล) — ทางจริงกว้าง 2 เท่าของค่านี้ */
  halfWidth: number;
  /** 1 = เดินจากซ้ายไปขวาบนจอ, -1 = ขวาไปซ้าย */
  direction: 1 | -1;
}

export interface PathGameConfig {
  pathType: PathType;
  widthLevel: PathWidthLevel;
  /** เวลาต่อรอบ (วินาที) — เริ่มนับตอนผู้ป่วยถือวัตถุมาถึงจุดเริ่มต้นแล้ว */
  roundTimeSec: number;
  totalRounds: number;
}

export interface PathRoundResult {
  roundNumber: number;
  pathType: PathType;
  segmentKinds: PathSegmentKind[];
  /** ลากถึงปลายทางได้ก่อนหมดเวลา */
  completed: boolean;
  /** ผู้เล่นกด "ข้ามรอบ" (นับเป็นไม่สำเร็จ ได้ 0 คะแนน) */
  skipped: boolean;
  /** ความคืบหน้าตามเส้นไกลสุดที่ทำได้ 0..1 */
  progressRatio: number;
  timeUsedSec: number;
  timeLimitSec: number;
  /** คะแนนความแม่นยำของมือ 0-100 — ถ่วงเวลาที่ถือวัตถุ: มืออยู่ในทาง = เต็ม, ออกนอกทางลดลงเชิงเส้นจนเป็น 0 ที่ห่างเท่าความกว้างครึ่งทางอีกเท่าตัว
   *  (0 และ accuracyMeasured = false ถ้ารอบนี้ไม่เคยลากเลย เช่นข้ามรอบ/ไม่ได้เริ่ม) */
  accuracyScore: number;
  /** รอบนี้มีข้อมูลความแม่นยำจริงหรือไม่ (เคยถือวัตถุลากอย่างน้อยช่วงหนึ่ง) */
  accuracyMeasured: boolean;
  /** สัดส่วนเวลา (ตอนถือวัตถุ) ที่อยู่ในทางจริงๆ 0..1 */
  onPathRatio: number;
  /** จำนวนครั้งที่ปล่อยวัตถุหลุดกลางทาง */
  dropCount: number;
  feedbackText: string;
}

export interface PathGameSummary {
  targetRounds: number;
  /** คะแนนตัวที่ 1: ทำสำเร็จกี่รอบ (ลากถึงปลายทางทันเวลา) จากทั้งหมด targetRounds รอบ — ไม่รวมกับความแม่นยำ */
  completedRounds: number;
  /** คะแนนตัวที่ 2: ความแม่นยำของมือ 0-100 เฉลี่ยเฉพาะรอบที่มีข้อมูลความแม่นยำ (0 ถ้าไม่มีรอบไหนมีเลย) */
  accuracyScore: number;
  avgOnPathRatio: number;
  totalDrops: number;
  feedbackText: string;
  rounds: PathRoundResult[];
}

export type PathGamePhase = 'ready' | 'dragging' | 'roundEnd' | 'gameOver';

/** สถานะปัจจุบันของ PathDragFSM สำหรับวาดจอ/แผงข้อมูล */
export interface PathGameSnapshot {
  phase: PathGamePhase;
  roundNumber: number;
  totalRounds: number;
  path: GamePath | null;
  /** ระยะไกลสุดตามเส้นที่ทำได้ในรอบนี้ (พิกเซล) และสัดส่วน 0..1 */
  progressLength: number;
  progressRatio: number;
  timeLimitSec: number;
  timeRemainingSec: number;
  /** เวลาที่เหลือ 0..1 (1 = เพิ่งเริ่มจับเวลา) */
  timeRemainingRatio: number;
  /** ตอนนี้ถือวัตถุอยู่ (กำมือติดวัตถุ + เจอมือ) หรือไม่ */
  holding: boolean;
  /** ระยะจากจุดถือถึงเส้นกลางทาง (พิกเซล) null ถ้าไม่ได้ถืออยู่ */
  currentDistance: number | null;
  onPath: boolean | null;
  /** ความแม่นยำสะสมของรอบนี้ถึงตอนนี้ 0..1 (null ถ้ายังไม่มีตัวอย่าง) */
  liveAccuracy: number | null;
  dropCount: number;
  /** ผลรอบที่เพิ่งจบ (แสดงช่วงพักระหว่างรอบ) */
  lastResult: PathRoundResult | null;
}
