import { prisma } from "../../config/prisma";
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from "../../common/errors";

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

export async function getPatientPlans(patientId: string, actorId: string, actorRole: string) {
  const patient = await prisma.patient.findUnique({ where: { userId: patientId } });
  if (!patient) throw new NotFoundError("Patient not found.");

  // Authorization: patients may only read their own plans.
  // Therapists must be actively assigned to the patient. Admins are unrestricted.
  if (actorRole === "patient" && actorId !== patientId) {
    throw new ForbiddenError("You can only view your own rehabilitation plans.");
  }
  if (actorRole === "therapist") {
    const assignment = await prisma.patientTherapistAssignment.findFirst({
      where: { patientId, therapistId: actorId, status: "active" }
    });
    if (!assignment) throw new ForbiddenError("You are not assigned to this patient.");
  }

  const plans = await prisma.patientRehabilitationPlan.findMany({
    where: { patientId },
    orderBy: { createdAt: "desc" },
    include: planIncludeWithDaysAndExercises
  });

  return plans;
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

  const start = parseIsoDate(patch.startDate ?? undefined);
  const end = parseIsoDate(patch.endDate ?? undefined);
  if (start && end && end.getTime() < start.getTime()) throw new ValidationError("endDate cannot be before startDate.");

  // Business rule: if startDate hasn't been reached yet, allow change to current day but not before current day
  const nowDateStr = new Date().toISOString().slice(0, 10);
  if (start && start.toISOString().slice(0, 10) < nowDateStr) {
    throw new ValidationError("startDate cannot be before today.");
  }

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

export async function updateScheduledExerciseStatus(actorId: string, exerciseId: string, patch: { status: string; performance?: any }) {
  const ex = await prisma.scheduledExercise.findUnique({ where: { id: exerciseId }, include: { performanceResults: true, scheduleDay: true } });
  if (!ex) throw new NotFoundError("Scheduled exercise not found.");

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
  const file = await prisma.file.findUnique({ where: { id: fileId } });
  if (!file) throw new NotFoundError("File not found.");
  return file;
}

