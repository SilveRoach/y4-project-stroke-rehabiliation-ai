// One-line, human-readable summary of an exercise row's base_criteria — the
// simple values a therapist authored (angle / grip strength / reps / hold).
// Extracted from ExerciseLibraryPage so the same wording renders wherever an
// exercise row is shown: the library's read-only detail panel AND the version
// banner ExerciseAiPage shows when it was opened from the History panel.
//
// baseCriteria.poseReference is deliberately NOT summarized here: it's the
// nested AI authoring blob (angle definitions + FSM config + feature samples),
// which has no meaningful single-line form.
import type { ExerciseBaseCriteria } from "../types";

export function describeCriteria(criteria: ExerciseBaseCriteria): string {
  const parts: string[] = [];
  if (criteria.targetAngleDeg !== undefined) parts.push(`target angle ${criteria.targetAngleDeg}\u00b0`);
  if (criteria.targetGripStrength !== undefined) parts.push(`grip strength ${criteria.targetGripStrength}`);
  if (criteria.repetitions !== undefined) parts.push(`${criteria.repetitions} reps`);
  if (criteria.holdSeconds !== undefined) parts.push(`${criteria.holdSeconds}s hold`);
  return parts.length > 0 ? parts.join(", ") : "No criteria set";
}