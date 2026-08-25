// Bootstraps the first Admin account.
//
// Necessary because Admins create Therapist/Admin accounts, but someone
// has to already be an Admin to create the first one.
//
// Run with:
//   npm run prisma:seed
//
// Idempotent — safe to re-run; does nothing if the username already exists.

import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BOOTSTRAP_USERNAME =
  process.env.SEED_ADMIN_USERNAME ?? "admin";

const BOOTSTRAP_PASSWORD =
  process.env.SEED_ADMIN_PASSWORD ?? "changeme123";

async function main() {
  const existing = await prisma.user.findUnique({
    where: {
      username: BOOTSTRAP_USERNAME,
    },
  });

  if (existing) {
    console.log(
      `Seed: user "${BOOTSTRAP_USERNAME}" already exists, skipping.`
    );
    return;
  }

  const passwordHash = await bcrypt.hash(
    BOOTSTRAP_PASSWORD,
    12
  );

  await prisma.user.create({
    data: {
      role: "admin",
      username: BOOTSTRAP_USERNAME,
      passwordHash,
      status: "active",
      firstName: "System",
      lastName: "Administrator",
    },
  });

  console.log(
    `Seed: created bootstrap Admin "${BOOTSTRAP_USERNAME}".`
  );

  console.log(
    "IMPORTANT: A default password is being used unless " +
      "SEED_ADMIN_PASSWORD was set in your environment. " +
      "Change the password before using this account in a real deployment."
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });