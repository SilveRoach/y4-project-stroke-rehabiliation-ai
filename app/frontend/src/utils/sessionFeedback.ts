// End-of-session AI comment ("ความเห็นจาก AI"). Ported from the AI team's
// computeOverallFeedback (ai/scoring/detailedFeedback.ts): instead of one canned
// sentence, the comment summarizes the whole session — an overall verdict from
// the average score, plus the body-part problems that REPEATED across reps (a
// one-off slip is not worth nagging about). The per-rep items come from the
// backend (pose-scoring/detailedFeedback.ts), since only the server holds the
// reference clips needed to compare against.
//
// The resulting text is stored as exercise_performance_results.ai_feedback, so
// the therapist sees the same comment in the review page.

import { countGripFailures } from "../ai/grip/ballGripScoring";
import type { PoseSessionSummary } from "../pages/PatientSessionPage";
import type { PoseDetailedFeedbackItem, PoseRepScoringResult } from "../ai/poseScoring/poseScoringTypes";

type Severity = PoseDetailedFeedbackItem["severity"];

export interface OverallFeedbackItem {
  part: string;
  message: string;
  severity: Severity;
  occurredInReps: number;
  totalReps: number;
}

export interface SessionComment {
  feedback: string;
  metrics: Array<{ label: string; value: string }>;
}

// A problem must repeat in at least this share of reps (and in at least
// MIN_REP_COUNT reps) to count as a pattern rather than a one-off.
const MIN_REP_RATIO = 0.4;
const MIN_REP_COUNT = 2;
const MAX_ITEMS = 3;

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };

/** Score band wording shared by the comment's opening line. */
function verdict(score: number): string {
  if (score >= 80) return "ทำได้ดีมาก";
  if (score >= 60) return "ทำได้ใช้ได้";
  return "ควรฝึกเพิ่ม";
}

/**
 * Groups per-rep coaching items by body part and keeps the parts that repeated
 * often enough, most severe / most frequent first.
 */
export function computeOverallFeedback(reps: PoseRepScoringResult[]): OverallFeedbackItem[] {
  const totalReps = reps.length;
  if (totalReps === 0) return [];

  type Agg = { critical: number; warn: number; info: number; criticalMsg?: string; warnMsg?: string; infoMsg?: string };
  const grouped = new Map<string, Agg>();

  for (const rep of reps) {
    const seen = new Set<string>();
    for (const item of rep.detailedFeedback ?? []) {
      if (seen.has(item.part)) continue;
      seen.add(item.part);
      const agg = grouped.get(item.part) ?? { critical: 0, warn: 0, info: 0 };
      if (item.severity === "critical") {
        agg.critical++;
        agg.criticalMsg = item.message;
      } else if (item.severity === "warn") {
        agg.warn++;
        agg.warnMsg = item.message;
      } else {
        agg.info++;
        agg.infoMsg = item.message;
      }
      grouped.set(item.part, agg);
    }
  }

  const minOccurrences = Math.max(MIN_REP_COUNT, Math.ceil(totalReps * MIN_REP_RATIO));
  const items: OverallFeedbackItem[] = [];
  for (const [part, agg] of grouped) {
    const occurredInReps = agg.critical + agg.warn + agg.info;
    if (occurredInReps < minOccurrences) continue;
    const severity: Severity = agg.critical > 0 && agg.critical >= agg.warn ? "critical" : agg.warn > 0 ? "warn" : "info";
    const message = (severity === "critical" ? agg.criticalMsg : severity === "warn" ? agg.warnMsg : agg.infoMsg) ?? "";
    items.push({ part, message, severity, occurredInReps, totalReps });
  }

  items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.occurredInReps - a.occurredInReps);
  return items.slice(0, MAX_ITEMS);
}

/** "8/10" when the prescribed total is known, else just the count. */
function repsLabel(done: number, target: number): string {
  return target > 0 ? `${done}/${target}` : String(done);
}

