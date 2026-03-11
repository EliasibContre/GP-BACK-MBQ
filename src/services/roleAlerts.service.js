// src/services/roleAlerts.service.js
import { createNotification } from "./notification.service.js";
import { getUsersByRoleNames } from "./notificationRecipients.service.js";
import { sendRoleAlertEmail } from "../utils/email.js";

export async function notifyRoles({
  roleNames = [],
  type,
  entityType,
  entityId,
  title,
  message,
  data,
  sendEmail = true,
}) {
  const users = await getUsersByRoleNames(roleNames);

  for (const user of users) {
    await createNotification({
      userId: user.id,
      type,
      entityType,
      entityId,
      title,
      message,
      data,
      sendEmail: false,
    });

    if (sendEmail && user.email) {
      try {
        await sendRoleAlertEmail(user.email, title, title, message);
      } catch (err) {
        console.error(`Error enviando correo a ${user.email}:`, err?.message || err);
      }
    }
  }

  return { notified: users.length };
}
