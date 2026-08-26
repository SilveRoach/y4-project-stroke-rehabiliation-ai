// Bootstraps the first Admin account, then (optionally) seeds a demo
// Therapist + 2 Patients with an assignment, a couple of Exercise Library
// items, and rehab plans with schedule days / scheduled exercises /
// performance results — enough for the Therapist Dashboard
// (modules/therapist/*) to show real, non-empty data.
//
// Run with:
//   npm run prisma:seed
//
// Idempotent — safe to re-run; does nothing if the relevant username(s)
// already exist.

import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BOOTSTRAP_USERNAME = process.env.SEED_ADMIN_USERNAME ?? "admin";
const BOOTSTRAP_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "changeme123";

const DEMO_THERAPIST_USERNAME = "therapist_demo";
const DEMO_PASSWORD = "changeme123";

async function seedBootstrapAdmin(): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { username: BOOTSTRAP_USERNAME } });

  if (existing) {
    console.log(`Seed: user "${BOOTSTRAP_USERNAME}" already exists, skipping.`);
    return existing.id;
  }

  const passwordHash = await bcrypt.hash(BOOTSTRAP_PASSWORD, 12);

  const admin = await prisma.user.create({
    data: {
      role: "admin",
      username: BOOTSTRAP_USERNAME,
      passwordHash,
      status: "active",
      firstName: "System",
      lastName: "Administrator"
    }
  });

  console.log(`Seed: created bootstrap Admin "${BOOTSTRAP_USERNAME}".`);
  console.log(
    "IMPORTANT: A default password is being used unless SEED_ADMIN_PASSWORD was set " +
      "in your environment. Change the password before using this account in a real deployment."
  );

  return admin.id;
}

function dayOffset(offset: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
}

/**
 * Demo data for the Therapist Dashboard (modules/therapist/*), which was
 * previously untestable end-to-end — only the bootstrap admin existed, so the
 * dashboard legitimately had nothing to show. Skipped entirely (not just
 * partially re-run) if DEMO_THERAPIST_USERNAME already exists, since the plan
 * generation below isn't safe to run twice against the same patients.
 */
