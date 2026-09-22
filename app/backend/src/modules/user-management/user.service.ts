import bcrypt from "bcrypt";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../common/errors";
import { displayName, relativeDateLabel } from "../../common/formatting";
import { prisma } from "../../config/prisma";

const BCRYPT_ROUNDS = 12;

export interface CreatedAccount {
  id: string;
  role: "therapist" | "admin" | "patient";
  username: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  email: string | null;
  phoneNumber: string | null;
  // Patient-only — undefined for Therapist/Admin accounts (no `patients` row
  // to read these from). Mirrors patients.gender/date_of_birth/height_cm/
  // weight_kg on schema.prisma.
  gender?: "male" | "female" | "other" | "unknown";
  dateOfBirth?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
}

export interface CreateAccountInput {
  firstName: string;
  lastName: string;
  email?: string;
  phoneNumber?: string;
  // Patient-only extras — ignored for Therapist/Admin (see the role branch
  // below). `phoneNumber` above doubles as the patient's phone for
  // Therapist/Admin's optional contact field, but for a Patient the *login*
  // phone number is the `username` argument itself, matching
  // auth.service.ts's `register()` convention (username === phone_number).
  gender?: "male" | "female" | "other" | "unknown";
  dateOfBirth?: string;
  heightCm?: number;
  weightKg?: number;
}

function validateUsername(username: string): string {
  const trimmed = username.trim();

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,49}$/.test(trimmed)) {
    throw new ValidationError(
      "Username must be 3-50 characters, start with a letter or number, and contain only letters, numbers, dots, underscores, or hyphens."
    );
  }

  return trimmed;
}

function validatePassword(password: string): void {
  if (password.length < 8) {
    throw new ValidationError("Password must be at least 8 characters.");
  }
}

