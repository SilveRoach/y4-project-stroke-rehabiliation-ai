// Reviews persisted exercise attempts for one schedule day. The selected
// attempt's recording and AI/PT evaluations come from GET /schedule-days/:id/results;
// therapist reviews are saved through PATCH /performance-results/:id/scoring.

import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Save,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ReviewVideoPlayer } from "../components/ReviewVideoPlayer";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import { useProfilePicture } from "../hooks/useProfilePicture";
import {
  ApiError,
  getFileContent,
  getPatientPlans,
  getScheduleDayReview,
  getTherapistPatients,
  updateAttemptScoring
} from "../services/api";
import { useAuth } from "../store/authStore";
import type {
  ExercisePerformanceAttempt,
  SessionExerciseReview,
  SessionReviewData,
  TherapistPatientSummary
} from "../types";
import type { ScheduleDayReviewData } from "../services/api";

// Maps the real GET /schedule-days/:id/results payload onto the page's
// SessionExerciseReview/attempt shape. The video comes through as a server
// files-row id (referenceVideoFileId) — AttemptReview streams it via
// getFileContent and renders a real <video> player in place of the placeholder.
function mapRealReviewToExercises(real: ScheduleDayReviewData): SessionExerciseReview[] {
  return real.exercises.map((exercise) => ({
    id: exercise.id,
    scheduledExerciseId: exercise.scheduledExerciseId,
    exerciseName: exercise.exerciseName,
    exerciseVersionLabel: exercise.exerciseVersionLabel,
    description: exercise.description,
    difficultyLevel: exercise.difficultyLevel,
    movementTracking: exercise.movementTracking,
    baseCriteria: exercise.baseCriteria,
    targetValueLabel: exercise.targetValueLabel,
    therapistInstruction: exercise.therapistInstruction,
    attempts: exercise.attempts.map((attempt) => ({
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      completedAtIso: attempt.completedAtIso,
      referenceVideo: null,
      referenceVideoFileId: attempt.referenceVideoFileId ?? null,
      aiScore: attempt.aiScore ?? undefined,
      aiFeedback: attempt.aiFeedback ?? undefined,
      aiMetrics: attempt.aiMetrics ?? undefined,
      videoIncludesOverlay: attempt.videoIncludesOverlay,
      aiEvaluatedAtLabel: attempt.aiEvaluatedAtIso
        ? new Date(attempt.aiEvaluatedAtIso).toLocaleString("th-TH")
        : undefined,
      ptScore: attempt.ptScore ?? undefined,
      ptFeedback: attempt.ptFeedback ?? undefined,
      finalScore: attempt.finalScore ?? undefined,
      evaluationSource: attempt.evaluationSource ?? undefined,
      currentScore: attempt.currentScore,
      currentScoreSource: attempt.currentScoreSource,
      therapistReviewed: attempt.therapistReviewed
    }))
  }));
}

function exerciseDifficultyLabel(value: string): string {
  const labels: Record<string, string> = { easy: "ง่าย", medium: "ปานกลาง", moderate: "ปานกลาง", hard: "ยาก" };
  return labels[value.toLowerCase()] ?? value;
}

function exerciseDifficultyClass(value: string): string {
  const normalized = value.toLowerCase();
  return normalized === "medium" ? "moderate" : normalized;
}

function movementTrackingLabel(value: string): string {
  if (value === "pose") return "ติดตามท่าทาง";
  if (value === "virtual_grip") return "ติดตามมือ";
  if (value === "none") return "ไม่ใช้ AI ติดตาม";
  return value.replace(/_/g, " ");
}

function criterionLabel(value: string): string {
  const labels: Record<string, string> = {
    "target angle": "มุมเป้าหมาย",
    "target angle (degrees)": "มุมเป้าหมาย (องศา)",
    "target grip strength": "แรงบีบมือเป้าหมาย",
    "grip strength": "แรงบีบมือ",
    repetitions: "จำนวนครั้ง",
    reps: "จำนวนครั้ง",
    "hold seconds": "ช่วงคะแนน:",
    "hold seconds (seconds)": "ช่วงคะแนน:",
    "hold duration": "ระยะเวลาค้างไว้",
    "hold duration (seconds)": "ระยะเวลาค้างไว้ (วินาที)"
  };
  return labels[value.trim().toLowerCase()] ?? value;
}

function isHoldSecondsCriterion(value: string): boolean {
  return value.trim().toLowerCase().replace(/_/g, " ") === "hold seconds";
}

type ReviewParameter = { label: string; value: string };

