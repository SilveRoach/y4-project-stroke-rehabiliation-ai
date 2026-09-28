import { useEffect, useRef } from "react";
import { PoseTracker, drawSkeleton } from "../ai/poseDetection";

interface PoseVideoPlayerProps {
  src: string;
  className?: string;
}

/** Replays a recorded camera video with a locally re-derived pose overlay. */
export function PoseVideoPlayer({ src, className = "sud-video" }: PoseVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const tracker = new PoseTracker();
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
        const landmarks = tracker.detect(video, performance.now());
        if (landmarks) {
          // Camera recordings are unmirrored; unlike the live selfie preview,
          // their overlay must use the landmarks' original left-right position.
          drawSkeleton(context, landmarks, canvas.width, canvas.height, { mirror: false });
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
    tracker.init()
      .then(() => {
        if (disposed) return;
        ready = true;
        start();
      })
      .catch((error) => console.error("Recorded pose overlay could not be loaded", error));

    return () => {
      disposed = true;
      stop();
      tracker.dispose();
      video.removeEventListener("playing", start);
      video.removeEventListener("seeked", start);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onPause);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, [src]);

  return (
    <div className="pose-video-player">
      <video ref={videoRef} className={className} src={src} controls playsInline />
      <canvas ref={canvasRef} className="pose-video-overlay" aria-hidden="true" />
    </div>
  );
}
