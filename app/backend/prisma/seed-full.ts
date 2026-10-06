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
//     3 plans, and 2 patients with 1 plan. Every plan has schedule days with
//     exercises up to today (completed/skipped history) plus 3-5 more days of
//     assigned exercise scheduled ahead, and exercise performance results for
//     completed days (some AI-only, some PT-reviewed) — enough data for the
//     Therapist Dashboard, Patient Progress view, and Session Result Review
//     page to all show real, non-empty data.
//   4 Exercise Library items
//
// Run with:
//   npm run prisma:seed:full
//
// Idempotent — every account is keyed by its unique username/phone number and
// is skipped if it already exists; anything downstream of a skipped account
// is skipped too, so re-running never duplicates plans or results.

import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

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
    name: "ยืดกล้ามเนื้อไหล่ขึ้นตึง (Shoulder Flexion Stretch)",
    description: "ยกไหล่ช้า ๆ อย่างมีการควบคุม เพื่อฟื้นฟูช่วงการเคลื่อนไหวของข้อไหล่",
    movementTracking: "pose" as const,
    difficultyLevel: "easy" as const,
    baseCriteria: { targetAngleDeg: 90, repetitions: 10 }
  },
  {
    name: "ฝึกกำมือและแรงบีบ (Grip Strength Trainer)",
    description: "ฝึกบีบและค้างไว้แบบเพิ่มระดับขั้น โดยใช้เซนเซอร์กำมือเสมือน",
    movementTracking: "virtual_grip" as const,
    difficultyLevel: "medium" as const,
    baseCriteria: { targetGripStrength: 15, holdSeconds: 5, repetitions: 8 }
  },
  {
    name: "งอศอกกับดัมเบลเบา (Weighted Elbow Curl)",
    description: "ฝึกงอศอกแบบบิเซปส์ด้วยดัมเบลเบา ติดตามการเคลื่อนไหวด้วย Pose Estimation",
    movementTracking: "pose" as const,
    difficultyLevel: "medium" as const,
    baseCriteria: { targetAngleDeg: 120, repetitions: 12 }
  },
  {
    name: "ยกเข่ายืนเหยียบตรง (Assisted Standing March)",
    description: "ฝึกยกเข่าขึ้นตึงกับที่โดยมีที่ยืนพิง เพื่อฟื้นฟูความมั่นคงในการเดินและการทรงตัว",
    movementTracking: "pose" as const,
    difficultyLevel: "hard" as const,
    baseCriteria: { holdSeconds: 30, repetitions: 6 }
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
  // Days before today the plan starts (0 = start today).
  startOffset: number;
  // 3-5 more days of assigned exercise scheduled after today.
  futureDays: 3 | 4 | 5;
}