function minigameTrackingParameters(
  criteria: ReviewParameter[] | null | undefined
): ReviewParameter[] | null {
  if (!criteria?.length) return null;
  const byKey = new Map(criteria.map((criterion) => [criterion.label.trim().toLowerCase(), criterion.value]));
  const gameType = byKey.get("virtual grip game type")?.trim().toLowerCase();
  if (!gameType) return null;

  const valueFor = (key: string) => byKey.get(key);
  const withSeconds = (value: string | undefined) => value === undefined ? null : `${value} วินาที`;

  if (gameType === "ball-grip") {
    const roundTime = valueFor("ball grip round time seconds");
    return [
      { label: "เกมฝึก", value: "จับลูกบอลเสมือน (Ball Grip)" },
      ...(roundTime === undefined ? [] : [{ label: "เวลาในแต่ละรอบ", value: withSeconds(roundTime)! }])
    ];
  }
  if (gameType === "falling-cup") {
    const fallSpeed = valueFor("falling cup fall speed");
    const spawnInterval = valueFor("falling cup spawn interval seconds");
    return [
      { label: "เกมฝึก", value: "จับถ้วยตกลงมา (Falling Cup)" },
      ...(fallSpeed === undefined ? [] : [{ label: "ความเร็วการตก", value: fallSpeed }]),
      ...(spawnInterval === undefined ? [] : [{ label: "ช่วงเวลาปล่อยวัตถุ", value: withSeconds(spawnInterval)! }])
    ];
  }
  if (gameType === "path-drag") {
    const targetObject = valueFor("path drag target label");
    const roundTime = valueFor("path drag round time seconds");
    return [
      { label: "เกมฝึก", value: "ลากตามเส้นทาง (Path Drag)" },
      ...(targetObject === undefined ? [] : [{ label: "วัตถุที่ให้ AI ตรวจจับ", value: targetObject }]),
      ...(roundTime === undefined ? [] : [{ label: "เวลาในแต่ละรอบ", value: withSeconds(roundTime)! }])
    ];
  }
  return null;
}

function reviewDayLabel(value: string): string {
  return value.replace(/^day\s+(\d+)$/i, "วันที่ $1");
}

function formatReviewDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function latestAttempt(exercise: SessionExerciseReview): ExercisePerformanceAttempt | undefined {
  return exercise.attempts.reduce<ExercisePerformanceAttempt | undefined>((latest, attempt) => {
    if (!latest || attempt.attemptNumber > latest.attemptNumber) return attempt;
    if (
      attempt.attemptNumber === latest.attemptNumber &&
      (attempt.completedAtIso ?? "") > (latest.completedAtIso ?? "")
    ) {
      return attempt;
    }
    return latest;
  }, undefined);
}

function attemptAiScoreRange(exercise: SessionExerciseReview): string {
  const scores = exercise.attempts.reduce<number[]>((values, attempt) => {
    if (typeof attempt.aiScore === "number" && Number.isFinite(attempt.aiScore)) {
      values.push(attempt.aiScore);
    }
    return values;
  }, []);
  if (scores.length === 0) return "—";

  const range = scores.reduce(
    (result, score) => ({ min: Math.min(result.min, score), max: Math.max(result.max, score) }),
    { min: scores[0], max: scores[0] }
  );
  return `${range.min}–${range.max}`;
}

interface ReviewPlanDay {
  id: string;
  scheduledDate: string;
  status: string;
  scheduledExercises: Array<{ id: string; status: string; performanceResults?: unknown[] }>;
}

interface ReviewPlan {
  id: string;
  name: string;
  status: string;
  scheduleDays: ReviewPlanDay[];
}

function isReviewPlan(value: unknown): value is ReviewPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return typeof plan.id === "string" &&
    typeof plan.name === "string" &&
    typeof plan.status === "string" &&
    Array.isArray(plan.scheduleDays) &&
    plan.scheduleDays.every((day: unknown) => {
      if (!day || typeof day !== "object") return false;
      const planDay = day as Record<string, unknown>;
      return typeof planDay.id === "string" &&
        typeof planDay.scheduledDate === "string" &&
        Array.isArray(planDay.scheduledExercises) &&
        planDay.scheduledExercises.every((exercise: unknown) => {
          if (!exercise || typeof exercise !== "object") return false;
          const scheduledExercise = exercise as Record<string, unknown>;
          return typeof scheduledExercise.id === "string" &&
            typeof scheduledExercise.status === "string";
        });
    });
}

function genderLabel(value?: string | null): string {
  if (value === "male") return "ชาย";
  if (value === "female") return "หญิง";
  if (value === "other") return "อื่น ๆ";
  return value?.toLowerCase() === "unknown" ? "ไม่มีข้อมูล" : value || "ไม่มีข้อมูล";
}

function accountStatusLabel(value?: string): string {
  const labels: Record<string, string> = {
    active: "ใช้งานอยู่",
    inactive: "ไม่ได้ใช้งาน",
    disabled: "ปิดใช้งาน",
    pending: "รอดำเนินการ",
    suspended: "ระงับ"
  };
  return value ? labels[value.toLowerCase()] ?? value : "—";
}

