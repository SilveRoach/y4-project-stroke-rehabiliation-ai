// Admin module — HTTP handlers.
// SCOPE: only GET /admin/dashboard (FR-DASH-03) is implemented here. The
// account list/create/status/reset-password/unlock routes documented in
// api-design.md's "Users" section live under modules/user-management/*
// instead (GET/POST /users) — see that module's user.controller.ts.

import { NextFunction, Request, Response } from "express";
import * as adminService from "./admin.service";

export async function getAdminDashboardHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const dashboard = await adminService.getAdminDashboard();
    res.json(dashboard);
  } catch (err) {
    next(err);
  }
}

export async function syncSchedulesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const actorId = req.user?.sub;
    const clientToday = typeof req.body?.clientToday === "string" ? req.body.clientToday : undefined;
    const result = await adminService.syncScheduleStatuses(actorId, clientToday);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

