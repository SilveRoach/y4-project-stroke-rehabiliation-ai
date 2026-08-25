// User-management module — Express router, wires routes to user.controller.ts

import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { createAccountHandler } from "./user.controller";

export const userRouter = Router();

// POST /users — Create Therapist or Admin account (FR-AUTH-01c, FR-USR-02), Admin only.
userRouter.post("/", requireAuth, requireRole("admin"), createAccountHandler);
