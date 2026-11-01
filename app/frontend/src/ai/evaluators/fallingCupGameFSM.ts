/**
 * ตัวจัดการกติกาเกม "ของตกลงถ้วย" — มีของทยอยตกลงมาจากด้านบนจอช้าๆ ผู้เล่นกำมือจับของ ลากไปปล่อย (แบมือ) เหนือถ้วย
 * ของที่ปล่อยจะตกลงไปในถ้วยเอง ได้ 1 แต้มต่อชิ้นที่ลงถ้วย ของที่ตกพื้น/ตกนอกถ้วยได้ 0 แต้ม จำนวนของตายตัว (totalObjects)
 * เล่นจนของชิ้นสุดท้ายถูกตัดสิน (ลงถ้วยหรือตกพื้น) แล้วจบเกม
 *
 * กติกา "โซนมือ" (ไอเดียเพิ่มเติม): เกมเริ่มต้นในสถานะ PAUSE เพื่อรอมือเข้าโซนก่อนปล่อยของชิ้นแรก
 * หลังเริ่มเกมแล้ว หากไม่พบมือหรือมืออยู่นอกโซน ของจะยังตกต่อและเกมไม่หยุด; เมื่อพบมือยังเล่นได้ตามปกติ
 *
 * ทำงานเป็น pure state machine ไม่ยุ่งกับ canvas/กล้อง (วาดที่ ai/render/fallingCupRenderer.ts) พิกัดทั้งหมดเป็น normalized
 * 0..1 "มิเรอร์แล้ว" (พื้นที่เดียวกับที่วาดบนจอ) ส่วนรัศมี/ระยะ/ความเร็วเป็นสัดส่วนของ "ความสูง" canvas — ระยะแกน x คูณ
 * aspect (กว้าง/สูง) ก่อนเทียบ กันวงกลมกลายเป็นวงรีเมื่อ canvas ไม่ใช่สี่เหลี่ยมจัตุรัส
 *
 * หมายเหตุ: ค่า default ทั้งหมดเป็นค่าประมาณ ยังไม่ได้ calibrate กับผู้ป่วยจริง (เหมือนเกณฑ์ของเกมอื่นในระบบ)
 */

export type FallingCupStatus = 'paused' | 'playing' | 'finished';
/** เหตุที่เกมหยุดอยู่: ไม่พบมือ / มือสูงเกินโซน / มือต่ำเกินโซน */
export type FallingCupPauseReason = 'no-hand' | 'too-high' | 'too-low';
export type HandZone = 'ok' | FallingCupPauseReason;

/** falling = ตกช้าๆ ตามปกติ, held = อยู่ในมือ, dropping = เพิ่งถูกปล่อย (ตกเร็วขึ้น), inCup = ลงถ้วยแล้ว (กำลังจางหาย),
 *  lost = ตกพื้น/ตกนอกถ้วยแล้ว (ตัดสินแล้ว) */
export type FallingObjectState = 'falling' | 'held' | 'dropping' | 'inCup' | 'lost';

/** จำนวนแบบหน้าตาของของ (renderer เลือกสัญลักษณ์ตาม kind) */
export const FALLING_OBJECT_KIND_COUNT = 5;