export async function createAccount(
  role: string,
  username: string,
  password: string,
  createdById: string,
  extra: CreateAccountInput
): Promise<CreatedAccount> {
  if (role !== "therapist" && role !== "admin" && role !== "patient") {
    throw new ValidationError('Role must be "therapist", "admin", or "patient".');
  }

  validatePassword(password);

  // firstName/lastName mirror users.first_name/last_name on the schema (see
  // common/formatting.ts's `displayName()`) — required for every role here so
  // every admin-created account has a real name on day one, rather than
  // falling back to the login username/phone the way some legacy rows might.
  const firstName = (extra.firstName ?? "").trim();
  const lastName = (extra.lastName ?? "").trim();
  if (!firstName) {
    throw new ValidationError('"firstName" is required.');
  }
  if (!lastName) {
    throw new ValidationError('"lastName" is required.');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // --- Patient -----------------------------------------------------------
  // Real admin-created Patient accounts, previously mock-only in the frontend
  // (AdminUserManagementPage.tsx's CreateAccountModal never called this
  // endpoint for Patient — CreateUserPayload was typed to "therapist" |
  // "admin" only). Follows the exact same login-identifier convention
  // self-registration already uses in auth.service.ts's `register()`:
  // username === phone_number, both set from the same cleaned value.
  if (role === "patient") {
    const cleanPhone = validatePhoneNumberField(username);
    if (!cleanPhone) {
      throw new ValidationError('"username" (the patient\'s phone number) is required.');
    }

    // phone_number isn't @unique on the schema (see register()'s comment), so
    // check it with findFirst; username IS @unique, so also guard that
    // directly rather than relying solely on the phone check.
    const existingPhone = await prisma.user.findFirst({ where: { phoneNumber: cleanPhone } });
    if (existingPhone) {
      throw new ConflictError("An account with this phone number already exists.");
    }
    const existingUsername = await prisma.user.findUnique({ where: { username: cleanPhone } });
    if (existingUsername) {
      throw new ConflictError("An account with this phone number already exists.");
    }

    const gender = extra.gender ?? "unknown";
    const dateOfBirth =
      extra.dateOfBirth && extra.dateOfBirth.trim().length > 0 ? parseDateInput(extra.dateOfBirth, "dateOfBirth") : undefined;

    const user = await prisma.user.create({
      data: {
        role: "patient",
        username: cleanPhone,
        phoneNumber: cleanPhone,
        passwordHash,
        createdBy: createdById,
        firstName,
        lastName,
        patient: {
          create: {
            gender,
            dateOfBirth,
            heightCm: extra.heightCm,
            weightKg: extra.weightKg
          }
        }
      },
      include: { patient: true }
    });

    return {
      id: user.id,
      role: "patient",
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: displayName(user),
      email: user.email,
      phoneNumber: user.phoneNumber,
      gender: user.patient?.gender,
      dateOfBirth: toDateInputValue(user.patient?.dateOfBirth),
      heightCm: user.patient?.heightCm !== undefined && user.patient?.heightCm !== null ? Number(user.patient.heightCm) : null,
      weightKg: user.patient?.weightKg !== undefined && user.patient?.weightKg !== null ? Number(user.patient.weightKg) : null
    };
  }

  // --- Therapist / Admin ---------------------------------------------------
  const cleanUsername = validateUsername(username);

  // email/phoneNumber are optional on the schema (users.email, users.phone_number)
  // — validated with the same rules PATCH /users/:id already uses below.
  const email = extra.email && extra.email.trim().length > 0 ? validateEmail(extra.email) : "";
  const phoneNumber =
    extra.phoneNumber && extra.phoneNumber.trim().length > 0 ? validatePhoneNumberField(extra.phoneNumber) : "";

  const existing = await prisma.user.findUnique({
    where: {
      username: cleanUsername,
    },
  });

  if (existing) {
    throw new ConflictError(
      "An account with this username already exists."
    );
  }

  // users.phone_number is unique — same check PATCH /users/:id does for a
  // self-edit, needed here too since it's optional but not exempt from the
  // schema's uniqueness constraint.
  if (phoneNumber) {
    const existingPhone = await prisma.user.findUnique({ where: { phoneNumber } });
    if (existingPhone) {
      throw new ConflictError("An account with this phone number already exists.");
    }
  }

  const user = await prisma.user.create({
    data: {
      role,
      username: cleanUsername,
      passwordHash,
      createdBy: createdById,
      firstName,
      lastName,
      email: email || null,
      phoneNumber: phoneNumber || null,

      ...(role === "therapist"
        ? {
            therapist: {
              create: {},
            },
          }
        : {}),
    },
  });

  return {
    id: user.id,
    role: role as "therapist" | "admin",
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: displayName(user),
    email: user.email,
    phoneNumber: user.phoneNumber,
  };
}

// --- GET /users (Admin-only account list, FR-USR-02) -----------------------
// AdminUserManagementPage.tsx's account table was previously entirely mock
// data (data/adminMock.ts's adminUsers) with newly-created accounts merged in
// locally, because no list endpoint existed — see this file's original scope
// note above createAccount(). This is the first real implementation.

export interface UserListItem {
  id: string;
  role: "patient" | "therapist" | "admin";
  username: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  status: "active" | "disabled";
  lastLoginLabel: string;
  email: string | null;
  phoneNumber: string | null;
  // users.profile_picture_file_id (files-row id) — powers the account table's
  // profile-picture avatar on AdminUserManagementPage (initials fallback).
  profilePictureFileId?: string | null;
  // Therapist-only.
  licenseNumber?: string | null;
  licenseIssuedLabel?: string | null;
  licenseExpiryLabel?: string | null;
  // Count of this therapist's *active* patient_therapist_assignments rows —
  // same "active assignment" definition therapist.service.ts's dashboard
  // stats use, not a lifetime headcount.
  patientCount?: number;
  // Admin-only.
  employeeId?: string | null;
  // Patient-only.
  gender?: "male" | "female" | "other" | "unknown";
  dateOfBirthLabel?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  // Patient-only: the therapist from the patient's ACTIVE
  // patient_therapist_assignments row (null when unassigned). Mirrors
  // getUserProfile()'s assignedTherapist below — without this the account
  // table's "Assigned to {name}" line on AdminUserManagementPage always shows
  // "Not assigned" even when the therapist dashboard shows the assignment.
  assignedTherapist?: { id: string; displayName: string; licenseNumber?: string | null } | null;
}

// users.status is active/inactive/suspended (UsersStatus on schema.prisma),
// but the table only has an Active/Disabled badge and a disabled
// Enable/Disable button (no PATCH /users/:id/status endpoint exists yet, see
// AdminUserManagementPage.tsx) — inactive and suspended both collapse to
// "disabled" here since the UI doesn't distinguish them.
function toAccountStatus(status: "active" | "inactive" | "suspended"): "active" | "disabled" {
  return status === "active" ? "active" : "disabled";
}

// users.last_login_at -> a relative label, "Never" if it's never been set.
// Distinct from relativeDateLabel()'s own "No sessions yet" fallback (that
// one's about rehabilitation session history, not login activity) — same
// day-math, different empty-state copy for this context.
function lastLoginLabel(date: Date | null | undefined): string {
  if (!date) return "Never";
  return relativeDateLabel(date);
}

export async function listUsers(): Promise<UserListItem[]> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      patient: {
        include: {
          // Active assignment only (same definition therapist.service.ts's
          // dashboard uses) with the therapist's user row for the display name.
          therapistAssignments: {
            where: { status: "active" },
            include: { therapist: { include: { user: true } } }
          }
        }
      },
      therapist: {
        include: {
          patientAssignments: { where: { status: "active" } }
        }
      },
      admin: true
    }
  });

  return users.map((user) => {
    const item: UserListItem = {
      id: user.id,
      role: user.role,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: displayName(user),
      status: toAccountStatus(user.status),
      lastLoginLabel: lastLoginLabel(user.lastLoginAt),
      email: user.email,
      phoneNumber: user.phoneNumber,
      profilePictureFileId: user.profilePictureFileId
    };

    if (user.role === "therapist" && user.therapist) {
      item.licenseNumber = user.therapist.licenseNumber;
      item.licenseIssuedLabel = toDateInputValue(user.therapist.licenseIssuedDate);
      item.licenseExpiryLabel = toDateInputValue(user.therapist.licenseExpiryDate);
      item.patientCount = user.therapist.patientAssignments.length;
    }

    if (user.role === "admin" && user.admin) {
      item.employeeId = user.admin.employeeId;
    }

    if (user.role === "patient" && user.patient) {
      item.gender = user.patient.gender;
      item.dateOfBirthLabel = toDateInputValue(user.patient.dateOfBirth);
      item.heightCm = user.patient.heightCm !== null && user.patient.heightCm !== undefined ? Number(user.patient.heightCm) : null;
      item.weightKg = user.patient.weightKg !== null && user.patient.weightKg !== undefined ? Number(user.patient.weightKg) : null;
      // Same shape as getUserProfile()'s assignedTherapist (therapist *user* id —
      // assignment endpoints are keyed on user ids), so the table row and the
      // AccountInfoModal agree on the patient's current therapist.
      const activeAssignment = user.patient.therapistAssignments?.[0];
      if (activeAssignment?.therapist) {
        item.assignedTherapist = {
          id: activeAssignment.therapist.userId,
          displayName: displayName(activeAssignment.therapist.user),
          licenseNumber: activeAssignment.therapist.licenseNumber
        };
      } else {
        item.assignedTherapist = null;
      }
    }

    return item;
  });
}

