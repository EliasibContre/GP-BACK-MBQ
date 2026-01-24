import { Router } from 'express';
import { createAccessRequestCtrl, listAccessRequestsCtrl, getAccessRequestCtrl, decideAccessRequestCtrl } from '../controllers/accessRequest.controller.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireRole } from '../middlewares/requireRole.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Público: crear solicitud (sin auth)
router.post('/', asyncHandler(createAccessRequestCtrl));

// Protegidas: requieren autenticación y rol APPROVER o ADMIN
router.get('/', requireAuth, requireRole(['ADMIN', 'APPROVER']), asyncHandler(listAccessRequestsCtrl));
router.get('/:id', requireAuth, requireRole(['ADMIN', 'APPROVER']), asyncHandler(getAccessRequestCtrl));
router.patch('/:id/decision', requireAuth, requireRole(['ADMIN', 'APPROVER']), asyncHandler(decideAccessRequestCtrl));

export default router;