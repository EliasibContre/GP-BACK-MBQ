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
 * GET /api/payments - Listar pagos
 */
router.get("/", requireAuth, listPayments);

/**
 * GET /api/payments/approval - Listar pagos para aprobación
 * ⚠️ Debe ir antes que /:id
 */
router.get(
  "/approval",
  requireAuth,
  requireRole(["ADMIN", "APPROVER"]),
  listPaymentsForApproval
);

/**
 * GET /api/payments/my-plans - Listar parcialidades del proveedor autenticado
 * ⚠️ Debe ir antes que /:id
 */
router.get(
  "/my-plans",
  requireAuth,
  requireRole(["PROVIDER"]),
  listMyPaymentPlans
);

/**
 * POST /api/payments - Crear pago
 */
router.post(
  "/",
  requireAuth,
  requireRole(["ADMIN", "APPROVER"]),
  createPayment
);

/**
 * POST /api/payments/plans - Crear plan de pagos
 * ⚠️ Debe ir antes que /:id
 */
router.post(
  "/plans",
  requireAuth,
  requireRole(["ADMIN", "APPROVER"]),
  createPaymentPlan
);

/**
 * PATCH /api/payments/:id/decision - Aprobar/Rechazar
 * ⚠️ Debe ir antes que /:id
 */
router.patch(
  "/:id/decision",
  requireAuth,
  requireRole(["ADMIN", "APPROVER"]),
  decidePayment
);

/**
 * PATCH /api/payments/:id/submit - Proveedor envía parcialidad a revisión
 * ⚠️ Debe ir antes que /:id
 */
router.patch(
  "/:id/submit",
  requireAuth,
  requireRole(["PROVIDER"]),
  submitPaymentForReview
);

/**
 * PATCH /api/payments/:id/mark-paid - Marcar como pagado
 * ⚠️ Debe ir antes que /:id
 */
router.patch(
  "/:id/mark-paid",
  requireAuth,
  requireRole(["ADMIN", "APPROVER"]),
  markPaymentPaid
);

/**
 * GET /api/payments/:id - Obtener pago
 */
router.get("/:id", requireAuth, getPayment);

/**
 * PUT /api/payments/:id - Actualizar pago
 */
router.put(
  "/:id",
  requireAuth,
  requireRole(["ADMIN", "APPROVER"]),
  updatePayment
);

/**
 * DELETE /api/payments/:id - Eliminar pago
 */
router.delete(
  "/:id",
  requireAuth,
  requireRole(["ADMIN"]),
  deletePayment
);

export default router;