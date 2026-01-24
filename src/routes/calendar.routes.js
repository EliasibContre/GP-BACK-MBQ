import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth.js';
import { getCalendar } from '../controllers/calendar.controller.js';

const router = Router();

// GET /api/calendar?month=YYYY-MM OR from/to
router.get('/', requireAuth, getCalendar);

export default router;
