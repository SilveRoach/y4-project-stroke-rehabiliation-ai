// Full demo seed — the project's only seed file, with a complete demo dataset:
//
// NOTE: all human-readable seeded content (names, addresses, exercise
// names/descriptions, plan names, instructions, and feedback) is written in
// Thai; usernames, emails, and phone numbers remain ASCII.
//
//   1 Admin account
//   3 Therapist accounts
//   5 Patient accounts (each assigned to a therapist), with multiple active
//     rehabilitation plans each — 2 patients with 2 plans, 1 patient with
//     3 plans, and 2 patients with 1 plan. Every plan has 30 consecutive
//     schedule days with exercises through today and 3-5 more days scheduled
//     ahead, plus performance results for completed days (some AI-only, some PT-reviewed) — enough data for the
//     Therapist Dashboard, Patient Progress view, and Session Result Review
//     page to all show real, non-empty data.
//   9 Exercise Library items (5 AI pose + 4 virtual_grip)
//
// Run with:
//   npm run prisma:seed:full
//
// Idempotent — accounts and plans are matched by username/phone number and
// plan name. Reruns reconcile plan dates and fill missing schedule data without
// duplicating days, exercises, or performance results.

import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { ensureAiPoseExercises } from "./seed-ai-exercises";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "changeme123";
// Shorter hash rounds than the former minimal seed's 12 — with the large demo
// dataset (9 accounts), 12 rounds is noticeably slow on first run; 10 stays
// secure.
const BCRYPT_ROUNDS = 10;

function dayOffset(offset: number): Date {
  // คอลัมน์ scheduled_date เป็น @db.Date — Prisma เขียน/อ่านเป็นวันที่ตาม UTC เสมอ ถ้าส่ง "เที่ยงคืนตามเวลาท้องถิ่น"
  // (เช่น 00:00 เวลาไทย = 17:00 UTC ของเมื่อวาน) วันที่ที่บันทึกจะถูกเลื่อนไปเมื่อวาน และเทียบกับวันที่ท้องถิ่นไม่ตรงกัน
  // จึงสร้างเป็น 00:00 UTC ของ "วันที่ตามปฏิทินท้องถิ่น" แทน
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + offset));
}

// =====================================================================
// 1. ADMIN
// =====================================================================

async function seedAdmin(): Promise<string> {
  const username = "admin_full";
  const existing = await prisma.user.findUnique({ where: { username } });

  if (existing) {
    console.log(`Seed: admin "${username}" already exists, skipping.`);
    return existing.id;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);
  const admin = await prisma.user.create({
    data: {
      role: "admin",
      username,
      passwordHash,
      status: "active",
      firstName: "อนุชา",
      lastName: "วงศ์สา",
      email: "admin_full@example.com",
      admin: { create: { employeeId: "EMP-ADM-001" } }
    }
  });

  console.log(`Seed: created Admin "${username}" / password "${DEMO_PASSWORD}".`);
  return admin.id;
}

// =====================================================================
// 2. THERAPISTS
// =====================================================================

interface TherapistDef {
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  licenseNumber: string;
  licenseIssuedDate: Date;
  licenseExpiryDate: Date;
  // First names (see patientDefs below) of the patients this therapist owns.
  patientFirstNames: string[];
}

const therapistDefs: TherapistDef[] = [
  {
    username: "therapist_arisa",
    firstName: "อริสา",
    lastName: "ตันวงศ์",
    email: "arisa.tanwong@example.com",
    licenseNumber: "PT-TH-2018-0431",
    licenseIssuedDate: new Date("2018-06-01"),
    licenseExpiryDate: new Date(2027, 5, 30),
    patientFirstNames: ["สมชาย", "มาลี"]
  },
  {
    username: "therapist_pongsak",
    firstName: "พงศ์ศักดิ์",
    lastName: "รัตนี",
    email: "pongsak.rattanee@example.com",
    licenseNumber: "PT-TH-2015-1127",
    licenseIssuedDate: new Date("2015-03-15"),
    licenseExpiryDate: new Date(2026, 11, 31),
    patientFirstNames: ["นฤมล", "กิตติพงษ์"]
  },
  {
    username: "therapist_maya",
    firstName: "มายา",
    lastName: "กิตติวัชร",
    email: "maya.kittiwatchara@example.com",
    licenseNumber: "PT-TH-2021-0876",
    licenseIssuedDate: new Date("2021-09-01"),
    licenseExpiryDate: new Date(2028, 8, 31),
    patientFirstNames: ["ประเสริฐ"]
  }
];

