// Lightweight success toast (CAMERA_TRACKING_MOCKUP_PLAN.md §6.3 follow-up) —
// fixed to the bottom of the screen above the patient bottom nav, auto-cleared
// by the parent via the onDone callback. Rendered at App.tsx's root level so it
// survives the view switch from SessionUploadConfirmPage back to Today.
import { CheckCircle2 } from "lucide-react";

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  return (
    <div className="app-toast" role="status" aria-live="polite">
      <CheckCircle2 size={18} />
      <span>{message}</span>
      <button type="button" className="app-toast-close" onClick={onDone} aria-label="Dismiss notification">
        ×
      </button>
    </div>
  );
}
