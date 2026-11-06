// Virtual-grip "ball game" — pure state machine, canvas agnostic (drawing lives
// in ballGripRenderer.ts, scoring in ballGripScoring.ts).
//
// Ported from the AI team's VirtualBallGripFSM (Folder/Code ai/evaluators/
// virtualBallGripFSM.ts) and replaces the previous drag-and-hold minigame.
// Point-based timed rounds, in the style of the Box and Block Test: each round
// the ball and a target ring spawn and a round clock starts immediately. The
// patient closes the hand over the ball, drags it over the ring and OPENS the
// hand to release it there — released inside the ring = 1 point, released
// outside / timed out / hand lost = 0 points. The next round starts at once.
//
// Differences from the original, made to fit this app:
//   - Coordinates are MIRRORED normalized video space (x' = 1 - x), the space
//     the overlay canvas is drawn in. Spawns are confined to the VISIBLE
//     sub-frame (see setViewport) because the overlay uses object-fit: cover and
//     can crop the video on aspect-mismatched screens.
//   - Hit-tests are done in units of frame HEIGHT (x scaled by the video
//     aspect) so the drawn circles and the grab/drop regions match exactly
//     instead of becoming ellipses on wide frames.

import { computeBallGripRepScore, type BallGripRepReason, type BallGripRepResult } from "./ballGripScoring";

export type GripState = "open" | "closed";

export interface BallGripFsmConfig {
  /** Seconds per round, counted from the moment the ball/target appear. */
  roundTimeLimitSeconds: number;
  /** How close (frame-height units) the palm must be to the ball to grab it. */
  grabRadius: number;
  /** Target ring radius (frame-height units). */
  targetRadius: number;
  /** Seconds the hand may vanish from tracking mid-drag before the round is lost. */
  trackingLossGraceSeconds: number;
}

export const DEFAULT_BALL_GRIP_CONFIG: BallGripFsmConfig = {
  roundTimeLimitSeconds: 8,
  grabRadius: 0.1,
  targetRadius: 0.11,
  trackingLossGraceSeconds: 0.4
};

export interface BallGripSnapshot {
  /** Mirrored normalized video coordinates (multiply by canvas width/height). */
  ball: { x: number; y: number };
  ballColor: string;
  target: { x: number; y: number; radius: number };
  phase: "seeking" | "dragging";
  /** 1 = round just started, 0 = out of time. */
  timeRemainingRatio: number;
}

export interface BallGripUpdateInput {
  timestampMs: number;
  /** Palm center in mirrored normalized video space; null when no hand tracked. */
  handPos: { x: number; y: number } | null;
  gripState: GripState;
  /** Raw continuous openness 0..1 (before hysteresis) — backup release signal. */
  openness: number;
}

export interface BallGripVisibleFrame {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Minimum ball↔target spawn separation (frame-height units) so every round has
// a real drag distance to measure.
const MIN_BALL_TARGET_DISTANCE = 0.3;
// Keep spawns away from the edge of the visible frame (fraction of its size).
const SPAWN_MARGIN = 0.15;
// Below this drag length the path-efficiency ratio is meaningless noise.
const MIN_PATH_RATIO_EPSILON = 0.005;
// Backup "hand opened" signal: the classifier's absolute OPEN threshold is
// uncalibrated, so also accept openness rising this much above its value at
// grab time (a relaxed open hand may never reach the absolute threshold).
const RELEASE_OPENNESS_DELTA = 0.12;

type Phase = "seeking" | "dragging";
type Point = { x: number; y: number };

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

const BALL_COLORS = ["#ff7043", "#42a5f5", "#ab47bc", "#26a69a", "#ffca28", "#ec407a"];

function randomBallColor(): string {
  return BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)];
}

export class VirtualBallGripFSM {
  private phase: Phase = "seeking";
  private repCounter = 0;
  private ball: Point;
  private ballColor = randomBallColor();
  private target: Point;

  private frame: BallGripVisibleFrame = { x0: 0, y0: 0, x1: 1, y1: 1 };
  private videoAspect = 16 / 9;

  // null until the first update() — the first round's clock starts from the
  // first frame actually processed, not from construction time.
  private roundStartMs: number | null = null;
  private timeRemainingRatio = 1;