export interface FallingCupConfig {
  /** จำนวนของทั้งหมดที่จะตกลงมาในเกม */
  totalObjects: number;
  /** เวลาที่รอหลังเกมเริ่มเดินจริงก่อนปล่อยชิ้นแรก (วินาที เวลาที่เกมเดินจริง ไม่นับตอน pause) */
  firstSpawnDelaySec: number;
  /** ระยะเวลาระหว่างการปล่อยของแต่ละชิ้น (วินาที เวลาที่เกมเดินจริง) */
  spawnIntervalSec: number;
  /** ความเร็วตกปกติ (สัดส่วนความสูงจอต่อวินาที — 0.1 = ตกจากบนสุดถึงล่างสุดใน ~10 วินาที) */
  fallSpeed: number;
  /** ความเร็วตกหลังถูกปล่อยจากมือ (สัดส่วนความสูงจอต่อวินาที) เร็วกว่าตกปกติ ให้เห็นว่า "ตกลงไปต่อ" ชัดเจน */
  dropSpeed: number;
  /** รัศมีของ (สัดส่วนความสูงจอ) */
  objectRadius: number;
  /** ระยะสูงสุดจากจุดกึ่งกลางฝ่ามือถึงของที่ยังจับติด (สัดส่วนความสูงจอ) */
  grabRadius: number;
  /** ตำแหน่งแกน x ของถ้วย (normalized) */
  cupX: number;
  /** ความสูงของขอบปากถ้วย (normalized y) — ของที่ตัดผ่านเส้นนี้ขณะอยู่ในปากถ้วยถือว่าลงถ้วย */
  cupRimY: number;
  /** ครึ่งความกว้างปากถ้วย (สัดส่วนความสูงจอ) */
  cupMouthHalfWidth: number;
  /** ขอบบนของโซนมือ (normalized y) */
  bandTop: number;
  /** ขอบล่างของโซนมือ (normalized y) */
  bandBottom: number;
  /** ระยะเวลาที่ใช้ตำแหน่งมือล่าสุดแทน เมื่อการตรวจมือสะดุดชั่วครู่ (ms) */
  lostGraceMs: number;
  /** มือต้องอยู่ในโซนต่อเนื่องนานเท่านี้ (ms) ถึงจะกลับมาเล่นต่อ — กันกระพริบตอนมืออยู่ใกล้ขอบโซน */
  resumeDwellMs: number;
  /** ระยะแกน x ขั้นต่ำ (normalized) ระหว่างจุดที่ของเกิดกับกลางถ้วย — ให้ผู้เล่นต้องเคลื่อนมือไปทางข้างจริงทุกชิ้น */
  minSpawnDistanceFromCup: number;
  /** อัตราส่วนกว้าง/สูงของ canvas */
  aspect: number;
}

export const DEFAULT_FALLING_CUP_CONFIG: FallingCupConfig = {
  totalObjects: 10,
  firstSpawnDelaySec: 0.8,
  spawnIntervalSec: 5,
  fallSpeed: 0.1,
  dropSpeed: 0.3,
  objectRadius: 0.045,
  grabRadius: 0.11,
  cupX: 0.5,
  cupRimY: 0.82,
  cupMouthHalfWidth: 0.15,
  bandTop: 0.25,
  bandBottom: 0.75,
  lostGraceMs: 300,
  resumeDwellMs: 600,
  minSpawnDistanceFromCup: 0.2,
  aspect: 640 / 480,
};

export interface FallingObject {
  id: number;
  x: number;
  y: number;
  kind: number;
  state: FallingObjectState;
  /** เวลาที่เกมเดินจริง (ms) ตอนของชิ้นนี้ปรากฏ */
  spawnedAtActiveMs: number;
  /** เวลา (ms) ที่ผ่านไปตั้งแต่ลงถ้วย ใช้วาดอนิเมชันจางหาย (0 ถ้ายังไม่ลงถ้วย) */
  inCupMs: number;
}

export interface FallingCupObjectResult {
  /** ลำดับของที่ปรากฏ (เริ่ม 1) */
  objectNumber: number;
  caught: boolean;
  /** เวลาเกมเดินจริง (วินาที) จากของปรากฏจนถูกตัดสิน */
  secondsAlive: number;
}

export interface FallingCupSnapshot {
  status: FallingCupStatus;
  /** เหตุที่ pause อยู่ (null ถ้าไม่ได้ pause) */
  pauseReason: FallingCupPauseReason | null;
  /** ความคืบหน้าการกลับเข้าเล่นต่อ 0..1 (มือเข้าโซนแล้วรอครบ resumeDwellMs) */
  resumeProgress: number;
  objects: FallingObject[];
  heldId: number | null;
  /** จำนวนที่ลงถ้วยแล้ว */
  caught: number;
  /** จำนวนที่ตัดสินแล้ว (ลงถ้วย + ตกพื้น) */
  resolved: number;
  /** จำนวนที่ปรากฏแล้ว */
  spawned: number;
  total: number;
  cup: { x: number; rimY: number; mouthHalfWidth: number };
  band: { top: number; bottom: number };
}

