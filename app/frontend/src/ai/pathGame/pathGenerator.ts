import { GamePath, PathPoint, PathSegmentKind, PathType, PathWidthLevel } from '../../types/ai';

/**
 * สร้างเส้นทางสำหรับเกม "ลากวัตถุจริงตามเส้นทาง" (ดูชนิดใน types/ai.d.ts หมวด path drag) — pure function ล้วนๆ
 * ไม่ยุ่งกับ canvas/กล้อง ทดสอบแยกได้ ใส่ rng เองได้เพื่อให้ผลซ้ำได้ตอนทดสอบ
 *
 * พิกัดเป็นพิกเซลของ canvas 640x480 ที่ "มิเรอร์แล้ว" (พื้นที่เดียวกับที่ผู้ป่วยเห็นบนจอ) เส้นทางพาดแนวนอนเป็นหลัก
 * (ซ้าย↔ขวา) เพราะการเคลื่อนมือในแนวระนาบหน้ากล้องเป็นการเคลื่อนไหวที่ MediaPipe จับได้นิ่งที่สุด และไม่ต้องยกแขนสูง
 * เกินไปสำหรับผู้ป่วยที่แขนอ่อนแรง ความหลากหลายระหว่างรอบมาจากการสุ่มรูปร่าง/ความสูง/จำนวนหัก ไม่ใช่การเปลี่ยนแกน
 */

export const PATH_CANVAS_WIDTH = 640;
export const PATH_CANVAS_HEIGHT = 480;

/** ครึ่งความกว้างของทาง (พิกเซลบน canvas 640 กว้าง) ต่อระดับที่เลือก — ค่า heuristic ยังไม่ได้ calibrate กับผู้ป่วยจริง
 *  ตำแหน่งที่ใช้เทียบคือจุดกึ่งกลางฝ่ามือซึ่งสั่นได้ราว 5-10px จาก landmark jitter จึงไม่ตั้งแคบกว่า ~22px */
export const PATH_HALF_WIDTH_PX: Record<PathWidthLevel, number> = {
  wide: 50,
  medium: 34,
  narrow: 22,
};

export const PATH_WIDTH_LABEL_TH: Record<PathWidthLevel, string> = {
  wide: 'กว้าง',
  medium: 'กลาง',
  narrow: 'แคบ',
};

export const PATH_TYPE_LABEL_TH: Record<PathType, string> = {
  straight: 'เส้นทางตรง',
  curve: 'เส้นทางโค้ง',
  zigzag: 'เส้นทางซิกแซ็ก',
  mixed: 'เส้นทางผสม',
};

export const SEGMENT_KIND_LABEL_TH: Record<PathSegmentKind, string> = {
  straight: 'ตรง',
  curve: 'โค้ง',
  zigzag: 'ซิกแซ็ก',
};

/** ระยะห่างระหว่างจุดหลัง resample (พิกเซล) */
const RESAMPLE_STEP_PX = 4;

/** ขอบซ้าย/ขวาที่เส้นทางใช้ได้ — เว้นขอบไว้กันมือหลุดกรอบกล้องและให้มี margin วาดวงจุดเริ่ม/จบ */
const MARGIN_X = 80;
/** ความสูงกึ่งกลางที่เส้นทางวนรอบ และขอบเขตบน/ล่างที่ห้ามเกิน (เว้นแถบ HUD ด้านบน) */
const CENTER_Y = 250;
const Y_MIN = 120;
const Y_MAX = 390;

export type Rng = () => number;