async function seedTherapists(
  adminId: string
): Promise<Map<string, { userId: string; def: TherapistDef }>> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);
  const created = new Map<string, { userId: string; def: TherapistDef }>();

  for (const def of therapistDefs) {
    const existing = await prisma.user.findUnique({ where: { username: def.username } });

    if (existing) {
      console.log(`Seed: therapist "${def.username}" already exists, skipping.`);
      created.set(def.firstName, { userId: existing.id, def });
      continue;
    }

    const user = await prisma.user.create({
      data: {
        role: "therapist",
        username: def.username,
        passwordHash,
        status: "active",
        firstName: def.firstName,
        lastName: def.lastName,
        email: def.email,
        createdBy: adminId,
        therapist: {
          create: {
            licenseNumber: def.licenseNumber,
            licenseIssuedDate: def.licenseIssuedDate,
            licenseExpiryDate: def.licenseExpiryDate
          }
        }
      }
    });

    console.log(`Seed: created Therapist "${def.username}" / password "${DEMO_PASSWORD}".`);
    created.set(def.firstName, { userId: user.id, def });
  }

  return created;
}

// =====================================================================
// 3. EXERCISE LIBRARY
// =====================================================================

const exerciseDefs = [
  {
    name: "ฝึกกำมือและแรงบีบ (Grip Strength Trainer - Ball Grip)",
    description: "ฝึกบีบและค้างไว้แบบเพิ่มระดับขั้น โดยใช้เซนเซอร์กำมือเสมือน โหมดบีบลูกบอล",
    movementTracking: "virtual_grip" as const,
    difficultyLevel: "easy" as const,
    baseCriteria: {
      virtualGripGameType: "ball-grip",
      targetGripStrength: 15,
      holdSeconds: 5,
      repetitions: 8
    }
  },
  {
    name: "ลากเส้นตามเป้า (Path Drag Trainer)",
    description: "ฝึกลากนิ้วตามเส้นทางที่กำหนดบนหน้าจอ เพื่อฝึกความแม่นยำและการควบคุมมือ",
    movementTracking: "virtual_grip" as const,
    difficultyLevel: "medium" as const,
    baseCriteria: {
      virtualGripGameType: "path-drag",
      targetPathLength: 200,
      maxDeviation: 15,
      repetitions: 5
    }
  },
  {
    name: "รับของตกลงถ้วย (Falling Cup Game)",
    description: "ฝึกกำมือจับของที่ตกจากด้านบนลงในถ้วย เพื่อฝึกประสานสัมผัสมือและตา",
    movementTracking: "virtual_grip" as const,
    difficultyLevel: "hard" as const,
    baseCriteria: {
      virtualGripGameType: "falling-cup",
      totalObjects: 10,
      catchTarget: 7,
      fallSpeed: 0.15
    }
  },
  {
    name: "บีบลูกบอลเร็ว (Rapid Ball Grip Challenge)",
    description: "ฝึกบีบมืออย่างรวดเร็วซ้ำ ๆ หลายรอบ เพื่อฝึกความทนทานของกล้ามเนื้อมือ",
    movementTracking: "virtual_grip" as const,
    difficultyLevel: "medium" as const,
    baseCriteria: {
      virtualGripGameType: "ball-grip",
      targetGripStrength: 12,
      holdSeconds: 3,
      repetitions: 15,
      roundTimeLimitSeconds: 6
    }
  }
] as const;

async function seedExerciseLibrary(createdBy: string) {
  const exercises = [];

  for (const def of exerciseDefs) {
    const existing = await prisma.exerciseLibrary.findFirst({
      where: { name: def.name, versionNumber: 1 }
    });

    if (existing) {
      // Re-point existing rows to arisa too, so re-running the seed reassigns
      // exercises that were previously created by the admin (or anyone else).
      if (existing.createdBy !== createdBy) {
        await prisma.exerciseLibrary.update({ where: { id: existing.id }, data: { createdBy } });
        console.log(`Seed: exercise "${def.name}" creator reassigned.`);
      } else {
        console.log(`Seed: exercise "${def.name}" already exists, skipping.`);
      }
      exercises.push(existing);
      continue;
    }

    const exercise = await prisma.exerciseLibrary.create({
      data: {
        versionNumber: 1,
        name: def.name,
        description: def.description,
        movementTracking: def.movementTracking,
        difficultyLevel: def.difficultyLevel,
        baseCriteria: def.baseCriteria,
        status: "active",
        createdBy
      }
    });
    exercises.push(exercise);
  }

  console.log(`Seed: ensured ${exercises.length} Exercise Library items.`);
  return exercises;
}

