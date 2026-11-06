// Seed: the five AI-authored pose exercises (from the AI team's Rehab-AI repo)
// as ready-to-use, ACTIVE Exercise Library items, each with its full
// poseReference (angle definitions, FSM thresholds, targetRom, master + wrong-
// form samples) so a patient session can detect/score reps immediately — and
// the doctor-demo clip as the exercise's demo video where one exists.
//
//   1. Elbow Extension              (bilateral)
//   2. External Rotation (Lower)    (right arm)
//   3. External Rotation (Upper)    (right arm)
//   4. Shoulder Rotation            (left arm, hands together)
//   5. Side Bend                    (right arm)
//
// Source data lives in prisma/seed-data/ (pose-references/*.json is the AI
// repo's reference_data format with the raw `landmarkFrames` stripped — only the
// per-frame feature sequences DTW/K-NN need are kept; demo-videos/*.mp4 are the
// "from doctor demo" cuts).
//
// IDEMPOTENT: matches exercises by exact name (version 1). Re-running refreshes
// the stored base_criteria/poseReference in place and never duplicates rows or
// demo-video files. Run with the same DATABASE_URL as the other seeds:
//
//   npm run prisma:seed:ai-exercises     (from app/backend)

import { Prisma, PrismaClient, type ExerciseLibrary } from "@prisma/client";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const SEED_DATA_DIR = path.resolve(__dirname, "seed-data");
// Same default as src/config/env.ts. Stored paths stay RELATIVE ("media/…") so
// they resolve against the process cwd both for `npm run dev` on the host
// (app/backend) and inside the docker container (/app) — the bind mount maps
// app/backend/media ↔ /app/media.
const MEDIA_DIR = process.env.MEDIA_STORAGE_PATH ?? "./media";

interface AiExerciseDef {
  /** Base name of seed-data/pose-references/<key>.json (and demo-videos/<key>.mp4). */
  key: string;
  name: string;
  description: string;
  repetitions: number;
}

const DEFS: AiExerciseDef[] = [
  {
    key: "elbow-extension",
    name: "ท่ายืดข้อศอกสองข้าง (Elbow Extension – AI)",
    description: "นั่งหลังตรง งอศอกทั้งสองข้างแล้วเหยียดแขนออกให้สุด จากนั้นกลับสู่ท่าเริ่มต้นช้า ๆ โดยไม่โยกลำตัวช่วย",
    repetitions: 10
  },
  {
    key: "external-rotation-lower",
    name: "ท่าหมุนแขนออกนอก ระดับล่าง (External Rotation Lower – AI)",
    description: "แขนขวา: ศอกแนบลำตัว งอศอก 90° แล้วหมุนปลายแขนออกด้านนอกให้สุด จากนั้นหมุนกลับ ให้ลำตัวนิ่งตลอดท่า",
    repetitions: 10
  },
  {
    key: "external-rotation-upper",
    name: "ท่าหมุนแขนออกนอก ระดับบน (External Rotation Upper – AI)",
    description: "แขนขวา: ยกศอกระดับไหล่ งอศอก 90° แล้วหมุนปลายแขนขึ้นด้านบนให้สุด จากนั้นหมุนกลับ ให้ลำตัวนิ่งตลอดท่า",
    repetitions: 10
  },
  {
    key: "shoulder-rotation",
    name: "ท่าหมุนไหล่ (Shoulder Rotation – AI)",
    description: "ประสานมือสองข้างไว้ แล้วใช้มือข้างดีช่วยพยุงให้แขนข้างซ้ายหมุนไหล่ออกให้สุด จากนั้นกลับสู่ท่าเริ่มต้น",
    repetitions: 10
  },
  {
    key: "side-bend",
    name: "ท่าเอียงลำตัวด้านข้าง (Side Bend – AI)",
    description: "ยกแขนขวาขึ้นข้างลำตัวให้สุด พร้อมเอียงตัวไปด้านตรงข้ามอย่างช้า ๆ จากนั้นกลับสู่ท่าเริ่มต้น",
    repetitions: 10
  }
];

