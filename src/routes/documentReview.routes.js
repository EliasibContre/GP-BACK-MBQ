import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireRole } from '../middlewares/requireRole.js';
import validate from '../middlewares/validate.js';
import {
  getPendingDocuments,
  approveDocument,
  rejectDocument,
  downloadDocument,
  getDocumentStats
} from '../controllers/documentReview.controller.js';
import {
  getDocumentsSchema,
  approveDocumentSchema,
  rejectDocumentSchema
} from '../schemas/documentReview.schema.js';

const router = Router();

// Todas las rutas requieren autenticación
router.use(requireAuth);

// Rutas específicas ANTES de rutas con parámetros
// Obtener estadísticas (solo admin/approver)
router.get(
  '/stats',
  requireRole(['admin','approver']),
  getDocumentStats
);

// Descargar PDF del documento (accesible para todos los usuarios autenticados)
router.get(
  '/:documentId/download',
  downloadDocument
);

// Obtener documentos pendientes/aprobados/rechazados (solo admin/approver)
router.get(
  '/',
  requireRole(['admin','approver']),
  validate(getDocumentsSchema),
  getPendingDocuments
);

// Aprobar documento (solo admin/approver)
router.post(
  '/:documentId/approve',
  requireRole(['admin','approver']),
  validate(approveDocumentSchema),
  approveDocument
);

// Rechazar documento con motivo (solo admin/approver)
router.post(
  '/:documentId/reject',
  requireRole(['admin','approver']),
  validate(rejectDocumentSchema),
  rejectDocument
);

export default router;