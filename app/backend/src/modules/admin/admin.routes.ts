// Admin module — Express router, wires routes to admin.controller.ts.
// GET /admin/dashboard — system status summary, FR-DASH-03, Admin only.

import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { getAdminDashboardHandler, syncSchedulesHandler } from "./admin.controller";

export const adminRouter = Router();

adminRouter.get("/admin/dashboard", requireAuth, requireRole("admin"), getAdminDashboardHandler);
adminRouter.post("/admin/sync-schedules", requireAuth, requireRole("admin"), syncSchedulesHandler);

