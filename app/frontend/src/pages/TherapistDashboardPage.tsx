import {
  Activity,
  Clock,
  Search,
  TrendingUp,
  Users
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TherapistSidebar } from "../components/TherapistSidebar";
import AssignPatientModal from "../components/AssignPatientModal";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import {
  ApiError,
  getPatientProgressTrend,
  getPatientPlans,
  getTherapistDashboard,
  type TherapistDashboardData
} from "../services/api";
import { useAuth } from "../store/authStore";
import { useProfilePicture, useOwnProfilePicture } from "../hooks/useProfilePicture";
import type { PatientProgressTrend, TherapistPatientSummary } from "../types";
import { initialsFromName } from "../utils/displayName";
import { ISO_DATE_RE } from "../utils/rehabPlan";

interface TherapistDashboardPageProps {
  onLogout: () => void;
  onNavigate: (label: TherapistNavLabel) => void;
  onViewPatient: (patient: TherapistPatientSummary) => void;
}

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("th-TH", { weekday: "long" });
const DATE_FORMATTER = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "long", year: "numeric" });
const PERIOD_DATE_FORMATTER = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" });
const AXIS_DATE_FORMATTER = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" });
const FULL_DATE_FORMATTER = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "long", year: "numeric" });

const WEEKDAY_LABELS: Record<string, string> = {
  Mon: "จ.",
  Tue: "อ.",
  Wed: "พ.",
  Thu: "พฤ.",
  Fri: "ศ.",
  Sat: "ส.",
  Sun: "อา."
};

const CONDITION_LABELS: Record<string, string> = {
  "Ischemic Stroke": "โรคหลอดเลือดสมองชนิดขาดเลือด",
  "Hemorrhagic Stroke": "โรคหลอดเลือดสมองชนิดเลือดออก",
  "TIA Recovery": "ฟื้นฟูภาวะสมองขาดเลือดชั่วคราว",
  "Post-Stroke": "ฟื้นฟูหลังโรคหลอดเลือดสมอง"
};

function conditionLabel(condition: string): string {
  return CONDITION_LABELS[condition] ?? condition;
}

function sessionDateLabel(label: string): string {
  const labels: Record<string, string> = {
    Today: "วันนี้",
    Yesterday: "เมื่อวาน",
    "3 days ago": "3 วันที่แล้ว",
    "1 week ago": "1 สัปดาห์ที่แล้ว"
  };
  return labels[label] ?? label;
}

function planStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    active: "กำลังดำเนินการ",
    completed: "เสร็จสิ้น",
    draft: "ฉบับร่าง",
    paused: "หยุดชั่วคราว"
  };
  return labels[status.toLowerCase()] ?? status;
}

// ---------------------------------------------------------------------------
// Plan-scoped recovery chart — the plan selector next to the patient selector
// scopes "Avg. Recovery Progress" to ONE of that patient's rehabilitation
// plans (GET /patients/:id/plans; therapists may read any patient's plans).
// Only the slice of the payload this chart reads is kept — the full plan row
// (attachments, notes, exercise labels…) is far larger than the graph needs.
// ---------------------------------------------------------------------------

interface ChartPlanExercise {
  // Raw exercise_performance_result rows: attemptNumber + finalScore/ptScore/aiScore.
  performanceResults: any[];
}

interface ChartPlanDay {
  /** "YYYY-MM-DD" of this scheduled day — null only for undated rows. */
  dateLabel: string | null;
  exercises: ChartPlanExercise[];
}

interface ChartPlan {
  id: string;
  name: string;
  status: string;
  startDateLabel: string;
  endDateLabel: string;
  days: ChartPlanDay[];
}

/** Prisma Date → "YYYY-MM-DD" (rows arrive as ISO strings over the wire). */
function isoSliceDate(value: any): string {
  if (!value) return "";
  return typeof value === "string" ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10);
}

