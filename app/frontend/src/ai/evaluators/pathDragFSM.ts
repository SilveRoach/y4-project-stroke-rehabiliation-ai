import {
  GamePath,
  PathGameConfig,
  PathGamePhase,
  PathGameSnapshot,
  PathPoint,
  PathRoundResult,
  PathSegmentKind,
} from '../../types/ai';
import { generatePath, nextMixedKind, projectOntoPath, Rng } from '../pathGame/pathGenerator';
import { computePathRoundResult, pathSampleQuality } from '../scoring/pathGameScoreEngine';

/** รัศมีโซนจุดเริ่มต้น (พิกเซลบน canvas 640 กว้าง) — ต้องเริ่มลากจากจุดนี้ */
export const PATH_START_RADIUS_PX = 36;

/** ต้องลากไปถึงสัดส่วนนี้ของความยาวเส้นถึงถือว่า "ถึงปลายทาง" — ไม่ใช่ 1.0 เพราะจุดกึ่งกลางฝ่ามือสั่นเล็กน้อยตอนปลายเส้น */
const FINISH_PROGRESS_RATIO = 0.97;

/** ช่วงค้นหาจุดฉายเพื่อคิดความคืบหน้า (พิกเซลตามเส้น) เทียบกับความคืบหน้าสูงสุดเดิม — ถอยหลังได้เล็กน้อย เดินหน้าได้จำกัด
 *  ต่อ 1 เฟรม กันความคืบหน้ากระโดดข้ามไปขาอื่นของเส้นซิกแซ็กที่พับกลับมาใกล้กัน */
const PROGRESS_BACK_WINDOW_PX = 30;
const PROGRESS_FORWARD_WINDOW_PX = 110;

/** นับความคืบหน้าเฉพาะตอนจุดถือวัตถุอยู่ใกล้เส้นพอ (กี่เท่าของครึ่งความกว้างทาง) — ตัดทางลัดที่ออกนอกทางไปไกลแล้วค่อยกลับ */
const PROGRESS_TOLERANCE_RATIO = 2;

/** ช่วงพักระหว่างรอบ (แสดงผลรอบที่เพิ่งจบ) */
export const PATH_INTERMISSION_MS = 2500;

/** เพดานช่วงเวลาต่อ 1 ตัวอย่างความแม่นยำ — กันเฟรมสะดุดยาวๆ (เช่นแท็บค้าง) ถ่วงคะแนนเกินจริง */
const MAX_SAMPLE_DT_MS = 250;

/** ปล่อยวัตถุ (ไม่ได้ถืออยู่) นานเกินค่านี้ถึงนับเป็น "หลุด" 1 ครั้ง — ให้อภัยเฟรมที่ตรวจมือสะดุดชั่วครู่ */
const DROP_GRACE_MS = 500;

/** ส่วนต้นเส้นที่ไม่นับความแม่นยำ (เป็นสัดส่วนของความยาว) ขณะยังอยู่ในโซนเริ่มต้น — กันคนถือนิ่งที่จุดเริ่มทั้งรอบแล้วได้ความแม่นยำเต็ม */
const IDLE_AT_START_PROGRESS_RATIO = 0.03;

export interface PathDragUpdateInput {
  timestampMs: number;
  /** ตำแหน่งจุดกึ่งกลางฝ่ามือเป็นพิกเซล canvas (มิเรอร์แล้ว) null ถ้าเฟรมนี้ไม่เจอมือ */
  handPoint: PathPoint | null;
  /** กำมือติดวัตถุอยู่ (จาก attach logic ของ VirtualGripPathView) — ขณะติด ตำแหน่งวัตถุ = ตำแหน่งมือ */
  attached: boolean;
}