async function seedTherapistDashboardDemo(adminId: string): Promise<void> {
  const existingTherapist = await prisma.user.findUnique({ where: { username: DEMO_THERAPIST_USERNAME } });
  if (existingTherapist) {
    console.log(`Seed: demo therapist "${DEMO_THERAPIST_USERNAME}" already exists, skipping demo data.`);
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const therapistUser = await prisma.user.create({
    data: {
      role: "therapist",
      username: DEMO_THERAPIST_USERNAME,
      passwordHash,
      status: "active",
      firstName: "Sarah",
      lastName: "Chen",
      createdBy: adminId,
      therapist: { create: {} }
    }
  });
  console.log(`Seed: created demo Therapist "${DEMO_THERAPIST_USERNAME}" / password "${DEMO_PASSWORD}".`);

  const patientDefs = [
    {
      phoneNumber: "0812345678",
      firstName: "Somchai",
      lastName: "Boonmee",
      gender: "male" as const,
      dateOfBirth: new Date("1965-03-12"),
      planName: "Post-Stroke Upper Limb Recovery",
      // Slightly behind on compliance, to demo the "at_risk" badge.
      skipRate: 0.3
    },
    {
      phoneNumber: "0898765432",
      firstName: "Malee",
      lastName: "Sirikit",
      gender: "female" as const,
      dateOfBirth: new Date("1972-07-22"),
      planName: "Gait & Balance Rehabilitation",
      // Consistently compliant, to demo the "active" badge.
      skipRate: 0.05
    }
  ];

  const exerciseDefs = [
    {
      name: "Shoulder Flexion Stretch",
      description: "Slow, controlled shoulder raises to rebuild range of motion.",
      movementTracking: "pose" as const,
      difficultyLevel: "easy" as const,
      baseCriteria: { targetAngleDeg: 90, repetitions: 10 }
    },
    {
      name: "Grip Strength Trainer",
      description: "Progressive squeeze-and-hold exercise using the virtual grip sensor.",
      movementTracking: "virtual_grip" as const,
      difficultyLevel: "medium" as const,
      baseCriteria: { targetGripStrength: 15, holdSeconds: 5, repetitions: 8 }
    }
  ] as const;

  const exercises: Array<Awaited<ReturnType<typeof prisma.exerciseLibrary.create>>> = [];
  for (const def of exerciseDefs) {
    const exercise = await prisma.exerciseLibrary.create({
      data: {
        versionNumber: 1,
        name: def.name,
        description: def.description,
        movementTracking: def.movementTracking,
        difficultyLevel: def.difficultyLevel,
        baseCriteria: def.baseCriteria,
        status: "active",
        createdBy: therapistUser.id
      }
    });
    exercises.push(exercise);
  }
  console.log(`Seed: created ${exercises.length} demo Exercise Library items.`);

  const PLAN_START_OFFSET = -14;
  const PLAN_END_OFFSET = 13; // 28-day plan: 14 days elapsed, 14 remaining (today counted in remaining)

  for (const def of patientDefs) {
    const existingPatientUser = await prisma.user.findFirst({ where: { phoneNumber: def.phoneNumber } });
    if (existingPatientUser) {
      console.log(`Seed: patient with phone ${def.phoneNumber} already exists, skipping this patient.`);
      continue;
    }

    const patientPasswordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
    const patientUser = await prisma.user.create({
      data: {
        role: "patient",
        username: def.phoneNumber,
        phoneNumber: def.phoneNumber,
        passwordHash: patientPasswordHash,
        status: "active",
        firstName: def.firstName,
        lastName: def.lastName,
        createdBy: adminId,
        patient: {
          create: {
            gender: def.gender,
            dateOfBirth: def.dateOfBirth
          }
        }
      }
    });

    await prisma.patientTherapistAssignment.create({
      data: {
        patientId: patientUser.id,
        therapistId: therapistUser.id,
        status: "active",
        assignedBy: adminId
      }
    });

    const plan = await prisma.patientRehabilitationPlan.create({
      data: {
        patientId: patientUser.id,
        therapistId: therapistUser.id,
        name: def.planName,
        description: `Individualized ${def.planName.toLowerCase()} plan.`,
        startDate: dayOffset(PLAN_START_OFFSET),
        endDate: dayOffset(PLAN_END_OFFSET),
        status: "active",
        createdBy: therapistUser.id
      }
    });

    // One schedule day per day of the plan, deterministic pseudo-randomness
    // (seeded off the day offset) so re-reading this file's output is
    // reproducible rather than different every seed run.
    for (let offset = PLAN_START_OFFSET; offset <= PLAN_END_OFFSET; offset += 1) {
      const scheduledDate = dayOffset(offset);
      const isPast = offset < 0;
      const isToday = offset === 0;

      // Deterministic pseudo-random roll in [0, 1) from the offset + patient's
      // skipRate seed, just enough variance to make the dashboard's compliance/
      // chart numbers look like real usage instead of a flat 100% or 0%.
      const roll = Math.abs(Math.sin(offset * 12.9898 + def.skipRate * 78.233)) % 1;

      let dayStatus: "completed" | "skipped" | "in_progress" | "pending";
      if (isPast) {
        dayStatus = roll < def.skipRate ? "skipped" : "completed";
      } else if (isToday) {
        dayStatus = roll < def.skipRate ? "pending" : "in_progress";
      } else {
        dayStatus = "pending";
      }

      const scheduleDay = await prisma.rehabilitationScheduleDay.create({
        data: {
          rehabilitationPlanId: plan.id,
          scheduledDate,
          status: dayStatus,
          createdBy: therapistUser.id
        }
      });

      if (dayStatus === "pending") continue;

      // One scheduled exercise per day, alternating between the two library items.
      // ScheduledExercisesStatus and RehabilitationScheduleDaysStatus share the same
      // enum values (pending/in_progress/completed/skipped/cancelled), so the day's
      // status can be reused directly for its single exercise's status.
      const exercise = exercises[Math.abs(offset) % exercises.length];

      const scheduledExercise = await prisma.scheduledExercise.create({
        data: {
          scheduleDayId: scheduleDay.id,
          exerciseLibraryId: exercise.id,
          orderNumber: 1,
          targetType: "repetitions",
          targetValue: { repetitions: 10 },
          status: dayStatus,
          createdBy: therapistUser.id
        }
      });

      if (dayStatus !== "completed") continue;

      const aiScore = Math.round(65 + roll * 30); // 65-95
      // Every 3rd completed attempt is left un-reviewed by the therapist, to
      // populate the dashboard's "Pending Reviews" stat with something real.
      const isReviewed = Math.abs(offset) % 3 !== 0;

      await prisma.exercisePerformanceResult.create({
        data: {
          scheduledExerciseId: scheduledExercise.id,
          attemptNumber: 1,
          completedAt: scheduledDate,
          aiScore,
          aiFeedback: "Movement range and form were within target on most repetitions.",
          aiMetrics: { averageAngleDeg: aiScore, repetitionsCompleted: 10 },
          aiEvaluatedAt: scheduledDate,
          ...(isReviewed
            ? {
                ptScore: Math.min(100, aiScore + 3),
                ptFeedback: "Confirmed AI scoring — good session.",
                ptEvaluatedBy: therapistUser.id,
                ptEvaluatedAt: scheduledDate,
                finalScore: Math.min(100, aiScore + 3),
                evaluationSource: "pt" as const
              }
            : {})
        }
      });
    }

    console.log(`Seed: created demo Patient "${def.firstName} ${def.lastName}" (${def.phoneNumber}) with a 28-day plan.`);
  }
}

async function main() {
  const adminId = await seedBootstrapAdmin();
  await seedTherapistDashboardDemo(adminId);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