export interface FallingCupStats {
  /** จำนวนครั้งที่เกมถูก pause หลังเริ่มเล่นไปแล้ว (ไม่นับการรอมือเข้าโซนตอนเริ่มเกม) */
  pauseCount: number;
  /** เวลารวมที่หยุดอยู่ (ms) หลังเริ่มเล่นไปแล้ว */
  pausedMs: number;
  /** เวลาที่เกมเดินจริง (ms) */
  activeMs: number;
}

export interface FallingCupUpdateInput {
  timestampMs: number;
  /** จุดกึ่งกลางฝ่ามือ normalized มิเรอร์แล้ว (null ถ้าเฟรมนี้ไม่พบมือ) */
  handPos: { x: number; y: number } | null;
  /** สถานะกำ/แบของมือ (ใช้ classifyGripState ด้วยเกณฑ์ที่เข้ากับ openness ที่สอบเทียบแล้ว) */
  gripState: 'open' | 'closed';
}

/** เฟรมที่ห่างกันเกินนี้ (ms) ถือว่าแท็บถูกพักหรือเครื่องค้าง — จำกัด dt ไม่ให้ของวาร์ปข้ามจอ */
const MAX_FRAME_DT_MS = 100;
/** เวลาแสดงอนิเมชันของที่ลงถ้วยก่อนหายไป (ms) */
export const IN_CUP_FADE_MS = 500;

/** จัดโซนของมือเทียบกับโซนมือกลางจอ — ใช้ร่วมกับหน้าจอ (แสดงสถานะก่อนเริ่มเกม) */
export function classifyHandZone(
  handPos: { x: number; y: number } | null,
  cfg: Pick<FallingCupConfig, 'bandTop' | 'bandBottom'>
): HandZone {
  if (!handPos) return 'no-hand';
  if (handPos.y < cfg.bandTop) return 'too-high';
  if (handPos.y > cfg.bandBottom) return 'too-low';
  return 'ok';
}

export class FallingCupGameFSM {
  private readonly cfg: FallingCupConfig;
  private readonly rng: () => number;
  private readonly baseCupMouthHalfWidth: number;

  private status: FallingCupStatus = 'paused';
  private pauseReason: FallingCupPauseReason = 'no-hand';
  /** เคยเริ่มเล่นจริงแล้วหรือยัง (ใช้แยก "รอเริ่มเกม" ออกจาก "pause กลางเกม" ตอนนับสถิติ) */
  private started = false;
  private okDwellMs = 0;

  private lastTs: number | null = null;
  private lastHand: { x: number; y: number } | null = null;
  private lastHandSeenMs: number | null = null;

  private activeMs = 0;
  private pausedMs = 0;
  private pauseCount = 0;

  private objects: FallingObject[] = [];
  private nextId = 1;
  private spawned = 0;
  private nextSpawnAtMs: number;
  private lastSpawnSide = 0;

  private heldId: number | null = null;
  /** แบมืออย่างน้อย 1 เฟรมแล้วนับตั้งแต่จับ/เริ่มเกมครั้งก่อน — กันกำมือค้างแล้วคว้าของทุกชิ้นที่ผ่านมา (ต้องแบแล้วกำใหม่) */
  private armed = false;

  private caught = 0;
  private results: FallingCupObjectResult[] = [];

  constructor(config: Partial<FallingCupConfig> = {}, rng: () => number = Math.random) {
    this.cfg = { ...DEFAULT_FALLING_CUP_CONFIG, ...config };
    this.rng = rng;
    this.baseCupMouthHalfWidth = this.cfg.cupMouthHalfWidth;
    this.nextSpawnAtMs = this.cfg.firstSpawnDelaySec * 1000;
  }

  setAspect(aspect: number): void {
    if (Number.isFinite(aspect) && aspect > 0) {
      this.cfg.aspect = aspect;
    }
  }

  setCupScale(scale: number): void {
    if (Number.isFinite(scale) && scale > 0) {
      this.cfg.cupMouthHalfWidth = this.baseCupMouthHalfWidth * scale;
    }
  }

  get config(): FallingCupConfig {
    return this.cfg;
  }

