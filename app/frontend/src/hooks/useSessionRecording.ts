// Session video recording (CAMERA_TRACKING_MOCKUP_PLAN.md §6.2). Wraps
// MediaRecorder around the SAME MediaStream hooks/useCamera.ts already opened —
// no second getUserMedia call — producing one Blob for the whole attempt (not
// per-rep), matching exercise_performance_results' one-reference_video-per-attempt
// granularity (docs/04-design/newdb.txt).
//
// Codec/container fallback: the patient-facing app is used from a phone browser
// over the LAN, and MediaRecorder support isn't uniform across the two real
// target browsers — Chrome/Edge on Android record webm (VP8/VP9 + Opus)
// reliably, but iOS Safari's MediaRecorder (supported since iOS 14.3) does NOT
// support webm at all, only mp4/H.264. A hardcoded mimeType would throw on an
// iPhone, so this feature-detects via MediaRecorder.isTypeSupported(...) and
// falls back through candidates in order, carrying whatever Blob.type the
// browser actually produced through as the recording's mimeType rather than
// assuming one format.

import { useCallback, useEffect, useRef, useState } from "react";

export type RecordingStatus = "idle" | "recording" | "paused" | "stopped";

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
}

export interface UseSessionRecordingResult {
  status: RecordingStatus;
  result: RecordingResult | null;
  isSupported: boolean;
  start: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  // Discards the current/last recording and returns to "idle" — used by both
  // Retry (§6.3, after recording has stopped) and Restart (§6.4, mid-recording).
  reset: () => void;
}

const MIME_CANDIDATES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }
  return MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

export function useSessionRecording(stream: MediaStream | null): UseSessionRecordingResult {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [result, setResult] = useState<RecordingResult | null>(null);

  const isSupported = typeof MediaRecorder !== "undefined";

  const start = useCallback(() => {
    if (!stream || !isSupported || recorderRef.current) {
      return;
    }
    const candidateType = pickMimeType();
    const recorder = candidateType ? new MediaRecorder(stream, { mimeType: candidateType }) : new MediaRecorder(stream);
    chunksRef.current = [];

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onstop = () => {
      const mimeType = recorder.mimeType || candidateType || "video/webm";
      setResult({ blob: new Blob(chunksRef.current, { type: mimeType }), mimeType });
      setStatus("stopped");
      recorderRef.current = null;
    };

    recorder.start();
    recorderRef.current = recorder;
    setResult(null);
    setStatus("recording");
  }, [stream, isSupported]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  const pause = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.pause();
      setStatus("paused");
    }
  }, []);

  const resume = useCallback(() => {
    if (recorderRef.current?.state === "paused") {
      recorderRef.current.resume();
      setStatus("recording");
    }
  }, []);

  const reset = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      // No onstop handling needed here — discarding, not keeping this take.
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    setResult(null);
    setStatus("idle");
  }, []);

  // Stop cleanly on unmount so a still-recording MediaRecorder never outlives
  // the page (e.g. the patient navigates away mid-recording via a route change
  // outside this page's own Exit-confirm flow).
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
    };
  }, []);

  return { status, result, isSupported, start, stop, pause, resume, reset };
}
