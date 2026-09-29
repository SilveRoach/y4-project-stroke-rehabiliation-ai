// Shared display-name helpers for frontend UI (avatar badges, sidebar/topbar
// labels). Referenced by TherapistDashboardPage.tsx and TherapistSidebar.tsx —
// this file was imported by both but never actually created, which is what's
// causing Vite's "Failed to resolve import" error.
//
// Deliberately mirrors backend/src/common/formatting.ts's initialsFromName()
// (same fallback behavior) since both sides need to turn a display name into
// avatar initials, but there's no shared package between frontend/backend in
// this repo to import it from directly.

/**
 * "John Smith" -> "JS". Single word -> first two letters ("John" -> "JO").
 * Empty/whitespace-only input -> "?" rather than throwing, since this only
 * feeds cosmetic avatar badges and should never break a page render.
 */
export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Time-of-day greeting for the patient pages' shared topbar ("สวัสดีตอนเช้า").
 * Originally written inline in PatientTodayPage.tsx, moved here so Progress and
 * History render the exact same header chrome as Home/Today.
 *
 * Thai, and deliberately without the trailing comma the English wording carried:
 * the greeting sits on its own line above the name, and Thai has no equivalent of
 * that ", <name>" pause. Call sites must therefore not append a comma either.
 */
export function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "สวัสดีตอนเช้า";
  if (hour < 18) return "สวัสดีตอนบ่าย";
  return "สวัสดีตอนเย็น";
}