// --- GET /users/:id, PATCH /users/:id (FR-USR-04) --------------------------
// Previously only POST / existed (account creation) — this was the entire
// user-management module's scope so far, per this file's original header
// comment. Self-profile view/edit was documented in api-design.md ("Edit own
// profile") but never built; TherapistSettingsPage.tsx needs it for this pass.
//
// SCHEMA GAP: TherapistSettingsPage.tsx's original mock form (cloned from
// PatientSettingsPage.tsx) had a "Clinic address" field and a free-text "Title"
// field. Neither has a real column: `address` only exists on `patients`, not on
// `users`/`therapists`, and there is no job-title column anywhere. Both are
// dropped from the real form entirely (frontend) rather than kept as dead,
// never-persisted inputs — same treatment as exercise_library's missing
// `name_th` column elsewhere in this codebase.

export interface UserProfileDto {
  id: string;
  role: "patient" | "therapist" | "admin";
  username: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  email: string | null;
  phoneNumber: string | null;
  createdAtLabel: string;
  createdAtIso?: string;
  // Therapist-only
  licenseNumber?: string | null;
  licenseIssuedDate?: string | null;
  licenseExpiryDate?: string | null;
  // Patient-only
  gender?: "male" | "female" | "other" | "unknown";
  dateOfBirth?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  address?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  // Id of the user's profile-picture `files` row — the Settings pages resolve
  // it to pixels via GET /files/:fileId/content.
  profilePictureFileId?: string | null;
  assignedTherapist?: {
    id: string;
    displayName: string;
    licenseNumber?: string | null;
  } | null;
}

