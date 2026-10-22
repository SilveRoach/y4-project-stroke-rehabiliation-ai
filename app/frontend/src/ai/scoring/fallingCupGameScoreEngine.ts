import type { FallingCupObjectResult, FallingCupStats } from '../evaluators/fallingCupGameFSM';

export interface FallingCupGameSummary {
  /** จำนวนของทั้งหมดที่ตั้งไว้ตอนเริ่มเกม */
  totalObjects: number;
  /** จำนวนที่ลงถ้วย = คะแนนรวม (1 ชิ้น = 1 แต้ม) */
  caught: number;
  /** จำนวนที่ปล่อยแล้วแต่ไม่ลงถ้วย (ตกพื้น/ตกนอกถ้วย) */
  missed: number;
  /** จำนวนที่ยังไม่ทันปรากฏหรือยังไม่ถูกตัดสินตอนหยุดเกมกลางคัน — นับเป็นไม่ได้คะแนน */
  unplayed: number;
  /** คะแนนเป็นเปอร์เซ็นต์ = ที่ลงถ้วย / ทั้งหมด (0-100) */
  gameScore: number;
  /** เวลาเฉลี่ย (วินาที) จากของปรากฏจนลงถ้วย เฉพาะชิ้นที่ลงถ้วย — null ถ้ายังไม่มีชิ้นใดลงถ้วย
   *  (นับเวลาที่เกมเดินจริง ไม่รวมช่วง pause และรวมเวลาที่ของตกลงมาถึงมือด้วย จึงไม่ใช่เวลาตอบสนองล้วนๆ) */
  avgSecondsToCup: number | null;
  /** จำนวนครั้งที่เกมถูก pause กลางเกมเพราะมือหลุดจอ/อยู่นอกโซน */
  pauseCount: number;
  /** เวลารวมที่เกมหยุดอยู่กลางเกม (วินาที) */
  pausedSeconds: number;
  stoppedEarly: boolean;
  objects: FallingCupObjectResult[];
  feedbackText: string;
}

/** คะแนนเกมของตกลงถ้วย: จำนวนชิ้นที่ลงถ้วย ÷ จำนวนชิ้นทั้งหมดที่ตั้งไว้ (ชิ้นที่ไม่ทันเล่นไม่ได้คะแนน) */
export function computeFallingCupGameSummary(
  results: FallingCupObjectResult[],
  totalObjects: number,
  stats: FallingCupStats,
  stoppedEarly = false
): FallingCupGameSummary {
  const total = Math.max(1, totalObjects);
  const played = results.slice(0, total);
  const caughtList = played.filter((r) => r.caught);
  const caught = caughtList.length;
  const missed = played.length - caught;
  const unplayed = total - played.length;
  const gameScore = Math.round((caught / total) * 100);
  const avgSecondsToCup =
    caught > 0 ? Math.round((caughtList.reduce((s, r) => s + r.secondsAlive, 0) / caught) * 10) / 10 : null;

  let feedbackText: string;
  if (caught === 0) {
    feedbackText = 'ยังไม่มีชิ้นไหนลงถ้วย ลองกำมือจับของแล้วเลื่อนไปเหนือถ้วยก่อนแบมือปล่อย ทำช้าๆ ได้ ของตกช้าอยู่แล้ว';
  } else if (caught === total) {
    feedbackText = 'ใส่ถ้วยได้ครบทุกชิ้น ยอดเยี่ยม!';
  } else {
    feedbackText = `ใส่ถ้วยได้ ${caught} จาก ${total} ชิ้น${
      missed > 0 ? ` — ${missed} ชิ้นปล่อยแล้วไม่ลงถ้วย ลองเล็งให้มืออยู่เหนือปากถ้วยก่อนแบมือ` : ''
    }${unplayed > 0 ? ` — อีก ${unplayed} ชิ้นไม่ทันได้เล่น` : ''}`;
  }

  return {
    totalObjects: total,
    caught,
    missed,
    unplayed,
    gameScore,
    avgSecondsToCup,
    pauseCount: stats.pauseCount,
    pausedSeconds: Math.round((stats.pausedMs / 1000) * 10) / 10,
    stoppedEarly,
    objects: played,
    feedbackText,
  };
}
