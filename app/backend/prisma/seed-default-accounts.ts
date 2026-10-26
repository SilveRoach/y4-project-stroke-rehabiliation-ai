// Default account seed — creates 1 patient, 1 therapist, 1 admin if they don't
// already exist. Idempotent: safe to re-run, skipped accounts are never
// duplicated.
//
// Usernames: patient / therapist / admin
// Password:  12345678 (for all three)
//
// Run with:
//   npx tsx prisma/seed-default-accounts.ts
//
// Required env vars:
//   DATABASE_URL

import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = "12345678";
const BCRYPT_ROUNDS = 12;

type DefaultAccount = {
  username: string;
  role: "patient" | "therapist" | "admin";
  phoneNumber?: string;
};

const DEFAULT_ACCOUNTS: DefaultAccount[] = [
  { username: "patient", role: "patient", phoneNumber: "patient" },
  { username: "therapist", role: "therapist" },
  { username: "admin", role: "admin" },
];

async function seedDefaultAccounts(): Promise<void> {
  console.log("Seed: checking default accounts...");

  for (const account of DEFAULT_ACCOUNTS) {
    const existing = await prisma.user.findUnique({
      where: { username: account.username },
    });

    if (existing) {
      console.log(
        `Seed: account "${account.username}" (${account.role}) already exists, skipping.`
      );
      continue;
    }

    const passwordHash = await bcrypt.hash(
      DEFAULT_PASSWORD,
      BCRYPT_ROUNDS
    );

    const user = await prisma.user.create({
      data: {
        username: account.username,
        passwordHash,
        role: account.role,
        status: "active",
        ...(account.role === "patient"
          ? {
              phoneNumber: account.phoneNumber,
              patient: { create: {} },
            }
            : {}),
        ...(account.role === "therapist"
          ? {
              therapist: { create: {} },
            }
            : {}),
        ...(account.role === "admin"
          ? {
              admin: { create: {} },
            }
            : {}),
      },
    });

    console.log(
      `Seed: created ${account.role} "${account.username}" (id: ${user.id}) — password: "${DEFAULT_PASSWORD}"`
    );
  }

  console.log("Seed: default accounts complete.");
}

seedDefaultAccounts()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });