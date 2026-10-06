// Per-rep, per-body-part coaching feedback — adapted from projectimport/
// Rehab-AI's ai/scoring/detailedFeedback.ts (computeDetailedFeedback only;
// the session-level computeOverallFeedback is aggregated client-side). It
// lives on the backend because the "secondary joint compensation" axis needs
// the reference's masterSamples, which never leave the server.
//
// It does not change any score: it re-reads the same rep and splits the
// single feedbackText sentence of scoreEngine.ts into items saying WHICH body
// part to adjust and in which direction.

import { DynamicTimeWarping } from "./dtwEvaluator";
import { DetailedFeedbackItem, FrameFeature, MasterSample, PoseReference } from "./poseScoring.types";

/** ROM shortfall (degrees) of the primary joint before it is reported. */
const ROM_SHORTFALL_THRESHOLD_DEG = 8;
/** Shortfall at/above this is "critical" rather than "warn". */
const ROM_SHORTFALL_CRITICAL_DEG = ROM_SHORTFALL_THRESHOLD_DEG * 2;

/** The secondary angle must range this many times wider than the master's... */
const SECONDARY_COMPENSATION_RATIO = 1.4;
/** ...and by at least this many degrees, so tiny-range movements aren't flagged on ratio alone. */
const SECONDARY_COMPENSATION_MIN_DEG = 8;

/** Left/right range difference (degrees) before asymmetry is reported. */
const ASYMMETRY_THRESHOLD_DEG = 12;
const ASYMMETRY_CRITICAL_DEG = ASYMMETRY_THRESHOLD_DEG * 1.5;

/** Range (max - min) of a series — how far the joint actually moved over the rep. */
export function rangeOf(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
}

/** Reduces an authoring label (Thai or English) to a short body-part name the
 *  patient understands. Unknown => "ข้อต่อหลัก" (generic primary joint). */
function friendlyJointLabel(label: string | undefined): string {
  const text = (label ?? "").toLowerCase();
  if (text.includes("ศอก") || text.includes("elbow")) return "ข้อศอก";
  if (text.includes("ไหล่") || text.includes("shoulder")) return "ไหล่";
  if (text.includes("ข้อมือ") || text.includes("wrist")) return "ข้อมือ";
  if (text.includes("สะโพก") || text.includes("hip")) return "สะโพก";
  if (text.includes("แขน") || text.includes("forearm") || text.includes("arm")) return "แขน";
  return "ข้อต่อหลัก";
}

/** Real label of the secondary angle (the shoulderAngle field holds the
 *  secondary angle of any exercise, not necessarily the shoulder), taken from
 *  autoAnalysis. References without it return null and this axis is skipped
 *  rather than guessed. */
function secondaryJointLabel(ref: PoseReference): string | null {
  const analysis = ref.autoAnalysis;
  if (!analysis) return null;
  const candidate = analysis.rankedCandidates.find((c) => c.id === analysis.secondaryCandidateId);
  if (!candidate) return null;
  return friendlyJointLabel(candidate.label);
}

/** Master sample closest to the patient's rep (same DTW as evaluateDTW). */
function findBestMatchingSample(patientSeq: FrameFeature[], masterSamples: MasterSample[]): MasterSample | null {
  let best: MasterSample | null = null;
  let minNormDistance = Infinity;

  for (const sample of masterSamples) {
    if (!sample.frames || sample.frames.length === 0 || patientSeq.length === 0) continue;
    const dtw = new DynamicTimeWarping(patientSeq, sample.frames);
    const path = dtw.getPath();
    const normDist = dtw.getDistance() / (path.length || 1);
    if (normDist < minNormDistance) {
      minNormDistance = normDist;
      best = sample;
    }
  }

  return best;
}

/**
 * Builds the per-rep feedback list over 5 axes: (1) primary-joint ROM short,
 * (2) secondary angle compensating beyond the master, (3) trunk leaning/
 * swaying, (4) left/right asymmetry, (5) catch-all when the score is low but no
 * axis matched. Messages avoid raw degrees (direction/level wording instead) —
 * degrees only decide warn vs critical internally.
 */
export function computeDetailedFeedback(
  sequence: FrameFeature[],
  baseTrunkPoint: { x: number; y: number },
  peakRom: number,
  targetRom: number,
  meanBve: number,
  meanTrunkDrift: number,
  bveThreshold: number,
  isTrunkBveEnabled: boolean,
  ref: PoseReference,
  dtwScore: number,
  isKnnPass: boolean
): DetailedFeedbackItem[] {
  const items: DetailedFeedbackItem[] = [];
  if (sequence.length === 0) return items;

  const primaryLabel = friendlyJointLabel(ref.targetJoint);

  // (1) Primary-joint ROM short of target.
  const romShortfall = targetRom - peakRom;
  if (romShortfall >= ROM_SHORTFALL_THRESHOLD_DEG) {
    const isCritical = romShortfall >= ROM_SHORTFALL_CRITICAL_DEG;
    items.push({
      part: primaryLabel,
      message: isCritical
        ? `ยังขยับ${primaryLabel}ได้ไม่สุดช่วงเลย ลองขยับให้สุดช่วงมากกว่านี้อีกหน่อย`
        : `ยังขยับ${primaryLabel}ได้ไม่ค่อยสุดช่วง ลองขยับเพิ่มอีกนิดให้สุดช่วง`,
      severity: isCritical ? "critical" : "warn"
    });
  }

  // (2) Secondary angle moves more than in the closest master sample.
  const bestMatch = findBestMatchingSample(sequence, ref.masterSamples ?? []);
  const secondaryLabel = secondaryJointLabel(ref);
  // No resolvable secondary label, or same as the primary => skip the axis.
  if (bestMatch && secondaryLabel && secondaryLabel !== primaryLabel) {
    const patientSecondaryRange = rangeOf(sequence.map((f) => f.shoulderAngle));
    const masterSecondaryRange = rangeOf(bestMatch.frames.map((f) => f.shoulderAngle));
    const diff = patientSecondaryRange - masterSecondaryRange;
    if (
      masterSecondaryRange > 0 &&
      patientSecondaryRange > masterSecondaryRange * SECONDARY_COMPENSATION_RATIO &&
      diff >= SECONDARY_COMPENSATION_MIN_DEG
    ) {
      items.push({
        part: secondaryLabel,
        message: `${secondaryLabel}ขยับช่วยมากกว่าคลิปต้นแบบ ลองล็อก${secondaryLabel}ให้นิ่ง แล้วขยับเฉพาะ${primaryLabel}แทน`,
        severity: "warn"
      });
    }
  }

  // (3) Trunk leaning/swaying, with the direction at the frame deviating most.
  if (isTrunkBveEnabled && (meanBve > bveThreshold || meanTrunkDrift > bveThreshold)) {
    let maxDevPoint = sequence[0].trunkCentroid;
    let maxDevSq = -1;
    for (const f of sequence) {
      const dx = f.trunkCentroid.x - baseTrunkPoint.x;
      const dy = f.trunkCentroid.y - baseTrunkPoint.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > maxDevSq) {
        maxDevSq = distSq;
        maxDevPoint = f.trunkCentroid;
      }
    }
    const dx = maxDevPoint.x - baseTrunkPoint.x;
    const dy = maxDevPoint.y - baseTrunkPoint.y;

    // Directions are as the patient sees them on the mirrored selfie view
    // (what the eye sees), not anatomical sides — raw landmark x grows toward
    // the image's right, which appears on the LEFT of a mirrored display.
    const horizontalDir = Math.abs(dx) < 0.01 ? null : dx > 0 ? "ซ้าย" : "ขวา";
    const verticalDir = Math.abs(dy) < 0.01 ? null : dy > 0 ? "ลง" : "ขึ้น";

    let directionText = "";
    if (horizontalDir && Math.abs(dx) >= Math.abs(dy)) {
      directionText = `ไปทาง${horizontalDir}ของภาพที่เห็น`;
    } else if (verticalDir) {
      directionText = verticalDir === "ลง" ? "ยุบ/ก้มตัวลง" : "แอ่น/เผยอตัวขึ้น";
    }

    items.push({
      part: "ลำตัว",
      message: directionText
        ? `ลำตัวเอียง${directionText}ช่วยออกแรง ลองเกร็งหน้าท้องแล้วนั่ง/ยืนนิ่งๆ ไม่ต้องโยกตัวช่วย`
        : "ลำตัวเอียง/โยกช่วยออกแรงระหว่างทำท่า ลองเกร็งหน้าท้องแล้วนั่ง/ยืนนิ่งๆ ไม่ต้องโยกตัวช่วย",
      severity: Math.max(meanBve, meanTrunkDrift) > bveThreshold * 1.5 ? "critical" : "warn"
    });
  }

  // (4) Left/right asymmetry (bilateral exercises only — frames carry both sides).
  const leftVals = sequence.map((f) => f.leftElbowAngle).filter((v): v is number => v !== undefined);
  const rightVals = sequence.map((f) => f.rightElbowAngle).filter((v): v is number => v !== undefined);
  if (leftVals.length > 0 && rightVals.length > 0) {
    const leftRange = rangeOf(leftVals);
    const rightRange = rangeOf(rightVals);
    const diff = Math.abs(leftRange - rightRange);
    if (diff >= ASYMMETRY_THRESHOLD_DEG) {
      const weakerSide = leftRange < rightRange ? "ซ้าย" : "ขวา";
      const isCritical = diff >= ASYMMETRY_CRITICAL_DEG;
      items.push({
        part: `แขน${weakerSide}`,
        message: isCritical
          ? `แขน${weakerSide}ขยับได้น้อยกว่าอีกข้างมาก ลองเน้นขยับแขน${weakerSide}ให้สุดช่วงเพิ่ม`
          : `แขน${weakerSide}ขยับได้น้อยกว่าอีกข้างอยู่บ้าง ลองเน้นขยับแขน${weakerSide}เพิ่มอีกนิด`,
        severity: isCritical ? "critical" : "warn"
      });
    }
  }

  // (5) Catch-all: low DTW/K-NN result but none of the axes above matched
  // (e.g. a rhythm/speed problem) — never leave the patient without feedback.
  if (items.length === 0 && (dtwScore < 70 || !isKnnPass)) {
    items.push({
      part: "จังหวะการเคลื่อนไหว",
      message:
        "รูปแบบ/จังหวะการเคลื่อนไหวโดยรวมของรอบนี้ยังต่างจากคลิปต้นแบบอยู่ ลองทำช้าลงและเคลื่อนไหวให้ลื่นไหลสม่ำเสมอตามคลิปต้นแบบ",
      severity: dtwScore < 50 || !isKnnPass ? "critical" : "warn"
    });
  }

  return items;
}
