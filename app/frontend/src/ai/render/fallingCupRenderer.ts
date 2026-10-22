import type { FallingCupSnapshot, FallingObject } from '../evaluators/fallingCupGameFSM';
import { IN_CUP_FADE_MS } from '../evaluators/fallingCupGameFSM';

/** สัญลักษณ์ของแต่ละแบบ (index ตรงกับ FallingObject.kind) และสีพื้นวงกลมหลังสัญลักษณ์ */
const OBJECT_GLYPHS = ['🍎', '🍊', '🍋', '🍇', '🍓'];
const OBJECT_BACKGROUNDS = ['#ff5252', '#ff9800', '#ffeb3b', '#9c27b0', '#ec407a'];
const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

const BAND_OK = 'rgba(0,230,118,0.9)';
const BAND_WARN = 'rgba(255,202,40,0.95)';
const CUP_BODY = 'rgba(41,182,246,0.55)';
const CUP_EDGE = '#ffffff';
const CUP_ACCENT = '#29b6f6';

export interface DrawFallingCupOptions {
  /** โซนมือตอนนี้เป็นสีเตือน (มืออยู่นอกโซน/ไม่พบมือ) แทนสีเขียว */
  bandWarning?: boolean;
  /** เกมถูก pause — หรี่พื้นที่นอกโซนมือลงเพื่อให้เห็นโซนชัด ใช้ตอน pause ระหว่างเล่นเท่านั้น (หน้าตั้งค่าไม่หรี่) */
  dimOutsideBand?: boolean;
  /** วาดเฉพาะถ้วย+โซนมือ ไม่วาดของ (หน้าตั้งค่า/ก่อนเริ่มเกม) */
  hideObjects?: boolean;
}

