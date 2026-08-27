import { Request, Response, NextFunction } from "express";
import * as service from "./rehab.service";

export async function getPatientPlans(req: Request, res: Response, next: NextFunction) {
  try {
    const patientId = String(req.params.patientId);
    const plans = await service.getPatientPlans(patientId);
    res.json({ plans });
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