async function findTherapist(db: PrismaClient) {
  const therapist =
    (await db.user.findUnique({ where: { username: "therapist_arisa" } })) ??
    (await db.user.findFirst({ where: { role: "therapist" } }));
  if (!therapist) {
    throw new Error('No therapist user found — run "npm run prisma:seed" first.');
  }
  return therapist;
}

/** Copies a seed demo clip into the media dir and registers a files row (once per clip). */
async function ensureDemoVideo(db: PrismaClient, key: string, uploadedBy: string): Promise<string | null> {
  const source = path.join(SEED_DATA_DIR, "demo-videos", `${key}.mp4`);
  if (!fs.existsSync(source)) return null;

  // Size is part of the name so replacing a clip in seed-data registers a NEW
  // file row (and the exercise is re-pointed to it) instead of reusing the old one.
  const originalName = `${key}-demo-${fs.statSync(source).size}.mp4`;
  const existing = await db.file.findFirst({ where: { originalName, uploadedBy } });
  if (existing && fs.existsSync(path.resolve(existing.storagePath))) return existing.id;

  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const storedName = `${randomUUID()}.mp4`;
  fs.copyFileSync(source, path.join(MEDIA_DIR, storedName));
  const row = await db.file.create({
    data: {
      fileType: "video",
      originalName,
      storedName,
      mimeType: "video/mp4",
      fileSize: BigInt(fs.statSync(source).size),
      storagePath: `${MEDIA_DIR.split("\\").join("/").replace(/\/+$/, "")}/${storedName}`,
      uploadedBy
    }
  });
  return row.id;
}

export async function ensureAiPoseExercises(db: PrismaClient, createdBy: string): Promise<ExerciseLibrary[]> {
  const exercises: ExerciseLibrary[] = [];
  for (const def of DEFS) {
    const reference = JSON.parse(
      fs.readFileSync(path.join(SEED_DATA_DIR, "pose-references", `${def.key}.json`), "utf8")
    ) as Prisma.InputJsonObject;
    // Authoring metadata that is not part of the scored reference.
    const targetRom = reference.targetRom;
    const { exerciseId: _exerciseId, name: _name, difficulty, ...poseReference } = reference;
    void _exerciseId;
    void _name;
    if (typeof targetRom !== "number") {
      throw new Error(`Seed: "${def.name}" pose reference is missing a numeric targetRom.`);
    }

    const baseCriteria = {
      repetitions: def.repetitions,
      targetAngleDeg: targetRom,
      poseReference
    };
    const difficultyLevel = difficulty === "easy" || difficulty === "hard" ? difficulty : "medium";
    const demoVideoFileId = await ensureDemoVideo(db, def.key, createdBy);

    const existing = await db.exerciseLibrary.findFirst({ where: { name: def.name, versionNumber: 1 } });
    if (existing) {
      const exercise = await db.exerciseLibrary.update({
        where: { id: existing.id },
        data: {
          description: def.description,
          difficultyLevel,
          baseCriteria,
          status: "active",
          createdBy,
          ...(demoVideoFileId ? { demoVideoFileId } : {})
        }
      });
      console.log(`Seed: refreshed "${def.name}".`);
      exercises.push(exercise);
    } else {
      const exercise = await db.exerciseLibrary.create({
        data: {
          versionNumber: 1,
          name: def.name,
          description: def.description,
          movementTracking: "pose",
          difficultyLevel,
          baseCriteria,
          demoVideoFileId,
          status: "active",
          createdBy
        }
      });
      exercises.push(exercise);
      console.log(`Seed: created "${def.name}"${demoVideoFileId ? " (with demo video)" : ""}.`);
    }
  }
  return exercises;
}

async function main() {
  const db = new PrismaClient();
  try {
    const therapist = await findTherapist(db);
    await ensureAiPoseExercises(db, therapist.id);
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
}
