// src/routes/purchaseOrder.routes.js
import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireRole } from '../middlewares/requireRole.js';
import { multerErrorHandler } from '../middlewares/multerErrorHandler.js';
import validate from '../middlewares/validate.js';
import {
  createPurchaseOrder,
  getMyPurchaseOrders,
  getPendingApprovalPurchaseOrders,
  listPurchaseOrders,
  listApprovedForSessionProvider,
  listApprovedUnpaidPurchaseOrders,
  approvePurchaseOrder,
  rejectPurchaseOrder,
  markReceivedPurchaseOrder,
  updatePurchaseOrder,
  submitPurchaseOrder,
  deletePurchaseOrder,
} from '../controllers/purchaseOrder.controller.js';
import { createPurchaseOrderSchema } from '../schemas/purchaseOrder.schema.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'application/xml', 'text/xml'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PDF y XML'));
    }
  }
});

/**
 * ADMIN / APPROVER: lista general
 */
router.get(
  '/',
  requireAuth,
  requireRole(['ADMIN', 'APPROVER']),
  listPurchaseOrders
);

/**
 * PROVIDER: órdenes aprobadas propias
 */
router.get(
  '/my-approved',
  requireAuth,
  requireRole(['PROVIDER']),
  listApprovedForSessionProvider
);

/**
 * ADMIN / APPROVER: órdenes aprobadas sin pagos
 */
router.get(
  '/approved-unpaid',
  requireAuth,
  requireRole(['ADMIN', 'APPROVER']),
  listApprovedUnpaidPurchaseOrders
);

/**
 * PROVIDER: crear orden
 */
router.post(
  '/me',
  requireAuth,
  requireRole(['PROVIDER']),
  upload.fields([
    { name: 'archivoOrden', maxCount: 1 },
    { name: 'archivoFacturaPdf', maxCount: 10 },
    { name: 'archivoFacturaXml', maxCount: 10 }
  ]),
  multerErrorHandler,
  validate(createPurchaseOrderSchema),
  createPurchaseOrder
);

/**
 * PROVIDER: mis órdenes
 */
router.get(
  '/me',
  requireAuth,
  requireRole(['PROVIDER']),
  getMyPurchaseOrders
);

/**
 * PROVIDER: editar orden
 */
router.patch(
  '/:id',
  requireAuth,
  requireRole(['PROVIDER']),
  upload.fields([
    { name: 'archivoOrden', maxCount: 1 },
    { name: 'archivoFacturaPdf', maxCount: 10 },
    { name: 'archivoFacturaXml', maxCount: 10 }
  ]),
  multerErrorHandler,
  updatePurchaseOrder
);

/**
 * PROVIDER: enviar orden
 */
router.post(
  '/:id/submit',
  requireAuth,
  requireRole(['PROVIDER']),
  submitPurchaseOrder
);

/**
 * PROVIDER: eliminar orden
 */
router.delete(
  '/:id',
  requireAuth,
  requireRole(['PROVIDER']),
  deletePurchaseOrder
);

/**
 * ADMIN / APPROVER: pendientes de aprobación
 */
router.get(
  '/pending-approval',
  requireAuth,
  requireRole(['APPROVER', 'ADMIN']),
  getPendingApprovalPurchaseOrders
);

/**
 * ADMIN / APPROVER: aprobar / rechazar / marcar recibida
 */
router.post(
  '/:id/approve',
  requireAuth,
  requireRole(['APPROVER', 'ADMIN']),
  approvePurchaseOrder
);

router.post(
  '/:id/reject',
  requireAuth,
  requireRole(['APPROVER', 'ADMIN']),
  rejectPurchaseOrder
);

router.post(
  '/:id/mark-received',
  requireAuth,
  requireRole(['APPROVER', 'ADMIN']),
  markReceivedPurchaseOrder
);

export default router;