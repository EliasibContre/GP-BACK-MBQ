import express from 'express';
import { getPaymentStatusTimings, getDashboardStats, getProviderDashboardStats } from '../controllers/analytics.controller.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireRole } from '../middlewares/requireRole.js';

const router = express.Router();

// Dashboard stats - Admin only
router.get('/dashboard', requireAuth, requireRole('ADMIN'), getDashboardStats);

// Provider dashboard stats - Authenticated users
router.get('/provider-dashboard', requireAuth, getProviderDashboardStats);

// Payment status timings - Admin only
router.get('/payment-timings', requireAuth, requireRole('ADMIN'), getPaymentStatusTimings);

export default router;
