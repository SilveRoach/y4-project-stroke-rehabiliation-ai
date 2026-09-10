import { FileVideo, FolderOpen, Image as ImageIcon, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import type { PickedFile, PickedFileType } from "../types";

// Shared File Picker / Uploader component (UI_MOCKUP_PLAN_NEWDB.md §2.4). Mirrors
// docs/04-design/mockups/file-picker.html's 4 states: empty (dropzone), uploading
// (progress bar), image attached, video attached. One controlled slot per
// instance — for a multi-file field (e.g. medical history attachments), render
// one FilePicker per existing file plus a trailing empty one to add another (see
// pages/PatientDetailPage.tsx).
//
// Consumers that need persistence can provide onUpload. Existing consumers
// without it retain the local preview behavior.

interface FilePickerProps {
  value: PickedFile | null;
  onAttach: (file: PickedFile) => void;
  // Called when the person clicks "Remove". The caller owns the resulting state
  // change (e.g. clearing a slot or removing from a list) and should call
  // URL.revokeObjectURL(value.previewUrl) once it's done with the old preview.
  onRemove?: () => void;
  accept?: string;
  maxSizeMB?: number;
  // Smaller dropzone for inline "+ Add attachment" use inside a list, matching the
  // mockup's "used in context" panels.
  compact?: boolean;
  label?: string;
  onUpload?: (file: File, localPreviewUrl: string) => Promise<PickedFile>;
}

interface UploadingState {
  fileName: string;
  progress: number;
}

const DEFAULT_ACCEPT = "image/*,video/*";
const DEFAULT_MAX_SIZE_MB = 50;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function detectType(file: File): PickedFileType | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

// Best-effort video duration read via an offscreen <video> element, capped at
// 1.5s so a slow/odd file never blocks the upload flow — duration is a nice-to-
// have (matches the mockup's "0:34 · 12.4 MB"), not required to attach the file.
function readVideoDuration(objectUrl: string): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const timeout = setTimeout(() => resolve(null), 1500);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      resolve(Number.isFinite(video.duration) ? video.duration : null);
    };
    video.onerror = () => {
      clearTimeout(timeout);
      resolve(null);
    };
    video.src = objectUrl;
  });
}

export function FilePicker({
  value,
  onAttach,
  onRemove,
  accept = DEFAULT_ACCEPT,
  maxSizeMB = DEFAULT_MAX_SIZE_MB,
  compact = false,
  label,
  onUpload
}: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<UploadingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const openPicker = () => inputRef.current?.click();

  const handleFile = async (file: File) => {
    setError(null);

    const type = detectType(file);
    if (!type) {
      setError("Only image or video files are accepted.");
      return;
    }
    const maxBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
      setError(`File is too large — max ${maxSizeMB}MB.`);
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    const durationLabel =
      type === "video" ? await readVideoDuration(previewUrl).then((s) => (s ? formatDuration(s) : undefined)) : undefined;

    setUploading({ fileName: file.name, progress: 0 });

    if (onUpload) {
      try {
        const uploaded = await onUpload(file, previewUrl);
        setUploading(null);
        onAttach(uploaded);
      } catch (uploadError) {
        URL.revokeObjectURL(previewUrl);
        setUploading(null);
        setError(uploadError instanceof Error ? uploadError.message : "Could not upload this file.");
      }
      return;
    }

    const start = Date.now();
    const durationMs = 700 + Math.random() * 500;
    const tick = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(100, Math.round((elapsed / durationMs) * 100));
      setUploading({ fileName: file.name, progress });
      if (progress < 100) {
        requestAnimationFrame(tick);
      } else {
        setUploading(null);
        onAttach({
          id: `file-${Date.now()}`,
          fileName: file.name,
          fileType: type,
          sizeLabel: formatBytes(file.size),
          previewUrl,
          uploadedAtLabel: new Date().toISOString().slice(0, 10),
          durationLabel
        });
      }
    };
    requestAnimationFrame(tick);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  return (
    <div className={`filepicker ${compact ? "filepicker-compact" : ""}`}>
      {label && <p className="filepicker-label">{label}</p>}
      <input ref={inputRef} type="file" accept={accept} className="visually-hidden" onChange={handleInputChange} />

      {uploading ? (
        <div className="filepicker-row">
          <span className="filepicker-thumb uploading">
            <Loader2 size={16} className="filepicker-spin" />
          </span>
          <div className="filepicker-row-main">
            <p className="filepicker-filename">{uploading.fileName}</p>
            <div className="filepicker-progress-track">
              <div className="filepicker-progress-fill" style={{ width: `${uploading.progress}%` }} />
            </div>
          </div>
          <span className="filepicker-percent">{uploading.progress}%</span>
        </div>
      ) : value ? (
        <div className="filepicker-row">
          <span className={`filepicker-thumb ${value.fileType}`}>
            {value.fileType === "image" ? (
              <img src={value.previewUrl} alt="" className="filepicker-thumb-img" />
            ) : (
              <FileVideo size={16} />
            )}
          </span>
          <div className="filepicker-row-main">
            <p className="filepicker-filename">{value.fileName}</p>
            <p className="filepicker-meta">
              {value.fileType === "video" && value.durationLabel ? `${value.durationLabel} \u00b7 ` : ""}
              {value.sizeLabel}
              {value.fileType === "image" ? ` \u00b7 uploaded ${value.uploadedAtLabel}` : ""}
            </p>
          </div>
          <a href={value.previewUrl} target="_blank" rel="noreferrer" className="filepicker-action">
            {value.fileType === "video" ? "Preview" : "View"}
          </a>
          {onRemove && (
            <button type="button" className="filepicker-action danger" onClick={onRemove}>
              Remove
            </button>
          )}
        </div>
      ) : (
        <div
          className={`filepicker-dropzone ${isDragOver ? "drag-over" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          {compact ? (
            <button type="button" className="filepicker-compact-trigger" onClick={openPicker}>
              <FolderOpen size={14} /> No file yet &middot; <span>Choose file</span>
            </button>
          ) : (
            <>
              <ImageIcon size={22} className="filepicker-dropzone-icon" />
              <p className="filepicker-dropzone-text">Drag a file here, or</p>
              <button type="button" className="secondary-button" onClick={openPicker}>
                Choose file
              </button>
              <p className="filepicker-hint">
                Accepts image or video &middot; max {maxSizeMB}MB
              </p>
            </>
          )}
        </div>
      )}

      {error && <p className="filepicker-error">{error}</p>}
    </div>
  );
}