function rand(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

function randSign(rng: Rng): 1 | -1 {
  return rng() < 0.5 ? -1 : 1;
}

function clampY(y: number): number {
  return Math.max(Y_MIN, Math.min(Y_MAX, y));
}

function smoothstep(u: number): number {
  return u * u * (3 - 2 * u);
}

/** จุดตามเส้นจากปลาย A ถึงปลาย B (ไม่รวมจุด A เอง) ตามชนิดช่วง — ผู้เรียกต้องใส่จุดเริ่มต้นเอง
 *  x เดินจาก xa ไป xb เสมอ (ทิศทางซ้าย/ขวาจริงถูกพลิกทีหลังทั้งเส้น) */
function segmentPoints(
  kind: PathSegmentKind,
  xa: number,
  ya: number,
  xb: number,
  yb: number,
  amplitude: number,
  rng: Rng
): PathPoint[] {
  if (kind === 'straight') {
    return [{ x: xb, y: yb }];
  }

  if (kind === 'curve') {
    // โค้งแบบ "ส่วนโค้งเดียว" (sin 0..π) หรือแบบ "ตัว S" (sin 0..2π) สุ่มเลือก ปลายทั้งสองยังอยู่ที่ (ya, yb) เสมอ
    const sShape = rng() < 0.5;
    const sign = randSign(rng);
    const samples = 40;
    const out: PathPoint[] = [];
    for (let i = 1; i <= samples; i++) {
      const u = i / samples;
      const bump = sShape ? Math.sin(2 * Math.PI * u) : Math.sin(Math.PI * u);
      const baseY = ya + (yb - ya) * smoothstep(u);
      out.push({ x: xa + (xb - xa) * u, y: clampY(baseY + sign * amplitude * bump) });
    }
    return out;
  }

  // zigzag — จุดหักสลับบน/ล่างของเส้นฐานที่ไล่จาก ya ไป yb จำนวนขา (legs) ≥ 3
  const span = Math.abs(xb - xa);
  const minLegs = 3;
  const maxLegs = span > 300 ? 6 : 4;
  const legs = minLegs + Math.floor(rng() * (maxLegs - minLegs + 1));
  let sign = randSign(rng);
  const out: PathPoint[] = [];
  for (let i = 1; i <= legs; i++) {
    const u = i / legs;
    const x = xa + (xb - xa) * u;
    if (i === legs) {
      out.push({ x, y: yb });
    } else {
      out.push({ x, y: clampY(ya + (yb - ya) * u + sign * amplitude) });
      sign = (sign * -1) as 1 | -1;
    }
  }
  return out;
}

/** แบบเส้นทางที่ 'mixed' สุ่มเลือกมาให้ในแต่ละรอบ */
export const MIXED_KINDS: PathSegmentKind[] = ['straight', 'curve', 'zigzag'];

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** resample polyline ให้จุดห่างกันเท่าๆ กัน (RESAMPLE_STEP_PX) จุดแรก/สุดท้ายคงเดิม */
function resample(raw: PathPoint[]): { points: PathPoint[]; cumulative: number[]; totalLength: number } {
  const rawCum: number[] = [0];
  for (let i = 1; i < raw.length; i++) {
    rawCum.push(rawCum[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y));
  }
  const total = rawCum[rawCum.length - 1];
  const count = Math.max(2, Math.ceil(total / RESAMPLE_STEP_PX) + 1);
  const points: PathPoint[] = [];
  const cumulative: number[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const s = (total * k) / (count - 1);
    while (seg < raw.length - 2 && rawCum[seg + 1] < s) seg++;
    const segLen = rawCum[seg + 1] - rawCum[seg];
    const t = segLen > 0 ? (s - rawCum[seg]) / segLen : 0;
    points.push({
      x: raw[seg].x + (raw[seg + 1].x - raw[seg].x) * t,
      y: raw[seg].y + (raw[seg + 1].y - raw[seg].y) * t,
    });
    cumulative.push(s);
  }
  return { points, cumulative, totalLength: total };
}

/**
 * สร้างเส้นทางใหม่ 1 เส้น
 * - straight: เส้นตรง (แนวนอนหรือเอียงเล็กน้อย)
 * - curve: ส่วนโค้งหรือตัว S
 * - zigzag: หัก 3-6 ขา สลับบน/ล่าง
 * - mixed: สุ่มเลือกหนึ่งในสามแบบข้างบนต่อเส้น (GamePath.type ที่คืนไปเป็นแบบจริงที่สุ่มได้)
 * direction 1 = ซ้าย→ขวา, -1 = ขวา→ซ้าย (พลิกแนว x ทั้งเส้น)
 */
export function generatePath(
  type: PathType,
  widthLevel: PathWidthLevel,
  direction: 1 | -1 = 1,
  rng: Rng = Math.random
): GamePath {
  // 'mixed' = แต่ละรอบสุ่มแบบเส้นทางใดแบบหนึ่ง (ตรง/โค้ง/ซิกแซ็ก) ไม่ได้ต่อหลายแบบในเส้นเดียว เพื่อให้แต่ละเส้นใช้พื้นที่เต็มความกว้างจอ
  // (ตัวเกม PathDragFSM เลือกแบบให้ครบสลับกันไปเองผ่าน nextMixedKind แล้วส่งแบบจริงมา — ค่า 'mixed' ที่มาถึงตรงนี้เกิดเฉพาะตอนพรีวิว)
  const kind: PathSegmentKind = type === 'mixed' ? MIXED_KINDS[Math.floor(rng() * MIXED_KINDS.length)] : type;
  const xStart = MARGIN_X;
  const xEnd = PATH_CANVAS_WIDTH - MARGIN_X;
  const raw: PathPoint[] = [];
  const segmentKinds: PathSegmentKind[] = [kind];
  let ya: number;
  let yb: number;
  let amp: number;
  if (kind === 'straight') {
    ya = CENTER_Y + rand(rng, -70, 70);
    yb = CENTER_Y + rand(rng, -70, 70);
    amp = 0;
  } else if (kind === 'curve') {
    ya = CENTER_Y + rand(rng, -15, 15);
    yb = CENTER_Y + rand(rng, -15, 15);
    amp = rand(rng, 60, 100);
  } else {
    ya = CENTER_Y + rand(rng, -20, 20);
    yb = CENTER_Y + rand(rng, -20, 20);
    amp = rand(rng, 55, 85);
  }
  raw.push({ x: xStart, y: ya });
  raw.push(...segmentPoints(kind, xStart, ya, xEnd, yb, amp, rng));

  const oriented = direction === 1 ? raw : raw.map((p) => ({ x: PATH_CANVAS_WIDTH - p.x, y: p.y }));
  const { points, cumulative, totalLength } = resample(oriented);
  return {
    type: kind,
    segmentKinds,
    points,
    cumulative,
    totalLength,
    halfWidth: PATH_HALF_WIDTH_PX[widthLevel],
    direction,
  };
}

/** จุดบนเส้นที่ระยะสะสม s (พิกเซล) — clamp ให้อยู่ในช่วง 0..totalLength */
export function pointAtLength(path: GamePath, s: number): PathPoint {
  const clamped = Math.max(0, Math.min(path.totalLength, s));
  let lo = 0;
  let hi = path.cumulative.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path.cumulative[mid] <= clamped) lo = mid;
    else hi = mid;
  }
  const segLen = path.cumulative[hi] - path.cumulative[lo];
  const t = segLen > 0 ? (clamped - path.cumulative[lo]) / segLen : 0;
  return {
    x: path.points[lo].x + (path.points[hi].x - path.points[lo].x) * t,
    y: path.points[lo].y + (path.points[hi].y - path.points[lo].y) * t,
  };
}