/** Parse "YYYY-MM-DD" as a LOCAL date (day-stepping must not cross timezones). */
function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// Slim sibling of PatientProgressPage's mapServerPlans — same date-derivation
// rules (plan start falls back to the first scheduled day), fewer fields.
function mapPlansForChart(serverPlans: any[]): ChartPlan[] {
  return serverPlans.map((sp: any) => {
    const firstScheduleDate = sp.scheduleDays?.[0]?.scheduledDate ? isoSliceDate(sp.scheduleDays[0].scheduledDate) : "";
    const start = sp.startDate ? isoSliceDate(sp.startDate) : firstScheduleDate;
    const end = sp.endDate ? isoSliceDate(sp.endDate) : "";
    return {
      id: sp.id,
      name: sp.name,
      status: sp.status,
      startDateLabel: start,
      endDateLabel: end,
      days: (sp.scheduleDays ?? []).map((sd: any) => ({
        dateLabel: sd.scheduledDate ? isoSliceDate(sd.scheduledDate) : null,
        exercises: (sd.scheduledExercises ?? []).map((ex: any) => ({
          performanceResults: ex.performanceResults ?? []
        }))
      }))
    };
  });
}

interface PlanDayPoint {
  /** "YYYY-MM-DD" (or synthetic "day-N") key for this x-axis slot. */
  key: string;
  /** Short axis label ("5 Sep"); "Day N" for plans with no date anchor. */
  label: string;
  /** Long tooltip label ("5 September 2026"). */
  longLabel: string;
  /** Mean of the day's exercises' latest scores — null = nothing scored yet. */
  score: number | null;
  /** How many exercises fed the average (tooltip context). */
  scoredExercises: number;
}

// One exercise's score = its LATEST attempt's effective score — the same
// finalScore ?? ptScore ?? aiScore precedence PatientProgressPage,
// PatientHistoryPage and therapist.service's own report already use.
function latestExerciseScore(results: any[]): number | null {
  if (!results || results.length === 0) return null;
  const latest = results.reduce(
    (best: any, candidate: any) => (!best || (candidate?.attemptNumber ?? 0) > (best?.attemptNumber ?? 0) ? candidate : best),
    null
  );
  const raw = latest?.finalScore ?? latest?.ptScore ?? latest?.aiScore;
  if (raw === null || raw === undefined) return null;
  const num = typeof raw === "number" ? raw : Number(raw);
  return Number.isNaN(num) ? null : num;
}

function planDayPoint(day: ChartPlanDay | null, key: string, label: string, longLabel: string): PlanDayPoint {
  const scores: number[] = [];
  for (const exercise of day?.exercises ?? []) {
    const score = latestExerciseScore(exercise.performanceResults);
    if (score !== null) scores.push(score);
  }
  return {
    key,
    label,
    longLabel,
    // Average across the exercises that HAVE a score — an unscored exercise
    // never drags the day down as a phantom 0, and a day with no scores at all
    // stays null (a gap in the line, never a fabricated number).
    score: scores.length > 0 ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null,
    scoredExercises: scores.length
  };
}

// One point per calendar day from the plan's earliest to latest scheduled date
// — a 14-day plan produces exactly 14 points, whatever dates the therapist
// actually scheduled exercises on. Falls back to "Day 1…N" slots when the
// plan's days carry no dates, and to the dated days themselves when the span
// is unreasonably long (> 180 days) so the axis can't explode.
function buildPlanDayPoints(plan: ChartPlan | null): PlanDayPoint[] {
  if (!plan) return [];

  const dayByDate = new Map<string, ChartPlanDay>();
  for (const day of plan.days) {
    if (day.dateLabel && ISO_DATE_RE.test(day.dateLabel)) dayByDate.set(day.dateLabel, day);
  }
  if (dayByDate.size === 0) {
    return plan.days.map((day, index) =>
      planDayPoint(day, `day-${index + 1}`, `วันที่ ${index + 1}`, `วันที่ ${index + 1}`)
    );
  }

  const sortedDates = Array.from(dayByDate.keys()).sort();

  // Bounds = the plan's OWN start/end dates when present (the user-visible plan
  // period — a 14-day plan charts 14 days even if one schedule row is missing),
  // widened by the scheduled days themselves whenever they fall outside.
  // ISO dates compare correctly as strings; sortedDates guarantees min ≤ max.
  const minIso = ISO_DATE_RE.test(plan.startDateLabel) && plan.startDateLabel < sortedDates[0] ? plan.startDateLabel : sortedDates[0];
  const lastScheduled = sortedDates[sortedDates.length - 1];
  const maxIso = ISO_DATE_RE.test(plan.endDateLabel) && plan.endDateLabel > lastScheduled ? plan.endDateLabel : lastScheduled;

  const first = parseIsoDate(minIso);
  const last = parseIsoDate(maxIso);
  const spanDays = Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1;

  const dates: string[] = [];
  if (spanDays <= 180) {
    const cursor = new Date(first);
    while (cursor.getTime() <= last.getTime()) {
      dates.push(
        `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`
      );
      cursor.setDate(cursor.getDate() + 1);
    }
  } else {
    dates.push(...sortedDates);
  }

  return dates.map((iso) => {
    const date = parseIsoDate(iso);
    return planDayPoint(dayByDate.get(iso) ?? null, iso, AXIS_DATE_FORMATTER.format(date), FULL_DATE_FORMATTER.format(date));
  });
}

