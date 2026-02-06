import express from 'express';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireRole } from '../middlewares/requireRole.js';

import {
  createPayment,
  updatePayment,
  deletePayment,
  listPayments,
  getPayment,
  listPaymentsForApproval,
  decidePayment
} from '../controllers/payment.controller.js';

const router = express.Router();

/**
 * GET /api/payments - Listar pagos
 * Acceso: Autenticado
 */
router.get('/', requireAuth, listPayments);

/**
 * GET /api/payments/:id - Obtener un pago
 * Acceso: Autenticado
 */
router.get('/:id', requireAuth, getPayment);

/**
 * POST /api/payments - Crear pago
 * Acceso: ADMIN, APPROVER
 */
router.post('/', requireAuth, requireRole(['ADMIN', 'APPROVER']), createPayment);

/**
 * PUT /api/payments/:id - Actualizar pago
 * Acceso: ADMIN, APPROVER
 */
router.put('/:id', requireAuth, requireRole(['ADMIN', 'APPROVER']), updatePayment);

/**
 * DELETE /api/payments/:id - Eliminar pago
 * Acceso: ADMIN
 */
router.delete('/:id', requireAuth, requireRole(['ADMIN']), deletePayment);

/**
 * GET /api/payments/approval - Listar pagos para aprobación
 * Acceso: ADMIN, APPROVER
 */
router.get('/approval', requireAuth, requireRole(['ADMIN', 'APPROVER']), listPaymentsForApproval);

/**
 * PATCH /api/payments/:id/decision - Aprobar/Rechazar pago
 * Acceso: ADMIN, APPROVER
 */
router.patch('/:id/decision', requireAuth, requireRole(['ADMIN', 'APPROVER']), decidePayment);


export default router;
