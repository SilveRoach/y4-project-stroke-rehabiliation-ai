import { AlertTriangle, Ban, CheckCircle2, Dumbbell, Eye, Hand, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { FilePicker } from "../components/FilePicker";
import { AdminSidebar } from "../components/AdminSidebar";
import type { AdminNavLabel } from "../components/AdminSidebar";
import { TherapistSidebar } from "../components/TherapistSidebar";
import type { TherapistNavLabel } from "../components/TherapistSidebar";
import {
  ApiError,
  archiveExercise,
  createExercise,
  createExerciseVersion,
  getFileThumbnail,
  getExerciseLibrary,
  publishExercise,
  updateExerciseDraft,
  type ExerciseInputPayload
} from "../services/api";
import { useAuth } from "../store/authStore";
import { useOwnProfilePicture } from "../hooks/useProfilePicture";
import { initialsFromName } from "../utils/displayName";
import type {
  ExerciseBaseCriteria,
  ExerciseLibraryDifficulty,
  ExerciseLibraryItem,
  ExerciseLibraryStatus,
  ExerciseTrackingType,
  ExerciseVersionSummary,
  PickedFile
} from "../types";

// Exercise Library page (frontend-design.md §6, revised per
// UI_MOCKUP_PLAN_NEWDB.md §2.5 for newdb.txt's versioned exercise_library schema).
// Mirrors docs/04-design/mockups/exercise-library.html's layout and the versioning
// decisions made there: a version badge + status badge per card, a "History" panel
// listing every row under the same parent_exercise_id, editing an ACTIVE exercise
// creates a new draft version (BR-6 propagation warning) rather than mutating the
// row in place, and the base-criteria form branches by movement_tracking instead of
// one generic JSON field.
//
// Backed by modules/exercise-program-library/* on the backend — replaces the
// former data/exerciseLibraryMock.ts and data/therapistMock.ts (therapistProfile)
// imports, same "wire it to the real backend" pass already done for
// TherapistDashboardPage.tsx / TherapistPatientsPage.tsx. See
// services/api.ts's Exercise Library section and exercise.service.ts's own
// comments for the schema gaps this works around:
//   - No nameTh column — the version-history mock had Thai names, real rows never
//     will, so `nameTh` is simply never rendered here (dropped from this page
//     entirely rather than always showing an empty string).
//   - Editing a still-`draft` exercise's fields in place goes to
//     `PATCH /exercises/:id`, an endpoint added beyond api-design.md — see that
//     file's own header comment.

interface ExerciseLibraryPageProps {
  onLogout: () => void;
  // Union of both sidebars' contracts — this page renders TherapistSidebar for
  // therapists and AdminSidebar for admins (same section, same label), so App
  // passes one role-dispatching handler (handleExerciseLibraryNavigate).
  onNavigate: (label: TherapistNavLabel | AdminNavLabel) => void;
  // Called after the therapist fills in Step 1 of the "New exercise" flow
  // (name + movement tracking). The library page delegates the remaining
  // creation form to ExerciseCreationPage, which lives at a separate view.
  onCreateNew?: (name: string, tracking: ExerciseTrackingType) => void;
  // Called when the user clicks on an exercise card or clicks View/Edit.
  // Navigates to the comprehensive ExerciseCreationPage for that exercise.
  onSelectExercise?: (exercise: ExerciseLibraryItem) => void;
  // Called when a version card is clicked in the "History" panel: opens THAT
  // version's own details on the full ExerciseAiPage workspace (App rebuilds a
  // single-row ExerciseLibraryItem from the version summary, since the AI
  // workspace renders exactly one exercise_library row), rather than the
  // cramped in-sidebar sub-view this panel used to open.
  onViewVersion?: (exercise: ExerciseLibraryItem, version: ExerciseVersionSummary) => void;
}

type StatusFilter = "all" | ExerciseLibraryStatus;

const trackingLabels: Record<ExerciseTrackingType, string> = {
  pose: "ติดตามท่าทาง",
  virtual_grip: "วัดแรงบีบมือ",
  none: "ไม่ใช้ AI ติดตาม"
};

const trackingIcon: Record<ExerciseTrackingType, typeof Dumbbell> = {
  pose: Dumbbell,
  virtual_grip: Hand,
  none: Ban
};

function statusLabel(status: ExerciseLibraryStatus): string {
  if (status === "active") return "ใช้งาน";
  if (status === "draft") return "ฉบับร่าง";
  return "เก็บถาวร";
}

function criteriaLabel(criteria: ExerciseBaseCriteria): string {
  const parts: string[] = [];
  if (criteria.targetAngleDeg !== undefined) parts.push(`มุมเป้าหมาย ${criteria.targetAngleDeg}°`);
  if (criteria.targetGripStrength !== undefined) parts.push(`แรงบีบมือ ${criteria.targetGripStrength}`);
  if (criteria.repetitions !== undefined) parts.push(`${criteria.repetitions} ครั้ง`);
  if (criteria.holdSeconds !== undefined) parts.push(`ค้างไว้ ${criteria.holdSeconds} วินาที`);
  return parts.length > 0 ? parts.join(", ") : "ยังไม่ได้กำหนดเกณฑ์";
}

export function ExerciseLibraryPage({
  onLogout,
  onNavigate,
  onCreateNew,
  onSelectExercise,
  onViewVersion
}: ExerciseLibraryPageProps) {
  const { token, user } = useAuth();

  const [exercises, setExercises] = useState<ExerciseLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingExercise, setEditingExercise] = useState<ExerciseLibraryItem | "new" | null>(null);
  const [historyExercise, setHistoryExercise] = useState<ExerciseLibraryItem | null>(null);
  // Read-only detail view (separate from Edit) — lets the therapist inspect an
  // exercise's full details, including archived ones, without opening the form
  // and risking an accidental edit/version-bump.
  const [viewingExercise, setViewingExercise] = useState<ExerciseLibraryItem | null>(null);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const thumbnailUrlsRef = useRef<Record<string, string>>({});

  // `reloadToken` just forces the effect below to re-run after a mutation
  // (create/edit/archive) — simpler than duplicating the fetch/cancellation
  // logic in a second, separately-invoked loadExercises() function.
  const [reloadToken, setReloadToken] = useState(0);
  const refetch = () => setReloadToken((value) => value + 1);

  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;

    setLoading(true);
    setError(null);

    getExerciseLibrary(token)
      .then((data) => {
        if (!cancelled) {
          setExercises(data.exercises);
          Object.values(thumbnailUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
          thumbnailUrlsRef.current = {};
          setThumbnailUrls({});
          data.exercises.forEach((exercise) => {
            if (!exercise.demoVideoFileId) return;
            getFileThumbnail(token, exercise.demoVideoFileId)
              .then((blob) => {
                if (cancelled) return;
                const url = URL.createObjectURL(blob);
                thumbnailUrlsRef.current[exercise.id] = url;
                setThumbnailUrls((current) => ({ ...current, [exercise.id]: url }));
              })
              .catch(() => {
                // Keep the existing placeholder when a thumbnail cannot be generated.
              });
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "โหลดคลังท่าบริหารไม่สำเร็จ กรุณาลองอีกครั้ง");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      Object.values(thumbnailUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      thumbnailUrlsRef.current = {};
    };
  }, [token, user, reloadToken]);

  const filteredExercises = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return exercises.filter((exercise) => {
      const matchesStatus = statusFilter === "all" || exercise.status === statusFilter;
      const searchableText = [
        exercise.name,
        trackingLabels[exercise.movementTracking],
        exercise.movementTracking,
        exercise.createdByName || "นักกายภาพบำบัด"
      ]
        .join(" ")
        .toLocaleLowerCase();
      return matchesStatus && (!query || searchableText.includes(query));
    });
  }, [exercises, searchQuery, statusFilter]);

  const displayName = user?.displayName || user?.username || "นักกายภาพบำบัด";
  const ownAvatarUrl = useOwnProfilePicture();
  // The exercise-library section is shared with the admin console (App routes
  // admins here from AdminSidebar's "Exercise Library" item): admins get the
  // AdminSidebar back — same section highlighted — so they can navigate out
  // again, while therapists keep the TherapistSidebar exactly as before.
  const isAdmin = user?.role === "admin";

  return (
    <section className="therapist-shell">
      {isAdmin ? (
        <AdminSidebar
          activeLabel="Exercise Library"
          onNavigate={onNavigate}
          onLogout={onLogout}
          avatarUrl={ownAvatarUrl}
        />
      ) : (
        <TherapistSidebar activeLabel="Exercise Library" onNavigate={onNavigate} onLogout={onLogout} />
      )}

      <div className="therapist-workspace">
        <header className="therapist-topbar">
          <div>
            <h1>คลังท่าบริหาร</h1>
            <p>{loading ? "กำลังโหลด…" : `ท่าบริหารทั้งหมด ${exercises.length} ท่า`}</p>
          </div>
          <div className="therapist-topbar-actions">
            <div className="therapist-topbar-profile">
              <div>
                <strong>{displayName}</strong>
                <small>นักกายภาพบำบัด</small>
              </div>
              <span className={`avatar-badge${ownAvatarUrl ? " with-photo" : ""}`}>
                {ownAvatarUrl ? <img src={ownAvatarUrl} alt={`รูปโปรไฟล์ของ ${displayName}`} /> : initialsFromName(displayName)}
              </span>
            </div>
          </div>
        </header>

        <main className="therapist-main">
          {error && (
            <div className="summary-card" role="alert" style={{ borderColor: "var(--danger, #d33)", marginBottom: 16 }}>
              <p style={{ margin: 0 }}>{error}</p>
            </div>
          )}

          <div className="summary-card">
            <div className="library-toolbar">
              <label className="library-search">
                <Search size={16} />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="ค้นหาชื่อ ประเภท หรือผู้สร้าง"
                  aria-label="ค้นหาท่าบริหารด้วยชื่อ ประเภท หรือผู้สร้าง"
                />
              </label>
              <label className="library-status-filter">
                <span>สถานะ</span>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                  aria-label="กรองท่าบริหารตามสถานะ"
                >
                  <option value="all">ทั้งหมด</option>
                  <option value="active">ใช้งาน</option>
                  <option value="draft">ฉบับร่าง</option>
                  <option value="archived">เก็บถาวร</option>
                </select>
              </label>
              <button type="button" className="primary-button" onClick={() => setEditingExercise("new")}>
                <Plus size={16} /> เพิ่มท่าบริหาร
              </button>
            </div>
          </div>

          {!loading && filteredExercises.length === 0 ? (
            <p className="pd-empty-note">
              {exercises.length === 0
                ? "ยังไม่มีท่าบริหาร"
                : searchQuery.trim()
                  ? "ไม่พบท่าบริหารที่ตรงกับคำค้นหา"
                  : "ไม่พบท่าบริหารที่ตรงกับตัวกรองนี้"}
            </p>
          ) : (
            <div className="library-grid">
              {filteredExercises.map((exercise) => {
                const Icon = trackingIcon[exercise.movementTracking];
                return (
                  <div
                    key={exercise.id}
                    className={`library-card ${exercise.status === "archived" ? "is-archived" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectExercise?.(exercise)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectExercise?.(exercise);
                      }
                    }}
                    title="เปิดตัวแก้ไขท่าบริหาร"
                  >
                    <div className="library-card-media">
                      {thumbnailUrls[exercise.id] ? (
                        <img
                          className="library-card-thumbnail library-card-video-thumbnail"
                          src={thumbnailUrls[exercise.id]}
                          alt={`ภาพตัวอย่างวิดีโอสาธิต ${exercise.name}`}
                        />
                      ) : (
                        <div className="library-card-thumbnail">
                          <Icon size={30} />
                          <span>{exercise.hasDemoVideo ? "วิดีโอสาธิต" : "ไม่มีวิดีโอสาธิต"}</span>
                        </div>
                      )}
                      <span className={`library-card-type tracking-${exercise.movementTracking}`}>
                        {trackingLabels[exercise.movementTracking]}
                      </span>
                    </div>

                    <div className="library-card-details">
                      <strong className="library-card-title">{exercise.name}</strong>
                      <span>สร้างโดย {exercise.createdByName || "นักกายภาพบำบัด"}</span>
                      <span className={`library-status-badge ${exercise.status}`}>{statusLabel(exercise.status)}</span>
                      {exercise.movementTracking === "pose" && !exercise.baseCriteria.poseReference && (
                        <span
                          className="library-status-badge draft"
                          title="ท่านี้ยังไม่ได้สแกนวิดีโอสาธิตใน AI workspace จึงยังติดตาม/ให้คะแนนในเซสชันไม่ได้"
                        >
                          ยังไม่มีข้อมูล AI
                        </span>
                      )}
                      {exercise.versions.length > 1 ? (
                        <button
                          type="button"
                          className="text-action library-card-history-link"
                          onClick={(event) => {
                            event.stopPropagation();
                            setHistoryExercise(exercise);
                          }}
                        >
                          ประวัติ
                        </button>
                      ) : (
                        <span className="library-card-history-link" style={{ color: "var(--text-secondary)", fontSize: "0.78rem" }}>ไม่มีประวัติ</span>
                      )}
                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {editingExercise && (
        <ExerciseFormModal
          exercise={editingExercise === "new" ? null : editingExercise}
          onClose={() => setEditingExercise(null)}
          onSaved={() => {
            setEditingExercise(null);
            refetch();
          }}
          onCreateNew={
            editingExercise === "new" && onCreateNew
              ? (name, tracking) => {
                  setEditingExercise(null);
                  onCreateNew(name, tracking);
                }
              : undefined
          }
        />
      )}

      {historyExercise && (
        <ExerciseHistoryPanel
          exercise={historyExercise}
          onClose={() => setHistoryExercise(null)}
          onViewVersion={
            onViewVersion ? (version) => onViewVersion(historyExercise, version) : undefined
          }
        />
      )}

      {viewingExercise && (
        <ExerciseDetailPanel
          exercise={viewingExercise}
          onClose={() => setViewingExercise(null)}
          onEdit={
            viewingExercise.status !== "archived" && (user?.role === "admin" || viewingExercise.createdById === user?.id)
              ? () => {
                  const target = viewingExercise;
                  setViewingExercise(null);
                  if (onSelectExercise) {
                    onSelectExercise(target);
                  } else {
                    setEditingExercise(target);
                  }
                }
              : undefined
          }
          onViewHistory={
            viewingExercise.versions.length > 1
              ? () => {
                  setHistoryExercise(viewingExercise);
                  setViewingExercise(null);
                }
              : undefined
          }
        />
      )}
    </section>
  );
}

// Version History panel (UI_MOCKUP_PLAN_NEWDB.md §2.5). Its one job: list the
// family's versions and hand the clicked row up to onViewVersion, which opens
// THAT version's own details on the full ExerciseAiPage workspace (App rebuilds
// a single-row ExerciseLibraryItem from the version summary). The panel
// deliberately holds no second copy of those details any more — the in-sidebar
// sub-view it used to render was too cramped to read a demo clip in. Nothing
// here can mutate anything: no Edit form (ExerciseFormModal owns that, behind
// the grid's Edit button) and no path to a version bump — version history is the
// audit trail of the rows patients were actually scored against.
function ExerciseHistoryPanel({
  exercise,
  onClose,
  onViewVersion
}: {
  exercise: ExerciseLibraryItem;
  onClose: () => void;
  // Undefined only for a caller with nowhere to navigate to; a clicked version
  // then simply does nothing (this page always passes App's handler).
  onViewVersion?: (version: ExerciseVersionSummary) => void;
}) {
  return (
    <>
      <div className="therapist-panel-scrim" onClick={onClose} />
      <div className="therapist-detail-panel library-history-panel" role="dialog" aria-label="ประวัติเวอร์ชัน">
        <div className="therapist-detail-header">
          <strong>ประวัติ · {exercise.name}</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="ปิด">
            <X size={16} />
          </button>
        </div>

        <p style={{ margin: "0 0 10px", fontSize: "0.78rem", color: "var(--text-secondary)" }}>
          เลือกเวอร์ชันด้านล่างเพื่อเปิดดู
        </p>

        <div className="library-history-list">
          {exercise.versions.map((version) => {
            const isCurrent = version.id === exercise.id || version.versionNumber === exercise.versionNumber;
            return (
              <div
                key={version.id}
                className={`library-history-row library-history-row-clickable${isCurrent ? " is-current" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => onViewVersion?.(version)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onViewVersion?.(version);
                  }
                }}
                title={`เปิดเวอร์ชัน ${version.versionNumber} ในหน้าท่าบริหาร`}
              >
                <div className="library-history-row-top">
                  <strong>
                    v{version.versionNumber}
                    {isCurrent && <span className="library-history-current-tag">ปัจจุบัน</span>}
                  </strong>
                  <span className={`library-status-badge ${version.status}`}>{statusLabel(version.status)}</span>
                </div>
                {version.name && version.name !== exercise.name && (
                  <p className="library-history-criteria" style={{ fontWeight: 500, color: "var(--text-primary)" }}>
                    {version.name}
                  </p>
                )}
                <p className="library-history-criteria">{criteriaLabel(version.baseCriteria)}</p>
                <div className="library-history-row-bottom">
                  <p className="pd-record-meta">{version.createdAtLabel}</p>
                  <span className="library-history-view-hint">
                    <Eye size={13} />
                    ดูเวอร์ชัน
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

interface ExerciseDetailPanelProps {
  exercise: ExerciseLibraryItem;
  onClose: () => void;
  // Undefined when the exercise is archived (read-only, no edit path) or, for
  // History, when there's only one version to look at.
  onEdit?: () => void;
  onViewHistory?: () => void;
}

// Read-only "View" detail panel (UI_MOCKUP_PLAN_NEWDB.md §2.5's card grid never
// had a way to inspect a full exercise — including an archived one — without
// opening the Edit form, which risks an accidental draft edit or, worse, an
// accidental version bump on an active row. This panel never mutates anything;
// it only offers to hand off into Edit/History.
function ExerciseDetailPanel({ exercise, onClose, onEdit, onViewHistory }: ExerciseDetailPanelProps) {
  const Icon = trackingIcon[exercise.movementTracking];

  return (
    <>
      <div className="therapist-panel-scrim" onClick={onClose} />
      <div className="therapist-detail-panel library-history-panel" role="dialog" aria-label={`ดูรายละเอียด ${exercise.name}`}>
        <div className="therapist-detail-header">
          <strong>{exercise.name}</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="ปิด">
            <X size={16} />
          </button>
        </div>

        <div className="library-history-list">
          <div className="library-history-row">
            <div className="library-history-row-top">
              <span className="library-card-icon" style={{ width: 36, height: 36 }}>
                <Icon size={18} />
              </span>
              <div className="library-card-badges">
                <span className={`library-status-badge ${exercise.status}`}>{statusLabel(exercise.status)}</span>
                <span className="library-version-badge">v{exercise.versionNumber}</span>
              </div>
            </div>
            <p className="library-history-criteria">
              {trackingLabels[exercise.movementTracking]}
            </p>
          </div>

          <div className="library-history-row">
            <strong style={{ fontSize: "0.82rem" }}>คำอธิบาย</strong>
            <p className="library-history-criteria">{exercise.description || "ไม่มีคำอธิบาย"}</p>
          </div>

          <div className="library-history-row">
            <strong style={{ fontSize: "0.82rem" }}>เกณฑ์พื้นฐาน</strong>
            <p className="library-history-criteria">{criteriaLabel(exercise.baseCriteria)}</p>
          </div>

          <div className="library-history-row">
            <strong style={{ fontSize: "0.82rem" }}>วิดีโอสาธิต</strong>
            <p className="library-history-criteria">{exercise.hasDemoVideo ? "แนบแล้ว" : "ไม่ได้แนบ"}</p>
          </div>

          <div className="library-history-row">
            <strong style={{ fontSize: "0.82rem" }}>สร้างเมื่อ</strong>
            <p className="library-history-criteria">
              {exercise.createdAtLabel} โดย {exercise.createdByName}
            </p>
          </div>
        </div>

        <div className="library-history-row-actions">
          {onEdit && (
            <button type="button" className="primary-button" onClick={onEdit}>
              แก้ไข
            </button>
          )}
          {onViewHistory && (
            <button type="button" className="text-action" onClick={onViewHistory}>
              ดูประวัติ
            </button>
          )}
        </div>
      </div>
    </>
  );
}

interface ExerciseFormModalProps {
  exercise: ExerciseLibraryItem | null;
  onClose: () => void;
  // Replaces the old onSaveNew/onSaveEdit pair — now there's exactly one
  // "the backend call succeeded, go refetch the list" signal, since the page
  // owns the authoritative post-save state (the server response), not a
  // locally-constructed ExerciseLibraryItem.
  onSaved: () => void;
  // Two-step flow: when set, the "new exercise" modal only collects name +
  // movement tracking and calls this instead of saving. The full details form
  // lives at ExerciseCreationPage. Only provided when exercise===null (new).
  onCreateNew?: (name: string, tracking: ExerciseTrackingType) => void;
}

function ExerciseFormModal({ exercise, onClose, onSaved, onCreateNew }: ExerciseFormModalProps) {
  const { token, user } = useAuth();
  const isOwner = !exercise || (user ? (exercise.createdById === user.id || user.role === "admin") : false);
  const isEditingActive = exercise?.status === "active";
  // Two-step mode: when onCreateNew is provided and this is a new exercise,
  // the modal only collects name + movement tracking then calls onCreateNew.
  const isTwoStep = !exercise && !!onCreateNew;

  const [name, setName] = useState(exercise?.name ?? "");
  const [description, setDescription] = useState(exercise?.description ?? "");
  const [movementTracking, setMovementTracking] = useState<ExerciseTrackingType>(
    exercise?.movementTracking ?? "pose"
  );
  const [difficultyLevel, setDifficultyLevel] = useState<ExerciseLibraryDifficulty>(
    exercise?.difficultyLevel ?? "medium"
  );
  // Local preview only — see this file's header comment: no upload backend
  // exists, so picking a file here never reaches the server.
  const [demoFile, setDemoFile] = useState<PickedFile | null>(null);
  const [targetAngleDeg, setTargetAngleDeg] = useState(exercise?.baseCriteria.targetAngleDeg?.toString() ?? "90");
  const [targetGripStrength, setTargetGripStrength] = useState(
    exercise?.baseCriteria.targetGripStrength?.toString() ?? "50"
  );
  const [repetitions, setRepetitions] = useState(exercise?.baseCriteria.repetitions?.toString() ?? "10");
  const [holdSeconds, setHoldSeconds] = useState(exercise?.baseCriteria.holdSeconds?.toString() ?? "5");

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Status-change actions (Publish / Archive) are separate from the Save
  // button above: they don't touch any of the field state in this form, they
  // just move `exercise.status` directly via their own dedicated routes
  // (PATCH .../publish, PATCH .../archive) — same split as the page-level
  // handleArchive() uses for the card grid's own Archive button.
  const [statusAction, setStatusAction] = useState<"publish" | "archive" | null>(null);
  const [statusActionError, setStatusActionError] = useState<string | null>(null);

  const handlePublish = async () => {
    if (!exercise || !token) return;
    setStatusAction("publish");
    setStatusActionError(null);
    try {
      await publishExercise(token, exercise.id);
      onSaved();
    } catch (err) {
      setStatusActionError(err instanceof ApiError ? err.message : "เผยแพร่ท่าบริหารไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setStatusAction(null);
    }
  };

  const handleArchiveFromModal = async () => {
    if (!exercise || !token) return;
    setStatusAction("archive");
    setStatusActionError(null);
    try {
      await archiveExercise(token, exercise.id);
      onSaved();
    } catch (err) {
      setStatusActionError(err instanceof ApiError ? err.message : "เก็บท่าบริหารเข้าคลังไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setStatusAction(null);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;

    // Two-step: new exercise with a dedicated creation page — just hand off
    // name + tracking type and let ExerciseCreationPage collect the rest.
    if (isTwoStep) {
      onCreateNew!(name.trim(), movementTracking);
      return;
    }

    if (!token) return;

    const baseCriteria: ExerciseBaseCriteria = {};
    if (movementTracking === "pose") {
      baseCriteria.targetAngleDeg = Number(targetAngleDeg) || undefined;
      baseCriteria.repetitions = Number(repetitions) || undefined;
      baseCriteria.holdSeconds = Number(holdSeconds) || undefined;
    } else if (movementTracking === "virtual_grip") {
      baseCriteria.targetGripStrength = Number(targetGripStrength) || undefined;
      baseCriteria.repetitions = Number(repetitions) || undefined;
      baseCriteria.holdSeconds = Number(holdSeconds) || undefined;
    } else {
      baseCriteria.repetitions = Number(repetitions) || undefined;
    }
    // This form only knows the manual criteria fields, and create/PATCH/version
    // all REPLACE base_criteria wholesale — carry an AI-authored pose reference
    // (created in the AI workspace) forward so editing here can't silently wipe
    // it and break session scoring.
    if (exercise?.baseCriteria?.poseReference) {
      baseCriteria.poseReference = exercise.baseCriteria.poseReference;
    }

    const payload: ExerciseInputPayload = {
      name: name.trim(),
      description: description.trim(),
      movementTracking,
      difficultyLevel,
      baseCriteria
    };

    setSaving(true);
    setFormError(null);
    try {
      if (!exercise) {
        // New exercise family — starts its own family id at v1/draft.
        await createExercise(token, payload);
      } else if (isEditingActive) {
        // Active -> editing creates a new draft version (BR-6); the backend
        // archives the previously-active row in the same transaction.
        await createExerciseVersion(token, exercise.id, payload);
      } else {
        // Draft -> safe to edit in place; nothing has ever gone live.
        await updateExerciseDraft(token, exercise.id, payload);
      }
      onSaved();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "บันทึกท่าบริหารไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="therapist-panel-scrim" onClick={onClose} />
      <div className="library-modal" role="dialog" aria-label={exercise ? "แก้ไขท่าบริหาร" : "เพิ่มท่าบริหาร"}>
        <div className="therapist-detail-header">
          <strong>{exercise ? "แก้ไขท่าบริหาร" : "เพิ่มท่าบริหาร"}</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="ปิด">
            <X size={16} />
          </button>
        </div>

        {isEditingActive && (
          <div className="library-warning-banner">
            <AlertTriangle size={16} />
            <span>
              การแก้ไขท่าบริหารที่ใช้งานอยู่จะสร้างเวอร์ชันใหม่ และอัปเดตท่าบริหารนี้ในทุกแผนที่ใช้งานอยู่ (BR-6)
            </span>
          </div>
        )}

        {!isOwner && exercise && (
          <div className="library-warning-banner" style={{ borderColor: "var(--warning, #f59e0b)", background: "rgba(245, 158, 11, 0.1)" }}>
            <AlertTriangle size={16} />
            <span>
              ท่าบริหารนี้สร้างโดย {exercise.createdByName || "นักกายภาพบำบัดท่านอื่น"} เฉพาะผู้สร้างเท่านั้นที่แก้ไขหรือสร้างเวอร์ชันใหม่ได้
            </span>
          </div>
        )}

        {exercise && (
          <div className="library-history-row" style={{ margin: "0 20px" }}>
            <div className="library-history-row-top">
              <span>
                สถานะปัจจุบัน: <span className={`library-status-badge ${exercise.status}`}>{statusLabel(exercise.status)}</span>
              </span>
            </div>
            {statusActionError && (
              <p className="library-history-criteria" style={{ color: "var(--danger, #d33)" }}>
                {statusActionError}
              </p>
            )}
            {exercise.status !== "archived" && (
              <div className="library-history-row-actions">
                {exercise.status === "draft" && (
                  <button
                    type="button"
                    className="text-action"
                    disabled={statusAction !== null}
                    onClick={handlePublish}
                  >
                    <CheckCircle2 size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                    {statusAction === "publish" ? "กำลังเผยแพร่…" : "เผยแพร่"}
                  </button>
                )}
                <button
                  type="button"
                  className="text-action danger"
                  disabled={statusAction !== null}
                  onClick={handleArchiveFromModal}
                >
                  {statusAction === "archive" ? "กำลังเก็บเข้าคลัง…" : "เก็บเข้าคลัง"}
                </button>
              </div>
            )}
          </div>
        )}

        {formError && (
          <div className="summary-card" role="alert" style={{ borderColor: "var(--danger, #d33)", margin: "0 20px 12px" }}>
            <p style={{ margin: 0 }}>{formError}</p>
          </div>
        )}

        <form className="library-modal-form" onSubmit={handleSubmit}>
          <label>
            ชื่อท่าบริหาร
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>

          <div className="library-toggle-row">
            <label>
              วิธีติดตามการเคลื่อนไหว
              <select
                className="creation-select"
                value={movementTracking}
                onChange={(event) => setMovementTracking(event.target.value as ExerciseTrackingType)}
              >
                {(["pose", "virtual_grip", "none"] as ExerciseTrackingType[]).map((option) => (
                  <option key={option} value={option}>
                    {trackingLabels[option]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Two-step mode: stop here and hand off to ExerciseCreationPage */}
          {isTwoStep ? (
            <button type="submit" className="primary-button full-width" disabled={!name.trim()}>
              ดำเนินการต่อ →
            </button>
          ) : (
            <>
              <label>
                คำอธิบาย
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
              </label>

              <label>
                วิดีโอสาธิต
                <FilePicker
                  value={demoFile}
                  onAttach={setDemoFile}
                  onRemove={() => setDemoFile(null)}
                  accept="video/*"
                  locale="th"
                />
              </label>

              <div>
                <p className="filepicker-label" style={{ marginBottom: 8 }}>
                  เกณฑ์พื้นฐาน &mdash; สำหรับ{trackingLabels[movementTracking]}
                </p>
                <div className="library-criteria-grid">
                  {movementTracking === "pose" && (
                    <>
                      <label>
                        มุมเป้าหมาย (&deg;)
                        <input
                          type="number"
                          value={targetAngleDeg}
                          onChange={(event) => setTargetAngleDeg(event.target.value)}
                        />
                      </label>
                      <label>
                        จำนวนครั้ง
                        <input type="number" value={repetitions} onChange={(event) => setRepetitions(event.target.value)} />
                      </label>
                      <label>
                        ค้างไว้ (วินาที)
                        <input type="number" value={holdSeconds} onChange={(event) => setHoldSeconds(event.target.value)} />
                      </label>
                    </>
                  )}
                  {movementTracking === "virtual_grip" && (
                    <>
                      <label>
                        แรงบีบมือเป้าหมาย
                        <input
                          type="number"
                          value={targetGripStrength}
                          onChange={(event) => setTargetGripStrength(event.target.value)}
                        />
                      </label>
                      <label>
                        จำนวนครั้ง
                        <input type="number" value={repetitions} onChange={(event) => setRepetitions(event.target.value)} />
                      </label>
                      <label>
                        ค้างไว้ (วินาที)
                        <input type="number" value={holdSeconds} onChange={(event) => setHoldSeconds(event.target.value)} />
                      </label>
                    </>
                  )}
                  {movementTracking === "none" && (
                    <label>
                      จำนวนครั้ง
                      <input type="number" value={repetitions} onChange={(event) => setRepetitions(event.target.value)} />
                    </label>
                  )}
                </div>
              </div>

              <button type="submit" className="primary-button full-width" disabled={saving || (!isOwner && !!exercise)}>
                {saving
                  ? "กำลังบันทึก…"
                  : exercise
                    ? !isOwner
                      ? "ดูได้อย่างเดียว (ไม่ใช่ผู้สร้าง)"
                      : isEditingActive
                        ? `บันทึกเป็นเวอร์ชัน v${exercise.versionNumber + 1} · ฉบับร่าง`
                        : "บันทึกการเปลี่ยนแปลง"
                    : "บันทึกเป็นเวอร์ชัน v1 · ฉบับร่าง"}
              </button>
            </>
          )}
        </form>
      </div>
    </>
  );
}