  /** ป้อน 1 เฟรม — คืนผลของชิ้นที่เพิ่งถูกตัดสินในเฟรมนี้ (ลงถ้วย/ตกพื้น) ว่างถ้าไม่มี */
  update(input: FallingCupUpdateInput): FallingCupObjectResult[] {
    const now = input.timestampMs;
    const dt = this.lastTs === null ? 0 : Math.max(0, Math.min(now - this.lastTs, MAX_FRAME_DT_MS));
    this.lastTs = now;
    if (this.status === 'finished') return [];

    // --- ตำแหน่งมือ (ยอมให้ตรวจไม่เจอได้ชั่วครู่ ใช้ตำแหน่งล่าสุดแทน) ---
    if (input.handPos) {
      this.lastHand = input.handPos;
      this.lastHandSeenMs = now;
    }
    const withinGrace = this.lastHandSeenMs !== null && now - this.lastHandSeenMs <= this.cfg.lostGraceMs;
    const hand = input.handPos ?? (withinGrace ? this.lastHand : null);
    const zone = classifyHandZone(hand, this.cfg);

    // --- pause / resume ---
    if (zone === 'ok') this.okDwellMs += dt;
    else this.okDwellMs = 0;

    if (this.status === 'paused') {
      if (zone !== 'ok') this.pauseReason = zone;
      if (zone === 'ok' && this.okDwellMs >= this.cfg.resumeDwellMs) {
        this.status = 'playing';
        this.started = true;
      }
    }

    if (this.status === 'paused') {
      // เกมหยุดทั้งหมด: ไม่ขยับของ ไม่เดินเวลา ไม่รับสัญญาณกำ/แบ (กันปล่อยของพลาดตอนมือกลับเข้ามา)
      if (this.started) this.pausedMs += dt;
      return [];
    }
    this.activeMs += dt;
    const resolved: FallingCupObjectResult[] = [];

    // --- ปล่อยของชิ้นใหม่ ---
    if (this.spawned < this.cfg.totalObjects && this.activeMs >= this.nextSpawnAtMs) {
      this.spawnObject();
      this.nextSpawnAtMs += this.cfg.spawnIntervalSec * 1000;
    }

    // --- จับ / ปล่อย ---
    if (!hand && this.heldId !== null) {
      const held = this.objects.find((o) => o.id === this.heldId);
      if (held) held.state = 'dropping';
      this.heldId = null;
    } else if (hand) {
      if (input.gripState === 'open') this.armed = true;
      if (this.heldId !== null) {
        const held = this.objects.find((o) => o.id === this.heldId);
        if (!held) {
          this.heldId = null;
        } else if (input.gripState === 'open') {
          held.state = 'dropping'; // ปล่อยแล้วตกลงไปต่อ (ถ้าอยู่เหนือถ้วยจะลงถ้วยเอง ดูด้านล่าง)
          this.heldId = null;
        } else {
          held.x = hand.x;
          held.y = hand.y;
        }
      } else if (this.armed && input.gripState === 'closed' && zone === 'ok') {
        let best: FallingObject | null = null;
        let bestDist = this.cfg.grabRadius;
        for (const o of this.objects) {
          if (o.state !== 'falling' && o.state !== 'dropping') continue;
          const d = this.distance(o.x, o.y, hand.x, hand.y);
          if (d <= bestDist) {
            best = o;
            bestDist = d;
          }
        }
        if (best) {
          best.state = 'held';
          best.x = hand.x;
          best.y = hand.y;
          this.heldId = best.id;
          this.armed = false;
        }
      }
    }

    // --- ขยับของ + ตัดสินผล ---
    for (const o of this.objects) {
      if (o.state === 'inCup') {
        o.inCupMs += dt;
        continue;
      }
      if (o.state !== 'falling' && o.state !== 'dropping') continue;
      const speed = o.state === 'dropping' ? this.cfg.dropSpeed : this.cfg.fallSpeed;
      const prevY = o.y;
      o.y += (speed * dt) / 1000;

      // ตัดผ่านเส้นขอบปากถ้วย: อยู่ในปากถ้วย = ลงถ้วย, อยู่นอก = ผ่านไปเฉยๆ (ไปตกพื้น)
      if (prevY < this.cfg.cupRimY && o.y >= this.cfg.cupRimY) {
        const dxh = Math.abs(o.x - this.cfg.cupX) * this.cfg.aspect;
        if (dxh <= this.cfg.cupMouthHalfWidth) {
          o.state = 'inCup';
          o.inCupMs = 0;
          this.caught += 1;
          resolved.push(this.record(o, true));
          continue;
        }
      }
      if (o.y > 1 + this.cfg.objectRadius) {
        o.state = 'lost';
        resolved.push(this.record(o, false));
      }
    }

    // ลบของที่จางหายหมดแล้วออก (ไม่เก็บค้างให้ลิสต์โตเรื่อยๆ)
    this.objects = this.objects.filter((o) => !(o.state === 'inCup' && o.inCupMs >= IN_CUP_FADE_MS) && o.state !== 'lost');

    // --- จบเกมเมื่อปล่อยครบทุกชิ้นและทุกชิ้นถูกตัดสินแล้ว ---
    if (this.spawned >= this.cfg.totalObjects && this.results.length >= this.cfg.totalObjects) {
      this.status = 'finished';
    }

    return resolved;
  }

