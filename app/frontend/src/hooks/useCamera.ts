// Live camera capture via getUserMedia (FR-TRN-03). No AI/landmark processing here —
// this is purely "get the video feed onto the screen and handle the real-world ways
// that can fail." AI pose/hand detection (ai/poseDetection.ts, ai/handDetection.ts)
// will consume this same stream in a later pass.

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export type CameraStatus =
  | "idle"
  | "requesting"
  | "streaming"
  | "denied"
  | "not-found"
  | "insecure-context"
  | "unsupported"
  | "error";

export interface UseCameraResult {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  errorMessage: string | null;
  retry: () => void;
  // §6.2 (CAMERA_TRACKING_MOCKUP_PLAN.md) — the raw MediaStream once status is
  // "streaming", so hooks/useSessionRecording.ts can wrap MediaRecorder around the
  // exact same stream instead of opening a second getUserMedia call.
  stream: MediaStream | null;
}

// project-vision.md §4 / ai-architecture.md §1: target ≥15 FPS, 720p preferred,
// degrading gracefully on weaker hardware rather than failing outright — hence
// "ideal" (a request, not a hard requirement) on every constraint below.
const VIDEO_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, min: 15 },
    facingMode: "user"
  },
  audio: false
};

export function useCamera(active: boolean): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }

    // getUserMedia requires a secure context (HTTPS, or localhost) — worth a specific
    // message rather than a confusing generic failure, since this bites people the
    // first time they try accessing a dev server from another device on the LAN.
    if (!window.isSecureContext) {
      setStatus("insecure-context");
      setErrorMessage("Camera access requires HTTPS (or localhost). Contact your clinic if this persists.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      setErrorMessage("This browser doesn't support camera access. Try an up-to-date Chrome or Edge.");
      return;
    }

    let cancelled = false;
    setStatus("requesting");
    setErrorMessage(null);

    navigator.mediaDevices
      .getUserMedia(VIDEO_CONSTRAINTS)
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setStream(stream);
        setStatus("streaming");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          setStatus("denied");
          setErrorMessage("Camera access was denied. Allow camera permission in your browser settings, then try again.");
        } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
          setStatus("not-found");
          setErrorMessage("No camera was found on this device.");
        } else {
          setStatus("error");
          setErrorMessage("Couldn't start the camera. Close other apps that might be using it, then try again.");
        }
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setStream(null);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, attempt]);

  const retry = () => setAttempt((n) => n + 1);

  return { videoRef, status, errorMessage, retry, stream };
}
