import type { PathGameSnapshot } from "../types";

export function PathDragHud({
  snapshot,
  detectionLabel,
  className = ""
}: {
  snapshot: PathGameSnapshot;
  detectionLabel: string;
  className?: string;
}) {
  const timerRunning = snapshot.phase === "ready" || snapshot.phase === "dragging";
  const seconds = Math.ceil(timerRunning ? snapshot.timeRemainingSec : snapshot.timeLimitSec);
  const remaining = timerRunning ? snapshot.timeRemainingRatio : 1;
  const timeState = remaining <= 0.2 ? "urgent" : remaining <= 0.5 ? "warning" : "";

  return (
    <section className={`path-drag-hud ${className}`.trim()} aria-label="ข้อมูลเกมลากตามเส้นทาง">
      <div className="path-drag-hud-top">
        <strong>รอบ {snapshot.roundNumber}/{snapshot.totalRounds}</strong>
        <span className={`path-drag-hud-time ${timeState}`}>
          {timerRunning ? "เหลือ" : "เวลา"} {seconds} วิ
        </span>
      </div>
      <div className="path-drag-hud-detection" role="status" aria-live="polite">
        <span>AI ตรวจพบวัตถุ</span>
        <strong>{detectionLabel}</strong>
      </div>
    </section>
  );
}