// Thai date range (or a scheduled-day count when undated) for the chart subtitle.
function planPeriodLabel(plan: ChartPlan): string {
  const count = plan.days.length;
  if (ISO_DATE_RE.test(plan.startDateLabel) && ISO_DATE_RE.test(plan.endDateLabel)) {
    return `${PERIOD_DATE_FORMATTER.format(parseIsoDate(plan.startDateLabel))} ถึง ${PERIOD_DATE_FORMATTER.format(
      parseIsoDate(plan.endDateLabel)
    )}`;
  }
  if (ISO_DATE_RE.test(plan.startDateLabel)) {
    return `เริ่ม ${PERIOD_DATE_FORMATTER.format(parseIsoDate(plan.startDateLabel))} · ${count} วัน`;
  }
  return `${count} วันที่กำหนดไว้`;
}

// Tooltip for the plan-day chart — recharts' default tooltip prints raw nulls
// for unscored days, so this renders "No score yet" instead and shows how many
// exercises fed the average.
function PlanDayTooltip({ active, payload }: { active?: boolean; payload?: readonly any[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload as PlanDayPoint;
  return (
    <div
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "8px 10px",
        fontSize: 13
      }}
    >
      <strong style={{ display: "block", marginBottom: 2 }}>{point.longLabel}</strong>
      <span>
        {point.score === null
          ? "ยังไม่มีคะแนน"
          : `คะแนนเฉลี่ย ${point.score}/100 · ${point.scoredExercises} ท่า`}
      </span>
    </div>
  );
}

// One patient-table avatar: resolves the row's profilePictureFileId to a blob
// object URL via the shared useProfilePicture hook (the file lives behind the
// auth'd GET /files/:id/content endpoint, so an <img src> can't point at it
// directly). A hook can't be called per-row in the table's map callback, hence
// this small wrapper — same pattern as AdminUserManagementPage's UserAvatar:
// photo when resolved, initials badge otherwise (no file / loading / failed).
function PatientAvatar({ token, fileId, name }: { token: string | null | undefined; fileId?: string | null; name: string }) {
  const avatarUrl = useProfilePicture(token, fileId ?? null);
  return (
    <span className={`therapist-avatar${avatarUrl ? " with-photo" : ""}`}>
      {avatarUrl ? <img src={avatarUrl} alt={`${name}'s profile picture`} /> : initialsFromName(name)}
    </span>
  );
}

