import { GamePath, PathGameSnapshot, PathPoint } from '../../types/ai';
import { PATH_CANVAS_HEIGHT, PATH_CANVAS_WIDTH, pointAtLength } from '../pathGame/pathGenerator';
import { PATH_START_RADIUS_PX } from '../evaluators/pathDragFSM';

/**
 * วาดเกม "ลากวัตถุจริงตามเส้นทาง" ทับภาพกล้อง — ผู้เรียกวาดภาพวิดีโอ/skeleton มือเองก่อนแล้วเรียกฟังก์ชันนี้ทีหลัง
 * พิกัดเส้นทาง/จุดถือวัตถุเป็นพิกเซล canvas (มิเรอร์แล้ว) พื้นที่ 640x480 ตามที่ pathGenerator ใช้ ถ้า canvas จริงมีขนาดต่าง
 * จะ scale ให้อัตโนมัติ ตัวหนังสือวาดแบบไม่มิเรอร์ (ผู้เรียก restore transform ภาพวิดีโอไปแล้ว)
 */

const COLOR_CORRIDOR_BORDER = 'rgba(255,255,255,0.55)';
const COLOR_CORRIDOR_FILL = 'rgba(21,101,192,0.38)';
const COLOR_CENTERLINE = 'rgba(255,255,255,0.7)';
const COLOR_PROGRESS = '#00e676';
const COLOR_START = '#00e676';
const COLOR_END = '#ffca28';
const COLOR_ON_PATH = '#00e676';
const COLOR_OFF_PATH = '#ff7043';

function tracePolyline(ctx: CanvasRenderingContext2D, points: PathPoint[], upToIndex = points.length - 1): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i <= upToIndex; i++) ctx.lineTo(points[i].x, points[i].y);
}

/** วาดทางเดิน (เส้น + ขอบ) อย่างเดียว ใช้ทั้งตอนเล่นและตอนพรีวิวในหน้าตั้งค่า */
export function drawPathCorridor(ctx: CanvasRenderingContext2D, path: GamePath, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  tracePolyline(ctx, path.points);
  ctx.strokeStyle = COLOR_CORRIDOR_BORDER;
  ctx.lineWidth = path.halfWidth * 2 + 4;
  ctx.stroke();

  tracePolyline(ctx, path.points);
  ctx.strokeStyle = COLOR_CORRIDOR_FILL;
  ctx.lineWidth = path.halfWidth * 2;
  ctx.stroke();

  tracePolyline(ctx, path.points);
  ctx.strokeStyle = COLOR_CENTERLINE;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.stroke();
  ctx.setLineDash([]);

  // ลูกศรบอกทิศทางทุก ~90px ตามเส้น
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  for (let s = 70; s < path.totalLength - 40; s += 90) {
    const p = pointAtLength(path, s);
    const q = pointAtLength(path, s + 6);
    const angle = Math.atan2(q.y - p.y, q.x - p.x);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, -6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawEndpoint(
  ctx: CanvasRenderingContext2D,
  p: PathPoint,
  radius: number,
  color: string,
  label: string,
  pulse: number
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius + pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 3;
  ctx.strokeText(label, p.x, p.y);
  ctx.fillText(label, p.x, p.y);
  ctx.restore();
}

function drawBanner(ctx: CanvasRenderingContext2D, lines: string[], color: string): void {
  ctx.save();
  const w = 400;
  const h = 26 + lines.length * 24;
  const x = (PATH_CANVAS_WIDTH - w) / 2;
  const y = PATH_CANVAS_HEIGHT - h - 14;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    ctx.font = i === 0 ? 'bold 16px sans-serif' : '13px sans-serif';
    ctx.fillStyle = i === 0 ? color : '#fff';
    ctx.fillText(line, PATH_CANVAS_WIDTH / 2, y + 22 + i * 24);
  });
  ctx.restore();
}

export interface DrawPathGameOptions {
  /** ตำแหน่งจุดถือวัตถุ (พิกเซล canvas มิเรอร์แล้ว) ที่จะวาด marker — null ถ้าไม่ต้องวาด */
  gripPoint: PathPoint | null;
  /** เวลาปัจจุบัน ms ใช้ทำแอนิเมชันกะพริบจุดเริ่ม */
  nowMs: number;
}

