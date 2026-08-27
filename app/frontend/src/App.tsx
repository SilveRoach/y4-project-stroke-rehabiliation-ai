import { useState } from "react";
import type { PatientNavLabel } from "./components/PatientSidebar";
import type { TherapistNavLabel } from "./components/TherapistSidebar";
import { patientProgram } from "./data/patientMock";
import { patientRehabPlans } from "./data/patientRehabPlanMock";
import { getSessionReview } from "./data/sessionReviewMock";
import type { RecordingResult } from "./hooks/useSessionRecording";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { AdminSettingsPage } from "./pages/AdminSettingsPage";
import { AdminUserManagementPage } from "./pages/AdminUserManagementPage";
import { ExerciseLibraryPage } from "./pages/ExerciseLibraryPage";
import { LoginPage } from "./pages/LoginPage";
import { PatientDetailPage } from "./pages/PatientDetailPage";
import { PatientExerciseInstructionPage } from "./pages/PatientExerciseInstructionPage";
import { PatientHistoryPage } from "./pages/PatientHistoryPage";
import { PatientProgressPage } from "./pages/PatientProgressPage";
import { PatientSessionPage } from "./pages/PatientSessionPage";
import { PatientSettingsPage } from "./pages/PatientSettingsPage";
import { PatientTodayPage } from "./pages/PatientTodayPage";
import { ProgramEditorPage } from "./pages/ProgramEditorPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SessionResultReviewPage } from "./pages/SessionResultReviewPage";
import { SessionUploadConfirmPage } from "./pages/SessionUploadConfirmPage";
import { TherapistDashboardPage } from "./pages/TherapistDashboardPage";
import { TherapistPatientsPage } from "./pages/TherapistPatientsPage";
import { TherapistSessionsPage } from "./pages/TherapistSessionsPage";
import { TherapistSettingsPage } from "./pages/TherapistSettingsPage";
import { AuthProvider, useAuth } from "./store/authStore";
import type { PatientTodayExercise } from "./services/api";
import {
  markScheduledExerciseCompleted
} from "./utils/patientToday";
import type {
  PatientExercise,
  PatientRehabPlan,
  PendingSessionAttempt,
  Role,
  SessionHistoryEntry,
  TherapistPatientSummary
} from "./types";

type View =
  | "login"
  | "register"
  | "today"
  | "exercise-instruction"
  | "progress"
  | "history"
  | "patient-settings"
  | "session"
  | "session-upload-confirm"
  | "therapist-dashboard"
  | "therapist-patients"
  | "therapist-library"
  | "therapist-sessions"
  | "therapist-settings"
  | "patient-detail"
  | "program-editor"
  | "session-result-review"
  | "admin-dashboard"
  | "admin-users"
  | "admin-settings";

// Routes the just-authenticated user to their role's home view (FR-AUTH-01c /
// frontend-design.md's Role Assignment table). Admin now lands on the Admin
// Dashboard (§8) instead of jumping straight into User Management (§9) — the
// dashboard is the intended landing page; User Management is one screen reached
// from it via the sidebar's "Users" nav item or its "Go to User Management" link.
function homeViewForRole(role: Role): View {
  if (role === "therapist") return "therapist-dashboard";
  if (role === "admin") return "admin-dashboard";
  return "today";
}

