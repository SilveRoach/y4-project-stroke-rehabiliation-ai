import { GamePath, PathGameSnapshot, PathPoint } from '../../types/ai';
import { PATH_CANVAS_HEIGHT, PATH_CANVAS_WIDTH, pointAtLength } from '../pathGame/pathGenerator';
import { PATH_START_RADIUS_PX } from '../evaluators/pathDragFSM';
import type { PathGameViewport } from '../pathGame/pathGameViewport';

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

export interface DrawPathGameOptions {
  /** ตำแหน่งจุดถือวัตถุ (พิกเซล canvas มิเรอร์แล้ว) ที่จะวาด marker — null ถ้าไม่ต้องวาด */
  gripPoint: PathPoint | null;
  /** เวลาปัจจุบัน ms ใช้ทำแอนิเมชันกะพริบจุดเริ่ม */
  nowMs: number;
  /** 4:3 game board fitted inside the camera's visible object-fit: cover area. */
  viewport?: PathGameViewport;
}

/** วาดเฉพาะองค์ประกอบเกมที่ต้องซ้อนบนภาพกล้อง; HUD แสดงผลด้วย React */
export function drawPathGame(
  ctx: CanvasRenderingContext2D,
  snapshot: PathGameSnapshot,
  options: DrawPathGameOptions
): void {
  const path = snapshot.path;
  if (!path) return;
  const canvas = ctx.canvas;

  ctx.save();
  if (options.viewport) {
    ctx.translate(options.viewport.left, options.viewport.top);
    ctx.scale(options.viewport.scale, options.viewport.scale);
  } else {
    ctx.scale(canvas.width / PATH_CANVAS_WIDTH, canvas.height / PATH_CANVAS_HEIGHT);
  }

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

  ctx.restore();
}
