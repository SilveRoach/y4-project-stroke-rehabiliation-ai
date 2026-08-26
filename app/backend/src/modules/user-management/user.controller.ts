// User-management module — HTTP handlers.
// SCOPE: POST /users (create Therapist/Admin/Patient account), GET /users
// (Admin-only account list, FR-USR-02) plus GET/PATCH /users/:id (view/edit
// own profile — FR-USR-04) are implemented. Admin-only account
// status/reset-password/unlock routes from api-design.md's "Users" section
// are still not built — see user.service.ts for what's deliberately deferred.
//
// POST /users takes firstName/lastName (required) and email/phoneNumber
// (optional) alongside role/username/password, matching users.first_name/
// last_name/email/phone_number on schema.prisma. For role "patient" it also
// takes gender/dateOfBirth/heightCm/weightKg (patients.* on the schema) and
// treats `username` as the patient's login phone number, same convention as
// auth.service.ts's self-registration `register()`. Previously Patient
// creation was mock-only in the frontend (CreateUserPayload was typed to
// "therapist" | "admin" only) since this endpoint didn't accept the role at
// all — now it does.

import { NextFunction, Request, Response } from "express";
import { ForbiddenError, UnauthenticatedError, ValidationError } from "../../common/errors";
import * as userService from "./user.service";

function requireStringField(body: unknown, field: string): string {
  const value = (body as Record<string, unknown> | null)?.[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`"${field}" is required.`);
  }
  return value;
}

function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`Missing "${name}" route parameter.`);
  }
  return value;
}

// email/phoneNumber are optional on the schema — read as a string when
// present, otherwise undefined, rather than requireStringField's "must be a
// non-empty string" rule.
function optionalStringField(body: unknown, field: string): string | undefined {
  const value = (body as Record<string, unknown> | null)?.[field];
  return typeof value === "string" ? value : undefined;
}

function optionalNumberField(body: unknown, field: string): number | undefined {
  const value = (body as Record<string, unknown> | null)?.[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const PATIENT_GENDERS = ["male", "female", "other", "unknown"] as const;
type PatientGender = (typeof PATIENT_GENDERS)[number];

function optionalGenderField(body: unknown, field: string): PatientGender | undefined {
  const value = (body as Record<string, unknown> | null)?.[field];
  return typeof value === "string" && (PATIENT_GENDERS as readonly string[]).includes(value) ? (value as PatientGender) : undefined;
}

export async function createAccountHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const role = requireStringField(req.body, "role");
    const username = requireStringField(req.body, "username");
    const password = requireStringField(req.body, "password");
    const firstName = requireStringField(req.body, "firstName");
    const lastName = requireStringField(req.body, "lastName");
    const email = optionalStringField(req.body, "email");
    const phoneNumber = optionalStringField(req.body, "phoneNumber");
    // Patient-only — ignored by the service for Therapist/Admin roles, so no
    // harm in always reading them here regardless of `role`.
    const gender = optionalGenderField(req.body, "gender");
    const dateOfBirth = optionalStringField(req.body, "dateOfBirth");
    const heightCm = optionalNumberField(req.body, "heightCm");
    const weightKg = optionalNumberField(req.body, "weightKg");

    // req.user is guaranteed set here — this handler is always mounted behind
    // requireAuth in user.routes.ts.
    const createdById = req.user!.sub;

    const account = await userService.createAccount(role, username, password, createdById, {
      firstName,
      lastName,
      email,
      phoneNumber,
      gender,
      dateOfBirth,
      heightCm,
      weightKg
    });
    res.status(201).json({ user: account });
  } catch (err) {
    next(err);
  }
}

// GET /users — list all accounts (Admin-only) — FR-USR-02.
export async function listUsersHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const users = await userService.listUsers();
    res.json({ users });
  } catch (err) {
    next(err);
  }
}

// GET /users/:id — per api-design.md, "Self, or Admin".
export async function getUserProfileHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireParam(req, "id");
    if (!req.user) throw new UnauthenticatedError();
    if (req.user.role !== "admin" && req.user.sub !== id) {
      throw new ForbiddenError("You can only view your own profile.");
    }
    const user = await userService.getUserProfile(id);
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

// PATCH /users/:id — Self (any role) may edit their own profile. Admin may
// also edit a Patient account's profile (AdminUserManagementPage.tsx's Edit
// account flow, FR-USR-02) — Admin editing a Therapist/Admin account isn't in
// scope yet, only Patient. Account-status/reset-password/unlock are still not
// built either — see this file's header comment.
export async function updateUserProfileHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = requireParam(req, "id");
    if (!req.user) throw new UnauthenticatedError();
    const isSelf = req.user.sub === id;
    const isAdmin = req.user.role === "admin";
    if (!isSelf && !isAdmin) {
      throw new ForbiddenError("You can only edit your own profile.");
    }
    const user = await userService.updateUserProfile(id, req.user.sub, req.body ?? {});
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

