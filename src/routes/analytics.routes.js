// src/routes/analytics.routes.js
import express from "express";
import {
  getPaymentStatusTimings,
  getDashboardStats,
  getProviderDashboardStats,
  getActivityLog,
} from "../controllers/analytics.controller.js";

import { requireAuth } from "../middlewares/requireAuth.js";
import { requireRole } from "../middlewares/requireRole.js";

const router = express.Router();

// Dashboard stats - Admin only
router.get("/dashboard", requireAuth, requireRole("ADMIN"), getDashboardStats);

// Activity log - Admin only
router.get("/activity", requireAuth, requireRole("ADMIN"), getActivityLog);

// Payment status timings - Admin only
router.get("/payment-timings", requireAuth, requireRole("ADMIN"), getPaymentStatusTimings);

// Provider dashboard stats - Provider only (recomendado)
router.get("/provider-dashboard", requireAuth, requireRole("PROVIDER"), getProviderDashboardStats);

export default router;