function lastLoginLabel(value?: string): string {
  if (!value) return "—";
  if (value === "Today") return "วันนี้";
  if (value === "Yesterday") return "เมื่อวาน";
  if (value === "Never") return "ไม่เคยเข้าสู่ระบบ";
  const daysAgo = value.match(/^(\d+) days? ago$/);
  if (daysAgo) return `${daysAgo[1]} วันที่แล้ว`;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

function formatMonth(value: Date): string {
  return value.toLocaleDateString("th-TH", { month: "long", year: "numeric" });
}

function ReviewSectionTitle({
  children,
  aside
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="srr-section-title">
      <h2>{children}</h2>
      {aside && <div className="srr-section-aside">{aside}</div>}
    </div>
  );
}

interface SessionResultReviewPageProps {
  review: SessionReviewData;
  patientId: string;
  patientProfile?: TherapistPatientSummary | null;
  onBack: () => void;
  onLogout: () => void;
  onNavigate: (label: TherapistNavLabel) => void;
  // Scheduled-exercise id to focus when this review was opened for one exercise;
  // undefined = whole-day review.
  focusExerciseId?: string;
}

export function SessionResultReviewPage({
  review,
  patientId,
  patientProfile: patientProfileFromRoute,
  onBack,
  onLogout,
  onNavigate,
  focusExerciseId
}: SessionResultReviewPageProps) {
  const { token, user } = useAuth();
  const [exercises, setExercises] = useState<SessionExerciseReview[]>([]);
  const [loadedPatientProfile, setLoadedPatientProfile] = useState<TherapistPatientSummary | null>(null);
  const [patientProfileError, setPatientProfileError] = useState<string | null>(null);
  const [plans, setPlans] = useState<ReviewPlan[]>([]);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [assignedTherapistName, setAssignedTherapistName] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [selectedDayId, setSelectedDayId] = useState(review.sessionId);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [viewedMonth, setViewedMonth] = useState(() => new Date());
  const [sessionDetails, setSessionDetails] = useState({
    planName: review.planName ?? "",
    scheduledDateIso: review.scheduledDateIso ?? ""
  });
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | undefined>();
  const [loadingReview, setLoadingReview] = useState(true);

  // Only persisted attempts are rendered and can be reviewed.
  const [persistedAttemptIds, setPersistedAttemptIds] = useState<Set<string>>(new Set());
  const [scoringStatus, setScoringStatus] = useState<{ tone: "saved" | "error"; message: string } | null>(null);
  const [ptScoreDraft, setPtScoreDraft] = useState("");
  const [ptFeedbackDraft, setPtFeedbackDraft] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  const [changingScoreSource, setChangingScoreSource] = useState(false);
  const [pendingTherapistSelection, setPendingTherapistSelection] = useState(false);
  const patientProfile = patientProfileFromRoute ?? loadedPatientProfile;
  const patientAvatarUrl = useProfilePicture(token, patientProfile?.profilePictureFileId ?? null);

  useEffect(() => {
    let cancelled = false;
    if (patientProfileFromRoute) {
      setLoadedPatientProfile(patientProfileFromRoute);
      setPatientProfileError(null);
    } else if (!token || !patientId || !user?.id) {
      setPatientProfileError(!token
        ? "กรุณาเข้าสู่ระบบอีกครั้งเพื่อดูข้อมูลผู้ป่วย"
        : "ไม่พบรหัสนักกายภาพบำบัดสำหรับโหลดข้อมูลผู้ป่วย");
    } else {
      setLoadedPatientProfile(null);
      setPatientProfileError(null);
      getTherapistPatients(token, user.id)
        .then(({ patients }) => {
          if (cancelled) return;
          const matchingPatient = patients.find((item) => item.id === patientId);
          if (matchingPatient) {
            setLoadedPatientProfile(matchingPatient);
          } else {
            setPatientProfileError("ไม่พบข้อมูลผู้ป่วยในรายชื่อผู้ป่วยของนักกายภาพบำบัด");
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setPatientProfileError(err instanceof ApiError ? err.message : "โหลดข้อมูลผู้ป่วยไม่สำเร็จ");
          }
        });
    }

    if (!token || !patientId) {
      setPlansError(!token ? "กรุณาเข้าสู่ระบบอีกครั้งเพื่อดูแผนการฟื้นฟู" : "ไม่พบรหัสผู้ป่วยสำหรับการตรวจสอบ");
      return () => {
        cancelled = true;
      };
    }

    setPlans([]);
    setPlansError(null);
    getPatientPlans(token, patientId, ["active", "completed"])
      .then((response) => {
        if (cancelled) return;
        setAssignedTherapistName(response.patient?.assignedTherapist?.displayName ?? null);
        const nextPlans = response.plans.filter(isReviewPlan).filter((plan) => plan.scheduleDays.length > 0);
        setPlans(nextPlans);
        const currentPlan = nextPlans.find((plan) =>
          plan.scheduleDays.some((day) => day.id === review.sessionId)
        );
        const preferredPlan = currentPlan ??
          nextPlans.find((plan) => plan.status === "active") ??
          nextPlans[0];
        if (preferredPlan) {
          setSelectedPlanId(preferredPlan.id);
          const currentDay = preferredPlan.scheduleDays.find((day) => day.id === review.sessionId);
          const preferredDay = currentDay ??
            preferredPlan.scheduleDays.find((day) =>
              day.scheduledExercises.some((exercise) =>
                exercise.status === "completed" || (exercise.performanceResults?.length ?? 0) > 0
              )
            ) ??
            preferredPlan.scheduleDays[0];
          if (preferredDay) setSelectedDayId(preferredDay.id);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setPlansError(err instanceof ApiError ? err.message : "โหลดแผนการฟื้นฟูไม่สำเร็จ");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token, user?.id, patientId, review.sessionId, patientProfileFromRoute]);

  useEffect(() => {
    if (!token) {
      setLoadingReview(false);
      setScoringStatus({ tone: "error", message: "กรุณาเข้าสู่ระบบอีกครั้งเพื่อตรวจสอบผลการฝึก" });
      return;
    }
    let cancelled = false;
    setLoadingReview(true);
    setScoringStatus(null);
    getScheduleDayReview(token, selectedDayId)
      .then((res) => {
        if (cancelled) return;
        const mapped = mapRealReviewToExercises(res.review);
        setExercises(mapped);
        setSessionDetails({
          planName: res.review.planName,
          scheduledDateIso: res.review.scheduledDateIso
        });
        setSelectedExerciseId(mapped.find((exercise) => exercise.id === focusExerciseId)?.id ?? mapped[0]?.id);
        setPersistedAttemptIds(new Set(mapped.flatMap((exercise) => exercise.attempts.map((attempt) => attempt.id))));
      })
      .catch((err) => {
        if (!cancelled) {
          setExercises([]);
          setScoringStatus({
            tone: "error",
            message: err instanceof ApiError ? err.message : "โหลดผลการฝึกไม่สำเร็จ"
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingReview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, selectedDayId, focusExerciseId]);

  const selectedExercise = exercises.find((exercise) => exercise.id === selectedExerciseId) ?? exercises[0];
  const selectedAttempt = selectedExercise ? latestAttempt(selectedExercise) : undefined;
  const selectedAttemptReviewed = selectedAttempt?.therapistReviewed ??
    (selectedAttempt?.ptScore != null || selectedAttempt?.ptFeedback != null);
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId);
  const selectedPlanDays = [...(selectedPlan?.scheduleDays ?? [])].sort((a, b) =>
    a.scheduledDate.localeCompare(b.scheduledDate)
  );
  const selectedPlanDayIndex = selectedPlanDays.findIndex((day) => day.id === selectedDayId);
  const selectedPlanDay = selectedPlanDays[selectedPlanDayIndex];
  const selectedDate = selectedPlanDay?.scheduledDate.slice(0, 10) ?? sessionDetails.scheduledDateIso.slice(0, 10);
  useEffect(() => {
    if (selectedDate) setViewedMonth(new Date(`${selectedDate}T12:00:00`));
  }, [selectedDate]);
  const selectedDayLabel = selectedPlanDayIndex >= 0
    ? `วันที่ ${selectedPlanDayIndex + 1}`
    : reviewDayLabel(review.dayLabel);
  const reviewedExerciseIds = new Set(
    exercises
      .filter((exercise) => {
        const attempt = latestAttempt(exercise);
        return attempt != null && (
          attempt.therapistReviewed ?? (attempt.ptScore != null || attempt.ptFeedback != null)
        );
      })
      .map((exercise) => exercise.id)
  );
  const monthStart = new Date(viewedMonth.getFullYear(), viewedMonth.getMonth(), 1);
  const calendarStart = new Date(monthStart);
  calendarStart.setDate(monthStart.getDate() - monthStart.getDay());
  const calendarDates = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(calendarStart);
    date.setDate(calendarStart.getDate() + index);
    return date;
  });

  const choosePlan = (planId: string) => {
    const plan = plans.find((item) => item.id === planId);
    if (!plan) return;
    setSelectedPlanId(plan.id);
    const days = [...plan.scheduleDays].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
    const nextDay = days.find((day) =>
      day.scheduledExercises.some((exercise) =>
        exercise.status === "completed" || (exercise.performanceResults?.length ?? 0) > 0
      )
    ) ?? days[0];
    if (nextDay) {
      setSelectedDayId(nextDay.id);
      setViewedMonth(new Date(`${nextDay.scheduledDate.slice(0, 10)}T12:00:00`));
    }
    setCalendarOpen(false);
  };

  const chooseDay = (day: ReviewPlanDay) => {
    setSelectedDayId(day.id);
    setViewedMonth(new Date(`${day.scheduledDate.slice(0, 10)}T12:00:00`));
    setCalendarOpen(false);
  };

  useEffect(() => {
    if (!selectedAttempt) return;
    setPtScoreDraft(selectedAttempt?.ptScore == null ? "" : String(selectedAttempt.ptScore));
    setPtFeedbackDraft(selectedAttempt?.ptFeedback ?? "");
    setPendingTherapistSelection(false);
    setScoringStatus(null);
  }, [selectedAttempt?.id]);

  const saveTherapistReview = async () => {
    if (!selectedAttempt || !selectedExercise || !token || !persistedAttemptIds.has(selectedAttempt.id)) {
      setScoringStatus({ tone: "error", message: "ไม่สามารถบันทึกผลการฝึกนี้ได้" });
      return;
    }
    const score = ptScoreDraft.trim() === "" ? null : Number(ptScoreDraft);
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) {
      setScoringStatus({ tone: "error", message: "กรุณากรอกคะแนนประเมินตั้งแต่ 0 ถึง 100 หรือเว้นว่างไว้" });
      return;
    }
    if (pendingTherapistSelection && score === null) {
      setScoringStatus({ tone: "error", message: "กรุณากรอกคะแนนนักกายภาพก่อนเลือกใช้คะแนนนี้" });
      return;
    }

    setSavingReview(true);
    setScoringStatus({ tone: "saved", message: "กำลังบันทึกผลการตรวจสอบ…" });
    try {
      const response = await updateAttemptScoring(token, selectedAttempt.id, {
        ptScore: score,
        ptFeedback: ptFeedbackDraft.trim(),
        ...(pendingTherapistSelection ? { evaluationSource: "pt" as const } : {})
      });
      setExercises((current) =>
        current.map((exercise) => ({
          ...exercise,
          attempts: exercise.attempts.map((attempt) =>
            attempt.id === response.attempt.id
              ? {
                  ...attempt,
                  ptScore: response.attempt.ptScore ?? undefined,
                  ptFeedback: response.attempt.ptFeedback ?? undefined,
                  finalScore: response.attempt.finalScore ?? undefined,
                  evaluationSource: response.attempt.evaluationSource ?? undefined,
                  currentScore: response.attempt.currentScore,
                  currentScoreSource: response.attempt.currentScoreSource,
                  therapistReviewed: response.attempt.therapistReviewed
                }
              : attempt
          )
        }))
      );
      setPendingTherapistSelection(false);
      setScoringStatus({ tone: "saved", message: "บันทึกผลการตรวจสอบแล้ว" });
    } catch (err) {
      setScoringStatus({
        tone: "error",
        message: err instanceof ApiError ? err.message : "บันทึกผลการตรวจสอบไม่สำเร็จ กรุณาลองอีกครั้ง"
      });
    } finally {
      setSavingReview(false);
    }
  };

  const selectGradingScore = async (source: "ai" | "pt") => {
    if (!selectedAttempt || !token || !persistedAttemptIds.has(selectedAttempt.id)) return;
    if (source === "ai" && selectedAttempt.aiScore == null) return;
    if (source === "pt" && selectedAttempt.ptScore == null) {
      const score = Number(ptScoreDraft);
      if (
        ptScoreDraft.trim() === "" ||
        !Number.isFinite(score) ||
        score < 0 ||
        score > 100
      ) return;
      setPendingTherapistSelection(true);
      setScoringStatus(null);
      return;
    }

    if (source === "ai" && selectedAttempt.evaluationSource === "ai") {
      setPendingTherapistSelection(false);
      setScoringStatus(null);
      return;
    }

    setChangingScoreSource(true);
    setScoringStatus({ tone: "saved", message: "กำลังบันทึกคะแนนที่ใช้ประเมิน…" });
    try {
      const response = await updateAttemptScoring(token, selectedAttempt.id, { evaluationSource: source });
      setExercises((current) =>
        current.map((exercise) => ({
          ...exercise,
          attempts: exercise.attempts.map((attempt) =>
            attempt.id === response.attempt.id
              ? {
                  ...attempt,
                  finalScore: response.attempt.finalScore ?? undefined,
                  evaluationSource: response.attempt.evaluationSource ?? undefined,
                  currentScore: response.attempt.currentScore,
                  currentScoreSource: response.attempt.currentScoreSource
                }
              : attempt
          )
        }))
      );
      setPendingTherapistSelection(false);
      setScoringStatus({ tone: "saved", message: "บันทึกการเลือกคะแนนที่ใช้ประเมินแล้ว" });
    } catch (err) {
      setScoringStatus({
        tone: "error",
        message: err instanceof ApiError ? err.message : "อัปเดตคะแนนที่ใช้ประเมินไม่สำเร็จ กรุณาลองอีกครั้ง"
      });
    } finally {
      setChangingScoreSource(false);
    }
  };

  return (
    <section className="therapist-shell">
      <TherapistSidebar activeLabel="Sessions" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="therapist-workspace">
        <header className="therapist-topbar srr-topbar">
          <button type="button" className="srr-topbar-back" onClick={onBack} aria-label="ย้อนกลับ">
            <ArrowLeft size={18} />
          </button>
          <div className="srr-topbar-title">
            <h1>ตรวจสอบผลการฝึก</h1>
            <p>ตรวจสอบและประเมินผลการฝึกกายภาพบำบัดของผู้ป่วย</p>
          </div>
        </header>

        <main className="therapist-main srr-page-main">
          <section className="summary-card srr-patient-banner">
            <div className="srr-patient-heading">
              <span className="srr-patient-avatar" aria-hidden="true">
                {patientAvatarUrl
                  ? <img src={patientAvatarUrl} alt="" />
                  : patientProfile?.avatarInitials || <UserRound size={20} />}
              </span>
            </div>
            <div className="srr-patient-info-sections">
              {patientProfileError && <p className="srr-inline-error" role="alert">{patientProfileError}</p>}
              <div className="srr-patient-data-grid">
                <div><span>ชื่อ-นามสกุล</span><strong>{patientProfile?.name ?? review.patientName}</strong></div>
                <div><span>เพศ</span><strong>{genderLabel(patientProfile?.gender)}</strong></div>
                <div><span>วันเกิด</span><strong>{patientProfile?.dateOfBirth ? formatReviewDate(patientProfile.dateOfBirth) : "—"}</strong></div>
                <div><span>ส่วนสูง</span><strong>{patientProfile?.heightCm != null ? `${patientProfile.heightCm} ซม.` : "—"}</strong></div>
                <div><span>น้ำหนัก</span><strong>{patientProfile?.weightKg != null ? `${patientProfile.weightKg} กก.` : "—"}</strong></div>
              </div>
            </div>
          </section>

          <div className="srr-content-grid">
            <div className="srr-main-column">
            <section className="summary-card srr-flow-section">
              <ReviewSectionTitle>เลือกแผนการฝึกและวันที่</ReviewSectionTitle>
              {plansError ? (
                <p className="srr-inline-error" role="alert">{plansError}</p>
              ) : (
                <div className="srr-info-grid">
                  <label className="srr-info-card srr-plan-choice">
                    <span className="srr-eyebrow">แผนฟื้นฟูที่เลือก</span>
                    <strong>{selectedPlan?.name ?? "ไม่พบแผนการฟื้นฟู"}</strong>
                    <ChevronDown size={17} aria-hidden="true" />
                    <select
                      aria-label="เลือกแผนฟื้นฟู"
                      value={selectedPlanId}
                      onChange={(event) => choosePlan(event.target.value)}
                      disabled={plans.length === 0}
                    >
                      {plans.length === 0 && <option value="">ไม่พบแผนการฟื้นฟู</option>}
                      {plans.map((plan, index) => (
                        <option key={plan.id} value={plan.id}>{plan.name || `แผนฟื้นฟูที่ ${index + 1}`}</option>
                      ))}
                    </select>
                  </label>
                  <div className="srr-date-card">
                    <div>
                      <span className="srr-eyebrow">วันที่ในแผน</span>
                      <strong>{selectedPlanDay ? selectedDayLabel : "—"}</strong>
                    </div>
                    <div>
                      <span className="srr-eyebrow">วันที่ฝึกจริง</span>
                      <strong>{selectedAttempt?.completedAtIso
                        ? formatReviewDate(selectedAttempt.completedAtIso.slice(0, 10))
                        : selectedDate
                          ? formatReviewDate(selectedDate)
                          : "—"}</strong>
                    </div>
                    <div className="srr-calendar-anchor">
                      <button
                        type="button"
                        aria-label="เลือกวันที่ตามแผน"
                        onClick={() => setCalendarOpen((open) => !open)}
                        disabled={!selectedPlan}
                        aria-expanded={calendarOpen}
                      >
                        <CalendarDays size={18} />
                      </button>
                      {calendarOpen && selectedPlan && (
                        <div className="srr-calendar" role="dialog" aria-label="เลือกวันที่ตามแผน">
                          <div className="srr-calendar-header">
                            <button type="button" aria-label="เดือนก่อนหน้า" onClick={() => setViewedMonth(new Date(viewedMonth.getFullYear(), viewedMonth.getMonth() - 1, 1))}>
                              <ChevronLeft size={16} />
                            </button>
                            <strong>{formatMonth(viewedMonth)}</strong>
                            <button type="button" aria-label="เดือนถัดไป" onClick={() => setViewedMonth(new Date(viewedMonth.getFullYear(), viewedMonth.getMonth() + 1, 1))}>
                              <ChevronRight size={16} />
                            </button>
                          </div>
                          <div className="srr-calendar-grid" aria-hidden="true">
                            {["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"].map((day) => <span key={day}>{day}</span>)}
                          </div>
                          <div className="srr-calendar-grid">
                            {calendarDates.map((date) => {
                              const isoDate = [
                                date.getFullYear(),
                                String(date.getMonth() + 1).padStart(2, "0"),
                                String(date.getDate()).padStart(2, "0")
                              ].join("-");
                              const matchingDay = selectedPlanDays.find((day) => day.scheduledDate.slice(0, 10) === isoDate);
                              const inMonth = date.getMonth() === viewedMonth.getMonth();
                              return (
                                <button
                                  key={isoDate}
                                  type="button"
                                  className={`${inMonth ? "" : "outside-month"} ${selectedDate === isoDate ? "selected" : ""}`}
                                  disabled={!matchingDay}
                                  onClick={() => matchingDay && chooseDay(matchingDay)}
                                  aria-label={`${date.toLocaleDateString("th-TH")} ${matchingDay ? "" : "ไม่มีวันที่ในแผน"}`}
                                >
                                  {date.getDate()}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="summary-card srr-flow-section">
              <ReviewSectionTitle
                aside={<span className="srr-title-note">{reviewedExerciseIds.size} / {exercises.length} ตรวจสอบแล้ว</span>}
              >
                เลือกผลการฝึก
              </ReviewSectionTitle>
              {loadingReview ? (
                <p className="srr-empty-note" role="status">กำลังโหลดผลการฝึก…</p>
              ) : exercises.length === 0 ? (
                <p className="srr-empty-note">{scoringStatus?.tone === "error" ? scoringStatus.message : "ไม่มีผลการฝึกที่บันทึกไว้ในวันที่เลือก"}</p>
              ) : (
                <div className="srr-result-scroller" aria-label="เลือกผลการฝึก">
                  {exercises.map((exercise) => {
                    const reviewed = reviewedExerciseIds.has(exercise.id);
                    const active = exercise.id === selectedExercise?.id;
                    const attempt = latestAttempt(exercise);
                    const scoreSource = attempt?.currentScoreSource ?? attempt?.evaluationSource ?? "ai";
                    const isTherapistScore = scoreSource === "pt" || scoreSource === "manual";
                    const displayedScore = isTherapistScore ? attempt?.ptScore : attempt?.aiScore;
                    return (
                      <button
                        key={exercise.id}
                        type="button"
                        className={`srr-exercise-card ${active ? "selected" : ""}`}
                        onClick={() => setSelectedExerciseId(exercise.id)}
                      >
                        <span className={`srr-exercise-status ${reviewed ? "reviewed" : "pending"}`}>
                          {reviewed ? "ตรวจสอบแล้ว" : "ยังไม่ได้ตรวจสอบ"}
                        </span>
                        <strong className="srr-exercise-name">{exercise.exerciseName}</strong>
                        <span className="srr-exercise-score">
                          {isTherapistScore ? "คะแนนนักกายภาพ" : "คะแนน AI"} <b>{displayedScore ?? "—"}</b>
                        </span>
                        {active && <span className="srr-selected-check"><Check size={12} /></span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {selectedExercise && selectedAttempt && (
              <>
                <AttemptReview
                  attempt={selectedAttempt}
                  exercise={selectedExercise}
                  token={token}
                  ptScoreDraft={ptScoreDraft}
                  ptFeedbackDraft={ptFeedbackDraft}
                  onPtScoreChange={setPtScoreDraft}
                  onPtFeedbackChange={setPtFeedbackDraft}
                  onSave={saveTherapistReview}
                  saving={savingReview}
                  onSelectGradingScore={selectGradingScore}
                  pendingTherapistSelection={pendingTherapistSelection}
                  changingScoreSource={changingScoreSource}
                  onPrevious={() => {
                    const index = exercises.findIndex((exercise) => exercise.id === selectedExercise.id);
                    if (index > 0) setSelectedExerciseId(exercises[index - 1].id);
                  }}
                  onNext={() => {
                    const index = exercises.findIndex((exercise) => exercise.id === selectedExercise.id);
                    if (index < exercises.length - 1) setSelectedExerciseId(exercises[index + 1].id);
                  }}
                  hasPrevious={exercises.findIndex((exercise) => exercise.id === selectedExercise.id) > 0}
                  hasNext={exercises.findIndex((exercise) => exercise.id === selectedExercise.id) < exercises.length - 1}
                  scoringStatus={scoringStatus}
                />
              </>
            )}
            </div>
          </div>
        </main>
      </div>
    </section>
  );
}

function AttemptReview({
  attempt,
  exercise,
  token,
  ptScoreDraft,
  ptFeedbackDraft,
  onPtScoreChange,
  onPtFeedbackChange,
  onSave,
  saving,
  onSelectGradingScore,
  pendingTherapistSelection,
  changingScoreSource,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
  scoringStatus
}: {
  attempt: ExercisePerformanceAttempt;
  exercise: SessionExerciseReview;
  token?: string | null;
  ptScoreDraft: string;
  ptFeedbackDraft: string;
  onPtScoreChange: (value: string) => void;
  onPtFeedbackChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  onSelectGradingScore: (source: "ai" | "pt") => void;
  pendingTherapistSelection: boolean;
  changingScoreSource: boolean;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  scoringStatus: { tone: "saved" | "error"; message: string } | null;
}) {
  const therapistScoreIsActive =
    pendingTherapistSelection ||
    ((attempt.evaluationSource === "pt" || attempt.evaluationSource === "manual") &&
      attempt.ptScore != null);
  const parsedTherapistScore = Number(ptScoreDraft);
  const therapistScoreDisplay = ptScoreDraft.trim() !== "" &&
    Number.isFinite(parsedTherapistScore) &&
    parsedTherapistScore >= 0 &&
    parsedTherapistScore <= 100
    ? ptScoreDraft
    : "—";
  const aiScoreRange = attemptAiScoreRange(exercise);
  // Minigames display their own saved settings here, rather than a mixed list
  // of generic exercise criteria that do not apply to that game.
  const trackingParameters = minigameTrackingParameters(exercise.baseCriteria) ?? exercise.baseCriteria ?? [];
  // Stream the patient's recorded attempt video: the real attempt carries a
  // server files-row id (referenceVideoFileId) — fetch the bytes via the auth'd
  // GET /files/:fileId/content endpoint and render a real player. Mock attempts
  // (no file id) keep the placeholder box.
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);

  useEffect(() => {
    const fileId = attempt.referenceVideoFileId ?? null;
    if (!token || !fileId) {
      setVideoUrl(null);
      setVideoError(false);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setVideoUrl(null);
    setVideoError(false);
    setVideoLoading(true);
    getFileContent(token, fileId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setVideoUrl(objectUrl);
        setVideoLoading(false);
      })
      .catch(() => {
        if (!cancelled) { setVideoError(true); setVideoLoading(false); }
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, attempt.referenceVideoFileId]);

  const videoLabel = attempt.referenceVideo?.fileName
    ? attempt.referenceVideo.fileName
    : videoUrl
      ? "วิดีโอการฝึกของผู้ป่วย"
      : videoError
        ? "โหลดวิดีโอการฝึกของผู้ป่วยไม่สำเร็จ"
        : "ยังไม่มีวิดีโอแนบ";

  return (
    <div className="srr-review-workspace">
      <section className="summary-card srr-flow-section srr-media-exercise-card">
        <ReviewSectionTitle>
          ตรวจสอบผลการฝึก
        </ReviewSectionTitle>
        <div className="srr-video-col" style={{ width: "100%", alignSelf: "stretch" }}>
          <ReviewVideoPlayer
            src={videoUrl}
            isLoading={videoLoading}
            hasError={videoError}
            trackingType={exercise.movementTracking}
            overlayAlreadyIncluded
            placeholderLabel={videoLabel}
          />
        </div>

        <div className="srr-exercise-info">
          <div className="srr-exercise-info-heading">
            <span className="srr-eyebrow">ข้อมูลท่าบริหาร</span>
            {exercise.difficultyLevel && (
              <span className={`difficulty-badge srr-exercise-difficulty ${exerciseDifficultyClass(exercise.difficultyLevel)}`}>
                ระดับความยาก: {exerciseDifficultyLabel(exercise.difficultyLevel)}
              </span>
            )}
            <h2>{exercise.exerciseName}</h2>
          </div>
          <div className="srr-metrics-grid">
            {exercise.targetValueLabel && <div><span>เป้าหมาย</span><strong>{exercise.targetValueLabel}</strong></div>}
            {exercise.baseCriteria?.map((criterion) => (
              <div key={criterion.label}>
                <span>{criterionLabel(criterion.label)}</span>
                <strong>{isHoldSecondsCriterion(criterion.label) ? aiScoreRange : criterion.value}</strong>
              </div>
            ))}
            {exercise.movementTracking && (
              <div><span>การติดตาม</span><strong>{movementTrackingLabel(exercise.movementTracking)}</strong></div>
            )}
          </div>
          {exercise.therapistInstruction && (
            <p><strong>คำแนะนำจากนักกายบำบัดที่ดูเเล:</strong> {exercise.therapistInstruction}</p>
          )}
          <details className="srr-ai-parameters">
            <summary>AI Tracking Parameters</summary>
            {(attempt.aiMetrics?.length || trackingParameters.length || attempt.aiEvaluatedAtLabel) ? (
              <div className="srr-ai-parameters-grid">
                {attempt.aiMetrics?.map((metric) => (
                  <div className="srr-ai-parameter-item" key={metric.label}>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                  </div>
                ))}
                {trackingParameters.map((criterion) => (
                  <div className="srr-ai-parameter-item" key={criterion.label}>
                    <span>{criterionLabel(criterion.label)}</span>
                    <strong>{isHoldSecondsCriterion(criterion.label) ? aiScoreRange : criterion.value}</strong>
                  </div>
                ))}
                {attempt.aiEvaluatedAtLabel && (
                  <div className="srr-ai-parameter-item">
                    <span>AI ประเมินเมื่อ</span>
                    <strong>{attempt.aiEvaluatedAtLabel}</strong>
                  </div>
                )}
              </div>
            ) : (
              <p>ไม่มีพารามิเตอร์เพิ่มเติมสำหรับผลการฝึกนี้</p>
            )}
          </details>
        </div>
      </section>

      <div className="srr-review-sidebar">
      <section className="summary-card srr-flow-section srr-evaluation-card">
        <ReviewSectionTitle>ผลการประเมิน</ReviewSectionTitle>
        <div className="srr-score-grid">
          <div
            className={`srr-score-card ai ${therapistScoreIsActive ? "" : "selected"}`}
            onClick={(event) => {
              if (!(event.target instanceof Element) || !event.target.closest("button")) {
                onSelectGradingScore("ai");
              }
            }}
          >
            <span className="srr-score-heading">
              <span>คะแนน AI</span>
              <button
                type="button"
                className="srr-score-check"
                onClick={() => onSelectGradingScore("ai")}
                disabled={attempt.aiScore == null || saving || changingScoreSource}
                aria-label="ใช้คะแนน AI"
                aria-pressed={!therapistScoreIsActive}
              >
                {!therapistScoreIsActive && <Check size={12} />}
              </button>
            </span>
            <strong className="srr-score">{attempt.aiScore ?? "—"}</strong>
          </div>
          <div
            className={`srr-score-card therapist ${therapistScoreIsActive ? "selected" : ""}`}
            onClick={(event) => {
              if (
                !(event.target instanceof Element) ||
                !event.target.closest("button, input")
              ) onSelectGradingScore("pt");
            }}
          >
            <span className="srr-score-heading">
              <span>คะแนนนักกายภาพ</span>
              <button
                type="button"
                className="srr-score-check"
                onClick={() => onSelectGradingScore("pt")}
                disabled={
                  (attempt.ptScore == null && therapistScoreDisplay === "—") ||
                  saving ||
                  changingScoreSource
                }
                aria-label="ใช้คะแนนนักกายภาพบำบัด"
                aria-pressed={therapistScoreIsActive}
              >
                {therapistScoreIsActive && <Check size={12} />}
              </button>
            </span>
            <strong className="srr-score">{therapistScoreDisplay}</strong>
            <span className="srr-score-details">
              <span>คะแนนที่ประเมิน</span>
              <span className="srr-therapist-score">
                <input
                  className="srr-score-input"
                  value={ptScoreDraft}
                  onChange={(event) => onPtScoreChange(event.target.value)}
                  inputMode="numeric"
                  min={0}
                  max={100}
                  type="number"
                  placeholder="—"
                  aria-label="คะแนนประเมินจากนักกายภาพบำบัดตั้งแต่ 0 ถึง 100"
                  disabled={saving || changingScoreSource}
                />
                <span>/ 100</span>
              </span>
            </span>
          </div>
        </div>
      </section>

      <section className="summary-card srr-flow-section srr-feedback-card">
        <ReviewSectionTitle>Feedback จากนักกายภาพบำบัด</ReviewSectionTitle>
        <label className="srr-feedback-field">
        <textarea
          value={ptFeedbackDraft}
          onChange={(event) => onPtFeedbackChange(event.target.value)}
          placeholder="ระบุความคิดเห็นเกี่ยวกับผลการฝึกและคำแนะนำสำหรับผู้ป่วย..."
          aria-label="ข้อเสนอแนะจากนักกายภาพบำบัด"
          disabled={saving || changingScoreSource}
        />
          <small>{ptFeedbackDraft.length} / 500</small>
        </label>
      </section>

      <section className="summary-card srr-flow-section srr-action-section">
        <ReviewSectionTitle>การดำเนินการ</ReviewSectionTitle>
        <div className="srr-review-actions">
          <button type="button" className="srr-nav-button" onClick={onPrevious} disabled={!hasPrevious || saving || changingScoreSource}>
            <ChevronLeft size={18} /><span>ก่อนหน้า</span>
          </button>
          <button type="button" className="primary-button srr-save-review" onClick={onSave} disabled={saving || changingScoreSource}>
            <Save size={17} /> {saving ? "กำลังบันทึก…" : "บันทึกผลประเมิน"}
          </button>
          <button type="button" className="srr-nav-button" onClick={onNext} disabled={!hasNext || saving || changingScoreSource}>
            <span>ถัดไป</span><ChevronRight size={18} />
          </button>
        </div>
        {scoringStatus && (
          <p className="srr-save-status" role="status" data-tone={scoringStatus.tone}>{scoringStatus.message}</p>
        )}
      </section>
      </div>
    </div>
  );
}
