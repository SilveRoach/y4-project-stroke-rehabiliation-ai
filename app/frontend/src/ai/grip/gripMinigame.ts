// Virtual-grip "grab & drag" minigame — pure state-machine logic, canvas
// agnostic (drawing lives in gripMinigameRenderer.ts).
//
// Adapted from projectimport/Rehab-AI's grip primitives: hand openness comes
// from the same fingertip-distance idea (already ported in
// ai/handDetection.ts's computeHandOpenness) and the open/closed decision uses
// the reference extractors/gripStateClassifier.ts hysteresis thresholds
// (CLOSE_ENTER 0.35 / OPEN_ENTER 0.55). The reference never shipped an actual
// drag interaction (its VirtualGripView only showed the grip meter), so the
// grab/follow/drop state machine below is new — built on those ported
// primitives plus the already-ported OneEuroFilter for jitter-free following.
//
// All positions are in NORMALIZED VIDEO SPACE (0..1 of the video frame) — the
// same space hand landmarks use — so the interaction is resolution- and
// aspect-independent; the renderer applies the same mirror flip as the hand
// skeleton. A rep completes when the ball is dropped inside the target zone
// and held there for holdSeconds; the caller (PatientSessionPage) owns the
// rep counter and the prescribed total.

import type { Landmark } from "../handDetection";
import { computeHandOpenness, KEY_LANDMARKS } from "../handDetection";
import { OneEuroFilter } from "../poseScoring/oneEuroFilter";

export type GripState = "open" | "closed";

// Hysteresis thresholds from the reference gripStateClassifier — a value in
// the middle zone (0.35..0.55) keeps its previous state instead of flickering
// grab/drop every frame.
const CLOSE_ENTER = 0.35;
const OPEN_ENTER = 0.55;

/** Two-state grip decision with hysteresis (reference gripStateClassifier port). */
export function classifyGripState(openness: number, previousState: GripState | null): GripState {
  if (openness <= CLOSE_ENTER) return "closed";
  if (openness >= OPEN_ENTER) return "open";
  // Mid zone — keep the previous decision; on the very first frame fall back
  // to a rough midpoint judgment.
  return previousState ?? (openness >= 0.45 ? "open" : "closed");
}

export type GripMinigameState = "seeking" | "hover" | "grabbed" | "released" | "success";

export interface GripMinigameConfig {
  /** Seconds the dropped ball must stay inside the target to score a rep. */
  holdSeconds?: number;
  /** Ball radius as a fraction of frame height. */
  ballRadius?: number;
  /** Target-zone radius as a fraction of frame height. */
  targetRadius?: number;
  /** Grab hit-test grace multiplier applied to the ball radius. */
  grabGrace?: number;
}

export interface GripPoint {
  x: number;
  y: number;
}

export interface GripMinigameSnapshot {
  state: GripMinigameState;
  /** Ball center + radius (normalized frame coordinates). */
  ball: GripPoint & { r: number };
  /** Target-zone center + radius. */
  target: GripPoint & { r: number };
  /** 0..1 hold-timer progress inside the target (only meaningful after a drop). */
  holdProgress: number;
  /** Latest hand openness (0 fist .. 1 open) for the renderer's grip meter. */
  openness: number;
  /** Whether a hand is currently tracked at all. */
  handPresent: boolean;
  /** Bilingual status line for the session overlay caption. */
  statusText: string;
}

// One-Euro settings for the follow — between the reference's marker filter
// (0.8/0.3 @ ~5fps, too laggy at hand-detect's ~15fps) and unfiltered (jittery).
const FOLLOW_MIN_CUTOFF = 1.2;
const FOLLOW_BETA = 0.3;

// How many consecutive ms without a tracked hand before a grab is treated as
// lost (the ball is released where it is — it never teleports mid-therapy).
const HAND_LOST_RELEASE_MS = 500;

// Success flash duration before the ball respawns and the target moves.
const SUCCESS_FLASH_MS = 1200;

// Spawn/target presets — RELATIVE to the visible sub-frame (0..1 of what the
// patient can actually see after object-fit: cover cropping), mapped into
// video space via the current viewport so the ball/target can never be placed
// off-screen regardless of the client's aspect ratio. A small ROM-friendly
// circuit the ball/target alternate through.
const SPAWN_POINTS: GripPoint[] = [
  { x: 0.5, y: 0.55 },
  { x: 0.32, y: 0.4 },
  { x: 0.68, y: 0.4 },
  { x: 0.5, y: 0.32 }
];
const TARGET_POINTS: GripPoint[] = [
  { x: 0.72, y: 0.62 },
  { x: 0.28, y: 0.62 },
  { x: 0.5, y: 0.75 },
  { x: 0.32, y: 0.3 },
  { x: 0.68, y: 0.3 }
];