export interface PathProjection {
  /** ระยะจากจุดถึงเส้นกลางทาง (พิกเซล) */
  distance: number;
  /** ระยะสะสมตามเส้นของจุดบนเส้นที่ใกล้ที่สุด (พิกเซล) */
  s: number;
}

/**
 * หาจุดบนเส้นที่ใกล้ point ที่สุด โดยจำกัดเฉพาะช่วงของเส้นที่ระยะสะสมอยู่ใน [sMin, sMax] (ค่าเริ่มต้น = ทั้งเส้น)
 * ใช้ช่วงจำกัดตอนคิดความคืบหน้า เพื่อไม่ให้ความคืบหน้ากระโดดข้ามไปขาอื่นของเส้นซิกแซ็กที่พับกลับมาใกล้กัน
 */
export function projectOntoPath(
  path: GamePath,
  point: PathPoint,
  sMin = 0,
  sMax = path.totalLength
): PathProjection {
  let bestDistance = Infinity;
  let bestS = Math.max(0, Math.min(path.totalLength, sMin));
  for (let i = 0; i < path.points.length - 1; i++) {
    const s0 = path.cumulative[i];
    const s1 = path.cumulative[i + 1];
    if (s1 < sMin || s0 > sMax) continue;
    const a = path.points[i];
    const b = path.points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    // จำกัด t ให้จุดฉายอยู่ในช่วง [sMin, sMax] จริงๆ (ไม่ใช่แค่ segment ที่ทับช่วง)
    const segLen = s1 - s0;
    if (segLen > 0) {
      const tMin = Math.max(0, (sMin - s0) / segLen);
      const tMax = Math.min(1, (sMax - s0) / segLen);
      t = Math.max(tMin, Math.min(tMax, t));
    }
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const d = Math.hypot(point.x - px, point.y - py);
    if (d < bestDistance) {
      bestDistance = d;
      bestS = s0 + segLen * t;
    }
  }
  return { distance: bestDistance, s: bestS };
}

/**
 * เลือกแบบเส้นทางของรอบถัดไปสำหรับโหมด 'mixed' — สุ่มแบบ "ถุงสับไพ่": สับครบ 3 แบบแล้วหยิบทีละแบบจนหมดถุงค่อยสับใหม่
 * ทำให้ทุกแบบโผล่สลับกันสม่ำเสมอ (ไม่ได้ตรงล้วน 5 รอบติดแบบสุ่มอิสระ) และไม่ให้แบบแรกของถุงใหม่ซ้ำกับแบบสุดท้ายของถุงเก่า
 * bag ถูกแก้ไขโดยตรง ผู้เรียกเก็บไว้ข้ามรอบ
 */
export function nextMixedKind(bag: PathSegmentKind[], last: PathSegmentKind | null, rng: Rng = Math.random): PathSegmentKind {
  if (bag.length === 0) {
    const fresh = shuffle(MIXED_KINDS, rng);
    if (last !== null && fresh[0] === last) {
      const swapWith = 1 + Math.floor(rng() * (fresh.length - 1));
      [fresh[0], fresh[swapWith]] = [fresh[swapWith], fresh[0]];
    }
    bag.push(...fresh);
  }
  return bag.shift() as PathSegmentKind;
}
