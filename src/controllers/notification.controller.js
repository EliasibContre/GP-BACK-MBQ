import { listNotifications, markNotificationRead, markAllRead } from '../services/notification.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getMyNotifications = asyncHandler(async (req, res) => {
  console.log('📬 GET /api/notifications - Usuario:', req.user?.id, req.user?.email);
  const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
  console.log('📬 Filtro unreadOnly:', unreadOnly);
  const items = await listNotifications(req.user.id, { unreadOnly });
  console.log('📬 Notificaciones encontradas:', items.length, items.map(i => ({ id: i.id, type: i.type, title: i.title })));
  res.json(items);
});

export const readNotification = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const item = await markNotificationRead(req.user.id, id);
  res.json(item);
});

export const readAllNotifications = asyncHandler(async (req, res) => {
  const result = await markAllRead(req.user.id);
  res.json(result);
});