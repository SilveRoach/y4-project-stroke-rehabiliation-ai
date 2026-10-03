import { useEffect, useRef, useState } from "react";
import type { PatientNavLabel } from "./components/PatientSidebar";
import type { AdminNavLabel } from "./components/AdminSidebar";
import type { TherapistNavLabel } from "./components/TherapistSidebar";
import { Toast } from "./components/Toast";
import { patientProgram } from "./data/patientMock";
import { patientRehabPlans } from "./data/patientRehabPlanMock";
import { getSessionReview } from "./data/sessionReviewMock";
import type { RecordingResult } from "./hooks/useSessionRecording";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { AdminSettingsPage } from "./pages/AdminSettingsPage";
import { AdminUserManagementPage } from "./pages/AdminUserManagementPage";
import { ExerciseAiPage } from "./pages/ExerciseAiPage";
import { ExerciseLibraryPage } from "./pages/ExerciseLibraryPage";
import { LoginPage } from "./pages/LoginPage";
import { PatientDetailPage } from "./pages/PatientDetailPage";
import { PatientExerciseInstructionPage } from "./pages/PatientExerciseInstructionPage";
import { PatientHistoryPage } from "./pages/PatientHistoryPage";
import { PatientProgressPage } from "./pages/PatientProgressPage";
import { PatientSessionPage } from "./pages/PatientSessionPage";
import type { PoseSessionSummary } from "./pages/PatientSessionPage";
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
import { getExerciseLibrary } from "./services/api";
import type { PatientTodayExercise } from "./services/api";
import {
  markScheduledExerciseCompleted
} from "./utils/patientToday";
import type {
  ExerciseLibraryItem,
  ExerciseTrackingType,
  ExerciseVersionSummary,
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
  | "exercise-ai"
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
  const { user, token, logout } = useAuth();
  const [view, setView] = useState<View>(() => (user ? homeViewForRole(user.role) : "login"));
  const [sessionPaused, setSessionPaused] = useState(false);
  const [lowConfidence, setLowConfidence] = useState(false);
  const [detailPatient, setDetailPatient] = useState<TherapistPatientSummary | null>(null);
  const [reviewSession, setReviewSession] = useState<SessionHistoryEntry | null>(null);
  // Scheduled-exercise id the review page should focus (per-exercise "Review"
  // from PatientDetailPage's exercise cards); null = whole-day review.
  const [reviewFocusExerciseId, setReviewFocusExerciseId] = useState<string | null>(null);
  // Patient name for a review opened from the cross-patient Sessions log (where
  // no detailPatient is loaded). null when opened from Patient Detail.
  const [reviewPatientName, setReviewPatientName] = useState<string | null>(null);
  // Plan currently open in Program Editor (PT_EXERCISE_PATH_MOCKUP_PLAN.md §4.4).
  // PatientDetailPage still owns its own plans[] as local state (unchanged) —
  // pendingPlanUpdate is how Program Editor's Save hands one edited plan back down
  // to it without lifting all of Patient Detail's plan state up to App.tsx. See
  // PatientDetailPage.tsx's pendingPlanUpdate effect for the merge.
  const [editingPlan, setEditingPlan] = useState<PatientRehabPlan | null>(null);
  const [pendingPlanUpdate, setPendingPlanUpdate] = useState<PatientRehabPlan | null>(null);

  // State carried into ExerciseCreationPage (either a selected existing exercise or new exercise basics).
  const [selectedExercise, setSelectedExercise] = useState<ExerciseLibraryItem | null>(null);
  const [creationName, setCreationName] = useState("");
  const [creationTracking, setCreationTracking] = useState<ExerciseTrackingType>("pose");
  // Where ExerciseCreationPage's Back/Save should return to — the library page
  // when opened from there, or the patient's detail page when the therapist
  // used the "View" button in PatientDetailPage's exercise-picker popup.
  const [exerciseCreationReturn, setExerciseCreationReturn] = useState<"therapist-library" | "patient-detail">("therapist-library");
  // True while the AI workspace above was opened from the library's Version
  // History panel (openExerciseVersion) rather than from a library card or the
  // creation flow — the page then shows its version banner and names the library
  // in its back-link. Reset by every other path into that view.
  const [exerciseVersionView, setExerciseVersionView] = useState(false);

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

  // PatientSessionPage's STOP hands off the recording plus, for pose sessions,
  // the average of the successful server-scored repetitions. Other tracking
  // modes retain the existing preview fallback until they have real scoring.
  const handleFinishRecording = (result: RecordingResult, poseSummary?: PoseSessionSummary) => {
    const extension = result.mimeType.includes("mp4") ? "mp4" : "webm";
    const fileSlug = activeExercise.name.trim().toLowerCase().replace(/\s+/g, "-");
    setPendingAttempt({
      scheduledExerciseId: activeExercise.id,
      exerciseName: activeExercise.name,
      exerciseNameTh: activeExercise.nameTh,
      videoBlobUrl: URL.createObjectURL(result.blob),
      videoBlob: result.blob,
      videoFileName: `${fileSlug}-attempt.${extension}`,
      videoSizeLabel: formatVideoSize(result.blob.size),
      videoMimeType: result.mimeType,
      scoreSource: poseSummary ? "pose_average" : "preview",
      ...(poseSummary
        ? {
            aiScore: poseSummary.averageScore,
            aiFeedback: `Average score from ${poseSummary.repScores.length} AI-scored repetition${poseSummary.repScores.length === 1 ? "" : "s"}.`,
            aiMetrics: [
              { label: "Scored repetitions", value: String(poseSummary.repScores.length) },
              { label: "Score range", value: `${Math.min(...poseSummary.repScores)}–${Math.max(...poseSummary.repScores)}` },
              { label: "Average score", value: String(poseSummary.averageScore) }
            ]
          }
        : mockAiEvaluation())
    });
    setView("session-upload-confirm");
  };

  // §6.3 — Confirm & upload: marks the scheduled exercise completed (visible on
  // Today/Progress via rehabPlans state above), consumes this exercise's next
  // attempt number, releases the local blob URL, and returns to Today with a
  // success toast (rendered at root level so it survives the view switch).
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 4000);
  };
  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  const handleConfirmUpload = () => {
    if (!pendingAttempt) return;
    const { scheduledExerciseId, videoBlobUrl } = pendingAttempt;
    setRehabPlans((current) => markScheduledExerciseCompleted(current, scheduledExerciseId));
    setAttemptCounts((current) => ({ ...current, [scheduledExerciseId]: (current[scheduledExerciseId] ?? 0) + 1 }));
    URL.revokeObjectURL(videoBlobUrl);
    setPendingAttempt(null);
    setView("today");
    showToast("Exercise result uploaded successfully · บันทึกผลการฝึกเรียบร้อยแล้ว");
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

  const openSessionReview = (session: SessionHistoryEntry, patientName?: string, focusExerciseId?: string) => {
    setReviewSession(session);
    // Sessions opened from the cross-patient log aren't tied to a
    // detailPatient — remember the log's own patient name for the review page.
    setReviewPatientName(patientName ?? null);
    // When opened from an exercise card's per-exercise "Review" action, the
    // review page should switch straight to that exercise (null = no focus).
    setReviewFocusExerciseId(focusExerciseId ?? null);
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

  const handleOpenScheduledExercise = async (exerciseLibraryId: string) => {
    if (!token) return;
    try {
      const response = await getExerciseLibrary(token);
      const exercise = response.exercises.find((item) => item.id === exerciseLibraryId);
      if (!exercise) {
        window.alert("Exercise details could not be found.");
        return;
      }
      setSelectedExercise(exercise);
      setExerciseVersionView(false);
      setCreationName(exercise.name);
      setCreationTracking(exercise.movementTracking);
      setView("exercise-ai");
    } catch {
      window.alert("Could not load exercise details.");
    }
  };

  // Version-history drill-in: ExerciseLibraryPage's History panel → the full
  // ExerciseAiPage workspace (the same destination a library CARD click uses).
  // The AI workspace renders exactly ONE exercise_library row, so the clicked
  // version's own fields have to win: a version bump can change any of them
  // (name, description, tracking, difficulty, demo video, base criteria), and
  // the family's latest row only ever carries ITS values. Fields a version
  // summary doesn't carry (creator, thumbnail descriptor, the family id and the
  // whole history list) are inherited from the row the panel was opened for.
  const openExerciseVersion = (exercise: ExerciseLibraryItem, version: ExerciseVersionSummary) => {
    setSelectedExercise({
      ...exercise,
      id: version.id,
      versionNumber: version.versionNumber,
      status: version.status,
      name: version.name || exercise.name,
      description: version.description,
      movementTracking: version.movementTracking,
      difficultyLevel: version.difficultyLevel,
      demoVideoFileId: version.demoVideoFileId,
      hasDemoVideo: version.demoVideoFileId !== null,
      demoVideoFile: null,
      baseCriteria: version.baseCriteria,
      createdAtLabel: version.createdAtLabel
    });
    setExerciseVersionView(true);
    setCreationName(version.name || exercise.name);
    setCreationTracking(version.movementTracking);
    setExerciseCreationReturn("therapist-library");
    setView("exercise-ai");
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
  // admin-role sidebar (components/AdminSidebar.tsx). "Exercise Library" routes
  // admins into the shared Exercise Library section (ExerciseLibraryPage — the
  // therapist's page, reused), which renders this same admin sidebar back.
  const handleAdminNavigate = (label: AdminNavLabel) => {
    if (label === "Dashboard") setView("admin-dashboard");
    if (label === "Users") setView("admin-users");
    if (label === "Settings") setView("admin-settings");
    if (label === "Exercise Library") setView("therapist-library");
  };

  // The Exercise Library section (library → AI authoring workspace) is shared
  // by both roles: each page renders TherapistSidebar for therapists and
  // AdminSidebar for admins (decided inside the page from useAuth), so this one
  // handler dispatches the clicked label by the SIGNED-IN role — the labels
  // overlap ("Dashboard", "Settings") but mean different views per role, and
  // role-specific labels (Patients/Sessions vs Users) simply fall through.
  const handleExerciseLibraryNavigate = (label: TherapistNavLabel | AdminNavLabel) => {
    if (user?.role === "admin") handleAdminNavigate(label as AdminNavLabel);
    else handleTherapistNavigate(label as TherapistNavLabel);
  };

  return (
    <main>
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
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
          onLogout={() => {
            logout();
            setView("login");
          }}
          onNavigate={handlePatientNavigate}
        />
      )}
      {view === "history" && (
        <PatientHistoryPage
          onLogout={() => {
            logout();
            setView("login");
          }}
          onNavigate={handlePatientNavigate}
        />
      )}
      {view === "patient-settings" && (
        <PatientSettingsPage
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
          onViewPatient={openPatientDetail}
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
          onNavigate={handleExerciseLibraryNavigate}
          onCreateNew={(name, tracking) => {
            setSelectedExercise(null);
            setExerciseVersionView(false);
            setCreationName(name);
            setCreationTracking(tracking);
            setView("exercise-ai");
          }}
          onSelectExercise={(exercise) => {
            setSelectedExercise(exercise);
            setExerciseVersionView(false);
            setCreationName(exercise.name);
            setCreationTracking(exercise.movementTracking);
            setExerciseCreationReturn("therapist-library");
            setView("exercise-ai");
          }}
          onViewVersion={openExerciseVersion}
        />
      )}
      {view === "exercise-ai" && (
        <ExerciseAiPage
          exercise={selectedExercise}
          initialName={creationName}
          initialTracking={creationTracking}
          isVersionView={exerciseVersionView}
          onBack={() => {
            setSelectedExercise(null);
            setView(exerciseCreationReturn);
          }}
          onSaved={() => {
            setSelectedExercise(null);
            setView(exerciseCreationReturn);
          }}
          onLogout={() => {
            logout();
            setView("login");
          }}
          onNavigate={handleExerciseLibraryNavigate}
        />
      )}
      {view === "therapist-sessions" && (
        <TherapistSessionsPage
          onLogout={() => {
            logout();
            setView("login");
          }}
          onNavigate={handleTherapistNavigate}
          onReviewSession={(session) => openSessionReview(session, session.patientName)}
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
          onOpenExercise={handleOpenScheduledExercise}
          onOpenProgramEditor={openProgramEditor}
          pendingPlanUpdate={pendingPlanUpdate}
          onViewExercise={(exercise) => {
            setSelectedExercise(exercise);
            setExerciseVersionView(false);
            setCreationName(exercise.name);
            setCreationTracking(exercise.movementTracking);
            setExerciseCreationReturn("patient-detail");
            setView("exercise-ai");
          }}
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
      {view === "session-result-review" && reviewSession && (
        <SessionResultReviewPage
          review={getSessionReview(reviewSession, detailPatient?.name ?? reviewPatientName ?? "Patient")}
          focusExerciseId={reviewFocusExerciseId ?? undefined}
          onBack={() => setView(detailPatient ? "patient-detail" : "therapist-sessions")}
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
          onNavigateExerciseLibrary={() => handleAdminNavigate("Exercise Library")}
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
          onNavigateExerciseLibrary={() => handleAdminNavigate("Exercise Library")}
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
          onNavigateExerciseLibrary={() => handleAdminNavigate("Exercise Library")}
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
