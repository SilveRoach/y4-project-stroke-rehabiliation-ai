import { useEffect, useRef } from "react";
import { HandTracker, drawHandSkeleton } from "../ai/handDetection";
import { PoseTracker, drawSkeleton } from "../ai/poseDetection";
import type { ExerciseTrackingType, TrackingType } from "../types";

interface PoseVideoPlayerProps {
  src: string;
  className?: string;
  trackingType?: ExerciseTrackingType | TrackingType;
}

/** Replays a recorded camera video with the exercise's locally re-derived tracking overlay. */
export function PoseVideoPlayer({
  src,
  className = "sud-video",
  trackingType = "pose"
}: PoseVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const poseTracker = trackingType === "pose" || trackingType === "both" ? new PoseTracker() : null;
    const handTracker = trackingType === "virtual_grip" || trackingType === "both" ? new HandTracker() : null;
    if (!poseTracker && !handTracker) {
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    let ready = false;
    let disposed = false;
    let frameId: number | null = null;

    const resizeCanvas = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0 &&
          (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
    };
    const clear = () => canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    const stop = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
    };
    const drawFrame = () => {
      if (disposed || video.paused || video.ended) return;
      resizeCanvas();
      const context = canvas.getContext("2d");
      if (context) {
        clear();
        // MediaPipe requires monotonic timestamps. Playback can seek backwards,
        // so use the animation clock rather than the video's timeline.
        const timestamp = performance.now();
        const poseLandmarks = poseTracker?.detect(video, timestamp);
        if (poseLandmarks) {
          // Camera recordings are unmirrored; unlike the live selfie preview,
          // their overlay must use the landmarks' original left-right position.
          drawSkeleton(context, poseLandmarks, canvas.width, canvas.height, { mirror: false });
        }
        const handLandmarks = handTracker?.detect(video, timestamp);
        if (handLandmarks) {
          drawHandSkeleton(context, handLandmarks, canvas.width, canvas.height, false);
        }
      }
      frameId = requestAnimationFrame(drawFrame);
    };
    const start = () => {
      stop();
      if (ready && !video.paused && !video.ended) frameId = requestAnimationFrame(drawFrame);
    };
    const onPause = () => stop();
    const onLoadedMetadata = () => {
      resizeCanvas();
      clear();
    };

    video.addEventListener("playing", start);
    video.addEventListener("seeked", start);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onPause);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    Promise.all([
      poseTracker?.init(),
      handTracker?.init()
    ].filter((initialization): initialization is Promise<void> => initialization !== undefined))
      .then(() => {
        if (disposed) return;
        ready = true;
        start();
      })
      .catch((error) => console.error("Recorded session tracking model could not be loaded", error));

    return () => {
      disposed = true;
      stop();
      poseTracker?.dispose();
      handTracker?.dispose();
      video.removeEventListener("playing", start);
      video.removeEventListener("seeked", start);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onPause);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, [src, trackingType]);

  return (
    <div className="pose-video-player">
      <video ref={videoRef} className={className} src={src} controls playsInline />
      <canvas ref={canvasRef} className="pose-video-overlay" aria-hidden="true" />
    </div>
  );
}
