import { prisma } from "../../config/prisma";
import * as fileService from "../files/file.service";
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from "../../common/errors";
import { displayName as formatDisplayName, initialsFromName } from "../../common/formatting";
import { Prisma, type PatientRehabilitationPlansStatus } from "@prisma/client";

// Helper to convert YYYY-MM-DD string to Date at UTC midnight
function parseIsoDate(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

// Standard include relation for full rehabilitation plan with schedule days, exercises, and attachments
const planIncludeWithDaysAndExercises = {
  scheduleDays: {
    orderBy: { scheduledDate: "asc" as const },
    include: {
      scheduledExercises: {
        orderBy: { orderNumber: "asc" as const },
        include: { exerciseLibrary: true, performanceResults: true }
      }
    }
  },
  attachments: {
    include: {
      file: true
    }
  }
};

export async function getPatientPlans(
  patientId: string,
  actorId: string,
  actorRole: string,
  statuses?: PatientRehabilitationPlansStatus[]
) {
  // Include the patient's user row so the response can carry a server-computed
  // displayName/avatarInitials — same pattern as session.service.ts's
  // /patients/:id/today payload, so the patient-side Progress/History pages can
  // show the real name even when the auth-store user has no displayName.
  const patient = await prisma.patient.findUnique({
    where: { userId: patientId },
    include: {
      user: { select: { username: true, firstName: true, lastName: true, profilePictureFileId: true } },
      therapistAssignments: {
        where: { status: "active" },
        include: { therapist: { include: { user: true } } }
      }
    }
  });
  if (!patient) throw new NotFoundError("Patient not found.");

  // Authorization: patients may only read their own plans.
  // Therapists may view any patient's plans; write operations below still require
  // an active assignment to keep the plan manager read-only for other therapists.
  if (actorRole === "patient" && actorId !== patientId) {
    throw new ForbiddenError("You can only view your own rehabilitation plans.");
  }
  const plans = await prisma.patientRehabilitationPlan.findMany({
    where: {
      patientId,
      ...(statuses && statuses.length > 0 ? { status: { in: statuses } } : {})
    },
    orderBy: { createdAt: "desc" },
    include: planIncludeWithDaysAndExercises
  });

  const patientName = formatDisplayName({
    firstName: patient.user.firstName,
    lastName: patient.user.lastName,
    username: patient.user.username
  });

  return {
    plans,
    patient: {
      displayName: patientName,
      avatarInitials: initialsFromName(patientName),
      profilePictureFileId: patient.user.profilePictureFileId,
      assignedTherapist: patient.therapistAssignments[0]
        ? {
            id: patient.therapistAssignments[0].therapistId,
            displayName: formatDisplayName(patient.therapistAssignments[0].therapist.user)
          }
        : null
    }
  };
}

async function assertAssignedTherapist(actorId: string, patientId: string): Promise<void> {
  const assignment = await prisma.patientTherapistAssignment.findFirst({
    where: { patientId, therapistId: actorId, status: "active" }
  });
  if (!assignment) throw new ForbiddenError("You are not assigned to this patient.");
}

export async function createPlan(
  actorId: string,
  therapistId: string,
  patientId: string,
  payload: {
    name: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    days?: Array<{ scheduledDate: string; therapistNote?: string; exercises?: any[] }>;
    attachments?: Array<{ fileId: string; description?: string }>;
  }
) {
  if (!payload.name || !payload.name.trim()) throw new ValidationError("Plan name is required.");

  const start = parseIsoDate(payload.startDate);
  const end = parseIsoDate(payload.endDate);
  if (start && end && end.getTime() < start.getTime()) throw new ValidationError("endDate cannot be before startDate.");

  // Verify patient exists
  const patient = await prisma.patient.findUnique({ where: { userId: patientId } });
  if (!patient) throw new NotFoundError("Patient not found.");
  await assertAssignedTherapist(actorId, patientId);

  // Verify therapist exists
  const therapist = await prisma.therapist.findUnique({ where: { userId: therapistId } });
  if (!therapist) throw new NotFoundError("Therapist not found.");

  // Create schedule days either from payload.days or auto-generate between start and end (inclusive)
  const daysToCreate: Array<{ scheduledDate: string; therapistNote?: string; exercises?: any[] }> = [];
  if (payload.days && payload.days.length > 0) {
    for (const d of payload.days) {
      daysToCreate.push({ scheduledDate: d.scheduledDate, therapistNote: d.therapistNote, exercises: d.exercises });
    }
  } else if (start && end) {
    // generate every calendar day between start..end inclusive
    const cur = new Date(start);
    while (cur.getTime() <= end.getTime()) {
      daysToCreate.push({ scheduledDate: cur.toISOString().slice(0, 10) });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const plan = await tx.patientRehabilitationPlan.create({
      data: {
        patientId,
        therapistId,
        name: payload.name.trim(),
        description: payload.description?.trim() || null,
        startDate: start || null,
        endDate: end || null,
        status: "draft",
        createdBy: actorId
      }
    });

    if (daysToCreate.length > 0) {
      for (const d of daysToCreate) {
        // create schedule day and any nested exercises
        const scheduledDay = await tx.rehabilitationScheduleDay.create({
          data: {
            rehabilitationPlanId: plan.id,
            scheduledDate: new Date(`${d.scheduledDate}T00:00:00Z`),
            therapistNote: d.therapistNote ?? null,
            createdBy: actorId
          }
        });

        if (d.exercises && d.exercises.length > 0) {
          for (const ex of d.exercises) {
            await tx.scheduledExercise.create({
              data: {
                scheduleDayId: scheduledDay.id,
                exerciseLibraryId: ex.exerciseLibraryId,
                orderNumber: ex.orderNumber ?? undefined,
                targetType: ex.targetType ?? undefined,
                targetValue: ex.targetValue ?? undefined,
                therapistInstruction: ex.therapistInstruction ?? null,
                createdBy: actorId
              }
            });
          }
        }
      }
    }

    if (payload.attachments && payload.attachments.length > 0) {
      for (const att of payload.attachments) {
        await tx.rehabilitationPlanAttachment.create({
          data: {
            rehabilitationPlanId: plan.id,
            fileId: att.fileId,
            description: att.description?.trim() || null,
            uploadedBy: actorId
          }
        });
      }
    }

    const full = await tx.patientRehabilitationPlan.findUnique({
      where: { id: plan.id },
      include: planIncludeWithDaysAndExercises
    });

    return full;
  });

  return created;
}

export async function getPlanById(planId: string) {
  const plan = await prisma.patientRehabilitationPlan.findUnique({
    where: { id: planId },
    include: planIncludeWithDaysAndExercises
  });
  if (!plan) throw new NotFoundError("Plan not found.");
  return plan;
}

export async function updatePlanMetadata(
  actorId: string,
  planId: string,
  patch: { name?: string; description?: string; startDate?: string | null; endDate?: string | null; status?: string }
) {
  const plan = await prisma.patientRehabilitationPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new NotFoundError("Plan not found.");
  await assertAssignedTherapist(actorId, plan.patientId);

  const start = parseIsoDate(patch.startDate ?? undefined);
  const end = parseIsoDate(patch.endDate ?? undefined);
  if (start && end && end.getTime() < start.getTime()) throw new ValidationError("endDate cannot be before startDate.");

  if (typeof patch.status !== "undefined") {
    const valid = new Set(["draft", "active", "completed", "cancelled"]);
    if (!valid.has(patch.status)) throw new ValidationError("Invalid plan status.");
    if ((plan.status === "completed" || plan.status === "cancelled") && patch.status !== plan.status) {
      throw new ValidationError("Cannot change status of a completed or cancelled plan.");
    }
  }

  // Shrink remaining days if start/end changed and they are not current/completed days
  const updated = await prisma.$transaction(async (tx) => {
    const updates: any = {
      updatedBy: actorId,
      updatedAt: new Date()
    };
    if (typeof patch.name === "string") updates.name = patch.name.trim();
    if (typeof patch.description !== "undefined") updates.description = patch.description?.trim() ?? null;
    if (patch.startDate !== undefined) updates.startDate = start || null;
    if (patch.endDate !== undefined) updates.endDate = end || null;
    if (typeof patch.status === "string") updates.status = patch.status as any;

    const newPlan = await tx.patientRehabilitationPlan.update({ where: { id: planId }, data: updates });

    // If start/end changed, remove any pending scheduleDays outside the new range, but keep completed/in_progress days
    if (start || end) {
      // compute inclusive range
      const startVal = start || newPlan.startDate;
      const endVal = end || newPlan.endDate;
      if (startVal && endVal) {
        // delete schedule days with scheduledDate < startVal or > endVal AND status is pending (not completed/in_progress/skipped)
        await tx.rehabilitationScheduleDay.deleteMany({
          where: {
            rehabilitationPlanId: planId,
            status: "pending",
            OR: [{ scheduledDate: { lt: startVal } }, { scheduledDate: { gt: endVal } }]
          }
        });
      }
    }

    const full = await tx.patientRehabilitationPlan.findUnique({
      where: { id: planId },
      include: planIncludeWithDaysAndExercises
    });
    return full;
  });

  return updated;
}

export async function updatePlanStatus(actorId: string, planId: string, status: string) {
  const plan = await prisma.patientRehabilitationPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new NotFoundError("Plan not found.");
  await assertAssignedTherapist(actorId, plan.patientId);

  // Validate transitions
  const valid = new Set(["draft", "active", "completed", "cancelled"]);
  if (!valid.has(status)) throw new ValidationError("Invalid plan status.");

  // basic rules
  if (plan.status === "completed" || plan.status === "cancelled") {
    throw new ValidationError("Cannot change status of a completed or cancelled plan.");
  }

  if (plan.status === "draft" && status === "active") {
    // allow
  }

  if (plan.status === "active" && (status === "completed" || status === "cancelled")) {
    // allow
  }

  const updated = await prisma.patientRehabilitationPlan.update({
    where: { id: planId },
    data: { status: status as any, updatedBy: actorId, updatedAt: new Date() },
    include: planIncludeWithDaysAndExercises
  });
  return updated;
}

// --- DELETE /schedule-days/:dayId -------------------------------------------
// Removes one schedule day from a plan WITHOUT touching the plan's
// start/end dates (unlike the "Add day" flow, which extends the end date via
// PATCH plan metadata). Cascades the day's children leaf-first — the schema has
// no cascade rules on its FKs. Completed days are deletable too (the therapist
// may genuinely want to shrink a plan), with the caveat that their recorded
// performance results are wiped with them. Only the assigned therapist may
// delete a day.
export async function deleteScheduleDay(actorId: string, dayId: string) {
  const day = await prisma.rehabilitationScheduleDay.findUnique({
    where: { id: dayId },
    include: { rehabilitationPlan: { select: { patientId: true } } }
  });
  if (!day) throw new NotFoundError("Schedule day not found.");
  await assertAssignedTherapist(actorId, day.rehabilitationPlan.patientId);

  await prisma.$transaction(async (tx) => {
    await tx.exercisePerformanceResult.deleteMany({ where: { scheduledExercise: { scheduleDayId: dayId } } });
    await tx.scheduledExercise.deleteMany({ where: { scheduleDayId: dayId } });
    await tx.rehabilitationScheduleDay.delete({ where: { id: dayId } });
  });

  return { success: true };
}

export async function createScheduleDay(actorId: string, planId: string, scheduledDate: string, therapistNote?: string) {
  const plan = await prisma.patientRehabilitationPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new NotFoundError("Plan not found.");

  const date = parseIsoDate(scheduledDate);
  if (!date) throw new ValidationError("Invalid scheduledDate.");

  try {
    const day = await prisma.rehabilitationScheduleDay.create({
      data: { rehabilitationPlanId: planId, scheduledDate: date, therapistNote: therapistNote ?? null, createdBy: actorId },
      include: {
        scheduledExercises: {
          orderBy: { orderNumber: "asc" },
          include: { exerciseLibrary: true, performanceResults: true }
        }
      }
    });
    return day;
  } catch (err) {
    // Unique constraint may fail
    throw new ConflictError("A schedule day already exists for that date.");
  }
}

export async function updateScheduleDay(actorId: string, dayId: string, patch: { therapistNote?: string; status?: string }) {
  const day = await prisma.rehabilitationScheduleDay.findUnique({ where: { id: dayId }, include: { rehabilitationPlan: true, scheduledExercises: true } });
  if (!day) throw new NotFoundError("Schedule day not found.");
  await assertAssignedTherapist(actorId, day.rehabilitationPlan.patientId);

  const updates: any = { updatedBy: actorId, updatedAt: new Date() };
  if (typeof patch.therapistNote !== "undefined") updates.therapistNote = patch.therapistNote ?? null;
  if (typeof patch.status !== "undefined") {
    const allowed = new Set(["pending", "in_progress", "completed", "skipped", "cancelled"]);
    if (!allowed.has(patch.status)) throw new ValidationError("Invalid day status.");
    updates.status = patch.status;

    // If marking cancelled, cascade to pending scheduledExercises
    if (patch.status === "cancelled") {
      await prisma.scheduledExercise.updateMany({ where: { scheduleDayId: dayId, status: "pending" }, data: { status: "cancelled", updatedBy: actorId, updatedAt: new Date() } });
    }
  }

  const updated = await prisma.rehabilitationScheduleDay.update({
    where: { id: dayId },
    data: updates,
    include: {
      scheduledExercises: {
        orderBy: { orderNumber: "asc" },
        include: { exerciseLibrary: true, performanceResults: true }
      }
    }
  });
  return updated;
}

export async function createScheduledExercise(actorId: string, dayId: string, payload: { exerciseLibraryId: string; orderNumber?: number; targetType?: string; targetValue?: any; therapistInstruction?: string }) {
  // Validate day exists
  const day = await prisma.rehabilitationScheduleDay.findUnique({ where: { id: dayId } });
  if (!day) throw new NotFoundError("Schedule day not found.");
  const plan = await prisma.patientRehabilitationPlan.findUnique({ where: { id: day.rehabilitationPlanId } });
  if (!plan) throw new NotFoundError("Plan not found.");
  await assertAssignedTherapist(actorId, plan.patientId);

  // Create exercise
  try {
    const ex = await prisma.scheduledExercise.create({
      data: {
        scheduleDayId: dayId,
        exerciseLibraryId: payload.exerciseLibraryId,
        orderNumber: payload.orderNumber ?? undefined,
        // Prisma expects a typed enum for targetType; cast from the incoming payload to any to satisfy typing.
        targetType: (payload.targetType as any) ?? undefined,
        targetValue: payload.targetValue ?? undefined,
        therapistInstruction: payload.therapistInstruction ?? null,
        createdBy: actorId
      },
      include: { exerciseLibrary: true, performanceResults: true }
    });
    return ex;
  } catch (err) {
    throw new ConflictError("Scheduled exercise conflict (orderNumber may be duplicate).");
  }
}

export async function updateScheduledExerciseOrder(actorId: string, dayId: string, exerciseIds: unknown) {
  if (!Array.isArray(exerciseIds) || exerciseIds.some((id) => typeof id !== "string")) {
    throw new ValidationError("exerciseIds must be an array of exercise IDs.");
  }

  const day = await prisma.rehabilitationScheduleDay.findUnique({
    where: { id: dayId },
    include: {
      rehabilitationPlan: { select: { patientId: true } },
      scheduledExercises: { select: { id: true } }
    }
  });
  if (!day) throw new NotFoundError("Schedule day not found.");
  await assertAssignedTherapist(actorId, day.rehabilitationPlan.patientId);

  const existingIds = day.scheduledExercises.map((exercise) => exercise.id);
  if (exerciseIds.length !== existingIds.length || new Set(exerciseIds).size !== existingIds.length ||
      existingIds.some((id) => !exerciseIds.includes(id))) {
    throw new ValidationError("exerciseIds must contain every exercise for the selected day exactly once.");
  }

  const updatedDay = await prisma.$transaction(async (tx) => {
    // Temporary negative values avoid collisions with the unique (day, order) index.
    for (let index = 0; index < exerciseIds.length; index += 1) {
      await tx.scheduledExercise.update({
        where: { id: exerciseIds[index] },
        data: { orderNumber: -(index + 1), updatedBy: actorId, updatedAt: new Date() }
      });
    }
    for (let index = 0; index < exerciseIds.length; index += 1) {
      await tx.scheduledExercise.update({
        where: { id: exerciseIds[index] },
        data: { orderNumber: index + 1, updatedBy: actorId, updatedAt: new Date() }
      });
    }
    return tx.rehabilitationScheduleDay.findUniqueOrThrow({
      where: { id: dayId },
      include: {
        scheduledExercises: {
          orderBy: { orderNumber: "asc" },
          include: { exerciseLibrary: true, performanceResults: true }
        }
      }
    });
  });

  return updatedDay;
}

export async function updateScheduledExercise(actorId: string, exerciseId: string, patch: { targetValue?: unknown }) {
  if (!Object.prototype.hasOwnProperty.call(patch, "targetValue")) {
    throw new ValidationError("targetValue is required.");
  }
  const exercise = await prisma.scheduledExercise.findUnique({
    where: { id: exerciseId },
    include: { scheduleDay: { include: { rehabilitationPlan: true } } }
  });
  if (!exercise) throw new NotFoundError("Scheduled exercise not found.");
  await assertAssignedTherapist(actorId, exercise.scheduleDay.rehabilitationPlan.patientId);

  return prisma.scheduledExercise.update({
    where: { id: exerciseId },
    data: {
      targetValue: patch.targetValue === null ? Prisma.JsonNull : patch.targetValue,
      updatedBy: actorId,
      updatedAt: new Date()
    },
    include: { exerciseLibrary: true, performanceResults: true }
  });
}

export async function deleteScheduledExercise(actorId: string, exerciseId: string) {
  const exercise = await prisma.scheduledExercise.findUnique({
    where: { id: exerciseId },
    include: { scheduleDay: { include: { rehabilitationPlan: true } } }
  });
  if (!exercise) throw new NotFoundError("Scheduled exercise not found.");
  await assertAssignedTherapist(actorId, exercise.scheduleDay.rehabilitationPlan.patientId);

  await prisma.scheduledExercise.delete({ where: { id: exerciseId } });
}

export async function updateScheduledExerciseStatus(actorId: string, exerciseId: string, patch: { status: string; performance?: any }) {
  const ex = await prisma.scheduledExercise.findUnique({ where: { id: exerciseId }, include: { performanceResults: true, scheduleDay: true } });
  if (!ex) throw new NotFoundError("Scheduled exercise not found.");
  const plan = await prisma.patientRehabilitationPlan.findUnique({ where: { id: ex.scheduleDay.rehabilitationPlanId } });
  if (!plan) throw new NotFoundError("Plan not found.");
  await assertAssignedTherapist(actorId, plan.patientId);

  const allowed = new Set(["pending", "in_progress", "completed", "skipped", "cancelled"]);
  if (!allowed.has(patch.status)) throw new ValidationError("Invalid exercise status.");

  const result = await prisma.$transaction(async (tx) => {
    const updatedEx = await tx.scheduledExercise.update({
      where: { id: exerciseId },
      data: { status: patch.status as any, updatedBy: actorId, updatedAt: new Date() },
      include: { exerciseLibrary: true, performanceResults: true }
    });

    let createdResult = null;
    if (patch.status === "completed" && patch.performance) {
      // Create a performance result — caller provides evaluation fields
      const attemptNumber = (ex.performanceResults?.length ?? 0) + 1;
      createdResult = await tx.exercisePerformanceResult.create({
        data: {
          scheduledExerciseId: exerciseId,
          attemptNumber,
          referenceVideo: patch.performance.referenceVideoFileId ?? null,
          completedAt: patch.performance.completedAt ? new Date(patch.performance.completedAt) : new Date(),
          aiScore: patch.performance.aiScore ?? undefined,
          aiFeedback: patch.performance.aiFeedback ?? null,
          ptScore: patch.performance.ptScore ?? undefined,
          ptFeedback: patch.performance.ptFeedback ?? null,
          evaluationSource: patch.performance.evaluationSource ?? undefined,
          performanceData: patch.performance.performanceData ?? undefined,
          createdAt: new Date()
        }
      });
    }

    // If day now has all exercises completed, mark day completed
    const day = await tx.rehabilitationScheduleDay.findUnique({ where: { id: ex.scheduleDayId }, include: { scheduledExercises: true } });
    if (day) {
      const remaining = day.scheduledExercises.filter((s) => s.id !== exerciseId).some((s) => s.status !== "completed");
      if (!remaining) {
        await tx.rehabilitationScheduleDay.update({ where: { id: day.id }, data: { status: "completed", updatedBy: actorId, updatedAt: new Date() } });
      }
    }

    return { updatedEx, createdResult };
  });

  return result;
}

export async function getPatientAttachments(patientId: string) {
  const patient = await prisma.patient.findUnique({ where: { userId: patientId } });
  if (!patient) throw new NotFoundError("Patient not found.");

  const planAttachments = await prisma.rehabilitationPlanAttachment.findMany({
    where: {
      rehabilitationPlan: { patientId }
    },
    include: {
      file: true,
      rehabilitationPlan: {
        select: { id: true, name: true, status: true }
      }
    },
    orderBy: { uploadedAt: "desc" }
  });

  const patientFiles = await prisma.file.findMany({
    where: {
      uploadedBy: patientId
    },
    orderBy: { createdAt: "desc" }
  });

  return {
    attachments: planAttachments,
    files: patientFiles
  };
}

export async function addPlanAttachment(
  actorId: string,
  planId: string,
  payload: { fileId: string; description?: string }
) {
  if (!payload.fileId) throw new ValidationError("fileId is required.");

  const plan = await prisma.patientRehabilitationPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new NotFoundError("Plan not found.");

  const file = await prisma.file.findUnique({ where: { id: payload.fileId } });
  if (!file) throw new NotFoundError("File not found.");

  const attachment = await prisma.rehabilitationPlanAttachment.create({
    data: {
      rehabilitationPlanId: planId,
      fileId: payload.fileId,
      description: payload.description?.trim() || null,
      uploadedBy: actorId
    },
    include: {
      file: true
    }
  });

  return attachment;
}

export async function removePlanAttachment(actorId: string, planId: string, attachmentId: string) {
  const attachment = await prisma.rehabilitationPlanAttachment.findUnique({
    where: { id: attachmentId }
  });
  if (!attachment || attachment.rehabilitationPlanId !== planId) {
    throw new NotFoundError("Attachment not found for this plan.");
  }

  await prisma.rehabilitationPlanAttachment.delete({
    where: { id: attachmentId }
  });

  return { success: true };
}

export async function getFile(fileId: string) {
  return fileService.getFile(fileId);
}
