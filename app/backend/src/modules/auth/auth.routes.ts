// Auth module — Express router, wires routes to auth.controller.ts

import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import { loginHandler, logoutHandler, registerHandler } from "./auth.controller";

export const authRouter = Router();

authRouter.post("/register", registerHandler);
authRouter.post("/login", loginHandler);
authRouter.post("/logout", requireAuth, logoutHandler);