function dist(a: GripPoint, b: GripPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Visible sub-frame of the video, in normalized video coordinates.
 *
 * The overlay canvas is displayed with `object-fit: cover` over its container
 * (same as the video), so when the container's aspect ratio differs from the
 * video's, cover CROPS the frame — a point at video x=0.05 or x=0.95 can be
 * off-screen. This computes which part of the video frame is actually visible:
 * uniform cover scale = max(cw/vw, ch/vh), so the dimension with the larger
 * ratio fills the container and the other one is cropped symmetrically.
 */
export interface GripVisibleFrame {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function computeGripVisibleFrame(
  videoWidth: number,
  videoHeight: number,
  clientWidth: number,
  clientHeight: number
): GripVisibleFrame {
  const full: GripVisibleFrame = { x0: 0, y0: 0, x1: 1, y1: 1 };
  if (!videoWidth || !videoHeight || !clientWidth || !clientHeight) return full;
  const videoAspect = videoWidth / videoHeight;
  const clientAspect = clientWidth / clientHeight;
  if (!Number.isFinite(videoAspect) || !Number.isFinite(clientAspect) || videoAspect <= 0 || clientAspect <= 0) {
    return full;
  }
  if (clientAspect > videoAspect) {
    // Container wider than the video — cover crops top/bottom.
    const visibleHeight = videoAspect / clientAspect;
    const y0 = (1 - visibleHeight) / 2;
    return { x0: 0, y0, x1: 1, y1: y0 + visibleHeight };
  }
  // Container narrower than the video — cover crops left/right.
  const visibleWidth = clientAspect / videoAspect;
  const x0 = (1 - visibleWidth) / 2;
  return { x0, y0: 0, x1: x0 + visibleWidth, y1: 1 };
}

/** Palm centroid (wrist + the four MCP knuckles) — a stable carry anchor. */
export function computePalmAnchor(landmarks: Landmark[]): GripPoint | null {
  const indices = [KEY_LANDMARKS.wrist, 5, 9, 13, 17];
  let x = 0;
  let y = 0;
  for (const index of indices) {
    const p = landmarks[index];
    if (!p) return null;
    x += p.x;
    y += p.y;
  }
  return { x: x / indices.length, y: y / indices.length };
}

export class GripMinigame {
  private state: GripMinigameState = "seeking";
  // Ball/target are stored RELATIVE to the visible sub-frame (0..1 of the
  // region the patient can actually see) so viewport changes never push the
  // interaction off-screen; the snapshot maps them into video space for
  // rendering and all hit-testing happens in video space (uniform distances,
  // so the drawn circles match the grab regions exactly).
  private ball: GripPoint & { r: number };
  private target: GripPoint & { r: number };
  private readonly holdSeconds: number;
  private readonly grabGrace: number;

  private frame: GripVisibleFrame = { x0: 0, y0: 0, x1: 1, y1: 1 };
  private videoAspect = 16 / 9;

  private handPresent = false;
  private openness = 0;
  private gripState: GripState | null = null;

  // Anchor→ball offset captured at grab time so the ball never jumps.
  private grabOffset: GripPoint = { x: 0, y: 0 };
  private followX = new OneEuroFilter(FOLLOW_MIN_CUTOFF, FOLLOW_BETA);
  private followY = new OneEuroFilter(FOLLOW_MIN_CUTOFF, FOLLOW_BETA);

  private lastUpdateMs: number | null = null;
  private holdElapsedMs = 0;
  private successUntilMs: number | null = null;
  private handLostSinceMs: number | null = null;

  private spawnIndex = 0;
  private targetIndex = 0;

  /** Called once per completed repetition (successful drop + hold). */
  onRepComplete: ((info: { holdSeconds: number }) => void) | null = null;

  constructor(config: GripMinigameConfig = {}) {
    this.holdSeconds = config.holdSeconds ?? 2;
    this.ball = { ...SPAWN_POINTS[0], r: config.ballRadius ?? 0.07 };
    this.target = { ...TARGET_POINTS[0], r: config.targetRadius ?? 0.11 };
    this.grabGrace = config.grabGrace ?? 1.3;
  }

  /** Relative (visible-frame) → normalized video coordinates. */
  private mapToVideo(p: GripPoint): GripPoint {
    const { x0, y0, x1, y1 } = this.frame;
    return { x: x0 + p.x * (x1 - x0), y: y0 + p.y * (y1 - y0) };
  }

  /** Normalized video coordinates → relative (visible-frame). */
  private mapToRelative(p: GripPoint): GripPoint {
    const { x0, y0, x1, y1 } = this.frame;
    const w = x1 - x0 || 1;
    const h = y1 - y0 || 1;
    return { x: (p.x - x0) / w, y: (p.y - y0) / h };
  }

  /**
   * Updates the visible sub-frame (see computeGripVisibleFrame). Called every
   * detect tick by the session loop; cheap no-op while unchanged. Existing
   * ball/target positions keep their relative placement in the new frame
   * (clamped inside it), so a resize/rotation mid-therapy never moves the
   * interaction off-screen or teleports it across the frame.
   */
  setViewport(frame: GripVisibleFrame, videoAspect: number): void {
    const unchanged =
      Math.abs(frame.x0 - this.frame.x0) < 1e-4 &&
      Math.abs(frame.y0 - this.frame.y0) < 1e-4 &&
      Math.abs(frame.x1 - this.frame.x1) < 1e-4 &&
      Math.abs(frame.y1 - this.frame.y1) < 1e-4;
    if (unchanged) {
      this.videoAspect = videoAspect > 0 ? videoAspect : this.videoAspect;
      return;
    }

    const previous = this.frame;
    const remap = (p: GripPoint): GripPoint => {
      // Current position expressed in the OLD visible frame → video → NEW frame.
      const videoX = previous.x0 + p.x * (previous.x1 - previous.x0);
      const videoY = previous.y0 + p.y * (previous.y1 - previous.y0);
      const rel = this.mapToRelativeWith({ x: videoX, y: videoY }, frame);
      return {
        x: Math.min(1, Math.max(0, rel.x)),
        y: Math.min(1, Math.max(0, rel.y))
      };
    };
    this.ball = { ...remap(this.ball), r: this.ball.r };
    this.target = { ...remap(this.target), r: this.target.r };
    this.frame = frame;
    this.videoAspect = videoAspect > 0 ? videoAspect : this.videoAspect;
  }

  private mapToRelativeWith(p: GripPoint, frame: GripVisibleFrame): GripPoint {
    const w = frame.x1 - frame.x0 || 1;
    const h = frame.y1 - frame.y0 || 1;
    return { x: (p.x - frame.x0) / w, y: (p.y - frame.y0) / h };
  }

  reset(): void {
    this.spawnIndex = 0;
    this.targetIndex = 0;
    this.ball = { ...SPAWN_POINTS[0], r: this.ball.r };
    this.target = { ...TARGET_POINTS[0], r: this.target.r };
    this.state = "seeking";
    this.handPresent = false;
    this.openness = 0;
    this.gripState = null;
    this.grabOffset = { x: 0, y: 0 };
    this.followX.reset();
    this.followY.reset();
    this.lastUpdateMs = null;
    this.holdElapsedMs = 0;
    this.successUntilMs = null;
    this.handLostSinceMs = null;
  }

  private respawn(): void {
    // Fresh spawn point, and a new target different from the previous one so
    // every rep is a fresh range-of-motion task.
    this.spawnIndex = (this.spawnIndex + 1) % SPAWN_POINTS.length;
    const previousTarget = this.targetIndex;
    this.targetIndex = (this.targetIndex + 1) % TARGET_POINTS.length;
    if (this.targetIndex === previousTarget) {
      this.targetIndex = (this.targetIndex + 1) % TARGET_POINTS.length;
    }
    this.ball = { ...SPAWN_POINTS[this.spawnIndex], r: this.ball.r };
    this.target = { ...TARGET_POINTS[this.targetIndex], r: this.target.r };
    this.holdElapsedMs = 0;
    this.successUntilMs = null;
    this.state = "seeking";
  }

  /**
   * Advances the minigame by one hand-detect frame. Call with null when no
   * hand is tracked. All timing comes from the caller's clock (performance.now).
   */
  update(landmarks: Landmark[] | null, nowMs: number): void {
    const dtMs = this.lastUpdateMs === null ? 0 : Math.max(0, nowMs - this.lastUpdateMs);
    this.lastUpdateMs = nowMs;

    // Success flash is pure display time — no hand needed.
    if (this.state === "success") {
      if (this.successUntilMs !== null && nowMs >= this.successUntilMs) {
        this.respawn();
      }
      return;
    }

    if (!landmarks || landmarks.length === 0) {
      this.handPresent = false;
      if (this.handLostSinceMs === null) this.handLostSinceMs = nowMs;
      const handLost = nowMs - this.handLostSinceMs >= HAND_LOST_RELEASE_MS;
      if (this.state === "grabbed" && handLost) {
        // Lost mid-carry: release the ball where it is (frozen), no rep.
        this.state = "released";
        this.holdElapsedMs = 0;
      } else if (handLost) {
        // Hand lost during hold — reset the hold timer so a hand reappearing
        // far away can't instantly resume an (expired) hold.
        this.holdElapsedMs = 0;
      }
      return;
    }
    this.handPresent = true;
    this.handLostSinceMs = null;

    this.openness = computeHandOpenness(landmarks);
    this.gripState = classifyGripState(this.openness, this.gripState);
    const anchor = computePalmAnchor(landmarks);
    if (!anchor) {
      this.state = "seeking";
      return;
    }
    // Hit-testing happens in VIDEO space (uniform pixel scale, so the drawn
    // circles match the grab/drop regions exactly) while positions are stored
    // relative to the visible sub-frame.
    const ballVideo = this.mapToVideo(this.ball);
    const targetVideo = this.mapToVideo(this.target);

    if (this.state === "grabbed") {
      // Carry: follow the (filtered) palm anchor + captured offset, clamped
      // inside the VISIBLE frame so the ball can't be dragged off-screen
      // (object-fit: cover crops the frame on aspect-mismatched clients).
      const anchorRel = this.mapToRelative(anchor);
      const fx = this.followX.filter(anchorRel.x, nowMs);
      const fy = this.followY.filter(anchorRel.y, nowMs);
      const candidateVideo = this.mapToVideo({ x: fx + this.grabOffset.x, y: fy + this.grabOffset.y });
      // Margin = ball radius in each axis's normalized unit (x is normalized
      // by video WIDTH, y by HEIGHT — hence the videoAspect correction).
      const marginX = this.ball.r / this.videoAspect;
      const marginY = this.ball.r;
      const clampedVideo = {
        x: Math.min(this.frame.x1 - marginX, Math.max(this.frame.x0 + marginX, candidateVideo.x)),
        y: Math.min(this.frame.y1 - marginY, Math.max(this.frame.y0 + marginY, candidateVideo.y))
      };
      this.ball = { ...this.mapToRelative(clampedVideo), r: this.ball.r };

      if (this.gripState === "open") {
        // Release: the ball stays where the hand left it.
        this.state = "released";
        this.holdElapsedMs = 0;
      }
      return;
    }

    // seeking / hover / released
    const nearBall = dist(anchor, ballVideo) <= this.ball.r * this.grabGrace;

    if (this.gripState === "closed" && nearBall) {
      // Grab: capture the anchor→ball offset (in visible-frame-relative space,
      // so it survives viewport changes), then carry.
      const anchorRel = this.mapToRelative(anchor);
      this.grabOffset = { x: this.ball.x - anchorRel.x, y: this.ball.y - anchorRel.y };
      this.followX.reset();
      this.followY.reset();
      this.state = "grabbed";
      this.holdElapsedMs = 0;
      return;
    }

    if (this.state === "released") {
      // Hold the dropped ball inside the target (open hand resting there) for
      // holdSeconds to score a repetition.
      const insideTarget = dist(anchor, targetVideo) <= this.target.r;
      if (insideTarget) {
        this.holdElapsedMs += dtMs;
        if (this.holdElapsedMs >= this.holdSeconds * 1000) {
          this.state = "success";
          this.successUntilMs = nowMs + SUCCESS_FLASH_MS;
          this.onRepComplete?.({ holdSeconds: this.holdSeconds });
        }
      } else {
        this.holdElapsedMs = 0;
      }
      return;
    }

    // seeking / hover visual cue while an open hand is over the ball.
    this.state = this.gripState === "open" && nearBall ? "hover" : "seeking";
  }

  snapshot(): GripMinigameSnapshot {
    return {
      state: this.state,
      // Positions mapped into normalized VIDEO coordinates for rendering —
      // the renderer draws in video space and object-fit: cover crops it,
      // so only the visible sub-frame region ever appears on screen.
      ball: { ...this.mapToVideo(this.ball), r: this.ball.r },
      target: { ...this.mapToVideo(this.target), r: this.target.r },
      holdProgress: Math.min(1, this.holdElapsedMs / (this.holdSeconds * 1000)),
      openness: this.openness,
      handPresent: this.handPresent,
      statusText: this.statusText()
    };
  }

  private statusText(): string {
    const holdProgress = Math.min(1, this.holdElapsedMs / (this.holdSeconds * 1000));
    const holdLeft = Math.max(0, Math.ceil(this.holdSeconds - this.holdElapsedMs / 1000));
    switch (this.state) {
      case "hover":
        return "Close your hand to grab the ball · กำมือเพื่อจับลูกบอล";
      case "grabbed":
        return "Drag the ball into the circle · ลากลูกบอลไปที่วงกลม";
      case "released":
        return holdProgress > 0
          ? `Hold it there — ${holdLeft}s · ค้างไว้ — ${holdLeft}s`
          : "Drop it inside the circle · วางไว้ในวงกลม";
      case "success":
        return "Good! · ทำได้ดี!";
      default:
        return this.handPresent
          ? "Move your open hand over the ball · แบมือไปที่ลูกบอล"
          : "Show your hand to the camera · ยกมือขึ้นให้เห็นในกล้อง";
    }
  }
}

