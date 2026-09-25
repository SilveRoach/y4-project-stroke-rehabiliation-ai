// Virtual-grip minigame canvas renderer — draws the draggable ball, the
// target ring, and the hold-progress arc on the same overlay canvas the hand
// skeleton uses. Coordinates are normalized video space (the same space the
// hand landmarks and the minigame logic use); mirroring matches
// drawHandSkeleton's mirror=true so the ball sits under the hand the patient
// actually sees. Styling follows the app's overlay language (blue hand /
// green success from styles.css conventions).

import type { GripMinigame } from "./gripMinigame";

function toCanvasX(x: number, width: number, mirror: boolean): number {
  return (mirror ? 1 - x : x) * width;
}

/**
 * Draws one frame of the grip minigame. Does not clear the canvas — the
 * caller prepares it (the session loop clears + draws skeletons first).
 */
export function drawGripMinigame(
  ctx: CanvasRenderingContext2D,
  game: GripMinigame,
  width: number,
  height: number,
  mirror = true
): void {
  const s = game.snapshot();
  const bx = toCanvasX(s.ball.x, width, mirror);
  const by = s.ball.y * height;
  const br = s.ball.r * height;
  const tx = toCanvasX(s.target.x, width, mirror);
  const ty = s.target.y * height;
  const tr = s.target.r * height;

  ctx.save();
  ctx.lineWidth = 4;

  // Target zone: dashed ring; while holding, a solid arc fills clockwise with
  // hold progress and the ring turns green.
  ctx.setLineDash([10, 9]);
  ctx.strokeStyle = s.holdProgress > 0 ? "#22c55e" : "rgba(255, 255, 255, 0.55)";
  ctx.beginPath();
  ctx.arc(tx, ty, tr, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.setLineDash([]);
  if (s.holdProgress > 0) {
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 7;
    ctx.beginPath();
    // Progress from the top, clockwise — reads like a countdown ring.
    ctx.arc(tx, ty, tr, -Math.PI / 2, -Math.PI / 2 + s.holdProgress * 2 * Math.PI);
    ctx.stroke();
    ctx.lineWidth = 4;
  }

  // Ball — color by state: neutral while idle, amber outline pulse on hover,
  // solid blue while grabbed (matches the hand-skeleton blue), green flash on
  // a scored rep.
  let fill = "rgba(55, 71, 79, 0.75)";
  let stroke = "#90a4ae";
  if (s.state === "hover") {
    stroke = "#ffca28";
    fill = "rgba(69, 90, 100, 0.8)";
  } else if (s.state === "grabbed") {
    fill = "rgba(41, 182, 246, 0.85)";
    stroke = "#29b6f6";
  } else if (s.state === "success") {
    fill = "rgba(34, 197, 94, 0.85)";
    stroke = "#22c55e";
  }

  // Soft glow while the ball is interactive (hover/grabbed/success).
  if (s.state !== "seeking" && s.state !== "released") {
    ctx.shadowColor = stroke;
    ctx.shadowBlur = 18;
  }
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, 2 * Math.PI);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = stroke;
  ctx.stroke();

  // Grip meter on the ball while hovering — openness 0..1 as a small arc, so
  // the patient sees how close they are to a confirmed grab.
  if (s.state === "hover") {
    ctx.strokeStyle = "#ffca28";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(bx, by, br + 10, -Math.PI / 2, -Math.PI / 2 + s.openness * 2 * Math.PI);
    ctx.stroke();
    ctx.lineWidth = 4;
  }

  // Grab hint cross-hair on the ball while seeking with a hand present.
  if (s.state === "seeking" && s.handPresent) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.beginPath();
    ctx.moveTo(bx - br * 0.4, by);
    ctx.lineTo(bx + br * 0.4, by);
    ctx.moveTo(bx, by - br * 0.4);
    ctx.lineTo(bx, by + br * 0.4);
    ctx.stroke();
  }

  ctx.restore();
}
