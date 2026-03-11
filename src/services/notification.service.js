// src/services/notification.service.js
import { prisma } from "../config/prisma.js";
import { sendPlatformNotificationEmail } from "../utils/email.js";

export async function listNotifications(userId, { unreadOnly = false } = {}) {
  return prisma.notification.findMany({
    where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function markNotificationRead(userId, id) {
  const notif = await prisma.notification.findUnique({ where: { id } });
  if (!notif || notif.userId !== userId) {
    throw new Error("Notificación no encontrada");
  }

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
  sendEmail = true,
}) {
  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      entityType,
      entityId,
      title,
      message,
      data,
    },
  });

  if (sendEmail && String(process.env.MAILER_DISABLED || "false") !== "true") {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, isActive: true },
      });

      if (user?.email && user?.isActive !== false) {
        await sendPlatformNotificationEmail(user.email, {
          title,
          message,
          type,
          entityType,
          entityId,
          data,
        });
      }
    } catch (err) {
      console.error(
        "Error enviando email de notificación:",
        err?.message || err
      );
    }
  }

  return notification;
}

/**
 *  Borra SOLO notificaciones del flujo "Solicitudes de usuario"
 * Ajusta USER_REQUEST al type real si en tu proyecto usas otro nombre.
 */
export async function deleteUserRequestNotification(userId, id) {
  const notif = await prisma.notification.findUnique({ where: { id } });

  if (!notif || notif.userId !== userId) {
    throw new Error("Notificación no encontrada");
  }

  const type = String(notif.type || "").toUpperCase();

  if (type !== "USER_REQUEST") {
    throw new Error("No permitido para este tipo de notificación");
  }

  await prisma.notification.delete({ where: { id } });

  return { deleted: true };
}