  private dragStartHandPos: Point | null = null;
  private dragLastHandPos: Point | null = null;
  private dragPath = 0;
  private grabOpenness = 0;
  private lastHandSeenMs: number | null = null;

  constructor(private config: BallGripFsmConfig = DEFAULT_BALL_GRIP_CONFIG) {
    this.ball = this.spawnPoint();
    this.target = this.spawnTargetAwayFrom(this.ball);
  }

  get repsCompleted(): number {
    return this.repCounter;
  }

  /**
   * Sets the visible sub-frame (mirrored normalized video space) and the video
   * aspect ratio. Called every detect tick; cheap while unchanged. The current
   * ball/target are clamped into a changed frame so a resize mid-round can't
   * strand them off-screen.
   */
  setViewport(frame: BallGripVisibleFrame, videoAspect: number): void {
    if (videoAspect > 0) this.videoAspect = videoAspect;
    const unchanged =
      Math.abs(frame.x0 - this.frame.x0) < 1e-4 &&
      Math.abs(frame.y0 - this.frame.y0) < 1e-4 &&
      Math.abs(frame.x1 - this.frame.x1) < 1e-4 &&
      Math.abs(frame.y1 - this.frame.y1) < 1e-4;
    if (unchanged) return;
    this.frame = frame;
    this.ball = this.clampToFrame(this.ball);
    this.target = this.clampToFrame(this.target);
  }

  /** Back to round 1 with fresh spawns (new session / restart). */
  reset(): void {
    this.phase = "seeking";
    this.repCounter = 0;
    this.roundStartMs = null;
    this.timeRemainingRatio = 1;
    this.clearDrag();
    this.ball = this.spawnPoint();
    this.ballColor = randomBallColor();
    this.target = this.spawnTargetAwayFrom(this.ball);
  }

  /**
   * Restarts the CURRENT round's clock without scoring it (keeps the same
   * ball/target). Used after a pause/resume gap so paused time is not charged
   * to the round; any in-progress drag is dropped.
   */
  restartRound(): void {
    this.phase = "seeking";
    this.roundStartMs = null;
    this.timeRemainingRatio = 1;
    this.clearDrag();
  }

  /** Sets the per-round time limit (takes effect from the next round start). */
  setRoundTimeLimit(seconds: number): void {
    this.config = { ...this.config, roundTimeLimitSeconds: Math.max(1, seconds) };
  }

  snapshot(): BallGripSnapshot {
    return {
      ball: this.ball,
      ballColor: this.ballColor,
      target: { ...this.target, radius: this.config.targetRadius },
      phase: this.phase,
      timeRemainingRatio: this.timeRemainingRatio
    };
  }

  /** Short Thai status line for the session overlay caption. */
  statusText(handPresent: boolean): string {
    if (this.phase === "dragging") return "ลากลูกบอลไปที่วงกลม แล้วแบมือปล่อย";
    return handPresent ? "กำมือเพื่อจับลูกบอล" : "ยกมือให้กล้องมองเห็น";
  }

  /**
   * Advance one hand-detect frame. Returns the finished round's result when a
   * round ended on this frame (success / missed / timeout / lost tracking),
   * otherwise null.
   */
  update(input: BallGripUpdateInput): BallGripRepResult | null {
    const { timestampMs, handPos, gripState, openness } = input;

    if (this.roundStartMs === null) this.roundStartMs = timestampMs;
    const elapsedSeconds = (timestampMs - this.roundStartMs) / 1000;
    this.timeRemainingRatio = Math.max(0, 1 - elapsedSeconds / this.config.roundTimeLimitSeconds);

    if (elapsedSeconds >= this.config.roundTimeLimitSeconds) {
      return this.finishRep(timestampMs, false, "timeout");
    }

    if (handPos) this.lastHandSeenMs = timestampMs;

    if (this.phase === "seeking") {
      if (!handPos) return null;
      if (this.dist(handPos, this.ball) <= this.config.grabRadius && gripState === "closed") {
        this.phase = "dragging";
        this.dragStartHandPos = handPos;
        this.dragLastHandPos = handPos;
        this.dragPath = 0;
        this.grabOpenness = openness;
      }
      return null;
    }

    // phase === "dragging"
    if (!handPos) {
      // Tracking dropout mid-drag: wait up to the grace period with the ball
      // frozen where it is. The round clock keeps running (no free time).
      const graceMs = this.config.trackingLossGraceSeconds * 1000;
      const sinceSeenMs = this.lastHandSeenMs === null ? Infinity : timestampMs - this.lastHandSeenMs;
      if (sinceSeenMs <= graceMs) return null;
      return this.finishRep(timestampMs, false, "lost_tracking");
    }

    if (this.dragLastHandPos) this.dragPath += this.dist(handPos, this.dragLastHandPos);
    this.dragLastHandPos = handPos;
    this.ball = this.clampToFrame(handPos); // ball sticks to the palm while dragging

    const releasedByState = gripState !== "closed";
    const releasedByDelta = openness - this.grabOpenness >= RELEASE_OPENNESS_DELTA;
    if (releasedByState || releasedByDelta) {
      // Opening the hand = "place the ball here" — judged on this frame only
      // (dragging across the ring without releasing does not count).
      const success = this.dist(handPos, this.target) <= this.config.targetRadius;
      return this.finishRep(timestampMs, success, success ? "success" : "missed");
    }

    return null;
  }

