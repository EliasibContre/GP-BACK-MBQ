// src/services/notificationRecipients.service.js
import { prisma } from "../config/prisma.js";

export async function getUsersByRoleNames(roleNames = []) {
  const normalized = (roleNames || [])
    .map((r) => String(r || "").trim().toUpperCase())
    .filter(Boolean);

  if (!normalized.length) return [];

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      roles: {
        some: {
          role: {
            name: { in: normalized },
          },
        },
      },
    },
    select: {
      id: true,
      email: true,
      fullName: true,
    },
  });

  const seen = new Set();
  return users.filter((u) => {
    const email = String(u.email || "").trim().toLowerCase();
    if (!email) return false;
    if (seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}
