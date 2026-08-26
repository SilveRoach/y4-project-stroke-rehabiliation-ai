// User-management module — Express router, wires routes to user.controller.ts

import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { createAccountHandler, getUserProfileHandler, listUsersHandler, updateUserProfileHandler } from "./user.controller";

export const userRouter = Router();

// POST /users — Create Therapist or Admin account (FR-AUTH-01c, FR-USR-02), Admin only.
userRouter.post("/", requireAuth, requireRole("admin"), createAccountHandler);

// GET /users — list all accounts (FR-USR-02), Admin only.
userRouter.get("/", requireAuth, requireRole("admin"), listUsersHandler);

// GET /users/:id — view own profile (Self, or Admin) — FR-USR-04.
userRouter.get("/:id", requireAuth, getUserProfileHandler);
// PATCH /users/:id — edit own profile (Self), or Admin editing a Patient
// account (AdminUserManagementPage.tsx's Edit account flow) — FR-USR-04.
userRouter.patch("/:id", requireAuth, updateUserProfileHandler);

