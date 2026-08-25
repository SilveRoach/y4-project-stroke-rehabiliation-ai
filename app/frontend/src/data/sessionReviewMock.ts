import type { SessionHistoryEntry, SessionReviewData } from "../types";

// Session Result Review mock data (UI_MOCKUP_PLAN_NEWDB.md §2.7). Curated to match
// docs/04-design/mockups/session-result-review.html's sample data (Shoulder Flexion
// Exercise, attempt 3 of 3, AI 82 / PT 85) for sh-1, keyed by
// data/patientDetailMock.ts's SessionHistoryEntry.id so Patient Detail's "Review ›"
// action can look up review data the same way it looks up a patient profile.
//
// Only sh-1 is guaranteed to match the reviewed mockup 1:1; sh-3/sh-4 are simpler
// curated examples (PT-reviewed and AI-scored respectively) added for variety, and
// any other session id falls back to a synthesized single-exercise review derived
// from the SessionHistoryEntry itself — same "real UI, mock persistence, clearly
// synthesized fallback" pattern as patientDetailMock.ts's buildFallbackProfile.

const curatedReviews: Record<string, SessionReviewData> = {
  "sh-1": {
    sessionId: "sh-1",
    patientName: "Somchai P.",
    dateLabel: "2026-08-01",
    dayLabel: "Day 5",
    exercises: [
      {
        id: "sh-1-ex-1",
        exerciseName: "Shoulder Flexion Exercise",
        exerciseVersionLabel: "v3",
        scheduledExerciseId: "se-4821",
        attempts: [
          {
            id: "att-4821-3",
            attemptNumber: 3,
            referenceVideo: null,
            aiScore: 82,
            aiFeedback:
              "Good range of motion, slight compensation from the shoulder on reps 4–6. Hold duration met target on 8/10 reps.",
            aiMetrics: [
              { label: "Peak angle", value: "88° (target 90°)" },
              { label: "Reps completed", value: "10/10" },
              { label: "Avg hold", value: "4.6s (target 5s)" }
            ],
            aiEvaluatedAtLabel: "2026-08-01 14:32",
            ptScore: 85,
            ptFeedback:
              "Good session overall — compensation on reps 4–6 is mild, not a concern yet. Keep an eye on it next week.",
            ptEvaluatedByLabel: "Dr. Nisa",
            finalScore: 85,
            evaluationSource: "pt"
          },
          {
            id: "att-4821-2",
            attemptNumber: 2,
            referenceVideo: null,
            aiScore: 80,
            aiFeedback: "Consistent form, minor undershoot on hold duration.",
            aiMetrics: [
              { label: "Peak angle", value: "85° (target 90°)" },
              { label: "Reps completed", value: "10/10" }
            ],
            aiEvaluatedAtLabel: "2026-08-01 14:20",
            finalScore: 80,
            evaluationSource: "ai"
          },
          {
            id: "att-4821-1",
            attemptNumber: 1,
            referenceVideo: null,
            aiScore: 78,
            aiFeedback: "First attempt of the day; range of motion still warming up.",
            aiMetrics: [{ label: "Peak angle", value: "82° (target 90°)" }],
            aiEvaluatedAtLabel: "2026-08-01 14:05",
            finalScore: 78,
            evaluationSource: "ai"
          }
        ]
      },
      {
        id: "sh-1-ex-2",
        exerciseName: "Wrist Extension Stretch",
        exerciseVersionLabel: "v1",
        scheduledExerciseId: "se-4822",
        attempts: [
          {
            id: "att-4822-1",
            attemptNumber: 1,
            referenceVideo: null,
            aiScore: 88,
            aiFeedback: "Clean extension through full range on every rep.",
            aiMetrics: [
              { label: "Peak angle", value: "44° (target 45°)" },
              { label: "Reps completed", value: "12/12" }
            ],
            aiEvaluatedAtLabel: "2026-08-01 14:40",
            finalScore: 88,
            evaluationSource: "ai"
          }
        ]
      },
      {
        id: "sh-1-ex-3",
        exerciseName: "Grip Strength Trainer",
        exerciseVersionLabel: "v2",
        scheduledExerciseId: "se-4823",
        attempts: [
          {
            id: "att-4823-1",
            attemptNumber: 1,
            referenceVideo: null,
            aiScore: 84,
            aiFeedback: "Grip target met on 13/15 reps; hold duration slightly short.",
            aiMetrics: [
              { label: "Peak grip", value: "58 (target 60)" },
              { label: "Reps completed", value: "13/15" },
              { label: "Avg hold", value: "3.6s (target 4s)" }
            ],
            aiEvaluatedAtLabel: "2026-08-01 14:48",
            finalScore: 84,
            evaluationSource: "ai"
          }
        ]
      }
    ]
  },

  "sh-3": {
    sessionId: "sh-3",
    patientName: "Somchai P.",
    dateLabel: "2026-07-30",
    dayLabel: "Day 3",
    exercises: [
      {
        id: "sh-3-ex-1",
        exerciseName: "Shoulder Flexion Exercise",
        exerciseVersionLabel: "v3",
        scheduledExerciseId: "se-4790",
        attempts: [
          {
            id: "att-4790-1",
            attemptNumber: 1,
            referenceVideo: null,
            aiScore: 87,
            aiFeedback: "Strong form, full range of motion maintained throughout.",
            aiMetrics: [
              { label: "Peak angle", value: "91° (target 90°)" },
              { label: "Reps completed", value: "10/10" }
            ],
            aiEvaluatedAtLabel: "2026-07-30 10:15",
            ptScore: 91,
            ptFeedback: "Excellent session — best form yet. Consider increasing target angle next week.",
            ptEvaluatedByLabel: "Dr. Nisa",
            finalScore: 91,
            evaluationSource: "pt"
          }
        ]
      },
      {
        id: "sh-3-ex-2",
        exerciseName: "Wrist Extension Stretch",
        exerciseVersionLabel: "v1",
        scheduledExerciseId: "se-4791",
        attempts: [
          {
            id: "att-4791-1",
            attemptNumber: 1,
            referenceVideo: null,
            aiScore: 90,
            aiEvaluatedAtLabel: "2026-07-30 10:22",
            ptScore: 91,
            ptEvaluatedByLabel: "Dr. Nisa",
            finalScore: 91,
            evaluationSource: "pt"
          }
        ]
      },
      {
        id: "sh-3-ex-3",
        exerciseName: "Grip Strength Trainer",
        exerciseVersionLabel: "v2",
        scheduledExerciseId: "se-4792",
        attempts: [
          {
            id: "att-4792-1",
            attemptNumber: 1,
            referenceVideo: null,
            aiScore: 89,
            aiEvaluatedAtLabel: "2026-07-30 10:30",
            ptScore: 91,
            ptEvaluatedByLabel: "Dr. Nisa",
            finalScore: 91,
            evaluationSource: "pt"
          }
        ]
      }
    ]
  },

  "sh-4": {
    sessionId: "sh-4",
    patientName: "Somchai P.",
    dateLabel: "2026-07-29",
    dayLabel: "Day 2",
    exercises: [
      {
        id: "sh-4-ex-1",
        exerciseName: "Shoulder Flexion Exercise",
        exerciseVersionLabel: "v3",
        scheduledExerciseId: "se-4760",
        attempts: [
          {
            id: "att-4760-1",
            attemptNumber: 1,
            referenceVideo: null,
            aiScore: 76,
            aiFeedback: "Range of motion below target on several reps; possible fatigue.",
            aiMetrics: [{ label: "Peak angle", value: "76° (target 90°)" }],
            aiEvaluatedAtLabel: "2026-07-29 09:40",
            finalScore: 76,
            evaluationSource: "ai"
          }
        ]
      },
      {
        id: "sh-4-ex-2",
        exerciseName: "Wrist Extension Stretch",
        exerciseVersionLabel: "v1",
        scheduledExerciseId: "se-4761",
        attempts: [
          {
            id: "att-4761-1",
            attemptNumber: 1,
            referenceVideo: null,
            aiScore: 80,
            aiEvaluatedAtLabel: "2026-07-29 09:48",
            finalScore: 80,
            evaluationSource: "ai"
          }
        ]
      }
    ]
  }
};

