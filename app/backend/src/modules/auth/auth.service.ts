import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import {
  ConflictError,
  ForbiddenError,
  UnauthenticatedError,
  ValidationError,
} from "../../common/errors";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { JwtPayload } from "../../types";

const BCRYPT_ROUNDS = 12;
const TOKEN_EXPIRY = "2h";

export interface AuthResult {
  token: string;
  user:
    | {
        id: string;
        role: "patient";
        phoneNumber: string;
        firstName: string | null;
        lastName: string | null;
      }
    | {
        id: string;
        role: "therapist" | "admin";
        username: string;
      };
}

function issueToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: TOKEN_EXPIRY,
  });
}

function validatePhoneNumber(phoneNumber: string): string {
  const trimmed = phoneNumber.trim();

  if (!/^[0-9+\-\s]{7,20}$/.test(trimmed)) {
    throw new ValidationError("Enter a valid phone number.");
  }

  return trimmed;
}

function validatePassword(password: string): void {
  if (password.length < 8) {
    throw new ValidationError("Password must be at least 8 characters.");
  }
}

/**
 * Patient self-registration.
 *
 * Patient phone number, first name, and last name belong to the users table.
 * The patients table only contains patient-specific information.
 */
export async function register(
  phoneNumber: string,
  password: string
): Promise<AuthResult> {
  const cleanPhone = validatePhoneNumber(phoneNumber);
  validatePassword(password);

  // phone_number is currently not @unique in the Prisma schema,
  // so use findFirst rather than findUnique.
  const existingPhone = await prisma.user.findFirst({
    where: {
      phoneNumber: cleanPhone,
    },
  });

  if (existingPhone) {
    throw new ConflictError(
      "An account with this phone number already exists."
    );
  }

  // Username is currently used as the patient's login identifier.
  // Since username is unique, make sure it does not collide with
  // an existing account.
  const existingUsername = await prisma.user.findUnique({
    where: {
      username: cleanPhone,
    },
  });

  if (existingUsername) {
    throw new ConflictError(
      "An account with this phone number already exists."
    );
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      username: cleanPhone,
      phoneNumber: cleanPhone,
      passwordHash,
      role: "patient",

      // Create the patient's 1:1 role-extension row.
      patient: {
        create: {},
      },
    },
  });

  const token = issueToken({
    sub: user.id,
    role: "patient",
  });

  return {
    token,
    user: {
      id: user.id,
      role: "patient",
      phoneNumber: user.phoneNumber!,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
    },
  };
}

/**
 * Login.
 *
 * Patients log in using their phone number.
 * Therapists/Admins log in using their username.
 */
export async function login(
  identifier: string,
  password: string
): Promise<AuthResult> {
  const cleanIdentifier = identifier.trim();

  // ============================================================
  // Patient login
  // ============================================================
  //
  // Patient phone number is stored in users.phone_number.
  //
  const patientUser = await prisma.user.findFirst({
    where: {
      phoneNumber: cleanIdentifier,
      role: "patient",
    },
    include: {
      patient: true,
    },
  });

  if (patientUser) {
    if (patientUser.status !== "active") {
      throw new ForbiddenError(
        "This account is not active. Contact your clinic."
      );
    }

    const passwordMatches = await bcrypt.compare(
      password,
      patientUser.passwordHash
    );

    if (!passwordMatches) {
      throw new UnauthenticatedError(
        "Incorrect phone number or password."
      );
    }

    const token = issueToken({
      sub: patientUser.id,
      role: "patient",
    });

    return {
      token,
      user: {
        id: patientUser.id,
        role: "patient",
        phoneNumber: patientUser.phoneNumber!,
        firstName: patientUser.firstName ?? null,
        lastName: patientUser.lastName ?? null,
      },
    };
  }

  // ============================================================
  // Therapist/Admin login
  // ============================================================
  //
  // Therapist/Admin accounts use users.username.
  //
  const user = await prisma.user.findUnique({
    where: {
      username: cleanIdentifier,
    },
  });

  if (!user || (user.role !== "therapist" && user.role !== "admin")) {
    throw new UnauthenticatedError(
      "Incorrect username/phone number or password."
    );
  }

  if (user.status !== "active") {
    throw new ForbiddenError(
      "This account is not active. Contact your administrator."
    );
  }

  const passwordMatches = await bcrypt.compare(
    password,
    user.passwordHash
  );

  if (!passwordMatches) {
    throw new UnauthenticatedError(
      "Incorrect username/phone number or password."
    );
  }

  const token = issueToken({
    sub: user.id,
    role: user.role,
  });

  return {
    token,
    user: {
      id: user.id,
      role: user.role,
      username: user.username,
    },
  };
}