  private finishRep(timestampMs: number, success: boolean, reason: BallGripRepReason): BallGripRepResult {
    this.repCounter += 1;

    const straightLineDist =
      this.dragStartHandPos && this.dragLastHandPos ? this.dist(this.dragStartHandPos, this.dragLastHandPos) : 0;
    const dragPathEfficiency =
      this.dragPath > MIN_PATH_RATIO_EPSILON ? Math.max(0, Math.min(1, straightLineDist / this.dragPath)) : 1;

    // Only meaningful once the ball was actually grabbed (otherwise it still
    // sits at its spawn point) — null rather than a misleading 0.
    const targetAccuracy =
      this.phase === "dragging"
        ? Math.max(0, Math.min(1, 1 - this.dist(this.ball, this.target) / this.config.targetRadius))
        : null;

    const timeTakenSeconds = Math.min(
      this.config.roundTimeLimitSeconds,
      this.roundStartMs !== null ? (timestampMs - this.roundStartMs) / 1000 : 0
    );

    const result = computeBallGripRepScore(
      this.repCounter,
      success,
      reason,
      timeTakenSeconds,
      this.config.roundTimeLimitSeconds,
      dragPathEfficiency,
      targetAccuracy
    );

    // Next round: new spawns, clock restarts on the next frame.
    this.ball = this.spawnPoint();
    this.ballColor = randomBallColor();
    this.target = this.spawnTargetAwayFrom(this.ball);
    this.phase = "seeking";
    this.roundStartMs = null;
    this.timeRemainingRatio = 1;
    this.clearDrag();

    return result;
  }

  private clearDrag(): void {
    this.dragStartHandPos = null;
    this.dragLastHandPos = null;
    this.dragPath = 0;
    this.grabOpenness = 0;
    this.lastHandSeenMs = null;
  }

  /** Distance in frame-height units (x is scaled by the video aspect). */
  private dist(a: Point, b: Point): number {
    return Math.hypot((a.x - b.x) * this.videoAspect, a.y - b.y);
  }

  private clampToFrame(p: Point): Point {
    const marginX = 0.03 / this.videoAspect;
    const marginY = 0.03;
    return {
      x: Math.min(this.frame.x1 - marginX, Math.max(this.frame.x0 + marginX, p.x)),
      y: Math.min(this.frame.y1 - marginY, Math.max(this.frame.y0 + marginY, p.y))
    };
  }

  private spawnPoint(): Point {
    const { x0, y0, x1, y1 } = this.frame;
    const w = x1 - x0;
    const h = y1 - y0;
    return {
      x: randomInRange(x0 + w * SPAWN_MARGIN, x1 - w * SPAWN_MARGIN),
      y: randomInRange(y0 + h * SPAWN_MARGIN, y1 - h * SPAWN_MARGIN)
    };
  }

  private spawnTargetAwayFrom(ball: Point): Point {
    let candidate = this.spawnPoint();
    let best = candidate;
    let bestDist = this.dist(candidate, ball);
    for (let attempts = 0; attempts < 20 && bestDist < MIN_BALL_TARGET_DISTANCE; attempts++) {
      candidate = this.spawnPoint();
      const d = this.dist(candidate, ball);
      if (d > bestDist) {
        best = candidate;
        bestDist = d;
      }
    }
    return best;
  }
}