interface PatientDef {
  firstName: string;
  lastName: string;
  phoneNumber: string;
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
        startOffset: -14,
        futureDays: 4
      },
      {
        planName: "เสริมความแข็งแรงไหล่ระยะต่อเนื่อง",
        planDescription: "โปรแกรมต่อยอดจากแผนหลัก เน้นเพิ่มช่วงการเคลื่อนไหวของข้อไหล่และความทนทานของกล้ามเนื้อ",
        skipRate: 0.3,
        startOffset: -6,
        futureDays: 3
      }
    ]
  },
  {
    firstName: "มาลี",
    lastName: "สิริกิติ",
    phoneNumber: "0810000002",
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
        startOffset: -14,
        futureDays: 5
      },
      {
        planName: "ฝึกความอึดในการเดินระยะสั้น",
        planDescription: "โปรแกรมฝึกเดินระยะสั้นซ้ำ ๆ เพื่อเพิ่มความอึดและลดความเหนื่อยง่ายหลังฟื้นฟูระยะแรก",
        skipRate: 0.05,
        startOffset: -4,
        futureDays: 3
      }
    ]
  },
  {
    firstName: "นฤมล",
    lastName: "พวงทอง",
    phoneNumber: "0810000003",
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
        startOffset: -14,
        futureDays: 4
      }
    ]
  },
  {
    firstName: "กิตติพงษ์",
    lastName: "ชัยพร",
    phoneNumber: "0810000004",
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
        startOffset: -14,
        futureDays: 5
      },
      {
        planName: "ฝึกการทรงตัวขณะยืน",
        planDescription: "ฝึกยืนทรงตัวและยกเข่าต่อเนื่อง เพื่อลดความเสี่ยงตกหลังภาวะสมองขาดเลือด",
        skipRate: 0.2,
        startOffset: -8,
        futureDays: 4
      },
      {
        planName: "ยืดเหยียดกล้ามเนื้อทั้งตัวรายวัน",
        planDescription: "โปรแกรมยืดเหยียดเบา ๆ ทุกวัน เพื่อลดความตึงของกล้ามเนื้อ (spasticity) ด้านขวา",
        skipRate: 0.2,
        startOffset: -3,
        futureDays: 3
      }
    ]
  },
  {
    firstName: "ประเสริฐ",
    lastName: "ดวงแก้ว",
    phoneNumber: "0810000005",
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
        startOffset: -14,
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

    if (existingPatientUser) {
      console.log(`Seed: patient "${def.firstName} ${def.lastName}" already exists, skipping.`);
      continue;
    }

    // Assign to the therapist whose patientFirstNames list contains this
    // patient; fall back to the first therapist if no explicit mapping.
    const owner =
      [...therapists.values()].find((t) => t.def.patientFirstNames.includes(def.firstName)) ??
      [...therapists.values()][0];

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

    await prisma.patientTherapistAssignment.create({
      data: {
        patientId: patientUser.id,
        therapistId: owner.userId,
        status: "active",
        assignedBy: adminId
      }
    });

    // Multiple plans per patient (plan index also varies the pseudo-random
    // roll so overlapping plans don't get identical compliance patterns).
    for (const [planIndex, planDef] of def.plans.entries()) {
      const plan = await prisma.patientRehabilitationPlan.create({
        data: {
          patientId: patientUser.id,
          therapistId: owner.userId,
          name: planDef.planName,
          description: planDef.planDescription,
          // Start of the plan's first schedule day; end covers today plus the
          // 3-5 scheduled days ahead of it.
          startDate: dayOffset(planDef.startOffset),
          endDate: dayOffset(planDef.futureDays),
          status: "active",
          createdBy: owner.userId
        }
      });

    // One schedule day per day of the plan. Exercises run up to today
    // (offset 0) with `futureDays` more pending days scheduled after it.
    // Deterministic pseudo-random roll (seeded off plan index, day offset and
    // skipRate) so compliance numbers look like real usage.
    for (let offset = planDef.startOffset; offset <= planDef.futureDays; offset += 1) {
      const scheduledDate = dayOffset(offset);
      const roll = Math.abs(Math.sin(offset * 12.9898 + planIndex * 40.233 + planDef.skipRate * 78.233)) % 1;

      let dayStatus: "completed" | "skipped" | "in_progress" | "pending";
      if (offset < 0) {
        dayStatus = roll < planDef.skipRate ? "skipped" : "completed";
      } else if (offset === 0) {
        dayStatus = roll < planDef.skipRate ? "pending" : "in_progress";
      } else {
        dayStatus = "pending";
      }

      const scheduleDay = await prisma.rehabilitationScheduleDay.create({
        data: {
          rehabilitationPlanId: plan.id,
          scheduledDate,
          status: dayStatus,
          therapistNote:
            dayStatus === "skipped" ? "ไม่มาฝึกในวันนี้ — ติดตามอีกครั้งในครั้งหน้า" : null,
          createdBy: owner.userId
        }
      });

      // Pending days (today when not started, and the scheduled days ahead —
      // e.g. today the 18th, 19th, 20th) still get their two exercises, so the
      // patient's Today list shows upcoming assigned work. Only completed days
      // additionally get performance results below.
      for (let order = 1; order <= 2; order += 1) {
        const exercise = exercises[(Math.abs(offset) + order) % exercises.length];

        const scheduledExercise = await prisma.scheduledExercise.create({
          data: {
            scheduleDayId: scheduleDay.id,
            exerciseLibraryId: exercise.id,
            orderNumber: order,
            targetType: order === 1 ? "repetitions" : "duration",
            targetValue: order === 1 ? "10 ครั้ง" : "5 นาที",
            therapistInstruction:
              order === 1
                ? "เคลื่อนไหวช้า ๆ อย่างมีการควบคุม"
                : "หยุดพักทันทีหากปวดเกิน 4/10",
            status: dayStatus,
            createdBy: owner.userId
          }
        });

        if (dayStatus !== "completed") continue;

        const aiScore = Math.round(65 + roll * 30); // 65-95
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
      `Seed:   plan "${planDef.planName}" — days ${planDef.startOffset}→${planDef.futureDays} ` +
        `(exercises up to today + ${planDef.futureDays} more scheduled day(s)).`
    );
    }

    console.log(
      `Seed: created Patient "${def.firstName} ${def.lastName}" (${def.phoneNumber}, ` +
        `therapist ${owner.def.username}) with ${def.plans.length} plan(s).`
    );

  }
}

// =====================================================================

// Backfill for already-seeded data: patients are skipped on re-run, so plans
// from an earlier run keep their original schedule (which left pending days
// empty). This ensures today and the next two days (18/19/20 on a Sep 18 run)
// carry assigned exercises for EVERY active plan — creating any missing
// schedule day, and adding exercises to existing days that have none.
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
    for (const offset of [0, 1, 2]) {
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
            targetType: order === 1 ? "repetitions" : "duration",
            targetValue: order === 1 ? "10 ครั้ง" : "5 นาที",
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
      `${exercisesAdded} exercise(s) added (today + next 2 days, all active plans).`
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
  const exercises = await seedExerciseLibrary(arisa.userId);
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





