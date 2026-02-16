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
  listApprovedUnpaidPurchaseOrders
} from '../controllers/purchaseOrder.controller.js';
import { approvePurchaseOrder, rejectPurchaseOrder, markReceivedPurchaseOrder } from '../controllers/purchaseOrder.controller.js';
import { createPurchaseOrderSchema } from '../schemas/purchaseOrder.schema.js';

const router = Router();

// Configurar multer para recibir archivos en memoria
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

// Listar órdenes con filtros
router.get('/', requireAuth, listPurchaseOrders);
// Órdenes aprobadas del proveedor autenticado (solo rol PROVIDER)
router.get('/my-approved', requireAuth, listApprovedForSessionProvider);
// Órdenes aprobadas sin pagos (para admin/aprobador)
router.get('/approved-unpaid', requireAuth, requireRole(['ADMIN','APPROVER']), listApprovedUnpaidPurchaseOrders);

router.post(
  '/me',
  requireAuth,
  upload.fields([
    { name: 'archivoOrden', maxCount: 1 },
    { name: 'archivoFacturaPdf', maxCount: 10 },
    { name: 'archivoFacturaXml', maxCount: 10 }
  ]),
  multerErrorHandler,
  validate(createPurchaseOrderSchema),
  createPurchaseOrder
);

router.get('/me', requireAuth, getMyPurchaseOrders);

// Endpoint para aprobadores/administradores: obtener órdenes pendientes de aprobación
router.get('/pending-approval', requireAuth, requireRole(['APPROVER','ADMIN']), getPendingApprovalPurchaseOrders);

// Endpoints para aprobar/rechazar/marcar recibida
router.post('/:id/approve', requireAuth, requireRole(['APPROVER','ADMIN']), approvePurchaseOrder);
router.post('/:id/reject', requireAuth, requireRole(['APPROVER','ADMIN']), rejectPurchaseOrder);
router.post('/:id/mark-received', requireAuth, requireRole(['APPROVER','ADMIN']), markReceivedPurchaseOrder);

export default router;