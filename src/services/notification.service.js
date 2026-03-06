// src/services/notification.service.js
import { prisma } from "../config/prisma.js";

export async function listNotifications(userId, { unreadOnly = false } = {}) {
  return prisma.notification.findMany({
    where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function markNotificationRead(userId, id) {
  const notif = await prisma.notification.findUnique({ where: { id } });
  if (!notif || notif.userId !== userId) throw new Error("Notificación no encontrada");

  return prisma.notification.update({
    where: { id },
    data: { readAt: new Date() },
  });
}

export async function markAllRead(userId) {
  const res = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: res.count };
}

export async function createNotification({
  userId,
  type,
  entityType,
  entityId,
  title,
  message,
  data,
}) {
  return prisma.notification.create({
    data: { userId, type, entityType, entityId, title, message, data },
  });
}

/**
 * ✅ NUEVO: Borra SOLO notificaciones del flujo "Solicitudes de usuario"
 * Para no afectar notis generales, restringimos por type.
 * Ajusta USER_REQUEST al type real que usas en esas notificaciones.
 */
export async function deleteUserRequestNotification(userId, id) {
  const notif = await prisma.notification.findUnique({ where: { id } });
  if (!notif || notif.userId !== userId) throw new Error("Notificación no encontrada");

  const type = String(notif.type || "").toUpperCase();

  // ✅ Solo permitir borrar notis de solicitudes
  // (si tu type real es otro, cámbialo aquí)
  if (type !== "USER_REQUEST") {
    throw new Error("No permitido para este tipo de notificación");
  }

  await prisma.notification.delete({ where: { id } });
  return { deleted: true };
}