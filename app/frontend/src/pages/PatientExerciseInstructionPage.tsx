import { useEffect, useState } from "react";
import { ArrowLeft, Play, VideoOff } from "lucide-react";
import { PatientBottomNav } from "../components/PatientBottomNav";
import { PatientSidebar } from "../components/PatientSidebar";
import type { PatientNavLabel } from "../components/PatientSidebar";
import {
  ApiError,
  getPatientScheduledExerciseDemoVideo,
  getPatientScheduledExerciseInstruction,
  type PatientScheduledExerciseInstruction,
  type PatientTodayExercise
} from "../services/api";
import { useAuth } from "../store/authStore";

interface PatientExerciseInstructionPageProps {
  scheduledExerciseId: string;
  onBack: () => void;
  onStartExercise: (exerciseData?: Partial<PatientTodayExercise>) => void;
  onLogout: () => void;
  onNavigate: (label: PatientNavLabel) => void;
}

function targetValueLabel(value: unknown): string {
  if (value === null || value === undefined) return "ไม่ได้กำหนดเป้าหมาย";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(String).join(" · ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${String(item)} ${key}`)
      .join(" · ");
  }
  return String(value);
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
      setError("กรุณาเข้าสู่ระบบอีกครั้งเพื่อดูท่าบริหารนี้");
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
        if (!cancelled) setError(err instanceof ApiError ? err.message : "โหลดข้อมูลท่าบริหารไม่สำเร็จ กรุณาลองอีกครั้ง");
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
        if (!cancelled) setVideoError(err instanceof ApiError ? err.message : "ไม่สามารถเปิดวิดีอตัวอย่างได้");
      })
      .finally(() => {
        if (!cancelled) setVideoLoading(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [instruction, token]);

  const patientName = user?.displayName ?? user?.username ?? "ผู้ป่วย";
  const avatarInitials = patientName.slice(0, 2).toUpperCase();
  const exercise = instruction?.exercise;

  return (
    <section className="therapist-shell">
      <PatientSidebar activeLabel="Home" onNavigate={onNavigate} onLogout={onLogout} displayName={patientName} avatarInitials={avatarInitials} />
      <div className="therapist-workspace">
        <header className="therapist-topbar pei-topbar">
          <div>
            <div className="pei-heading-row">
              <button type="button" className="pei-back-button" onClick={onBack}>
                <ArrowLeft size={16} />
                <span>กลับไป</span>
              </button>
              <p className="eyebrow">คำแนะนำท่าบริหาร</p>
            </div>
          </div>
        </header>

        {loading || error ? (
          <section className="today-main-panel exercise-panel" role={error ? "alert" : "status"}>
            <p className="pd-empty-note">{loading ? "กำลังโหลดคำแนะนำท่าบริหาร…" : error}</p>
            {error && <button className="secondary-button" onClick={() => setRetryKey((key) => key + 1)}>ลองอีกครั้ง</button>}
          </section>
        ) : instruction && exercise ? (
          <div className="today-grid">
            <section className="today-main-panel exercise-panel">
              <div className="program-heading">
                <p className="eyebrow">วิดีโอตัวอย่างจากนักกายภาพบำบัด</p>
              </div>
              {videoUrl ? (
                <video controls className="exercise-instruction-video" src={videoUrl}>เบราว์เซอร์ของคุณไม่รองรับการเล่นวิดีโอตัวอย่าง</video>
              ) : (
                <div className="exercise-instruction-video-placeholder">
                  <VideoOff size={28} />
                  <span>{videoLoading ? "กำลังโหลดวิดีโอตัวอย่าง…" : videoError ?? "ไม่มีวิดีโอตัวอย่างสำหรับท่าบริหารนี้"}</span>
                </div>
              )}
              <section className="summary-card">
                <p className="eyebrow">รายละเอียด</p>
                <p>{exercise.description ?? "ยังไม่มีรายละเอียดท่าบริหาร"}</p>
              </section>
            </section>

            {/* Target + therapist instruction, moved down here from the old sidebar
                (per the wireframe this page is now built from) — nested inside its
                own outer card the same way Description nests inside the demo/video
                card above, rather than sitting loose in the grid. */}
            <section className="today-main-panel pei-details-panel">
              <section className="summary-card">
                <h2>{exercise.name}</h2>
                <div className="pei-target-grid">
                  <div className="pei-target-item">
                    <p className="eyebrow">เป้าหมาย</p>
                    <h2>{targetValueLabel(instruction.targetValue)}</h2>
                  </div>
                  <div className="pei-target-item">
                    <p className="eyebrow">ความยาก</p>
                    <h2 className={`pei-difficulty-value ${exercise.difficultyLevel === "medium" ? "moderate" : exercise.difficultyLevel}`}>
                      {exercise.difficultyLevel === "easy" ? "ง่าย" : exercise.difficultyLevel === "medium" ? "ปานกลาง" : exercise.difficultyLevel === "hard" ? "ยาก" : exercise.difficultyLevel}
                    </h2>
                  </div>
                </div>
              </section>
              <section className="summary-card">
                <p className="eyebrow">คำแนะนำจากนักกายภาพบำบัด</p>
                <p>{instruction.therapistInstruction ?? "นักกายภาพบำบัดยังไม่มีคำแนะนำเพิ่มเติม"}</p>
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
            <button
              type="button"
              className="primary-button patient-start-button pei-start-button"
              onClick={() => onStartExercise({
                virtualGripGameType: instruction.exercise.virtualGripGameType,
                baseCriteria: instruction.exercise.baseCriteria
              })}
            >
              <Play size={20} fill="currentColor" /> เริ่มทำท่าบริหาร
            </button>
          </div>
        )}
      </div>
      <PatientBottomNav activeLabel="Home" onNavigate={onNavigate} />
    </section>
  );
}
