import { Router } from "express";
import * as controller from "./rehab.controller";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";

export const rehabPlansRouter = Router();

// Patient-scoped plans
rehabPlansRouter.get("/patients/:patientId/plans", requireAuth, controller.getPatientPlans);
rehabPlansRouter.post("/patients/:patientId/plans", requireAuth, requireRole("therapist"), controller.createPlan);

// Plan-level operations
rehabPlansRouter.get("/plans/:planId", requireAuth, controller.getPlan);
rehabPlansRouter.patch("/plans/:planId", requireAuth, requireRole("therapist"), controller.patchPlan);
rehabPlansRouter.patch("/plans/:planId/status", requireAuth, requireRole("therapist"), controller.patchPlanStatus);

// Attachments
rehabPlansRouter.get("/patients/:patientId/attachments", requireAuth, controller.getPatientAttachments);
rehabPlansRouter.post("/plans/:planId/attachments", requireAuth, requireRole("therapist"), controller.addPlanAttachment);
rehabPlansRouter.delete("/plans/:planId/attachments/:attachmentId", requireAuth, requireRole("therapist"), controller.removePlanAttachment);
rehabPlansRouter.get("/files/:fileId", requireAuth, controller.getFile);

// Schedule days
rehabPlansRouter.post("/plans/:planId/schedule-days", requireAuth, requireRole("therapist"), controller.postScheduleDay);
rehabPlansRouter.patch("/schedule-days/:dayId", requireAuth, requireRole("therapist"), controller.patchScheduleDay);

// Scheduled exercises
rehabPlansRouter.delete("/schedule-days/:dayId", requireAuth, requireRole("therapist"), controller.deleteScheduleDayHandler);
rehabPlansRouter.post("/schedule-days/:dayId/exercises", requireAuth, requireRole("therapist"), controller.postScheduledExercise);
rehabPlansRouter.patch("/schedule-days/:dayId/exercises/order", requireAuth, requireRole("therapist"), controller.patchScheduledExerciseOrder);
rehabPlansRouter.patch("/scheduled-exercises/:exerciseId/status", requireAuth, requireRole("therapist"), controller.patchScheduledExerciseStatus);
rehabPlansRouter.patch("/scheduled-exercises/:exerciseId", requireAuth, requireRole("therapist"), controller.patchScheduledExercise);
rehabPlansRouter.delete("/scheduled-exercises/:exerciseId", requireAuth, requireRole("therapist"), controller.deleteScheduledExercise);

export default rehabPlansRouter;