function poseComment(summary: PoseSessionSummary, reps: PoseRepScoringResult[]): SessionComment {
  const scores = summary.repScores;
  const best = Math.max(...scores);
  const worst = Math.min(...scores);
  const overall = computeOverallFeedback(reps);
  const avg = summary.averageScore ?? 0;

  let feedback = `${verdict(avg)} — คะแนนเฉลี่ย ${avg} จาก ${scores.length} ครั้ง`;
  if (scores.length > 1) feedback += ` (ดีที่สุด ${best}, ต่ำสุด ${worst})`;
  feedback += ".";

  if (overall.length > 0) {
    feedback += " สิ่งที่ควรปรับ: " + overall.map((item) => `${item.part} — ${item.message}`).join(" · ");
  } else if (avg >= 80) {
    feedback += " ท่าทางสม่ำเสมอ ไม่พบปัญหาที่เกิดซ้ำ";
  } else {
    feedback += " ลองทำช้าลงและเคลื่อนไหวให้ลื่นไหลตามวิดีโอตัวอย่าง";
  }

  const metrics = [
    { label: "จำนวนครั้งที่ทำ", value: repsLabel(scores.length, summary.targetReps) },
    { label: "ช่วงคะแนน", value: `${worst}–${best}` },
    { label: "คะแนนเฉลี่ย", value: String(avg) }
  ];
  if (reps.length > 0) {
    const mean = (pick: (r: PoseRepScoringResult) => number) =>
      Math.round(reps.reduce((sum, r) => sum + pick(r), 0) / reps.length);
    metrics.push(
      { label: "ความแม่นยำของท่าทาง", value: `${mean((r) => r.metrics.dtwScore)}%` },
      { label: "ระยะการเคลื่อนไหว", value: `${mean((r) => r.metrics.romScore)}%` }
    );
  }
  return { feedback, metrics };
}

function gripComment(summary: PoseSessionSummary, rounds: NonNullable<PoseSessionSummary["gripRounds"]>): SessionComment {
  const points = rounds.filter((r) => r.success).length;
  const failures = countGripFailures(rounds);
  const avgTime = rounds.filter((r) => r.success).reduce((sum, r) => sum + r.timeTakenSeconds, 0) / Math.max(1, points);
  const avg = summary.averageScore ?? 0;

  let feedback = `${verdict(avg)} — วางบอลเข้าเป้าสำเร็จ ${points} จาก ${rounds.length} รอบ`;
  if (points > 0) feedback += ` (เฉลี่ย ${avgTime.toFixed(1)} วินาทีต่อรอบ)`;
  feedback += ".";

  const hints: string[] = [];
  if (failures.timeout > 0) hints.push(`หมดเวลา ${failures.timeout} รอบ — ลองสังเกตตำแหน่งบอลให้เร็วขึ้น`);
  if (failures.missed > 0) hints.push(`ปล่อยบอลไม่ตรงวง ${failures.missed} รอบ — เล็งให้แม่นก่อนแบมือ`);
  if (failures.lost_tracking > 0) hints.push(`กล้องจับมือไม่เจอ ${failures.lost_tracking} รอบ — ให้มืออยู่ในกรอบกล้อง`);
  if (hints.length > 0) feedback += " สิ่งที่ควรปรับ: " + hints.join(" · ");
  else if (points === rounds.length) feedback += " ทุกรอบสำเร็จ";

  return {
    feedback,
    metrics: [
      { label: "จำนวนครั้งที่ทำ", value: repsLabel(rounds.length, summary.targetReps) },
      { label: "แต้มที่ได้", value: `${points}/${rounds.length}` },
      { label: "อัตราสำเร็จ", value: `${avg}%` }
    ]
  };
}

/** Builds the session comment + metric chips for a finished scored session. */
export function buildSessionComment(summary: PoseSessionSummary): SessionComment {
  if (summary.gripRounds && summary.gripRounds.length > 0) return gripComment(summary, summary.gripRounds);
  return poseComment(summary, summary.poseReps ?? []);
}
