import bcrypt from "bcrypt";
import { ConflictError, ValidationError } from "../../common/errors";
import { prisma } from "../../config/prisma";

const BCRYPT_ROUNDS = 12;

export interface CreatedAccount {
  id: string;
  role: "therapist" | "admin";
  username: string;
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
  createdById: string
): Promise<CreatedAccount> {
  if (role !== "therapist" && role !== "admin") {
    throw new ValidationError('Role must be "therapist" or "admin".');
  }

  const cleanUsername = validateUsername(username);
  validatePassword(password);

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

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      role,
      username: cleanUsername,
      passwordHash,
      createdBy: createdById,

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
  };
}