// src/routes/payment.routes.js
import express from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireRole } from "../middlewares/requireRole.js";

import {
  createPayment,
  updatePayment,
  deletePayment,
  listPayments,
  getPayment,
  listPaymentsForApproval,
  decidePayment,
  markPaymentPaid,
  listMyPaymentPlans,
  submitPaymentForReview,
} from "../controllers/payment.controller.js";
import { createPaymentPlan } from "../controllers/paymentPlan.controller.js";

const router = express.Router();

/**
 * GET /api/payments
 * ADMIN / APPROVER solamente
 */
router.get(
  "/",
  requireAuth,
  requireRole(["ADMIN", "APPROVER"]),
  listPayments
);

/**
 * GET /api/payments/approval
 */
router.get(
  "/approval",
  requireAuth,
  requireRole(["ADMIN", "APPROVER"]),
  listPaymentsForApproval
);

/**
 * GET /api/payments/my-plans
 */
router.get(
  "/my-plans",
  requireAuth,
  requireRole(["PROVIDER"]),
  listMyPaymentPlans
);

/**
 * POST /api/payments
 */
router.post(
  "/",
  requireAuth,
  requireRole(["ADMIN", "APPROVER"]),
  createPayment
);

/**
 * POST /api/payments/plans
 */
router.post(
  "/plans",
  requireAuth,
  requireRole(["ADMIN", "APPROVER"]),
  createPaymentPlan
);

/**
 * PATCH /api/payments/:id/decision
 */
router.patch(
  "/:id/decision",
  requireAuth,
  requireRole(["ADMIN", "APPROVER"]),
  decidePayment
);

/**
 * PATCH /api/payments/:id/submit
 */
router.patch(
  "/:id/submit",
  requireAuth,
  requireRole(["PROVIDER"]),
  submitPaymentForReview
);

/**
 * PATCH /api/payments/:id/mark-paid
 */
router.patch(
  "/:id/mark-paid",
  requireAuth,
  requireRole(["ADMIN", "APPROVER"]),
  markPaymentPaid
);

/**
 * GET /api/payments/:id
 * Puede entrar cualquier autenticado, pero el controller valida ownership
 */
router.get(
  "/:id",
  requireAuth,
  getPayment
);

/**
 * PUT /api/payments/:id
 */
router.put(
  "/:id",
  requireAuth,
  requireRole(["ADMIN", "APPROVER"]),
  updatePayment
);

/**
 * DELETE /api/payments/:id
 */
router.delete(
  "/:id",
  requireAuth,
  requireRole(["ADMIN"]),
  deletePayment
);

export default router;