export function TherapistDashboardPage({ onLogout, onNavigate, onViewPatient }: TherapistDashboardPageProps) {
  const { token, user } = useAuth();

  const [search, setSearch] = useState("");
  const [assignModalOpen, setAssignModalOpen] = useState(false);

  // Real dashboard data (modules/therapist/* on the backend) — replaces the
  // former data/therapistMock.ts imports (therapistPatients, weeklySessionData,
  // therapistProfile). Loaded once on mount / whenever the logged-in therapist
  // changes; there's no polling or refetch-on-focus yet, so switching to another
  // tab and back won't pick up changes made elsewhere until the page remounts.
  const [dashboard, setDashboard] = useState<TherapistDashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;

    setDashboardLoading(true);
    setDashboardError(null);

    getTherapistDashboard(token, user.id)
      .then((data) => {
        if (!cancelled) setDashboard(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setDashboardError(err instanceof ApiError ? err.message : "โหลดแดชบอร์ดไม่สำเร็จ กรุณาลองอีกครั้ง");
        }
      })
      .finally(() => {
        if (!cancelled) setDashboardLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, user]);

  const patients = dashboard?.patients ?? [];

  // Drives the "Avg. Recovery Progress" chart — null until the PT picks a patient
  // (top-right selector, or clicking a row in the table below), matching the
  // requested UX: don't plot anything until a patient/plan is chosen.
  const [trendPatientId, setTrendPatientId] = useState<string | null>(null);
  const [trend, setTrend] = useState<PatientProgressTrend | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);

  // Plan selector (next to the patient selector) — holds EVERY plan the
  // selected patient has (GET /patients/:id/plans; the backend lets any
  // therapist read any patient's plans). Choosing one scopes the chart to that
  // plan's min→max date with one point per day. On patient switch the list is
  // re-fetched and the active plan auto-selected (falling back to the most
  // recent plan) so the chart is immediately plan-sized; picking
  // "Select plan…" drops back to the pre-existing weekly trend.
  const [planOptions, setPlanOptions] = useState<ChartPlan[]>([]);
  const [planOptionsLoading, setPlanOptionsLoading] = useState(false);
  const [trendPlanId, setTrendPlanId] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !trendPatientId) {
      setTrend(null);
      return;
    }
    let cancelled = false;
    setTrendLoading(true);

    getPatientProgressTrend(token, trendPatientId)
      .then((data) => {
        if (!cancelled) setTrend(data);
      })
      .catch(() => {
        if (!cancelled) setTrend(null);
      })
      .finally(() => {
        if (!cancelled) setTrendLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, trendPatientId]);

  // Load all of the selected patient's plans and auto-select one (see the
  // state declaration above for the auto-select rules). Selection is reset
  // synchronously so a fast patient switch can never keep the previous
  // patient's plan (or worse, chart THEIR days under the new patient).
  useEffect(() => {
    if (!token || !trendPatientId) {
      setPlanOptions([]);
      setTrendPlanId(null);
      return;
    }
    let cancelled = false;
    setPlanOptionsLoading(true);
    setTrendPlanId(null);

    getPatientPlans(token, trendPatientId)
      .then(({ plans }) => {
        if (cancelled) return;
        const mapped = mapPlansForChart(plans);
        setPlanOptions(mapped);
        const preferred = mapped.find((plan) => plan.status === "active") ?? mapped[0] ?? null;
        setTrendPlanId(preferred?.id ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setPlanOptions([]);
        setTrendPlanId(null);
      })
      .finally(() => {
        if (!cancelled) setPlanOptionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, trendPatientId]);

  const filteredPatients = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return patients;
    return patients.filter((patient) =>
      [patient.name, patient.nameTh ?? "", patient.condition, conditionLabel(patient.condition)]
        .some((value) => value.toLowerCase().includes(query))
    );
  }, [search, patients]);

  const stats = dashboard?.stats;
  const weeklySessions = dashboard?.weeklySessions ?? [];

  const trendPatient = trendPatientId ? (patients.find((p) => p.id === trendPatientId) ?? null) : null;
  const selectedPlan = planOptions.find((plan) => plan.id === trendPlanId) ?? null;
  const planPoints = useMemo(() => buildPlanDayPoints(selectedPlan), [selectedPlan]);
  // Delta badge — plan mode: first vs last SCORED day of the selected plan;
  // weekly mode: first vs last point of the existing report trend (unchanged).
  const scoredPlanPoints = planPoints.filter(
    (point): point is PlanDayPoint & { score: number } => point.score !== null
  );
  const trendDelta = selectedPlan
    ? scoredPlanPoints.length > 1
      ? scoredPlanPoints[scoredPlanPoints.length - 1].score - scoredPlanPoints[0].score
      : null
    : trend && trend.points.length > 1
      ? trend.points[trend.points.length - 1].score - trend.points[0].score
      : null;

  const displayName = user?.displayName || user?.username || "นักกายภาพบำบัด";
  const ownAvatarUrl = useOwnProfilePicture();
  const today = new Date();

  return (
    <section className="therapist-shell">
      <TherapistSidebar activeLabel="Dashboard" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>แดชบอร์ด</h1>
              <p>
                {WEEKDAY_FORMATTER.format(today)}ที่ {DATE_FORMATTER.format(today)}
            </p>
          </div>
          <div className="therapist-topbar-actions">
            <div className="therapist-topbar-profile">
              <div>
                <strong>{displayName}</strong>
                <small>นักกายภาพบำบัด</small>
              </div>
              <span className={`avatar-badge${ownAvatarUrl ? " with-photo" : ""}`}>
                {ownAvatarUrl ? <img src={ownAvatarUrl} alt={`${displayName}'s profile picture`} /> : initialsFromName(displayName)}
              </span>
            </div>
          </div>
        </header>

        <main className="therapist-main">
          {dashboardError && (
            <div className="summary-card" role="alert" style={{ borderColor: "var(--danger, #d33)", marginBottom: 16 }}>
              <p style={{ margin: 0 }}>{dashboardError}</p>
            </div>
          )}

          <div className="therapist-stat-grid">
            <StatCard
              icon={<Users size={20} />}
              label="ผู้ป่วยที่ดูแล"
              value={dashboardLoading ? "…" : (stats?.activePatients ?? 0)}
            />
            <StatCard
              icon={<Activity size={20} />}
              label="การฝึกวันนี้"
              value={dashboardLoading ? "…" : (stats?.sessionsToday ?? 0)}
              accent="teal"
            />
            <StatCard
              icon={<TrendingUp size={20} />}
              label="อัตราการทำตามแผนเฉลี่ย"
              value={dashboardLoading ? "…" : `${stats?.avgCompliancePercent ?? 0}%`}
              accent="success"
            />
            <StatCard
              icon={<Clock size={20} />}
              label="รายการที่รอตรวจสอบ"
              value={dashboardLoading ? "…" : (stats?.pendingReviews ?? 0)}
              accent="warning"
            />
          </div>

          <div className="therapist-chart-grid">
            <div className="summary-card therapist-chart-card">
              <div className="therapist-chart-heading">
                <div>
                  <strong>ความก้าวหน้าในการฟื้นฟูเฉลี่ย</strong>
                  <p>
                    {trendPatient
                      ? selectedPlan
                        ? `${selectedPlan.name} · ${planPeriodLabel(selectedPlan)}`
                        : (trend?.planName ?? "เลือกแผนการฟื้นฟูเพื่อดูคะแนนรายวัน")
                      : "เลือกผู้ป่วยเพื่อดูแนวโน้มการฟื้นฟู"}
                  </p>
                </div>
                <div className="therapist-chart-heading-actions">
                  <select
                    className="admin-role-select"
                    value={trendPatientId ?? ""}
                    onChange={(event) => setTrendPatientId(event.target.value || null)}
                    aria-label="เลือกผู้ป่วยสำหรับกราฟความก้าวหน้าในการฟื้นฟู"
                  >
                    <option value="">เลือกผู้ป่วย…</option>
                    {patients.map((patient) => (
                      <option key={patient.id} value={patient.id}>
                        {patient.name}
                      </option>
                    ))}
                  </select>
                  {/* Plan selector — populated with EVERY plan the selected
                      patient has; choosing one sizes the chart to that plan's
                      min→max date (one point per day, each day = the average
                      of that day's exercise scores). */}
                  <select
                    className="admin-role-select"
                    value={trendPlanId ?? ""}
                    onChange={(event) => setTrendPlanId(event.target.value || null)}
                    disabled={!trendPatientId || planOptionsLoading}
                    aria-label="เลือกแผนการฟื้นฟูสำหรับกราฟความก้าวหน้า"
                  >
                    <option value="">
                      {!trendPatientId
                        ? "เลือกผู้ป่วยก่อน…"
                        : planOptionsLoading
                          ? "กำลังโหลดแผน…"
                          : planOptions.length > 0
                            ? "เลือกแผน…"
                            : "ยังไม่มีแผน"}
                    </option>
                    {planOptions.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name} ({planStatusLabel(plan.status)})
                      </option>
                    ))}
                  </select>
                  {trendDelta !== null && (
                    <span className={`badge-pill ${trendDelta >= 0 ? "good" : "poor"}`}>
                      {trendDelta >= 0 ? "+" : ""}
                      {trendDelta}pts
                    </span>
                  )}
                </div>
              </div>
              {trendLoading || planOptionsLoading ? (
                <div className="therapist-chart-empty">
                  <TrendingUp size={22} />
                  <p>กำลังโหลดข้อมูลแนวโน้ม…</p>
                </div>
              ) : trendPatient && selectedPlan ? (
                // Plan-scoped chart: one point per calendar day across the
                // plan's min→max date (a 14-day plan → 14 days). Each day's
                // score is the AVERAGE of that day's exercises' latest scores;
                // unscored days stay null → a gap in the line (connectNulls
                // off), never a fabricated 0.
                planPoints.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={planPoints} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
                        axisLine={false}
                        tickLine={false}
                        // One tick per day so every day of the plan is visible;
                        // longer plans thin the labels out instead of colliding.
                        interval={planPoints.length > 14 ? "preserveStartEnd" : 0}
                        minTickGap={8}
                      />
                      <YAxis
                        tick={{ fontSize: 12, fill: "var(--text-secondary)" }}
                        axisLine={false}
                        tickLine={false}
                        domain={[0, 100]}
                      />
                      <Tooltip content={PlanDayTooltip} />
                      <Line
                        type="monotone"
                        dataKey="score"
                        stroke="var(--primary)"
                        strokeWidth={2.5}
                        dot={{ fill: "var(--primary)", r: 4, strokeWidth: 0 }}
                        activeDot={{ r: 6 }}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="therapist-chart-empty">
                    <TrendingUp size={22} />
                    <p>แผนนี้ยังไม่มีวันที่กำหนดไว้</p>
                  </div>
                )
              ) : trend && trend.points.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={trend.points}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="week" tick={{ fontSize: 12, fill: "var(--text-secondary)" }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 12, fill: "var(--text-secondary)" }}
                      axisLine={false}
                      tickLine={false}
                      domain={[0, 100]}
                    />
                    <Tooltip
                      formatter={(value) => [value, "คะแนน"]}
                      contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 13 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="var(--primary)"
                      strokeWidth={2.5}
                      dot={{ fill: "var(--primary)", r: 4, strokeWidth: 0 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : trendPatient ? (
                <div className="therapist-chart-empty">
                  <TrendingUp size={22} />
                  <p>
                    {planOptions.length > 0
                      ? "เลือกแผนด้านบนเพื่อแสดงคะแนนรายวัน"
                      : "ผู้ป่วยรายนี้ยังไม่มีแผนการฟื้นฟู"}
                  </p>
                </div>
              ) : (
                <div className="therapist-chart-empty">
                  <TrendingUp size={22} />
                  <p>เลือกผู้ป่วยด้านบน หรือคลิกแถวในตารางด้านล่างเพื่อแสดงแนวโน้มการฟื้นฟู</p>
                </div>
              )}
            </div>

            <div className="summary-card therapist-chart-card">
              <div className="therapist-chart-heading">
                <div>
                  <strong>จำนวนครั้งการฝึกประจำสัปดาห์</strong>
                  <p>จำนวนครั้งที่ฝึกในแต่ละวัน</p>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={weeklySessions} barSize={24}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tickFormatter={(day: string) => WEEKDAY_LABELS[day] ?? day}
                    tick={{ fontSize: 12, fill: "var(--text-secondary)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis tick={{ fontSize: 12, fill: "var(--text-secondary)" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(value) => [value, "จำนวนครั้งที่ฝึก"]}
                    contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 13 }}
                  />
                  <Bar dataKey="sessions" fill="var(--teal)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="summary-card therapist-patient-card">
            <div className="therapist-patient-toolbar">
              <strong>ผู้ป่วย</strong>
              <div className="therapist-patient-toolbar-actions">
                <div className="therapist-search">
                  <Search size={16} />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="ค้นหาผู้ป่วย…"
                    aria-label="ค้นหาผู้ป่วย"
                  />
                </div>
                <button type="button" className="primary-button therapist-add-patient" onClick={() => setAssignModalOpen(true)}>
                  <Users size={14} /> เพิ่มผู้ป่วย
                </button>
                {assignModalOpen && (
                  <AssignPatientModal
                    therapistId={user?.id ?? ""}
                    onClose={() => setAssignModalOpen(false)}
                    onAssigned={(patient) => {
                      // Prepend the newly assigned patient to the dashboard patients list
                      setDashboard((prev) => {
                        if (!prev) return prev;
                        const already = prev.patients.find((p) => p.id === patient.id);
                        if (already) return prev;
                        return {
                          ...prev,
                          patients: [patient, ...prev.patients],
                          stats: { ...prev.stats, activePatients: (prev.stats.activePatients ?? 0) + 1 }
                        };
                      });
                    }}
                  />
                )}
              </div>
            </div>

            <div className="therapist-table-scroll">
              <table className="therapist-table">
                <thead>
                  <tr>
                    <th>ผู้ป่วย</th>
                    <th>การวินิจฉัย</th>
                    <th>การฝึกล่าสุด</th>
                    <th>การทำตามแผน</th>
                    <th>ความก้าวหน้า</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {!dashboardLoading && filteredPatients.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", padding: "24px 0", color: "var(--text-secondary)" }}>
                        {patients.length === 0
                          ? "ยังไม่มีผู้ป่วยที่ได้รับมอบหมาย"
                          : "ไม่พบผู้ป่วยที่ตรงกับคำค้นหา"}
                      </td>
                    </tr>
                  )}
                  {filteredPatients.map((patient) => (
                    <tr
                      key={patient.id}
                      className="therapist-patient-table-row"
                      onClick={() => onViewPatient(patient)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") onViewPatient(patient);
                      }}
                      tabIndex={0}
                      role="button"
                    >
                      <td>
                        <div className="therapist-table-patient">
                          <PatientAvatar token={token} fileId={patient.profilePictureFileId} name={patient.nameTh || patient.name} />
                          <div>
                            <strong>{patient.nameTh || patient.name}</strong>
                            <small>
                              อายุ {patient.age} ปี · ฝึกแล้ว {patient.sessionsCompleted} ครั้ง
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>{conditionLabel(patient.condition)}</td>
                      <td>{sessionDateLabel(patient.lastSessionLabel)}</td>
                      <td>
                        <div className="therapist-compliance-bar">
                          <span className="therapist-compliance-track">
                            <span
                              className={`therapist-compliance-fill ${complianceTone(patient.compliancePercent)}`}
                              style={{ width: `${patient.compliancePercent}%` }}
                            />
                          </span>
                          <span className="therapist-compliance-value">{patient.compliancePercent}%</span>
                        </div>
                      </td>
                      <td>
                        <MiniProgressRing value={patient.progressPercent} size={36} strokeWidth={4} />
                      </td>
                      <td>
                        <span className={`badge-pill ${patient.standing === "active" ? "good" : "fair"}`}>
                          {patient.standing === "active" ? "ปกติ" : "ควรติดตาม"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>

    </section>
  );
}

function StatCard({
  icon,
  label,
  value,
  change,
  positive,
  accent = "primary"
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  change?: string;
  positive?: boolean;
  accent?: "primary" | "teal" | "success" | "warning";
}) {
  return (
    <div className={`summary-card therapist-stat-card accent-${accent}`}>
      <div className="therapist-stat-top">
        <span className="therapist-stat-icon">{icon}</span>
        {change && (
          <span className={`therapist-stat-change ${positive ? "positive" : "negative"}`}>
            {positive ? "\u2191" : "\u2193"} {change}
          </span>
        )}
      </div>
      <div className="therapist-stat-value">{value}</div>
      <p className="therapist-stat-label">{label}</p>
    </div>
  );
}

function complianceTone(percent: number): "good" | "fair" | "poor" {
  if (percent >= 80) return "good";
  if (percent >= 60) return "fair";
  return "poor";
}

function MiniProgressRing({ value, size = 36, strokeWidth = 4 }: { value: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (value / 100) * circumference;
  const tone = complianceTone(value);

  return (
    <span className={`mini-progress-ring ${tone}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} className="mini-progress-track" strokeWidth={strokeWidth} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className="mini-progress-fill"
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <strong>{value}%</strong>
    </span>
  );
}
