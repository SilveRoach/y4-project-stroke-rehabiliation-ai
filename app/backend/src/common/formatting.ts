// Shared display-formatting helpers used across modules (auth, therapist, and
// any future module that needs to turn a User/date into UI-ready text).
//
// NOTE: this file was referenced by modules/auth/auth.service.ts (the
// `formatDisplayName` import) and was supposed to already exist from an earlier
// pass, but it was never actually written to disk — that earlier pass's summary
// was wrong. Creating it now for real; auth.service.ts's import needed no changes.

/**
 * Builds a human display name from a User-shaped record: "First Last" when both
 * are set, "First" or "Last" alone if only one is, otherwise falls back to the
 * login username. Patients register with just a phone number (no name fields
 * required at signup) and Therapist/Admin accounts are sometimes created with
 * only a username, so the fallback chain matters for both roles.
 */
export function displayName(user: {
  firstName?: string | null;
  lastName?: string | null;
  username: string;
}): string {
  const parts = [user.firstName, user.lastName].filter((part): part is string => Boolean(part && part.trim()));
  if (parts.length > 0) {
    return parts.join(" ");
  }
  return user.username;
}

/**
 * "John Smith" -> "JS". Single word -> first two letters ("John" -> "JO").
 * Empty/whitespace-only input -> "?" rather than throwing, since this is purely
 * cosmetic (avatar badges) and should never break a page render.
 */
export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Age in whole years as of today. Returns null when there's no date of birth on
 * file (patients.date_of_birth is nullable — not every patient record has it
 * filled in, especially ones created via admin-assisted registration).
 */
export function ageFromDate(dateOfBirth: Date | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const today = new Date();
  let age = today.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = today.getMonth() - dateOfBirth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dateOfBirth.getDate())) {
    age -= 1;
  }
  return age;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * "Today" / "Yesterday" / "N days ago" for the last week, then a short absolute
 * date ("12 Aug 2026") beyond that. Used for the Patients table's "Last Session"
 * column and the Patient Profile panel. Returns a friendly placeholder — not an
 * empty string — when there's no date at all (patient hasn't completed a
 * session yet), so the UI never renders a blank cell.
 */
export function relativeDateLabel(date: Date | null | undefined): string {
  if (!date) return "No sessions yet";

  const diffDays = Math.round((startOfDay(new Date()).getTime() - startOfDay(date).getTime()) / 86_400_000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) return `${diffDays} days ago`;

  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

/** Short weekday label ("Mon", "Tue", ...) — used for the Weekly Sessions chart's x-axis. */
export function weekdayShortLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
}