/** วาดเกมทั้งหมดตามสถานะ snapshot (ทาง ความคืบหน้า จุดเริ่ม/จบ แถบเวลา marker จุดถือ และแบนเนอร์สถานะ) */
export function drawPathGame(
  ctx: CanvasRenderingContext2D,
  snapshot: PathGameSnapshot,
  options: DrawPathGameOptions
): void {
  const path = snapshot.path;
  if (!path) return;
  const canvas = ctx.canvas;

  ctx.save();
  ctx.scale(canvas.width / PATH_CANVAS_WIDTH, canvas.height / PATH_CANVAS_HEIGHT);

  const roundOver = snapshot.phase === 'roundEnd' || snapshot.phase === 'gameOver';
  drawPathCorridor(ctx, path, roundOver ? 0.5 : 1);

  // ส่วนที่ลากผ่านแล้ว
  if (snapshot.progressLength > 1) {
    let upTo = 0;
    while (upTo < path.cumulative.length - 1 && path.cumulative[upTo + 1] <= snapshot.progressLength) upTo++;
    const head = pointAtLength(path, snapshot.progressLength);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    tracePolyline(ctx, path.points, upTo);
    ctx.lineTo(head.x, head.y);
    ctx.strokeStyle = COLOR_PROGRESS;
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.restore();
  }

  const pulse = snapshot.phase === 'ready' ? 4 + 4 * Math.sin(options.nowMs / 220) : 0;
  const start = path.points[0];
  const end = path.points[path.points.length - 1];
  drawEndpoint(ctx, start, PATH_START_RADIUS_PX, COLOR_START, 'เริ่ม', pulse);
  drawEndpoint(ctx, end, PATH_START_RADIUS_PX * 0.8, COLOR_END, 'จบ', 0);

  // marker จุดถือวัตถุ
  if (options.gripPoint && snapshot.holding) {
    const color = snapshot.onPath === false ? COLOR_OFF_PATH : COLOR_ON_PATH;
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(options.gripPoint.x, options.gripPoint.y, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  // HUD บน: รอบ + แถบเวลา (แสดงแถบเวลาเมื่อเริ่มจับเวลาแล้ว)
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, PATH_CANVAS_WIDTH, 34);
  ctx.font = 'bold 15px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(`รอบ ${snapshot.roundNumber}/${snapshot.totalRounds}`, 12, 17);
  ctx.textAlign = 'right';
  ctx.fillText(
    snapshot.phase === 'dragging' ? `เหลือ ${Math.ceil(snapshot.timeRemainingSec)} วิ` : `เวลา ${snapshot.timeLimitSec} วิ`,
    PATH_CANVAS_WIDTH - 12,
    17
  );
  const barX = 110;
  const barW = PATH_CANVAS_WIDTH - 110 - 120;
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fillRect(barX, 12, barW, 10);
  const ratio = snapshot.phase === 'dragging' ? snapshot.timeRemainingRatio : 1;
  ctx.fillStyle = ratio > 0.5 ? '#00e676' : ratio > 0.2 ? '#ffca28' : '#ff5252';
  ctx.fillRect(barX, 12, barW * Math.max(0, Math.min(1, ratio)), 10);
  ctx.restore();

  // แบนเนอร์สถานะ
  if (snapshot.phase === 'ready') {
    drawBanner(
      ctx,
      ['นำวัตถุที่ถืออยู่ไปวางที่วง "เริ่ม" ค้างไว้', 'แล้วเวลาจะเริ่มนับ — ถือวัตถุไว้แล้วลากตามทางสีฟ้า'],
      COLOR_START
    );
  } else if (snapshot.phase === 'dragging' && !snapshot.holding) {
    drawBanner(ctx, ['วัตถุหลุดจากมือ', 'หยิบวัตถุกลับขึ้นมา (กำมือที่วัตถุ) แล้วลากต่อได้เลย'], COLOR_OFF_PATH);
  } else if (roundOver && snapshot.lastResult) {
    const r = snapshot.lastResult;
    drawBanner(
      ctx,
      [
        r.skipped ? 'ข้ามรอบนี้' : r.completed ? 'ถึงปลายทางแล้ว!' : 'หมดเวลา',
        r.accuracyMeasured ? `ความแม่นยำของมือ ${r.accuracyScore}` : 'ยังไม่ได้ลากในรอบนี้',
      ],
      r.completed ? COLOR_START : COLOR_END
    );
  }

  ctx.restore();
}
