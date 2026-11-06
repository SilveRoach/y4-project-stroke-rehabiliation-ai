import { useEffect, useState } from "react";
import type { RefObject } from "react";

interface UseSessionVideoCompositionResult {
  stream: MediaStream | null;
  error: string | null;
}

export function useSessionVideoComposition(
  videoRef: RefObject<HTMLVideoElement | null>,
  overlayRef: RefObject<HTMLCanvasElement | null>,
  active: boolean
): UseSessionVideoCompositionResult {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setStream(null);
      setError(null);
      return;
    }

    const video = videoRef.current;
    if (!video) {
      setError("ไม่พบภาพจากกล้องสำหรับเตรียมวิดีโอ");
      return;
    }

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context || typeof canvas.captureStream !== "function") {
      setError("เบราว์เซอร์นี้ไม่รองรับการรวมภาพกล้องและภาพติดตามเพื่อบันทึก");
      return;
    }

    let disposed = false;
    let frameId: number | null = null;
    let composedStream: MediaStream | null = null;
    let setupAttempted = false;

    const drawFrame = () => {
      if (disposed) return;

      const width = video.videoWidth;
      const height = video.videoHeight;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && width > 0 && height > 0) {
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }

        context.clearRect(0, 0, width, height);
        context.save();
        context.translate(width, 0);
        context.scale(-1, 1);
        context.drawImage(video, 0, 0, width, height);
        context.restore();

        const overlay = overlayRef.current;
        if (overlay && overlay.width > 0 && overlay.height > 0) {
          context.drawImage(overlay, 0, 0, width, height);
        }
      }

      frameId = window.requestAnimationFrame(drawFrame);
    };

    const setup = () => {
      if (disposed || setupAttempted || video.videoWidth <= 0 || video.videoHeight <= 0) return;
      setupAttempted = true;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      try {
        drawFrame();
        composedStream = canvas.captureStream(30);
      } catch (captureError) {
        setError(captureError instanceof Error
          ? `เตรียมวิดีโอสำหรับบันทึกไม่สำเร็จ: ${captureError.message}`
          : "เตรียมวิดีโอสำหรับบันทึกไม่สำเร็จ");
        return;
      }

      setError(null);
      setStream(composedStream);
    };

    video.addEventListener("loadedmetadata", setup);
    setup();
    return () => {
      disposed = true;
      video.removeEventListener("loadedmetadata", setup);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      composedStream?.getTracks().forEach((track) => track.stop());
    };
  }, [active, overlayRef, videoRef]);

  return { stream, error };
}