// =====================================================================
// 4. PATIENTS + ASSIGNMENTS + PLANS
// =====================================================================

interface PlanDef {
  planName: string;
  planDescription: string;
  // Fraction of past days "skipped", to vary compliance badges on the dashboard.
  skipRate: number;
  // Keep the 25-day program ending 7 days after today.
  futureDays: 3 | 4 | 5;
}

const SEEDED_PLAN_DURATION_DAYS = 25;

interface PatientDef {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  email: string;
  gender: "male" | "female";
  dateOfBirth: Date;
  heightCm: number;
  weightKg: number;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  // Multiple plans per patient: สมชาย & มาลี have 2, กิตติพงษ์ has 3,
  // นฤมล & ประเสริฐ have 1 — exercises run up to today with 3-5 more
  // scheduled days ahead per plan.
  plans: PlanDef[];
}

const patientDefs: PatientDef[] = [
  {
    firstName: "สมชาย",
    lastName: "บุญมี",
    phoneNumber: "0810000001",
    email: "somchai.patient@example.com",
    gender: "male",
    dateOfBirth: new Date("1965-03-12"),
    heightCm: 172,
    weightKg: 74,
    address: "12 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110",
    emergencyContactName: "นงลักษณ์ บุญมี",
    emergencyContactPhone: "0819990001",
    plans: [
      {
        planName: "ฟื้นฟูแขนส่วนบนหลังเส้นเลือดสมองตีบ",
        planDescription: "โปรแกรมเน้นฝึกข้อไหล่และการกำมือ หลังภาวะสมองขาดเลือดด้านซ้าย (left MCA infarct)",
        skipRate: 0.3,
        futureDays: 4
      },
      {
        planName: "เสริมความแข็งแรงไหล่ระยะต่อเนื่อง",
        planDescription: "โปรแกรมต่อยอดจากแผนหลัก เน้นเพิ่มช่วงการเคลื่อนไหวของข้อไหล่และความทนทานของกล้ามเนื้อ",
        skipRate: 0.3,
        futureDays: 3
      }
    ]
  },
  {
    firstName: "มาลี",
    lastName: "สิริกิติ",
    phoneNumber: "0810000002",
    email: "malee.patient@example.com",
    gender: "female",
    dateOfBirth: new Date("1972-07-22"),
    heightCm: 158,
    weightKg: 61,
    address: "88 ถนนพระราม 4 แขวงมหาพฤฒาราม เขตบางรัก กรุงเทพมหานคร 10500",
    emergencyContactName: "อนันต์ สิริกิติ",
    emergencyContactPhone: "0819990002",
    plans: [
      {
        planName: "ฟื้นฟูการเดินและการทรงตัว",
        planDescription: "ฝึกยกเข่ายืนเหยียบตรงและเสริมความมั่นคง หลังเส้นเลือดสมองด้านขวา",
        skipRate: 0.05,
        futureDays: 5
      },
      {
        planName: "ฝึกความอึดในการเดินระยะสั้น",
        planDescription: "โปรแกรมฝึกเดินระยะสั้นซ้ำ ๆ เพื่อเพิ่มความอึดและลดความเหนื่อยง่ายหลังฟื้นฟูระยะแรก",
        skipRate: 0.05,
        futureDays: 3
      }
    ]
  },
  {
    firstName: "นฤมล",
    lastName: "พวงทอง",
    phoneNumber: "0810000003",
    email: "narumon.patient@example.com",
    gender: "female",
    dateOfBirth: new Date("1980-11-05"),
    heightCm: 163,
    weightKg: 55,
    address: "45 ถนนพหลโยธิน แขวงสามเสนใน เขตพญาไท กรุงเทพมหานคร 10400",
    emergencyContactName: "ชัย พวงทอง",
    emergencyContactPhone: "0819990003",
    plans: [
      {
        planName: "โปรแกรมฝึกการใช้แขนให้กลับมาทำงาน",
        planDescription: "ฝึกงอศอกและยกไหล่แบบเพิ่มระดับขั้น เพื่อฟื้นฟูกล้ามเนื้ออ่อนแรงครึ่งซีก (hemiparesis)",
        skipRate: 0.15,
        futureDays: 4
      }
    ]
  },
  {
    firstName: "กิตติพงษ์",
    lastName: "ชัยพร",
    phoneNumber: "0810000004",
    email: "kittipong.patient@example.com",
    gender: "male",
    dateOfBirth: new Date("1958-01-30"),
    heightCm: 168,
    weightKg: 80,
    address: "7 ถนนเชียงใหม่-ลำพูน ตำบลศรีภูมิ อำเภอเมืองเชียงใหม่ เชียงใหม่ 50200",
    emergencyContactName: "ศิริน ชัยพร",
    emergencyContactPhone: "0819990004",
    plans: [
      {
        planName: "ฟื้นฟูแรงกำมือและการเคลื่อนไหวละเอียด",
        planDescription: "ฝึกด้วยเซนเซอร์กำมือเสมือน เพื่อฟื้นแรงมือหลังเส้นเลือดสมองตีบ",
        skipRate: 0.2,
        futureDays: 5
      },
      {
        planName: "ฝึกการทรงตัวขณะยืน",
        planDescription: "ฝึกยืนทรงตัวและยกเข่าต่อเนื่อง เพื่อลดความเสี่ยงตกหลังภาวะสมองขาดเลือด",
        skipRate: 0.2,
        futureDays: 4
      },
      {
        planName: "ยืดเหยียดกล้ามเนื้อทั้งตัวรายวัน",
        planDescription: "โปรแกรมยืดเหยียดเบา ๆ ทุกวัน เพื่อลดความตึงของกล้ามเนื้อ (spasticity) ด้านขวา",
        skipRate: 0.2,
        futureDays: 3
      }
    ]
  },
  {
    firstName: "ประเสริฐ",
    lastName: "ดวงแก้ว",
    phoneNumber: "0810000005",
    email: "prasert.patient@example.com",
    gender: "male",
    dateOfBirth: new Date("1969-09-18"),
    heightCm: 175,
    weightKg: 68,
    address: "301 ถนนห้วยแก้ว ตำบลสุเทพ อำเภอเมืองเชียงใหม่ เชียงใหม่ 50200",
    emergencyContactName: "กัณดา ดวงแก้ว",
    emergencyContactPhone: "0819990005",
    plans: [
      {
        planName: "ฟื้นฟูการทรงตัวและความอึด",
        planDescription: "โปรแกรมผสม ระหว่างการฝึกเดินกับการรักษาความแข็งแรงของแขนส่วนบน",
        skipRate: 0.4,
        futureDays: 3
      }
    ]
  }
];

