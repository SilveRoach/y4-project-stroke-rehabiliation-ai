import { useEffect, useState } from "react";
import { ArrowLeft, Play, VideoOff } from "lucide-react";
import { PatientBottomNav } from "../components/PatientBottomNav";
import { PatientSidebar } from "../components/PatientSidebar";
import type { PatientNavLabel } from "../components/PatientSidebar";
import {
  ApiError,
  getPatientScheduledExerciseDemoVideo,
  getPatientScheduledExerciseInstruction,
  type PatientScheduledExerciseInstruction
} from "../services/api";
import { useAuth } from "../store/authStore";

interface PatientExerciseInstructionPageProps {
  scheduledExerciseId: string;
  onBack: () => void;
  onStartExercise: () => void;
  onLogout: () => void;
  onNavigate: (label: PatientNavLabel) => void;
}

function targetValueLabel(value: unknown): string {
  if (value === null || value === undefined) return "No target set";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(String).join(" · ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${String(item)} ${key}`)
      .join(" · ");
  }
  return String(value);
}

function targetTypeLabel(targetType: PatientScheduledExerciseInstruction["targetType"]): string {
  return targetType.charAt(0).toUpperCase() + targetType.slice(1);
}

export function PatientExerciseInstructionPage({
  scheduledExerciseId,
  onBack,
  onStartExercise,
  onLogout,
  onNavigate
}: PatientExerciseInstructionPageProps) {
  const { token, user } = useAuth();
  const [instruction, setInstruction] = useState<PatientScheduledExerciseInstruction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError("Please log in again to view this exercise.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPatientScheduledExerciseInstruction(token, scheduledExerciseId)
      .then((response) => {
        if (!cancelled) setInstruction(response.scheduledExercise);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Couldn't load this exercise. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scheduledExerciseId, token, retryKey]);

  useEffect(() => {
    if (!token || !instruction?.exercise.demoVideoFileId) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setVideoLoading(true);
    setVideoError(null);
    getPatientScheduledExerciseDemoVideo(token, instruction.id)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setVideoUrl(objectUrl);
      })
      .catch((err) => {
        if (!cancelled) setVideoError(err instanceof ApiError ? err.message : "The demonstration video is unavailable.");
      })
      .finally(() => {
        if (!cancelled) setVideoLoading(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [instruction, token]);

  const patientName = user?.displayName ?? user?.username ?? "Patient";
  const avatarInitials = patientName.slice(0, 2).toUpperCase();
  const exercise = instruction?.exercise;

  return (
    <section className="therapist-shell">
      <PatientSidebar activeLabel="Home" onNavigate={onNavigate} onLogout={onLogout} displayName={patientName} avatarInitials={avatarInitials} />
      <div className="therapist-workspace">
        <header className="therapist-topbar pei-topbar">
          <div>
            <button type="button" className="sidebar-link" onClick={onBack}><ArrowLeft size={16} /> Back to today</button>
            <p className="eyebrow">Exercise instruction</p>
            <h1>{exercise?.name ?? "Exercise"}</h1>
          </div>
        </header>

        {loading || error ? (
          <section className="today-main-panel exercise-panel" role={error ? "alert" : "status"}>
            <p className="pd-empty-note">{loading ? "Loading exercise instructions…" : error}</p>
            {error && <button className="secondary-button" onClick={() => setRetryKey((key) => key + 1)}>Try again</button>}
          </section>
        ) : instruction && exercise ? (
          <div className="today-grid">
            <section className="today-main-panel exercise-panel">
              <div className="program-heading">
                <div><p className="eyebrow">PT demonstration</p><h2>{exercise.name}</h2></div>
                <span className={`difficulty-badge ${exercise.difficultyLevel === "medium" ? "moderate" : exercise.difficultyLevel}`}>{exercise.difficultyLevel}</span>
              </div>
              {videoUrl ? (
                <video controls className="exercise-instruction-video" src={videoUrl}>Your browser does not support demonstration video playback.</video>
              ) : (
                <div className="exercise-instruction-video-placeholder">
                  <VideoOff size={28} />
                  <span>{videoLoading ? "Loading demonstration video…" : videoError ?? "No demonstration video is available for this exercise."}</span>
                </div>
              )}
              <section className="summary-card">
                <p className="eyebrow">Description</p>
                <p>{exercise.description ?? "No exercise description has been provided."}</p>
              </section>
            </section>

            {/* Target + therapist instruction, moved down here from the old sidebar
                (per the wireframe this page is now built from) — nested inside its
                own outer card the same way Description nests inside the demo/video
                card above, rather than sitting loose in the grid. */}
            <section className="today-main-panel pei-details-panel">
              <section className="summary-card">
                <p className="eyebrow">Your target</p>
                <h2>{targetValueLabel(instruction.targetValue)}</h2>
                <p>{targetTypeLabel(instruction.targetType)}</p>
              </section>
              <section className="summary-card">
                <p className="eyebrow">Therapist instruction</p>
                <p>{instruction.therapistInstruction ?? "No additional instruction has been provided by your therapist."}</p>
              </section>
            </section>
          </div>
        ) : null}

        {/* Standalone Start Exercise bar — full-width, pinned to the bottom of the
            page content (above the bottom nav), outside the instruction grid. The
            real camera setup happens on PatientSessionPage when the exercise
            starts. */}
        {instruction && exercise && !loading && !error && (
          <div className="pei-start-bar">
            <button type="button" className="primary-button patient-start-button pei-start-button" onClick={onStartExercise}>
              <Play size={20} fill="currentColor" /> Start Exercise
            </button>
          </div>
        )}
      </div>
      <PatientBottomNav activeLabel="Home" onNavigate={onNavigate} />
    </section>
  );
}