function dist(a: PathPoint, b: PathPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * ควบคุมกติกาเกม "ลากวัตถุจริงตามเส้นทาง" — pure state machine ไม่ยุ่งกับ canvas/กล้อง (วาดผ่าน ai/render/pathGameRenderer.ts)
 *
 * วงจรต่อรอบ: 'ready' (แสดงเส้นทางใหม่และเริ่มนับเวลาทันที รอผู้ป่วยหยิบวัตถุมาวางที่จุดเริ่ม) → 'dragging'
 * (ลากไปตามทางจนถึงปลายทางหรือหมดเวลา) → 'roundEnd' (พักแสดงผลรอบ PATH_INTERMISSION_MS) → รอบถัดไป 'ready'
 * จนครบ totalRounds → 'gameOver' ทุกรอบสร้างเส้นทางใหม่ (สุ่มรูปร่างใหม่) และสลับทิศซ้าย↔ขวา เพื่อให้จุดเริ่มของรอบถัดไป
 * อยู่ใกล้จุดที่ผู้ป่วยวางวัตถุไว้ตอนจบรอบก่อน (ไม่ต้องหอบวัตถุข้ามจอ)
 *
 * ออกนอกทาง "ไม่ตัดสิทธิ์" — แค่ลดคะแนนความแม่นยำ (ดู ai/scoring/pathGameScoreEngine.ts) และความคืบหน้านับเฉพาะตอนจุดถือวัตถุ
 * อยู่ใกล้เส้นในระยะ PROGRESS_TOLERANCE_RATIO × ครึ่งความกว้างทาง ปล่อยวัตถุกลางทางได้ (นับ dropCount) หยิบใหม่แล้วลากต่อได้
 */
export class PathDragFSM {
  private config: PathGameConfig;
  private rng: Rng;

  private phase: PathGamePhase = 'ready';
  private roundNumber = 1;
  private path: GamePath;
  // โหมด 'mixed': ถุงแบบเส้นทางที่ยังไม่ถูกใช้ + แบบของรอบก่อน (ดู nextMixedKind)
  private mixedBag: PathSegmentKind[] = [];
  private lastMixedKind: PathSegmentKind | null = null;

  // สถานะรอบปัจจุบัน
  private roundStartMs: number | null = null;
  private lastTs = 0;
  private progressS = 0;
  private qualityWeightedMs = 0;
  private holdingMs = 0;
  private onPathMs = 0;
  private dropCount = 0;
  private holding = false;
  private notHoldingSinceMs: number | null = null;
  private dropCounted = false;
  private currentDistance: number | null = null;
  private roundEndedMs = 0;
  private lastResult: PathRoundResult | null = null;

  constructor(config: PathGameConfig, rng: Rng = Math.random) {
    this.config = config;
    this.rng = rng;
    this.path = this.makePath(1);
  }

  private makePath(roundNumber: number): GamePath {
    // รอบคี่ซ้าย→ขวา รอบคู่ขวา→ซ้าย (ดูคอมเมนต์หัวคลาส)
    const direction: 1 | -1 = roundNumber % 2 === 1 ? 1 : -1;
    let type = this.config.pathType;
    if (type === 'mixed') {
      const kind = nextMixedKind(this.mixedBag, this.lastMixedKind, this.rng);
      this.lastMixedKind = kind;
      type = kind;
    }
    return generatePath(type, this.config.widthLevel, direction, this.rng);
  }

  /** เริ่มเกมใหม่ทั้งหมดด้วย config (ใหม่) — เรียกตอนกดเริ่ม/เล่นใหม่ */
  reset(config: PathGameConfig = this.config): void {
    this.config = config;
    this.phase = 'ready';
    this.roundNumber = 1;
    this.lastResult = null;
    this.mixedBag = [];
    this.lastMixedKind = null;
    this.beginRound(1);
  }

  private beginRound(roundNumber: number): void {
    this.roundNumber = roundNumber;
    this.path = this.makePath(roundNumber);
    this.phase = 'ready';
    this.roundStartMs = null;
    this.lastTs = 0;
    this.progressS = 0;
    this.qualityWeightedMs = 0;
    this.holdingMs = 0;
    this.onPathMs = 0;
    this.dropCount = 0;
    this.holding = false;
    this.notHoldingSinceMs = null;
    this.dropCounted = false;
    this.currentDistance = null;
  }

  /** ข้ามรอบปัจจุบัน (นับเป็นไม่สำเร็จ 0 คะแนน) — คืนผลรอบถ้าข้ามได้ */
  skipRound(timestampMs: number): PathRoundResult | null {
    if (this.phase !== 'ready' && this.phase !== 'dragging') return null;
    return this.endRound(timestampMs, false, true);
  }

  private endRound(timestampMs: number, completed: boolean, skipped: boolean): PathRoundResult {
    const elapsedSec = this.roundStartMs === null ? 0 : Math.max(0, (timestampMs - this.roundStartMs) / 1000);
    const timeUsedSec = Math.min(elapsedSec, this.config.roundTimeSec);
    const progressRatio = this.path.totalLength > 0 ? this.progressS / this.path.totalLength : 0;
    const result = computePathRoundResult({
      roundNumber: this.roundNumber,
      pathType: this.config.pathType,
      segmentKinds: this.path.segmentKinds,
      completed,
      skipped,
      progressRatio: completed ? 1 : progressRatio,
      timeUsedSec,
      timeLimitSec: this.config.roundTimeSec,
      qualityWeightedMs: this.qualityWeightedMs,
      holdingMs: this.holdingMs,
      onPathMs: this.onPathMs,
      dropCount: this.dropCount,
    });
    this.lastResult = result;
    this.roundEndedMs = timestampMs;
    this.holding = false;
    this.phase = this.roundNumber >= this.config.totalRounds ? 'gameOver' : 'roundEnd';
    return result;
  }

  /** เรียกทุกเฟรม คืนผลรอบถ้ารอบนี้เพิ่งจบ (ถึงปลายทาง/หมดเวลา) ไม่งั้นคืน null */
  update(input: PathDragUpdateInput): PathRoundResult | null {
    const { timestampMs: ts, handPoint, attached } = input;
    const holdingNow = attached && handPoint !== null;

    if (this.phase === 'roundEnd') {
      this.lastTs = ts;
      if (ts - this.roundEndedMs >= PATH_INTERMISSION_MS) this.beginRound(this.roundNumber + 1);
      return null;
    }
    if (this.phase === 'gameOver') {
      this.lastTs = ts;
      return null;
    }

    if (this.roundStartMs === null) {
      this.roundStartMs = ts;
      this.lastTs = ts;
    }

    if (this.phase === 'ready') {
      this.lastTs = ts;
      this.holding = holdingNow;
      this.currentDistance = holdingNow && handPoint ? projectOntoPath(this.path, handPoint).distance : null;
      if (holdingNow && handPoint && dist(handPoint, this.path.points[0]) <= PATH_START_RADIUS_PX) {
        this.phase = 'dragging';
        this.notHoldingSinceMs = null;
        this.dropCounted = false;
      }
      if (ts - this.roundStartMs >= this.config.roundTimeSec * 1000) {
        return this.endRound(ts, false, false);
      }
      return null;
    }

    // phase === 'dragging'
    const dt = Math.max(0, Math.min(MAX_SAMPLE_DT_MS, ts - this.lastTs));
    this.lastTs = ts;
    this.holding = holdingNow;

    if (holdingNow && handPoint) {
      this.notHoldingSinceMs = null;
      this.dropCounted = false;

      const global = projectOntoPath(this.path, handPoint);
      this.currentDistance = global.distance;

      // ความคืบหน้า: ค้นหาจุดฉายเฉพาะช่วงรอบๆ ความคืบหน้าสูงสุดเดิม และนับเฉพาะตอนอยู่ใกล้เส้นพอ
      const windowed = projectOntoPath(
        this.path,
        handPoint,
        Math.max(0, this.progressS - PROGRESS_BACK_WINDOW_PX),
        Math.min(this.path.totalLength, this.progressS + PROGRESS_FORWARD_WINDOW_PX)
      );
      if (windowed.distance <= this.path.halfWidth * PROGRESS_TOLERANCE_RATIO) {
        this.progressS = Math.max(this.progressS, windowed.s);
      }

      // ตัวอย่างความแม่นยำ — ข้ามช่วงที่ยังอยู่ที่โซนจุดเริ่มต้นโดยแทบไม่ได้ขยับ (ดู IDLE_AT_START_PROGRESS_RATIO)
      const stillAtStart =
        this.progressS < this.path.totalLength * IDLE_AT_START_PROGRESS_RATIO &&
        dist(handPoint, this.path.points[0]) <= PATH_START_RADIUS_PX;
      if (!stillAtStart) {
        this.holdingMs += dt;
        this.qualityWeightedMs += dt * pathSampleQuality(global.distance, this.path.halfWidth);
        if (global.distance <= this.path.halfWidth) this.onPathMs += dt;
      }
    } else {
      this.currentDistance = null;
      if (this.notHoldingSinceMs === null) this.notHoldingSinceMs = ts;
      if (!this.dropCounted && ts - this.notHoldingSinceMs >= DROP_GRACE_MS) {
        this.dropCount += 1;
        this.dropCounted = true;
      }
    }

    if (this.progressS >= this.path.totalLength * FINISH_PROGRESS_RATIO) {
      return this.endRound(ts, true, false);
    }
    if (this.roundStartMs !== null && ts - this.roundStartMs >= this.config.roundTimeSec * 1000) {
      return this.endRound(ts, false, false);
    }
    return null;
  }

  snapshot(): PathGameSnapshot {
    const timerRunning = this.phase === 'ready' || this.phase === 'dragging';
    const elapsedMs = timerRunning && this.roundStartMs !== null
      ? Math.max(0, this.lastTs - this.roundStartMs)
      : 0;
    const limitMs = this.config.roundTimeSec * 1000;
    const timeRemainingSec = timerRunning
      ? Math.max(0, (limitMs - elapsedMs) / 1000)
      : this.config.roundTimeSec;
    const onPath = this.currentDistance === null ? null : this.currentDistance <= this.path.halfWidth;
    return {
      phase: this.phase,
      roundNumber: this.roundNumber,
      totalRounds: this.config.totalRounds,
      path: this.path,
      progressLength: this.progressS,
      progressRatio: this.path.totalLength > 0 ? this.progressS / this.path.totalLength : 0,
      timeLimitSec: this.config.roundTimeSec,
      timeRemainingSec,
      timeRemainingRatio: limitMs > 0 ? timeRemainingSec / this.config.roundTimeSec : 0,
      holding: this.holding,
      currentDistance: this.currentDistance,
      onPath,
      liveAccuracy: this.holdingMs > 0 ? this.qualityWeightedMs / this.holdingMs : null,
      dropCount: this.dropCount,
      lastResult: this.lastResult,
    };
  }
}
