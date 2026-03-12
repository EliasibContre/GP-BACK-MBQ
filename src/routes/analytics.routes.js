// src/routes/analytics.routes.js
import express from "express";
import {
  getPaymentStatusTimings,
  getDashboardStats,
  getProviderDashboardStats,
  getApproverDashboardStats,
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
router.get(
  "/payment-timings",
  requireAuth,
  requireRole("ADMIN"),
  getPaymentStatusTimings
);

// Provider dashboard stats - Provider only
router.get(
  "/provider-dashboard",
  requireAuth,
  requireRole("PROVIDER"),
  getProviderDashboardStats
);

//  Approver dashboard stats - Approver only
router.get(
  "/approver-dashboard",
  requireAuth,
  requireRole("APPROVER"),
  getApproverDashboardStats
);

export default router;