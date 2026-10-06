// Canvas renderer for the virtual-grip ball game (ballGripFSM.ts). Draws the
// target ring, the round countdown ring and the ball on the shared overlay
// canvas, after the hand skeleton. Snapshot coordinates are already mirrored
// normalized video space, so they are multiplied by width/height directly.
//
// Colours are chosen to stay visible on any room background: a thick white halo
// plus a saturated dashed accent ring plus a faint fill (a thin white line alone
// disappears on bright backgrounds).

import type { BallGripSnapshot } from "./ballGripFSM";

const TARGET_ACCENT = "#ff2d9e";
const TARGET_HALO = "rgba(255,255,255,0.95)";
const TARGET_FILL_IDLE = "rgba(255,45,158,0.14)";
const TARGET_FILL_ARMED = "rgba(0,230,118,0.18)";

function timerColor(ratio: number): string {
  if (ratio > 0.5) return "#00e676";
  if (ratio > 0.25) return "#ffca28";
  return "#ff5252";
}

export function drawBallGrip(
  ctx: CanvasRenderingContext2D,
  snapshot: BallGripSnapshot,
  width: number,
  height: number
): void {
  const bx = snapshot.ball.x * width;
  const by = snapshot.ball.y * height;
  const ballRadius = 0.045 * height;
  const tx = snapshot.target.x * width;
  const ty = snapshot.target.y * height;
  const tr = snapshot.target.radius * height;
  const timeRemaining = snapshot.timeRemainingRatio;

  ctx.save();

  ctx.beginPath();
  ctx.arc(tx, ty, tr, 0, 2 * Math.PI);
  ctx.fillStyle = timeRemaining <= 0.25 ? TARGET_FILL_ARMED : TARGET_FILL_IDLE;
  ctx.fill();

  ctx.lineWidth = 6;
  ctx.strokeStyle = TARGET_HALO;
  ctx.beginPath();
  ctx.arc(tx, ty, tr, 0, 2 * Math.PI);
  ctx.stroke();

  ctx.setLineDash([9, 7]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = TARGET_ACCENT;
  ctx.beginPath();
  ctx.arc(tx, ty, tr, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.setLineDash([]);

  const crossLen = Math.min(10, tr * 0.25);
  ctx.lineWidth = 2;
  ctx.strokeStyle = TARGET_HALO;
  ctx.beginPath();
  ctx.moveTo(tx - crossLen, ty);
  ctx.lineTo(tx + crossLen, ty);
  ctx.moveTo(tx, ty - crossLen);
  ctx.lineTo(tx, ty + crossLen);
  ctx.stroke();

  // Round countdown ring, separate from the target outline.
  const timerRadius = tr + 10;
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.beginPath();
  ctx.arc(tx, ty, timerRadius, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.strokeStyle = timerColor(timeRemaining);
  ctx.beginPath();
  ctx.arc(tx, ty, timerRadius, -Math.PI / 2, -Math.PI / 2 + timeRemaining * 2 * Math.PI);
  ctx.stroke();

  // Ball: grey while seeking, blue while carried.
  let fill = "rgba(120,120,120,0.85)";
  let stroke = "#9e9e9e";
  if (snapshot.phase === "dragging") {
    fill = "rgba(41,182,246,0.9)";
    stroke = "#29b6f6";
  }
  ctx.beginPath();
  ctx.arc(bx, by, ballRadius + 3, 0, 2 * Math.PI);
  ctx.strokeStyle = TARGET_HALO;
  ctx.lineWidth = 3;
  ctx.stroke();

  if (snapshot.phase === "dragging") {
    ctx.shadowColor = stroke;
    ctx.shadowBlur = 16;
  }
  ctx.beginPath();
  ctx.arc(bx, by, ballRadius, 0, 2 * Math.PI);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();

  ctx.restore();
}
