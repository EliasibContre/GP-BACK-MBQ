import { Router } from 'express';
import { getMyNotifications, readNotification, readAllNotifications } from '../controllers/notification.controller.js';
import { requireAuth } from '../middlewares/requireAuth.js';

const router = Router();

router.use(requireAuth);
router.get('/', getMyNotifications);
router.patch('/:id/read', readNotification);
router.patch('/read-all', readAllNotifications);

export default router;