async function seedPatientsAndPlans(
  adminId: string,
  therapists: Map<string, { userId: string; def: TherapistDef }>,
  exercises: Array<Awaited<ReturnType<typeof prisma.exerciseLibrary.create>>>
): Promise<void> {
  const patientPasswordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);

  for (const def of patientDefs) {
    // Patients log in with their phone number as username (existing convention).
    const existingPatientUser = await prisma.user.findUnique({
      where: { username: def.phoneNumber }
    });

    // Assign to the therapist whose patientFirstNames list contains this
    // patient; fall back to the first therapist if no explicit mapping.
    const owner =
      [...therapists.values()].find((t) => t.def.patientFirstNames.includes(def.firstName)) ??
      [...therapists.values()][0];

    const patientUser = existingPatientUser
      ? await prisma.user.update({
          where: { id: existingPatientUser.id },
          data: { email: def.email }
        })
      : await prisma.user.create({
        data: {
          role: "patient",
          username: def.phoneNumber,
          phoneNumber: def.phoneNumber,
          email: def.email,
          passwordHash: patientPasswordHash,
          status: "active",
          firstName: def.firstName,
          lastName: def.lastName,
          createdBy: adminId,
          patient: {
            create: {
              gender: def.gender,
              dateOfBirth: def.dateOfBirth,
              heightCm: def.heightCm,
              weightKg: def.weightKg,
              address: def.address,
              emergencyContactName: def.emergencyContactName,
              emergencyContactPhone: def.emergencyContactPhone
            }
          }
        }
      });

    const activeAssignment = await prisma.patientTherapistAssignment.findFirst({
      where: { patientId: patientUser.id, status: "active" }
    });
    if (!activeAssignment) {
      await prisma.patientTherapistAssignment.create({
        data: {
          patientId: patientUser.id,
          therapistId: owner.userId,
          status: "active",
          assignedBy: adminId
        }
      });
    }

    // Multiple plans per patient (plan index also varies the pseudo-random
    // roll so overlapping plans don't get identical compliance patterns).
    for (const [planIndex, planDef] of def.plans.entries()) {
      // Seed covers 25 days ago → today+7 (33 days total). Negative offsets
      // are in the past (some skipped, some completed); positive offsets are
      // upcoming days ahead of the plan.
      const startDate = dayOffset(-25); // 25 days ago
      const endDate = dayOffset(7); // Today + 7
      const existingPlan = await prisma.patientRehabilitationPlan.findFirst({
        where: { patientId: patientUser.id, name: planDef.planName }
      });
      // Clear existing schedule data before rebuilding (idempotent + clean rebuild)
      if (existingPlan) {
        const existingScheduleDays = await prisma.rehabilitationScheduleDay.findMany({
          where: { rehabilitationPlanId: existingPlan.id }
        });
        await prisma.rehabilitationScheduleDay.deleteMany({
          where: { rehabilitationPlanId: existingPlan.id }
        });
        await prisma.scheduledExercise.deleteMany({
          where: { scheduleDayId: { in: existingScheduleDays.map(d => d.id) } }
        });
      }
      const plan = existingPlan
        ? await prisma.patientRehabilitationPlan.update({
            where: { id: existingPlan.id },
            data: {
              description: planDef.planDescription,
              startDate,
              endDate,
              updatedAt: new Date(),
              updatedBy: owner.userId
            }
          })
        : await prisma.patientRehabilitationPlan.create({
            data: {
              patientId: patientUser.id,
              therapistId: owner.userId,
              name: planDef.planName,
              description: planDef.planDescription,
              startDate,
              endDate,
              status: "active",
              createdBy: owner.userId
            }
          });

      // Deterministic pseudo-random rolls keep the seeded compliance varied.
      // Upserts let reruns expand an existing seeded plan without duplicating
      // schedule days, exercises, or performance results.
      for (let offset = -25; offset <= 7; offset += 1) {
        const scheduledDate = dayOffset(offset);
        const roll = Math.abs(Math.sin(offset * 12.9898 + planIndex * 40.233 + planDef.skipRate * 78.233)) % 1;

        let dayStatus: "completed" | "skipped" | "in_progress" | "pending";
        if (offset < 0) {
          // Past days: skipped or completed based on the patient's skip rate.
          // Additionally, force the last 2 days before today (offset -2, -1)
          // to always be "skipped" so the recent history includes skipped days.
          if (offset >= -2) {
            dayStatus = "skipped";
          } else {
            dayStatus = roll < planDef.skipRate ? "skipped" : "completed";
          }
        } else {
          // Today through today+7: all pending with exercises assigned.
          dayStatus = "pending";
        }

        const scheduleDay = await prisma.rehabilitationScheduleDay.upsert({
          where: {
            rehabilitationPlanId_scheduledDate: {
              rehabilitationPlanId: plan.id,
              scheduledDate
            }
          },
          update: {},
          create: {
            rehabilitationPlanId: plan.id,
            scheduledDate,
            status: dayStatus,
            therapistNote: null,
            createdBy: owner.userId
          }
        });

        // Pending days still receive exercises so the patient has upcoming work.
        // Completed days also receive a performance result for demo reporting.
        for (let order = 1; order <= 2; order += 1) {
          const exercise = exercises[(Math.abs(offset) + order) % exercises.length];

          const scheduledExercise = await prisma.scheduledExercise.upsert({
            where: {
              scheduleDayId_orderNumber: {
                scheduleDayId: scheduleDay.id,
                orderNumber: order
              }
            },
            update: {
              targetType: "repetitions",
              targetValue: "10 ครั้ง"
            },
            create: {
              scheduleDayId: scheduleDay.id,
              exerciseLibraryId: exercise.id,
              orderNumber: order,
              targetType: "repetitions",
              targetValue: "10 ครั้ง",
              therapistInstruction:
                order === 1
                  ? "เคลื่อนไหวช้า ๆ อย่างมีการควบคุม"
                  : "หยุดพักทันทีหากปวดเกิน 4/10",
              status: scheduleDay.status,
              createdBy: owner.userId
            }
          });

          // Results with scores are only for days up to yesterday (past days).
          // Today and future days (offset >= 0) get exercises but no scored results.
          // Skipped past days have no score either.
          if (offset >= 0 || scheduleDay.status === "skipped") continue;

          const existingResult = await prisma.exercisePerformanceResult.findUnique({
            where: {
              scheduledExerciseId_attemptNumber: {
                scheduledExerciseId: scheduledExercise.id,
                attemptNumber: 1
              }
            }
          });
          if (existingResult) continue;

          // Score grows naturally from low (25 days ago) to medium in the
          // middle, then to medium-high/high near the end of the plan.
          // 33-day span: offset -25 → +7.
          const totalDays = 33;
          const normalizedProgress = (offset + 25) / (totalDays - 1); // 0 → 1
          const baseScore = 48 + Math.pow(normalizedProgress, 1.5) * 38; // ~48 → ~86
          // Small deterministic fluctuation (±3) so consecutive days aren't
          // identical, while keeping the overall upward trend.
          const fluctuation = ((Math.sin(offset * 3.7 + planIndex * 5.1) % 1) * 2 - 1) * 3;
          const aiScore = Math.min(86, Math.round(baseScore + fluctuation));
          // Every 3rd completed attempt is left un-reviewed to populate the
          // dashboard's "Pending Reviews" stat with something real.
          const isReviewed = Math.abs(offset) % 3 !== 0;

          await prisma.exercisePerformanceResult.create({
            data: {
              scheduledExerciseId: scheduledExercise.id,
              attemptNumber: 1,
              completedAt: scheduledDate,
              aiScore: aiScore + (order - 1),
              aiFeedback:
                order === 1
                  ? "ช่วงการเคลื่อนไหวและท่าทางอยู่ในเกณฑ์เป้าหมายในการนับส่วนใหญ่"
                  : "จังหวะการเคลื่อนไหวสม่ำเสมอ แต่ท่าเอียงเล็กน้อยในการนับช่วงท้าย",
              aiMetrics:
                order === 1
                  ? { averageAngleDeg: aiScore, repetitionsCompleted: 10 }
                  : { averageHoldSeconds: 4.6, repetitionsCompleted: 8 },
              aiEvaluatedAt: scheduledDate,
              ...(isReviewed
                ? {
                    ptScore: Math.min(100, aiScore + 3),
                    ptFeedback: "ยืนยันผลคะแนนจาก AI — ฝึกได้ดีในครั้งนี้",
                    ptEvaluatedBy: owner.userId,
                    ptEvaluatedAt: scheduledDate,
                    finalScore: Math.min(100, aiScore + 3),
                    evaluationSource: "pt" as const
                  }
                : {
                    finalScore: aiScore,
                    evaluationSource: "ai" as const
                  })
            }
          });
        }
      }

      console.log(
        `Seed:   plan "${planDef.planName}" — 33 days (25 days ago→today+7, ` +
        `${planDef.futureDays} upcoming day(s)).`
      );
    }

    console.log(
      `Seed: created Patient "${def.firstName} ${def.lastName}" (${def.phoneNumber}, ` +
        `therapist ${owner.def.username}) with ${def.plans.length} plan(s).`
    );

  }
}