export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  licenseNumber?: string;
  licenseIssuedDate?: string;
  licenseExpiryDate?: string;
  // Patient-only
  username?: string;
  gender?: "male" | "female" | "other" | "unknown";
  dateOfBirth?: string;
  heightCm?: number;
  weightKg?: number;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  // Self-profile picture: the id of a `files` row (uploaded first via
  // POST /files) that must be an image. null clears the current picture.
  profilePictureFileId?: string | null;
}

/** Date -> "yyyy-MM-dd" for an <input type="date">'s value, or null if unset. */
function toDateInputValue(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

function parseDateInput(value: string, field: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`"${field}" must be a valid date.`);
  }
  return parsed;
}

function validateEmail(email: string): string {
  const trimmed = email.trim();
  if (trimmed.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new ValidationError("Enter a valid email address.");
  }
  return trimmed;
}

function validatePhoneNumberField(phoneNumber: string): string {
  const trimmed = phoneNumber.trim();
  if (trimmed.length > 0 && !/^[0-9+\-\s]{7,20}$/.test(trimmed)) {
    throw new ValidationError("Enter a valid phone number.");
  }
  return trimmed;
}

async function fetchUserWithTherapist(id: string) {
  return prisma.user.findUnique({
    where: { id },
    include: {
      therapist: true,
      patient: {
        include: {
          therapistAssignments: {
            where: { status: "active" },
            include: { therapist: { include: { user: true } } }
          }
        }
      }
    }
  });
}

function toProfileDto(user: NonNullable<Awaited<ReturnType<typeof fetchUserWithTherapist>>>): UserProfileDto {
  const base: UserProfileDto = {
    id: user.id,
    role: user.role,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: displayName(user),
    email: user.email,
    phoneNumber: user.phoneNumber,
    createdAtLabel: relativeDateLabel(user.createdAt),
    createdAtIso: user.createdAt.toISOString().slice(0, 10),
    profilePictureFileId: user.profilePictureFileId
  };

  if (user.role === "therapist" && user.therapist) {
    base.licenseNumber = user.therapist.licenseNumber;
    base.licenseIssuedDate = toDateInputValue(user.therapist.licenseIssuedDate);
    base.licenseExpiryDate = toDateInputValue(user.therapist.licenseExpiryDate);
  }

  if (user.role === "patient" && user.patient) {
    base.gender = user.patient.gender;
    base.dateOfBirth = toDateInputValue(user.patient.dateOfBirth);
    base.heightCm = user.patient.heightCm !== null && user.patient.heightCm !== undefined ? Number(user.patient.heightCm) : null;
    base.weightKg = user.patient.weightKg !== null && user.patient.weightKg !== undefined ? Number(user.patient.weightKg) : null;
    base.address = user.patient.address;
    base.emergencyContactName = user.patient.emergencyContactName;
    base.emergencyContactPhone = user.patient.emergencyContactPhone;

    const activeAssignment = user.patient.therapistAssignments?.[0];
    if (activeAssignment?.therapist) {
      base.assignedTherapist = {
        id: activeAssignment.therapist.userId,
        displayName: displayName(activeAssignment.therapist.user),
        licenseNumber: activeAssignment.therapist.licenseNumber
      };
    } else {
      base.assignedTherapist = null;
    }
  }

  return base;
}

export async function getUserProfile(id: string): Promise<UserProfileDto> {
  const user = await fetchUserWithTherapist(id);
  if (!user) throw new NotFoundError("User not found.");
  return toProfileDto(user);
}

