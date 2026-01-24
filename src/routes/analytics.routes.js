import express from 'express';
import { getPaymentStatusTimings, getDashboardStats, getProviderDashboardStats } from '../controllers/analytics.controller.js';
import { requireAuth } from '../middlewares/requireAuth.js';

const router = express.Router();

/**
 * GET /api/analytics/dashboard
 * Obtiene estadísticas generales del dashboard
 */
router.get('/dashboard', getDashboardStats);

/**
 * GET /api/analytics/provider-dashboard
 * Obtiene estadísticas específicas del proveedor autenticado
 */
router.get('/provider-dashboard', requireAuth, getProviderDashboardStats);

/**
 * GET /api/analytics/payment-timings
 * Obtiene tiempos promedio por estado de pago
 */
router.get('/payment-timings', getPaymentStatusTimings);

export default router;