// =====================================================================

// Backfill any active plans outside the seeded patient set so today through
// today+7 all carry exercises, without duplicating existing assignments.
async function backfillUpcomingExerciseDays(
  exercises: Array<Awaited<ReturnType<typeof prisma.exerciseLibrary.create>>>
): Promise<void> {
  const plans = await prisma.patientRehabilitationPlan.findMany({
    where: { status: "active" },
    include: { scheduleDays: { include: { scheduledExercises: true } } }
  });

  let daysCreated = 0;
  let exercisesAdded = 0;

  for (const plan of plans) {
    for (const offset of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const scheduledDate = dayOffset(offset);
      // เทียบเป็นวันที่แบบ UTC (YYYY-MM-DD) ทั้งสองฝั่ง เพราะ scheduled_date เป็น @db.Date — เดิมใช้ toDateString()
      // (เวลาท้องถิ่น) เทียบกับค่าที่อ่านกลับจาก DB (UTC) ทำให้เลื่อนไปหนึ่งวันในเขตเวลาไทย จึงหาแถวเดิมไม่เจอ
      // แล้วสั่ง create ซ้ำจนชน unique (rehabilitation_plan_id, scheduled_date)
      const toDateKey = (d: Date): string => d.toISOString().slice(0, 10);
      const existingDay = plan.scheduleDays.find(
        (day) => toDateKey(day.scheduledDate) === toDateKey(scheduledDate)
      );

      // upsert กันชน unique ซ้ำในทุกกรณี (รันซ้ำกี่รอบก็ไม่พัง)
      const scheduleDay =
        existingDay ??
        (await prisma.rehabilitationScheduleDay.upsert({
          where: {
            rehabilitationPlanId_scheduledDate: { rehabilitationPlanId: plan.id, scheduledDate }
          },
          update: {},
          create: {
            rehabilitationPlanId: plan.id,
            scheduledDate,
            status: "pending",
            createdBy: plan.therapistId
          }
        }));
      if (!existingDay) daysCreated += 1;

      await prisma.scheduledExercise.updateMany({
        where: { scheduleDayId: scheduleDay.id, targetType: "duration" },
        data: { targetType: "repetitions", targetValue: "10 ครั้ง" }
      });

      // วันที่มีท่าอยู่แล้ว (ไม่ว่าจะเพิ่งเจอหรือเพิ่งสร้างจาก upsert ที่ชนแถวเดิม) ไม่ต้องเพิ่มซ้ำ
      if (existingDay && existingDay.scheduledExercises.length > 0) continue;
      if (!existingDay) {
        const existingCount = await prisma.scheduledExercise.count({ where: { scheduleDayId: scheduleDay.id } });
        if (existingCount > 0) continue;
      }

      for (let order = 1; order <= 2; order += 1) {
        const exercise = exercises[(offset + order) % exercises.length];
        await prisma.scheduledExercise.create({
          data: {
            scheduleDayId: scheduleDay.id,
            exerciseLibraryId: exercise.id,
            orderNumber: order,
            targetType: "repetitions",
            targetValue: "10 ครั้ง",
            therapistInstruction:
              order === 1
                ? "เคลื่อนไหวช้า ๆ อย่างมีการควบคุม"
                : "หยุดพักทันทีหากปวดเกิน 4/10",
            status: scheduleDay.status === "completed" || scheduleDay.status === "in_progress" ? scheduleDay.status : "pending",
            createdBy: plan.therapistId
          }
        });
        exercisesAdded += 1;
      }
    }
  }

  console.log(
    `Seed: backfilled upcoming exercises — ${daysCreated} schedule day(s) created, ` +
      `${exercisesAdded} exercise(s) added (today → today+7, all active plans).`
  );
}

async function main(): Promise<void> {
  const adminId = await seedAdmin();
  const therapists = await seedTherapists(adminId);
  // Exercise Library items are created by the therapist_arisa account (not the
  // admin) so the library's "Created by" / owner-edit permissions resolve to a
  // real therapist in the demo dataset.
  const arisa = therapists.get("อริสา");
  if (!arisa) throw new Error("Seed: therapist_arisa not found — cannot seed exercise library.");
  const gripExercises = await seedExerciseLibrary(arisa.userId);
  const poseExercises = await ensureAiPoseExercises(prisma, arisa.userId);
  const exercises = [...poseExercises, ...gripExercises];
  await seedPatientsAndPlans(adminId, therapists, exercises);
  await backfillUpcomingExerciseDays(exercises);
  console.log("Seed: full demo dataset complete.");
  console.log(
    `Accounts — Admin: admin_full | Therapists: ${therapistDefs
      .map((t) => t.username)
      .join(", ")} | Patients: ${patientDefs.map((p) => p.phoneNumber).join(", ")}` +
      ` (all passwords: "${DEMO_PASSWORD}")`
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
