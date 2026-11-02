/**
 * ReviewVideoPlayer
 *
 * Completely reworked video player component for Training Result Review page.
 *
 * Separates concerns into:
 * - VideoViewport: Permanent 16:9 container that always maintains layout dimensions.
 * - VideoPlaceholder: Displayed when no video is available.
 * - VideoLoadingState: Displayed while the video is loading.
 * - VideoErrorState: Displayed when video loading fails.
 * - VideoElement: Renders PoseVideoPlayer inside the viewport with 100% fill and contain.
 */

import type { CSSProperties, ReactNode } from "react";
import { AlertCircle, Video } from "lucide-react";
import { PoseVideoPlayer } from "./PoseVideoPlayer";
import type { ExerciseTrackingType, TrackingType } from "../types";

export interface ReviewVideoPlayerProps {
  /** Blob / object URL of the video, or null if no video */
  src: string | null;
  /** True while video file is being loaded */
  isLoading: boolean;
  /** True if video file loading failed */
  hasError: boolean;
  /** Movement tracking type for AI overlay */
  trackingType?: ExerciseTrackingType | TrackingType;
  /** Skip re-drawing overlays when the uploaded recording already includes them. */
  overlayAlreadyIncluded?: boolean;
  /** Optional placeholder label */
  placeholderLabel?: string;
}

/* ─── Styles ──────────────────────────────────────────────────────────────── */

const VIEWPORT_STYLE: CSSProperties = {
  position: "relative",
  display: "block",
  width: "100%",
  alignSelf: "stretch",
  aspectRatio: "16 / 9",
  backgroundColor: "#000000",
  borderRadius: "12px",
  overflow: "hidden",
  boxSizing: "border-box",
};

const OVERLAY_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "12px",
  background: "radial-gradient(circle at 50% 48%, #172030, #090d14 64%)",
};

/* ─── Sub-components ──────────────────────────────────────────────────────── */

/**
 * Permanent 16:9 video viewport.
 * Occupies 100% of the available width of the video section.
 * Never collapses or resizes when state changes.
 */
export function VideoViewport({ children }: { children: ReactNode }) {
  return (
    <div className="rvp-viewport" style={VIEWPORT_STYLE}>
      {children}
    </div>
  );
}

/** State A: No video loaded placeholder */
export function VideoPlaceholder({ label = "ไม่มีวิดีโอ" }: { label?: string }) {
  return (
    <div className="rvp-placeholder" style={OVERLAY_STYLE}>
      <span className="rvp-icon-wrap" aria-hidden="true">
        <Video size={26} />
      </span>
      <span className="rvp-label">{label}</span>
    </div>
  );
}

/** State B: Loading state */
export function VideoLoadingState() {
  return (
    <div className="rvp-loading" style={OVERLAY_STYLE}>
      <span className="rvp-spinner" aria-hidden="true" />
      <span className="rvp-label">กำลังโหลดวิดีโอ…</span>
    </div>
  );
}

/** State D: Error state */
export function VideoErrorState({ label = "โหลดวิดีโอไม่สำเร็จ" }: { label?: string }) {
  return (
    <div className="rvp-error" style={OVERLAY_STYLE}>
      <span className="rvp-icon-wrap rvp-icon-wrap--error" aria-hidden="true">
        <AlertCircle size={26} />
      </span>
      <span className="rvp-label">{label}</span>
    </div>
  );
}

/** State C: Video loaded and rendered inside viewport */
export function VideoElement({
  src,
  trackingType = "pose",
  overlayAlreadyIncluded = false,
}: {
  src: string;
  trackingType?: ExerciseTrackingType | TrackingType;
  overlayAlreadyIncluded?: boolean;
}) {
  return (
    <div className="rvp-player-wrap">
      <PoseVideoPlayer
        src={src}
        className="rvp-video"
        trackingType={trackingType}
        overlayAlreadyIncluded={overlayAlreadyIncluded}
      />
    </div>
  );
}

/* ─── Main ReviewVideoPlayer Component ────────────────────────────────────── */

export function ReviewVideoPlayer({
  src,
  isLoading,
  hasError,
  trackingType = "pose",
  overlayAlreadyIncluded = false,
  placeholderLabel = "ไม่มีวิดีโอ",
}: ReviewVideoPlayerProps) {
  return (
    <VideoViewport>
      {/* State B: Loading */}
      {isLoading && <VideoLoadingState />}

      {/* State D: Error */}
      {!isLoading && hasError && <VideoErrorState />}

      {/* State A: No video */}
      {!isLoading && !hasError && !src && (
        <VideoPlaceholder label={placeholderLabel} />
      )}

      {/* State C: Video loaded */}
      {!isLoading && !hasError && src && (
        <VideoElement
          src={src}
          trackingType={trackingType}
          overlayAlreadyIncluded={overlayAlreadyIncluded}
        />
      )}
    </VideoViewport>
  );
}