export async function updateUserProfile(
  id: string,
  actorId: string,
  input: UpdateProfileInput
): Promise<UserProfileDto> {
  const user = await fetchUserWithTherapist(id);
  if (!user) throw new NotFoundError("User not found.");

  const userData: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
    username?: string;
    profilePictureFileId?: string | null;
  } = {};

  if (input.firstName !== undefined) {
    const trimmed = input.firstName.trim();
    userData.firstName = trimmed.length > 0 ? trimmed : null;
  }
  if (input.lastName !== undefined) {
    const trimmed = input.lastName.trim();
    userData.lastName = trimmed.length > 0 ? trimmed : null;
  }
  if (input.email !== undefined) {
    const clean = validateEmail(input.email);
    userData.email = clean.length > 0 ? clean : null;
  }
  if (input.phoneNumber !== undefined) {
    const clean = validatePhoneNumberField(input.phoneNumber);
    if (clean.length > 0) {
      const existing = await prisma.user.findFirst({ where: { phoneNumber: clean, NOT: { id } } });
      if (existing) throw new ConflictError("Another account already uses this phone number.");
    }
    userData.phoneNumber = clean.length > 0 ? clean : null;
  }

  if (input.username !== undefined && user.role === "patient") {
    const cleanPhone = validatePhoneNumberField(input.username);
    if (!cleanPhone) {
      throw new ValidationError('"username" (the patient\'s phone number) cannot be empty.');
    }
    const existingUsername = await prisma.user.findFirst({ where: { username: cleanPhone, NOT: { id } } });
    if (existingUsername) throw new ConflictError("An account with this phone number already exists.");
    const existingPhone = await prisma.user.findFirst({ where: { phoneNumber: cleanPhone, NOT: { id } } });
    if (existingPhone) throw new ConflictError("An account with this phone number already exists.");
    userData.username = cleanPhone;
    userData.phoneNumber = cleanPhone;
  }

  // Profile-picture assignment: the id must reference a `files` row the caller
  // uploaded that is an image (the same "only your own files" rule the exercise
  // demo-video flow enforces). null (explicit) clears the current picture.
  if (input.profilePictureFileId !== undefined) {
    if (input.profilePictureFileId === null) {
      userData.profilePictureFileId = null;
    } else {
      const file = await prisma.file.findUnique({ where: { id: input.profilePictureFileId } });
      if (!file) throw new ValidationError("The selected profile picture file does not exist.");
      if (file.fileType !== "image") throw new ValidationError("The profile picture must be an image file.");
      if (file.uploadedBy !== actorId) throw new ForbiddenError("You can only use files you uploaded.");
      userData.profilePictureFileId = file.id;
    }
  }

  const therapistData: { licenseNumber?: string | null; licenseIssuedDate?: Date | null; licenseExpiryDate?: Date | null } =
    {};

  if (user.role === "therapist") {
    if (input.licenseNumber !== undefined) {
      const trimmed = input.licenseNumber.trim();
      if (trimmed.length > 0) {
        const existing = await prisma.therapist.findFirst({ where: { licenseNumber: trimmed, NOT: { userId: id } } });
        if (existing) throw new ConflictError("Another therapist already uses this license number.");
      }
      therapistData.licenseNumber = trimmed.length > 0 ? trimmed : null;
    }
    if (input.licenseIssuedDate !== undefined) {
      therapistData.licenseIssuedDate =
        input.licenseIssuedDate.trim().length > 0 ? parseDateInput(input.licenseIssuedDate, "licenseIssuedDate") : null;
    }
    if (input.licenseExpiryDate !== undefined) {
      therapistData.licenseExpiryDate =
        input.licenseExpiryDate.trim().length > 0 ? parseDateInput(input.licenseExpiryDate, "licenseExpiryDate") : null;
    }
  }

  const patientData: {
    gender?: "male" | "female" | "other" | "unknown";
    dateOfBirth?: Date | null;
    heightCm?: number;
    weightKg?: number;
    address?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
  } = {};

  if (user.role === "patient") {
    if (input.gender !== undefined) {
      patientData.gender = input.gender;
    }
    if (input.dateOfBirth !== undefined) {
      patientData.dateOfBirth = input.dateOfBirth.trim().length > 0 ? parseDateInput(input.dateOfBirth, "dateOfBirth") : null;
    }
    if (input.heightCm !== undefined) {
      patientData.heightCm = input.heightCm;
    }
    if (input.weightKg !== undefined) {
      patientData.weightKg = input.weightKg;
    }
    if (input.address !== undefined) {
      const trimmed = input.address.trim();
      patientData.address = trimmed.length > 0 ? trimmed : null;
    }
    if (input.emergencyContactName !== undefined) {
      const trimmed = input.emergencyContactName.trim();
      patientData.emergencyContactName = trimmed.length > 0 ? trimmed : null;
    }
    if (input.emergencyContactPhone !== undefined) {
      const clean = validatePhoneNumberField(input.emergencyContactPhone);
      patientData.emergencyContactPhone = clean.length > 0 ? clean : null;
    }
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { ...userData, updatedAt: new Date(), updatedBy: actorId } }),
    ...(user.role === "therapist" && Object.keys(therapistData).length > 0
      ? [prisma.therapist.update({ where: { userId: id }, data: therapistData })]
      : []),
    ...(user.role === "patient" && Object.keys(patientData).length > 0
      ? [prisma.patient.update({ where: { userId: id }, data: patientData })]
      : [])
  ]);

  return getUserProfile(id);
}
