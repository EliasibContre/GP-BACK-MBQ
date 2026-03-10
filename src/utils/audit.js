import { prisma } from "../config/prisma.js";

export async function logAudit({
    actorId = null,
    action,
    entity,
    entityId = null,
    meta = null,
}) {
    try {
        if (!action || !entity) return;

        await prisma.auditLog.create({
            data: {
                actorId,
                action,
                entity,
                entityId,
                meta,
            },
        });
    } catch (err) {
        console.warn("[audit] FAILED:", err?.message || err);

        console.warn("[audit] error:", err?.message || err);
    }
}
