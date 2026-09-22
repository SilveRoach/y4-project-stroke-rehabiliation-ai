import { Request, Response, NextFunction } from "express";
import type { PatientRehabilitationPlansStatus } from "@prisma/client";
import { ValidationError } from "../../common/errors";
import * as service from "./rehab.service";

const PLAN_STATUSES: PatientRehabilitationPlansStatus[] = ["draft", "active", "completed", "cancelled"];

export async function getPatientPlans(req: Request, res: Response, next: NextFunction) {
  try {
    const patientId = String(req.params.patientId);
    const actorId = req.user!.sub;
    const actorRole = req.user!.role;
    const rawStatuses = typeof req.query.statuses === "string" ? req.query.statuses.split(",") : undefined;
    const statuses = rawStatuses?.map((status) => status.trim()).filter(Boolean);
    if (statuses?.some((status) => !PLAN_STATUSES.includes(status as PatientRehabilitationPlansStatus))) {
      throw new ValidationError("statuses contains an invalid rehabilitation plan status.");
    }
    const result = await service.getPatientPlans(
      patientId,
      actorId,
      actorRole,
      statuses as PatientRehabilitationPlansStatus[] | undefined
    );
    res.json({ plans: result.plans, patient: result.patient });
  } catch (err) {
    next(err);
  }
}

export async function createPlan(req: Request, res: Response, next: NextFunction) {
  try {
    const actorId = req.user!.sub;
    const therapistId = req.user!.sub; // therapist creating the plan must be the authenticated user
    const patientId = String(req.params.patientId);
    const payload = req.body;
    const created = await service.createPlan(actorId, therapistId, patientId, payload);
    res.status(201).json({ plan: created });
  } catch (err) {
    next(err);
  }
}

export async function getPlan(req: Request, res: Response, next: NextFunction) {
  try {
    const planId = String(req.params.planId);
    const plan = await service.getPlanById(planId);
    res.json({ plan });
  } catch (err) {
    next(err);
  }
}

export async function patchPlan(req: Request, res: Response, next: NextFunction) {
  try {
    const actorId = req.user!.sub;
    const planId = String(req.params.planId);
    const patch = req.body;
    const updated = await service.updatePlanMetadata(actorId, planId, patch);
    res.json({ plan: updated });
  } catch (err) {
    next(err);
  }
}

export async function patchPlanStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const actorId = req.user!.sub;
    const planId = String(req.params.planId);
    const { status } = req.body;
    const updated = await service.updatePlanStatus(actorId, planId, status);
    res.json({ plan: updated });
  } catch (err) {
    next(err);
  }
}

export async function postScheduleDay(req: Request, res: Response, next: NextFunction) {
  try {
    const actorId = req.user!.sub;
    const planId = String(req.params.planId);
    const { scheduledDate, therapistNote } = req.body;
    const day = await service.createScheduleDay(actorId, planId, scheduledDate, therapistNote);
    res.status(201).json({ day });
  } catch (err) {
    next(err);
  }
}

export async function deleteScheduleDayHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const actorId = req.user!.sub;
    const dayId = String(req.params.dayId);
    await service.deleteScheduleDay(actorId, dayId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function patchScheduleDay(req: Request, res: Response, next: NextFunction) {
  try {
    const actorId = req.user!.sub;
    const dayId = String(req.params.dayId);
    const patch = req.body;
    const updated = await service.updateScheduleDay(actorId, dayId, patch);
    res.json({ day: updated });
  } catch (err) {
    next(err);
  }
}

export async function postScheduledExercise(req: Request, res: Response, next: NextFunction) {
  try {
    const actorId = req.user!.sub;
    const dayId = String(req.params.dayId);
    const payload = req.body;
    const ex = await service.createScheduledExercise(actorId, dayId, payload);
    res.status(201).json({ scheduledExercise: ex });
  } catch (err) {
    next(err);
  }
}

export async function patchScheduledExerciseOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const actorId = req.user!.sub;
    const dayId = String(req.params.dayId);
    const exerciseIds = req.body?.exerciseIds;
    const day = await service.updateScheduledExerciseOrder(actorId, dayId, exerciseIds);
    res.json({ day });
  } catch (err) {
    next(err);
  }
}

export async function patchScheduledExercise(req: Request, res: Response, next: NextFunction) {
  try {
    const actorId = req.user!.sub;
    const exerciseId = String(req.params.exerciseId);
    const result = await service.updateScheduledExercise(actorId, exerciseId, req.body);
    res.json({ scheduledExercise: result });
  } catch (err) {
    next(err);
  }
}

export async function deleteScheduledExercise(req: Request, res: Response, next: NextFunction) {
  try {
    const actorId = req.user!.sub;
    const exerciseId = String(req.params.exerciseId);
    await service.deleteScheduledExercise(actorId, exerciseId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function patchScheduledExerciseStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const actorId = req.user!.sub;
    const exerciseId = String(req.params.exerciseId);
    const patch = req.body;
    const result = await service.updateScheduledExerciseStatus(actorId, exerciseId, patch);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getPatientAttachments(req: Request, res: Response, next: NextFunction) {
  try {
    const patientId = String(req.params.patientId);
    const data = await service.getPatientAttachments(patientId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function addPlanAttachment(req: Request, res: Response, next: NextFunction) {
  try {
    const actorId = req.user!.sub;
    const planId = String(req.params.planId);
    const payload = req.body;
    const attachment = await service.addPlanAttachment(actorId, planId, payload);
    res.status(201).json({ attachment });
  } catch (err) {
    next(err);
  }
}

export async function removePlanAttachment(req: Request, res: Response, next: NextFunction) {
  try {
    const actorId = req.user!.sub;
    const planId = String(req.params.planId);
    const attachmentId = String(req.params.attachmentId);
    const result = await service.removePlanAttachment(actorId, planId, attachmentId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getFile(req: Request, res: Response, next: NextFunction) {
  try {
    const fileId = String(req.params.fileId);
    const file = await service.getFile(fileId);
    res.json({ file });
  } catch (err) {
    next(err);
  }
}