  getResults(): FallingCupObjectResult[] {
    return [...this.results];
  }

  getStats(): FallingCupStats {
    return { pauseCount: this.pauseCount, pausedMs: this.pausedMs, activeMs: this.activeMs };
  }

  snapshot(): FallingCupSnapshot {
    return {
      status: this.status,
      pauseReason: this.status === 'paused' ? this.pauseReason : null,
      resumeProgress: this.status === 'paused' ? Math.min(1, this.okDwellMs / this.cfg.resumeDwellMs) : 0,
      objects: this.objects.map((o) => ({ ...o })),
      heldId: this.heldId,
      caught: this.caught,
      resolved: this.results.length,
      spawned: this.spawned,
      total: this.cfg.totalObjects,
      cup: { x: this.cfg.cupX, rimY: this.cfg.cupRimY, mouthHalfWidth: this.cfg.cupMouthHalfWidth },
      band: { top: this.cfg.bandTop, bottom: this.cfg.bandBottom },
    };
  }

  private distance(ax: number, ay: number, bx: number, by: number): number {
    return Math.hypot((ax - bx) * this.cfg.aspect, ay - by);
  }

  private record(o: FallingObject, caught: boolean): FallingCupObjectResult {
    const result: FallingCupObjectResult = {
      objectNumber: o.id,
      caught,
      secondsAlive: Math.round(((this.activeMs - o.spawnedAtActiveMs) / 1000) * 10) / 10,
    };
    this.results.push(result);
    return result;
  }

  private spawnObject(): void {
    const { cupX, minSpawnDistanceFromCup: minDist } = this.cfg;
    const margin = 0.1;
    const leftMax = cupX - minDist;
    const rightMin = cupX + minDist;
    // สลับฝั่งไม่ให้เกิดฝั่งเดิมซ้ำเกิน 2 ชิ้นติด (ให้ผู้เล่นได้เคลื่อนมือทั้งสองข้างพอๆ กัน)
    let side = this.rng() < 0.5 ? -1 : 1;
    if (this.lastSpawnSide !== 0 && this.spawnedSameSideCount >= 2) side = -this.lastSpawnSide;
    this.spawnedSameSideCount = side === this.lastSpawnSide ? this.spawnedSameSideCount + 1 : 1;
    this.lastSpawnSide = side;
    const lo = side < 0 ? margin : rightMin;
    const hi = side < 0 ? leftMax : 1 - margin;
    this.objects.push({
      id: this.nextId++,
      x: lo + this.rng() * Math.max(0, hi - lo),
      y: -this.cfg.objectRadius,
      kind: Math.floor(this.rng() * FALLING_OBJECT_KIND_COUNT) % FALLING_OBJECT_KIND_COUNT,
      state: 'falling',
      spawnedAtActiveMs: this.activeMs,
      inCupMs: 0,
    });
    this.spawned += 1;
  }

  private spawnedSameSideCount = 0;
}