function drawObject(ctx: CanvasRenderingContext2D, o: FallingObject, held: boolean, width: number, height: number, radius: number) {
  const cx = o.x * width;
  const cy = o.y * height;
  let alpha = 1;
  let scale = 1;
  if (o.state === 'inCup') {
    // ลงถ้วยแล้ว: จมลงในถ้วยเล็กน้อยพร้อมจางหาย
    const t = Math.min(1, o.inCupMs / IN_CUP_FADE_MS);
    alpha = 1 - t;
    scale = 1 - 0.3 * t;
  }
  const r = radius * scale;
  const cyDraw = o.state === 'inCup' ? cy + (o.inCupMs / IN_CUP_FADE_MS) * radius * 1.2 : cy;

  ctx.save();
  ctx.globalAlpha = alpha;
  // ฮาโลขาว + พื้นสี ให้เห็นชัดทุกพื้นหลัง
  ctx.beginPath();
  ctx.arc(cx, cyDraw, r + 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cyDraw, r, 0, Math.PI * 2);
  ctx.fillStyle = OBJECT_BACKGROUNDS[o.kind % OBJECT_BACKGROUNDS.length];
  ctx.fill();
  ctx.font = `${Math.round(r * 1.5)}px ${EMOJI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText(OBJECT_GLYPHS[o.kind % OBJECT_GLYPHS.length], cx, cyDraw + 1);
  if (held) {
    ctx.beginPath();
    ctx.arc(cx, cyDraw, r + 8, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#00e676';
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * วาด 1 เฟรมของเกม "ของตกลงถ้วย" (ai/evaluators/fallingCupGameFSM.ts): โซนมือกลางจอ, ช่องทางปล่อยเหนือถ้วย, ถ้วย, และของ
 * — ไม่ clear canvas/วาดวิดีโอให้ ผู้เรียกเตรียมพื้นหลัง (วิดีโอ + skeleton มือ) ไว้ก่อน พิกัดใน snapshot เป็น normalized
 * 0..1 มิเรอร์แล้ว คูณ width/height ตรงๆ รัศมี/ความกว้างปากถ้วยเป็นสัดส่วนของความสูง
 */
export function drawFallingCupGame(
  ctx: CanvasRenderingContext2D,
  snapshot: FallingCupSnapshot,
  width: number,
  height: number,
  options: DrawFallingCupOptions = {}
): void {
  const { bandWarning = false, dimOutsideBand = false, hideObjects = false } = options;
  const objectRadius = 0.045 * height;
  const bandTopPx = snapshot.band.top * height;
  const bandBottomPx = snapshot.band.bottom * height;
  const cupCx = snapshot.cup.x * width;
  const mouthHalfPx = snapshot.cup.mouthHalfWidth * height;
  const rimYPx = snapshot.cup.rimY * height;

  ctx.save();

  // 1) หรี่นอกโซนมือตอน pause (ให้โซนเด่น) — ไม่ทับในโซน
  if (dimOutsideBand) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, width, bandTopPx);
    ctx.fillRect(0, bandBottomPx, width, height - bandBottomPx);
  }

  // 2) โซนมือ: แถบโปร่งแสง + เส้นประบน/ล่าง + ป้าย
  const bandColor = bandWarning ? BAND_WARN : BAND_OK;
  ctx.fillStyle = bandWarning ? 'rgba(255,202,40,0.10)' : 'rgba(0,230,118,0.08)';
  ctx.fillRect(0, bandTopPx, width, bandBottomPx - bandTopPx);
  ctx.setLineDash([12, 8]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = bandColor;
  ctx.beginPath();
  ctx.moveTo(0, bandTopPx);
  ctx.lineTo(width, bandTopPx);
  ctx.moveTo(0, bandBottomPx);
  ctx.lineTo(width, bandBottomPx);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = `bold 13px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = bandColor;
  ctx.fillText('โซนมือ — ให้มืออยู่ในกรอบนี้', 10, bandTopPx + 6);

  // 3) ช่องทางปล่อยเหนือถ้วย: คอลัมน์โปร่งแสงจากล่างโซนมือถึงปากถ้วย บอกว่าปล่อยตรงไหนจะลงถ้วย
  ctx.fillStyle = 'rgba(41,182,246,0.12)';
  ctx.fillRect(cupCx - mouthHalfPx, bandBottomPx, mouthHalfPx * 2, rimYPx - bandBottomPx);
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(41,182,246,0.8)';
  ctx.beginPath();
  ctx.moveTo(cupCx - mouthHalfPx, bandBottomPx);
  ctx.lineTo(cupCx - mouthHalfPx, rimYPx);
  ctx.moveTo(cupCx + mouthHalfPx, bandBottomPx);
  ctx.lineTo(cupCx + mouthHalfPx, rimYPx);
  ctx.stroke();
  ctx.setLineDash([]);

  // 4) ถ้วย (สี่เหลี่ยมคางหมู ปากกว้าง ก้นแคบ) + จำนวนที่ใส่ได้ตรงกลาง
  const cupHeight = 0.14 * height;
  const bottomHalf = mouthHalfPx * 0.72;
  ctx.beginPath();
  ctx.moveTo(cupCx - mouthHalfPx, rimYPx);
  ctx.lineTo(cupCx + mouthHalfPx, rimYPx);
  ctx.lineTo(cupCx + bottomHalf, rimYPx + cupHeight);
  ctx.lineTo(cupCx - bottomHalf, rimYPx + cupHeight);
  ctx.closePath();
  ctx.fillStyle = CUP_BODY;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = CUP_EDGE;
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = CUP_ACCENT;
  ctx.stroke();
  ctx.font = `bold ${Math.round(cupHeight * 0.5)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(`${snapshot.caught}`, cupCx, rimYPx + cupHeight * 0.55);

  // 5) ของ (ของที่ถือในมือวาดทีหลังสุดให้อยู่ด้านบน)
  if (!hideObjects) {
    for (const o of snapshot.objects) {
      if (o.id === snapshot.heldId) continue;
      drawObject(ctx, o, false, width, height, objectRadius);
    }
    const held = snapshot.objects.find((o) => o.id === snapshot.heldId);
    if (held) drawObject(ctx, held, true, width, height, objectRadius);
  }

  ctx.restore();
}
