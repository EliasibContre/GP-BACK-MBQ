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
} from "../controllers/payment.controller.js";
import { createPaymentPlan } from "../controllers/paymentPlan.controller.js";

const router = express.Router();

/**
 * GET /api/payments - Listar pagos
 */
router.get("/", requireAuth, listPayments);

/**
 * GET /api/payments/approval - Listar pagos para aprobación
 * ⚠️ Debe ir ANTES que /:id
 */
router.get(
  "/approval",
  requireAuth,
  requireRole(["ADMIN", "APPROVER"]),
  listPaymentsForApproval
);

/**
 * POST /api/payments - Crear pago
 */
router.post("/", requireAuth, requireRole(["ADMIN", "APPROVER"]), createPayment);

/**
 * PATCH /api/payments/:id/decision - Aprobar/Rechazar
 * ⚠️ Debe ir ANTES que /:id (por claridad)
 */
router.patch(
  "/:id/decision",
  requireAuth,
  requireRole(["ADMIN", "APPROVER"]),
  decidePayment
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
router.delete("/:id", requireAuth, requireRole(["ADMIN"]), deletePayment);
router.post("/plans", createPaymentPlan);
router.patch("/:id/mark-paid", requireAuth, requireRole(["ADMIN", "APPROVER"]), markPaymentPaid);

export default router;