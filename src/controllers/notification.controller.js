// src/controllers/notification.controller.js
import {
  listNotifications,
  markNotificationRead,
  markAllRead,
  deleteUserRequestNotification,
} from "../services/notification.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const getMyNotifications = asyncHandler(async (req, res) => {
  const unreadOnly = req.query.unread === "1" || req.query.unread === "true";

  const items = await listNotifications(req.user.id, { unreadOnly });

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

/**
 * Borra SOLO notificaciones del flujo "Solicitudes de usuario"
 * Ruta sugerida: DELETE /api/notifications/:id/user-request
 */
export const deleteUserRequestNotif = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const result = await deleteUserRequestNotification(req.user.id, id);
  res.json(result);
});