function AppShell() {
  const { logout } = useAuth();
  const [view, setView] = useState<View>("login");
  const [sessionPaused, setSessionPaused] = useState(false);
  const [lowConfidence, setLowConfidence] = useState(false);
  const [detailPatient, setDetailPatient] = useState<TherapistPatientSummary | null>(null);
  const [reviewSession, setReviewSession] = useState<SessionHistoryEntry | null>(null);
  // Plan currently open in Program Editor (PT_EXERCISE_PATH_MOCKUP_PLAN.md §4.4).
  // PatientDetailPage still owns its own plans[] as local state (unchanged) —
  // pendingPlanUpdate is how Program Editor's Save hands one edited plan back down
  // to it without lifting all of Patient Detail's plan state up to App.tsx. See
  // PatientDetailPage.tsx's pendingPlanUpdate effect for the merge.
  const [editingPlan, setEditingPlan] = useState<PatientRehabPlan | null>(null);
  const [pendingPlanUpdate, setPendingPlanUpdate] = useState<PatientRehabPlan | null>(null);

  // CAMERA_TRACKING_MOCKUP_PLAN.md §6.6 — lifted from a plain module-level import
  // into state so a confirmed upload (see handleConfirmUpload below) can actually
  // mark the matching ScheduledExercise "completed" and have Today/Progress
  // re-render with it, instead of always showing the same static mock list.
  const [rehabPlans, setRehabPlans] = useState<PatientRehabPlan[]>(patientRehabPlans);

  // §6.1/§6.3 — the attempt currently awaiting Confirm/Retry/Discard on
  // SessionUploadConfirmPage, or null when there isn't one (i.e. whenever view
  // isn't "session-upload-confirm"). attemptCounts tracks how many attempts have
  // actually been *confirmed* per exercise so far this session (attempt_number is
  // only assigned at confirm time — a Retry/Discard never increments it).
  const [pendingAttempt, setPendingAttempt] = useState<PendingSessionAttempt | null>(null);
  const [attemptCounts, setAttemptCounts] = useState<Record<string, number>>({});
  const [selectedScheduledExercise, setSelectedScheduledExercise] = useState<PatientTodayExercise | null>(null);

  // PATIENT_TODAY_MOCKUP_PLAN.md §2.3, Option B: Home's onStartSession still only
  // ever hands back a ScheduledExercise id (see utils/patientToday.ts's
  // getTodayExerciseGroups/findTodayScheduledExercise, the same "today" list the
  // page itself renders), not a real PatientExercise — so it's resolved and
  // shimmed into PatientExercise shape right here, at the point Start Session is
  // pressed, rather than teaching PatientSessionPage.tsx the real schema.
  const [activeExercise, setActiveExercise] = useState<PatientExercise>(
    () => patientProgram.exercises[1] ?? patientProgram.exercises[0]
  );

  const openSession = (exercise?: PatientTodayExercise) => {
    if (exercise) {
      setActiveExercise({
        id: exercise.id,
        name: exercise.exerciseName,
        trackingType: exercise.movementTracking === "none" ? "both" : exercise.movementTracking,
        targetLabel: exercise.targetValueLabel,
        status: exercise.status === "completed" ? "done" : exercise.status === "in_progress" ? "in_progress" : "not_started",
        feedback: exercise.therapistInstruction ?? "Follow your therapist's prescribed instructions.",
        progressLabel: exercise.targetValueLabel,
        durationMinutes: 0,
        sets: 0,
        reps: 0,
        difficulty: exercise.difficultyLevel === "medium" ? "Moderate" : exercise.difficultyLevel === "easy" ? "Easy" : "Hard"
      });
    }
    setView("session");
  };

  const openExerciseInstruction = (exercise?: PatientTodayExercise) => {
    if (!exercise) return;
    setSelectedScheduledExercise(exercise);
    setView("exercise-instruction");
  };

  // §6.3 — mock AI score/feedback/metrics generated right after a recording
  // stops, same "real UI, mocked evaluation" caveat as §2.5's demo score (ai/
  // scoring.ts is still a stub). Kept local to this handler rather than a shared
  // util since nothing else needs it yet.
  const mockAiEvaluation = () => ({
    aiScore: Math.max(60, Math.min(98, (activeExercise.score ?? 80) + Math.round((Math.random() - 0.5) * 12))),
    aiFeedback:
      "Solid form overall — keep your shoulder relaxed through the top of the movement. · ท่าทางโดยรวมดี พยายามผ่อนคลายไหล่ตอนยกสุด",
    aiMetrics: [
      { label: "Range of motion", value: `${70 + Math.round(Math.random() * 20)}%` },
      { label: "Tempo", value: "Steady" },
      { label: "Frames analyzed", value: `${120 + Math.round(Math.random() * 40)}` }
    ]
  });

  function formatVideoSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // §6.3/§6.4 — PatientSessionPage's STOP hands off a raw recording here; this
  // composes it into a PendingSessionAttempt (a local blob URL + mock AI read)
  // and routes to the confirm screen instead of going back to Today directly.
  const handleFinishRecording = (result: RecordingResult) => {
    const extension = result.mimeType.includes("mp4") ? "mp4" : "webm";
    const fileSlug = activeExercise.name.trim().toLowerCase().replace(/\s+/g, "-");
    setPendingAttempt({
      scheduledExerciseId: activeExercise.id,
      exerciseName: activeExercise.name,
      exerciseNameTh: activeExercise.nameTh,
      videoBlobUrl: URL.createObjectURL(result.blob),
      videoFileName: `${fileSlug}-attempt.${extension}`,
      videoSizeLabel: formatVideoSize(result.blob.size),
      videoMimeType: result.mimeType,
      ...mockAiEvaluation()
    });
    setView("session-upload-confirm");
  };

  // §6.3 — Confirm & upload: marks the scheduled exercise completed (visible on
  // Today/Progress via rehabPlans state above), consumes this exercise's next
  // attempt number, releases the local blob URL, and returns to Today.
  const handleConfirmUpload = () => {
    if (!pendingAttempt) return;
    const { scheduledExerciseId, videoBlobUrl } = pendingAttempt;
    setRehabPlans((current) => markScheduledExerciseCompleted(current, scheduledExerciseId));
    setAttemptCounts((current) => ({ ...current, [scheduledExerciseId]: (current[scheduledExerciseId] ?? 0) + 1 }));
    URL.revokeObjectURL(videoBlobUrl);
    setPendingAttempt(null);
    setView("today");
  };

  // §6.3 — Retry: discard this take (no attempt number consumed) and go back into
  // the live camera to record another. Remounting PatientSessionPage (leaving then
  // re-entering "session") is what actually resets its recording/demo-motion
  // state back to a fresh preroll — see that page's own per-mount state.
  const handleRetryRecording = () => {
    if (pendingAttempt) URL.revokeObjectURL(pendingAttempt.videoBlobUrl);
    setPendingAttempt(null);
    setView("session");
  };

  // §6.3 — Discard: abandon this attempt entirely and return to Today, same as
  // Retry but without going back into the camera.
  const handleDiscardRecording = () => {
    if (pendingAttempt) URL.revokeObjectURL(pendingAttempt.videoBlobUrl);
    setPendingAttempt(null);
    setView("today");
  };

  const openPatientDetail = (patient: TherapistPatientSummary) => {
    setDetailPatient(patient);
    setView("patient-detail");
  };

  const openSessionReview = (session: SessionHistoryEntry) => {
    setReviewSession(session);
    setView("session-result-review");
  };

  const openProgramEditor = (plan: PatientRehabPlan) => {
    setEditingPlan(plan);
    setView("program-editor");
  };

  const handleSaveProgramEditorPlan = (plan: PatientRehabPlan) => {
    setPendingPlanUpdate(plan);
    setEditingPlan(null);
    setView("patient-detail");
  };

  // Single navigation contract shared by every therapist-role page's sidebar
  // (components/TherapistSidebar.tsx) — turns a clicked nav label into the
  // corresponding view, replacing what used to be four separate pages each doing
  // their own (mostly no-op) local highlight-only state.
  const handleTherapistNavigate = (label: TherapistNavLabel) => {
    if (label === "Dashboard") setView("therapist-dashboard");
    if (label === "Patients") setView("therapist-patients");
    if (label === "Exercise Library") setView("therapist-library");
    if (label === "Sessions") setView("therapist-sessions");
    if (label === "Settings") setView("therapist-settings");
  };

  // Same idea as handleTherapistNavigate above, for the patient-role sidebar/
  // bottom nav (components/PatientSidebar.tsx, components/PatientBottomNav.tsx).
  // Previously Today's sidebar/bottom-nav buttons for Progress, History, and
  // Settings had no onClick at all.
  const handlePatientNavigate = (label: PatientNavLabel) => {
    if (label === "Home") setView("today");
    if (label === "Progress") setView("progress");
    if (label === "History") setView("history");
    if (label === "Settings") setView("patient-settings");
  };

  // Same idea as handleTherapistNavigate/handlePatientNavigate above, for the
  // admin-role sidebar (components/AdminSidebar.tsx).
  const handleAdminNavigate = (label: "Dashboard" | "Users" | "Settings") => {
    if (label === "Dashboard") setView("admin-dashboard");
    if (label === "Users") setView("admin-users");
    if (label === "Settings") setView("admin-settings");
  };

  return (
    <main>
      {view === "login" && (
        <LoginPage
          onRegister={() => setView("register")}
          onLogin={(role) => setView(homeViewForRole(role))}
        />
      )}
      {view === "register" && <RegisterPage onLogin={() => setView("login")} />}
      {view === "today" && (
        <PatientTodayPage
          onLogout={() => {
            logout();
            setView("login");
          }}
          onNavigate={handlePatientNavigate}
          onOpenInstruction={openExerciseInstruction}
        />
      )}
      {view === "exercise-instruction" && selectedScheduledExercise && (
        <PatientExerciseInstructionPage
          scheduledExerciseId={selectedScheduledExercise.id}
          onBack={() => setView("today")}
          onStartExercise={() => openSession(selectedScheduledExercise)}
          onLogout={() => {
            logout();
            setView("login");
          }}
          onNavigate={handlePatientNavigate}
        />
      )}
      {view === "progress" && (
        <PatientProgressPage
          program={patientProgram}
          plans={rehabPlans}
          onLogout={() => {
            logout();
            setView("login");
          }}
          onNavigate={handlePatientNavigate}
        />
      )}
      {view === "history" && (
        <PatientHistoryPage
          program={patientProgram}
          onLogout={() => {
            logout();
            setView("login");
          }}
          onNavigate={handlePatientNavigate}
        />
      )}
      {view === "patient-settings" && (
        <PatientSettingsPage
          program={patientProgram}
          onLogout={() => {
            logout();
            setView("login");
          }}
          onNavigate={handlePatientNavigate}
        />
      )}
      {view === "session" && (
        <PatientSessionPage
          exercise={activeExercise}
          paused={sessionPaused}
          lowConfidence={lowConfidence}
          onBack={() => setView("today")}
          onTogglePause={() => setSessionPaused((value) => !value)}
          onToggleConfidence={() => setLowConfidence((value) => !value)}
          onRestart={() => {
            setSessionPaused(false);
            setLowConfidence(false);
          }}
          onFinishRecording={handleFinishRecording}
        />
      )}
      {view === "session-upload-confirm" && pendingAttempt && (
        <SessionUploadConfirmPage
          attempt={pendingAttempt}
          attemptNumber={(attemptCounts[pendingAttempt.scheduledExerciseId] ?? 0) + 1}
          onConfirm={handleConfirmUpload}
          onRetry={handleRetryRecording}
          onDiscard={handleDiscardRecording}
        />
      )}
      {view === "therapist-dashboard" && (
        <TherapistDashboardPage
          onLogout={() => {
            logout();
            setView("login");
          }}
          onNavigate={handleTherapistNavigate}
          onViewFullReport={openPatientDetail}
        />
      )}
      {view === "therapist-patients" && (
        <TherapistPatientsPage
          onLogout={() => {
            logout();
            setView("login");
          }}
          onNavigate={handleTherapistNavigate}
          onViewPatient={openPatientDetail}
        />
      )}
      {view === "therapist-library" && (
        <ExerciseLibraryPage
          onLogout={() => {
            logout();
            setView("login");
          }}
          onNavigate={handleTherapistNavigate}
        />
      )}
      {view === "therapist-sessions" && (
        <TherapistSessionsPage
          onLogout={() => {
            logout();
            setView("login");
          }}
          onNavigate={handleTherapistNavigate}
        />
      )}
      {view === "therapist-settings" && (
        <TherapistSettingsPage
          onLogout={() => {
            logout();
            setView("login");
          }}
          onNavigate={handleTherapistNavigate}
        />
      )}
      {view === "patient-detail" && detailPatient && (
        <PatientDetailPage
          patient={detailPatient}
          onBack={() => setView("therapist-dashboard")}
          onLogout={() => {
            logout();
            setView("login");
          }}
          onNavigate={handleTherapistNavigate}
          onReviewSession={openSessionReview}
          onOpenProgramEditor={openProgramEditor}
          pendingPlanUpdate={pendingPlanUpdate}
        />
      )}

      {view === "program-editor" && editingPlan && detailPatient && (
        <ProgramEditorPage
          plan={editingPlan}
          patientId={detailPatient.id}
          patientName={detailPatient.name}
          onSave={handleSaveProgramEditorPlan}
          onBack={() => setView("patient-detail")}
          onLogout={() => {
            logout();
            setView("login");
          }}
          onNavigate={handleTherapistNavigate}
        />
      )}
      {view === "session-result-review" && reviewSession && detailPatient && (
        <SessionResultReviewPage
          review={getSessionReview(reviewSession, detailPatient.name)}
          onBack={() => setView("patient-detail")}
          onLogout={() => {
            logout();
            setView("login");
          }}
          onNavigate={handleTherapistNavigate}
        />
      )}
      {view === "admin-dashboard" && (
        <AdminDashboardPage
          onLogout={() => {
            logout();
            setView("login");
          }}
          onNavigateUsers={() => handleAdminNavigate("Users")}
          onNavigateSettings={() => handleAdminNavigate("Settings")}
        />
      )}
      {view === "admin-users" && (
        <AdminUserManagementPage
          onLogout={() => {
            logout();
            setView("login");
          }}
          onNavigateDashboard={() => handleAdminNavigate("Dashboard")}
          onNavigateSettings={() => handleAdminNavigate("Settings")}
        />
      )}
      {view === "admin-settings" && (
        <AdminSettingsPage
          onLogout={() => {
            logout();
            setView("login");
          }}
          onNavigateDashboard={() => handleAdminNavigate("Dashboard")}
          onNavigateUsers={() => handleAdminNavigate("Users")}
        />
      )}
    </main>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

export default App;
