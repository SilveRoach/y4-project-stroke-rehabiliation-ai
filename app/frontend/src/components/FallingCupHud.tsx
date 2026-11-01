import type { FallingCupSnapshot } from "../ai/evaluators/fallingCupGameFSM";

export function FallingCupHud({
  snapshot,
  className = ""
}: {
  snapshot: FallingCupSnapshot;
  className?: string;
}) {
  return (
    <section className={`falling-cup-hud ${className}`.trim()} aria-label="ข้อมูลเกมของตกลงถ้วย">
      <div className="falling-cup-hud-summary">
        <div>
          <strong>เก็บได้ {snapshot.caught}/{snapshot.total}</strong>
          <span>พลาด {snapshot.resolved - snapshot.caught}</span>
        </div>
      </div>
    </section>
  );
}
