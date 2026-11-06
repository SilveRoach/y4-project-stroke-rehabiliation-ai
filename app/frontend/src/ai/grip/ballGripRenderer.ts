// Draws the basketball hoop target, green round timer, and colored ball on the
// shared overlay canvas after the hand skeleton. Snapshot coordinates are
// mirrored normalized video space and scale directly to the canvas dimensions.

import type { BallGripSnapshot } from "./ballGripFSM";
import hoopImageUrl from "../../assets/Glossy Basketball Hoop Rim and Net.png";

let hoopImage: HTMLImageElement | null = null;

function getHoopImage(): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
  if (!hoopImage) {
    hoopImage = new Image();
    hoopImage.src = hoopImageUrl;
  }
  return hoopImage;
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

  const hoop = getHoopImage();
  if (hoop?.complete && hoop.naturalWidth > 0) {
    const hoopSize = tr * 2.2;
    ctx.drawImage(hoop, tx - hoopSize / 2, ty - hoopSize / 2, hoopSize, hoopSize);
  } else {
    ctx.beginPath();
    ctx.ellipse(tx, ty, tr * 0.82, tr * 0.32, 0, 0, 2 * Math.PI);
    ctx.lineWidth = Math.max(5, tr * 0.12);
    ctx.strokeStyle = "#ff7020";
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tx - tr * 0.72, ty + tr * 0.12);
    ctx.lineTo(tx - tr * 0.42, ty + tr);
    ctx.lineTo(tx, ty + tr * 0.72);
    ctx.lineTo(tx + tr * 0.42, ty + tr);
    ctx.lineTo(tx + tr * 0.72, ty + tr * 0.12);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Round countdown ring, separate from the target outline.
  const timerRadius = tr * 1.18;
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.beginPath();
  ctx.arc(tx, ty, timerRadius, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.strokeStyle = "#00e676";
  ctx.beginPath();
  ctx.arc(tx, ty, timerRadius, -Math.PI / 2, -Math.PI / 2 + timeRemaining * 2 * Math.PI);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(bx, by, ballRadius + 3, 0, 2 * Math.PI);
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 3;
  ctx.stroke();

  if (snapshot.phase === "dragging") {
    ctx.shadowColor = snapshot.ballColor;
    ctx.shadowBlur = 16;
  }
  ctx.beginPath();
  ctx.arc(bx, by, ballRadius, 0, 2 * Math.PI);
  const ballGradient = ctx.createRadialGradient(
    bx - ballRadius * 0.35,
    by - ballRadius * 0.4,
    ballRadius * 0.08,
    bx,
    by,
    ballRadius
  );
  ballGradient.addColorStop(0, "#ffffff");
  ballGradient.addColorStop(0.16, snapshot.ballColor);
  ballGradient.addColorStop(1, "#38231d");
  ctx.fillStyle = ballGradient;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = snapshot.ballColor;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(bx, by, ballRadius * 0.72, -Math.PI * 0.8, Math.PI * 0.8);
  ctx.strokeStyle = "rgba(42,25,18,0.75)";
  ctx.lineWidth = Math.max(1.5, ballRadius * 0.07);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(bx, by, ballRadius * 0.72, Math.PI * 0.2, Math.PI * 1.8);
  ctx.stroke();

  ctx.restore();
}
