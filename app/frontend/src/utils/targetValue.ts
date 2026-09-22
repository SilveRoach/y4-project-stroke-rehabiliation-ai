// Shared "raw JSON target value → human-readable label" formatter — mirrors
// backend session.service.ts's targetValueLabel(). Turns the scheduled_exercises
// targetValue JSONB (which Prisma returns as a JS object/array/primitive/null)
// into e.g. "10 repetitions" / "5 minutes" instead of '[object Object]' or the
// raw JSON '{"repetitions":10}'. Was duplicated locally in PatientProgressPage
// and PatientHistoryPage; extracted so PatientDetailPage's exercise list (which
// previously JSON.stringify()'d objects) renders the same labels everywhere.
export function formatTargetValue(targetValue: unknown): string {
  if (targetValue === null || targetValue === undefined) return "";
  if (typeof targetValue === "string" || typeof targetValue === "number") return String(targetValue);
  if (Array.isArray(targetValue)) return targetValue.map(String).join(" · ");
  if (typeof targetValue === "object") {
    return Object.entries(targetValue as Record<string, unknown>)
      .map(([key, value]) => `${String(value)} ${key}`)
      .join(" · ");
  }
  return String(targetValue);
}