// Any session without a curated review above (e.g. sh-2, which was skipped and has
// no exercises to review, or any patient's session not covered here) falls back to
// a single synthesized exercise built from the SessionHistoryEntry's own summary
// numbers — clearly labeled as a placeholder rather than inventing per-exercise
// detail that was never recorded.
function buildFallbackReview(session: SessionHistoryEntry, patientName: string): SessionReviewData {
  if (session.exercisesAttempted === 0 || session.outcome === "skipped") {
    return {
      sessionId: session.id,
      patientName,
      dateLabel: session.dateLabel,
      dayLabel: session.dayLabel,
      exercises: []
    };
  }

  const score = session.avgScore ?? 0;
  return {
    sessionId: session.id,
    patientName,
    dateLabel: session.dateLabel,
    dayLabel: session.dayLabel,
    exercises: [
      {
        id: `${session.id}-fallback`,
        exerciseName: "Session exercises (detail not recorded)",
        scheduledExerciseId: `${session.id}-fallback-se`,
        attempts: [
          {
            id: `${session.id}-fallback-att`,
            attemptNumber: 1,
            referenceVideo: null,
            aiScore: session.evaluationSource === "ai" ? score : undefined,
            ptScore: session.evaluationSource === "pt_reviewed" ? score : undefined,
            ptEvaluatedByLabel: session.evaluationSource === "pt_reviewed" ? "Dr. Nisa" : undefined,
            finalScore: score,
            evaluationSource: session.evaluationSource === "pt_reviewed" ? "pt" : "ai"
          }
        ]
      }
    ]
  };
}

export function getSessionReview(session: SessionHistoryEntry, patientName: string): SessionReviewData {
  return curatedReviews[session.id] ?? buildFallbackReview(session, patientName);
}
