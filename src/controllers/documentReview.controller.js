// src/controllers/documentReview.controller.js
import fetch from "node-fetch";
import { prisma } from "../config/prisma.js";
import { getSignedUrl } from "../config/supabase.js";
import {
  sendDocumentApprovedEmail,
  sendDocumentRejectedEmail,
} from "../utils/email.js";
import { createNotification } from "../services/notification.service.js";
import { logAudit } from "../utils/audit.js";

const DOCS_BUCKET = process.env.PROVIDER_DOCS_BUCKET || "provider-documents";
const SIGNED_URL_EXPIRES = Number(process.env.SIGNED_URL_EXPIRES || 3600);

// ------------------ Helpers ------------------
function safeFileName(s) {
  return String(s || "archivo")
    .replace(/[^\w\-\.]+/g, "_")
    .slice(0, 120);
}

function groupFromDocType(docType) {
  const code = String(docType?.code || "").toUpperCase();

  if (
    [
      "ID_FRONT",
      "ID_BACK",
      "INE_FRONT",
      "INE_BACK",
      "IDENT_FRONTAL",
      "IDENT_REVERSO",
    ].includes(code)
  ) {
    return {
      groupKey: "IDENTIFICACION",
      groupLabel: "Documentos de identificación",
    };
  }

  if (["CONTRACT", "CONTRATO"].includes(code)) {
    return { groupKey: "CONTRATO", groupLabel: "Contrato" };
  }

  if (
    ["CSF", "CONSTANCIA_FISCAL", "CONSTANCIA_SITUACION_FISCAL"].includes(code)
  ) {
    return { groupKey: "CSF", groupLabel: "Constancia de Situación Fiscal" };
  }

  return {
    groupKey: code || "OTROS",
    groupLabel: docType?.name || "Otros documentos",
  };
}

function aggregateGroupStatus(statuses) {
  const s = (statuses || []).map((x) => String(x || "").toUpperCase());
  if (s.includes("REJECTED")) return "REJECTED";
  if (s.includes("PENDING")) return "PENDING";
  if (s.length && s.every((x) => x === "APPROVED")) return "APPROVED";
  return "PENDING";
}

async function resolveDocumentUrl(document) {
  if (document?.fileUrl) return document.fileUrl;
  if (document?.storageKey) {
    return await getSignedUrl(DOCS_BUCKET, document.storageKey, SIGNED_URL_EXPIRES);
  }
  return null;
}

// ------------------ Listados ------------------
export async function getPendingDocuments(req, res) {
  try {
    const { status, search } = req.query;
    const where = {};

    if (status && ["PENDING", "APPROVED", "REJECTED"].includes(status)) {
      where.status = status;
    }

    if (search) {
      where.provider = {
        is: {
          OR: [
            { businessName: { contains: search, mode: "insensitive" } },
            { rfc: { contains: search, mode: "insensitive" } },
          ],
        },
      };
    }

    const documents = await prisma.providerDocument.findMany({
      where,
      include: {
        provider: {
          select: {
            id: true,
            businessName: true,
            rfc: true,
            emailContacto: true,
            personType: true,
          },
        },
        documentType: {
          select: { id: true, code: true, name: true, description: true },
        },
        uploadedBy: { select: { id: true, fullName: true, email: true } },
        reviewedBy: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });

    return res.json(documents);
  } catch (error) {
    console.error("Error getPendingDocuments:", error);
    return res
      .status(500)
      .json({ error: "Error al cargar documentos", detail: error.message });
  }
}

export async function getDocumentStats(req, res) {
  try {
    const [pending, approved, rejected, total] = await Promise.all([
      prisma.providerDocument.count({ where: { status: "PENDING" } }),
      prisma.providerDocument.count({ where: { status: "APPROVED" } }),
      prisma.providerDocument.count({ where: { status: "REJECTED" } }),
      prisma.providerDocument.count(),
    ]);

    return res.json({ pending, approved, rejected, total });
  } catch (error) {
    console.error("Error getDocumentStats:", error);
    return res
      .status(500)
      .json({ error: "Error al cargar estadísticas", detail: error.message });
  }
}

export async function getDocumentGroups(req, res) {
  try {
    const { status, search } = req.query;
    const where = {};

    if (status && ["PENDING", "APPROVED", "REJECTED"].includes(status)) {
      where.status = status;
    }

    if (search) {
      where.provider = {
        is: {
          OR: [
            { businessName: { contains: search, mode: "insensitive" } },
            { rfc: { contains: search, mode: "insensitive" } },
          ],
        },
      };
    }

    const documents = await prisma.providerDocument.findMany({
      where,
      include: {
        provider: {
          select: {
            id: true,
            businessName: true,
            rfc: true,
            emailContacto: true,
            personType: true,
          },
        },
        documentType: { select: { id: true, code: true, name: true } },
        uploadedBy: { select: { id: true, fullName: true, email: true } },
        reviewedBy: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: [{ createdAt: "desc" }],
    });

    const map = new Map();

    for (const d of documents) {
      const { groupKey, groupLabel } = groupFromDocType(d.documentType);
      const providerId = d.providerId;
      const groupId = `${providerId}|${groupKey}`;

      if (!map.has(groupId)) {
        map.set(groupId, {
          groupId,
          providerId,
          providerName: d.provider?.businessName ?? "—",
          requestKey: groupKey,
          requestLabel: groupLabel,
          updatedAt: d.updatedAt ?? d.createdAt,
          filesCount: 0,
          statuses: [],
          documentIds: [],
        });
      }

      const g = map.get(groupId);
      g.filesCount += 1;
      g.statuses.push(d.status);
      g.documentIds.push(d.id);

      const dt = d.updatedAt ?? d.createdAt;
      if (dt && g.updatedAt && dt > g.updatedAt) g.updatedAt = dt;
    }

    const groups = Array.from(map.values()).map((g) => ({
      groupId: g.groupId,
      providerId: g.providerId,
      providerName: g.providerName,
      requestKey: g.requestKey,
      requestLabel: g.requestLabel,
      status: aggregateGroupStatus(g.statuses),
      updatedAt: g.updatedAt,
      filesCount: g.filesCount,
      documentIds: g.documentIds,
    }));

    groups.sort((a, b) => {
      const rank = (s) => (s === "PENDING" ? 0 : s === "REJECTED" ? 1 : 2);
      const ra = rank(a.status);
      const rb = rank(b.status);
      if (ra !== rb) return ra - rb;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    return res.json(groups);
  } catch (error) {
    console.error("Error getDocumentGroups:", error);
    return res
      .status(500)
      .json({ error: "Error al cargar grupos", detail: error.message });
  }
}

export async function getDocumentGroupFiles(req, res) {
  try {
    const { groupId } = req.params;
    const [providerIdStr, groupKey] = String(groupId).split("|");
    const providerId = Number(providerIdStr);

    if (!providerId || !groupKey) {
      return res.status(400).json({ error: "groupId inválido" });
    }

    const docs = await prisma.providerDocument.findMany({
      where: { providerId },
      include: {
        documentType: { select: { code: true, name: true } },
      },
      orderBy: [{ createdAt: "desc" }],
    });

    const filtered = docs.filter(
      (d) => groupFromDocType(d.documentType).groupKey === groupKey,
    );

    const files = filtered.map((d) => ({
      id: d.id,
      name: d.documentType?.name ?? d.documentType?.code ?? "Documento",
      code: d.documentType?.code ?? "",
      status: d.status,
      notes: d.notes ?? "",
      createdAt: d.createdAt,
      updatedAt: d.updatedAt ?? d.createdAt,

      // ✅ Para el front
      viewUrl: `/api/document-reviews/${d.id}/view`,
      downloadUrl: `/api/document-reviews/${d.id}/download`,
    }));

    return res.json(files);
  } catch (error) {
    console.error("Error getDocumentGroupFiles:", error);
    return res.status(500).json({
      error: "Error al cargar archivos del grupo",
      detail: error.message,
    });
  }
}

// ------------------ Approve / Reject ------------------
export async function approveDocument(req, res) {
  try {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });
    const { documentId } = req.params;
    const userId = req.user.id;

    const document = await prisma.providerDocument.findUnique({
      where: { id: parseInt(documentId) },
      include: {
        provider: {
          select: {
            id: true,
            businessName: true,
            emailContacto: true,
            personType: true,
          },
        },
        documentType: { select: { name: true, code: true } },
      },
    });

    if (!document) return res.status(404).json({ error: "Documento no encontrado" });
    if (document.status === "APPROVED") {
      return res.status(400).json({ error: "El documento ya está aprobado" });
    }

    const updatedDocument = await prisma.$transaction(async (tx) => {
      const doc = await tx.providerDocument.update({
        where: { id: parseInt(documentId) },
        data: { status: "APPROVED", reviewedById: userId, notes: null },
        include: { documentType: true, provider: true },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: "APPROVE_DOCUMENT",
          entity: "ProviderDocument",
          entityId: doc.id,
          meta: {
            providerId: doc.providerId,
            documentType: doc.documentType.name,
            providerName: doc.provider.businessName,
          },
        },
      });

      if (doc.provider.personType) {
        const requiredDocs = await tx.documentType.findMany({
          where: { isRequired: true, requiredFor: { has: doc.provider.personType } },
        });

        const approvedDocs = await tx.providerDocument.count({
          where: { providerId: doc.providerId, status: "APPROVED" },
        });

        if (requiredDocs.length > 0 && approvedDocs >= requiredDocs.length) {
          await tx.provider.update({
            where: { id: doc.providerId },
            data: { isApproved: true },
          });
        }
      }

      return doc;
    });

    await logAudit(req, {
      actorId: userId,
      action: "DOC_REVIEW_APPROVE",
      entity: "ProviderDocument",
      entityId: updatedDocument.id,
      meta: {
        providerId: updatedDocument.providerId,
        documentType: updatedDocument.documentType?.name,
      },
    });

    try {
      if (updatedDocument.provider.emailContacto) {
        const providerUser = await prisma.user.findUnique({
          where: { email: updatedDocument.provider.emailContacto },
        });

        if (providerUser) {
          await createNotification({
            userId: providerUser.id,
            type: "DOC_APPROVED",
            entityType: "DOCUMENT",
            entityId: parseInt(documentId),
            title: "Documento Aprobado",
            message: `Tu documento ${updatedDocument.documentType.name} ha sido aprobado.`,
            data: {
              documentType: updatedDocument.documentType.name,
              documentCode: updatedDocument.documentType.code,
            },
            sendEmail: false,
          }).catch(() => {});
        }

        if (String(process.env.MAILER_DISABLED || "false") !== "true") {
          await sendDocumentApprovedEmail(
            updatedDocument.provider.emailContacto,
            updatedDocument.documentType.name,
            updatedDocument.provider.businessName,
          ).catch(() => {});
        }
      }
    } catch (e) {
      console.error("Error notificando aprobación de documento:", e);
    }

    return res.json({
      message: "Documento aprobado correctamente",
      document: updatedDocument,
    });
  } catch (error) {
    console.error("Error approveDocument:", error);
    return res
      .status(500)
      .json({ error: "Error al aprobar documento", detail: error.message });
  }
}

export async function rejectDocument(req, res) {
  try {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });
    const { documentId } = req.params;
    const { reason } = req.body;
    const userId = req.user.id;

    if (!reason || reason.trim().length < 3) {
      return res.status(400).json({ error: "Motivo inválido (mínimo 3 caracteres)" });
    }

    const document = await prisma.providerDocument.findUnique({
      where: { id: parseInt(documentId) },
      include: {
        provider: { select: { id: true, businessName: true, emailContacto: true } },
        documentType: { select: { name: true, code: true } },
      },
    });

    if (!document) return res.status(404).json({ error: "Documento no encontrado" });
    if (document.status === "REJECTED") {
      return res.status(400).json({ error: "Ya está rechazado" });
    }

    const updatedDocument = await prisma.$transaction(async (tx) => {
      const doc = await tx.providerDocument.update({
        where: { id: parseInt(documentId) },
        data: { status: "REJECTED", reviewedById: userId, notes: reason.trim() },
        include: { documentType: true, provider: true },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: "REJECT_DOCUMENT",
          entity: "ProviderDocument",
          entityId: doc.id,
          meta: {
            providerId: doc.providerId,
            providerName: doc.provider.businessName,
            documentType: doc.documentType.name,
            reason: reason.trim(),
          },
        },
      });

      await tx.provider.update({
        where: { id: doc.providerId },
        data: { isApproved: false },
      });

      return doc;
    });

    await logAudit(req, {
      actorId: userId,
      action: "DOC_REVIEW_REJECT",
      entity: "ProviderDocument",
      entityId: updatedDocument.id,
      meta: {
        providerId: updatedDocument.providerId,
        documentType: updatedDocument.documentType?.name,
        reason: reason.trim(),
      },
    });

    try {
      if (updatedDocument.provider.emailContacto) {
        const providerUser = await prisma.user.findUnique({
          where: { email: updatedDocument.provider.emailContacto },
        });

        if (providerUser) {
          await createNotification({
            userId: providerUser.id,
            type: "DOC_REJECTED",
            entityType: "DOCUMENT",
            entityId: parseInt(documentId),
            title: "Documento Rechazado",
            message: `Tu documento ${updatedDocument.documentType.name} ha sido rechazado. Motivo: ${reason.trim()}`,
            data: {
              documentType: updatedDocument.documentType.name,
              documentCode: updatedDocument.documentType.code,
              reason: reason.trim(),
            },
            sendEmail: false,
          }).catch(() => {});
        }

        if (String(process.env.MAILER_DISABLED || "false") !== "true") {
          await sendDocumentRejectedEmail(
            updatedDocument.provider.emailContacto,
            updatedDocument.documentType.name,
            reason.trim(),
          ).catch(() => {});
        }
      }
    } catch (e) {
      console.error("Error notificando rechazo de documento:", e);
    }

    return res.json({
      message: "Documento rechazado correctamente",
      document: updatedDocument,
    });
  } catch (error) {
    console.error("Error rejectDocument:", error);
    return res
      .status(500)
      .json({ error: "Error al rechazar documento", detail: error.message });
  }
}

// ------------------ View / Download ------------------

// ✅ VER (inline)
export async function viewDocument(req, res) {
  try {
    const { documentId } = req.params;

    const document = await prisma.providerDocument.findUnique({
      where: { id: parseInt(documentId) },
      include: { provider: true, documentType: true },
    });

    if (!document) return res.status(404).json({ error: "Documento no encontrado" });

    const url = await resolveDocumentUrl(document);
    if (!url) return res.status(404).json({ error: "Archivo no encontrado" });

    await logAudit(req, {
      actorId: req.user?.id ?? null,
      action: "DOC_VIEW",
      entity: "ProviderDocument",
      entityId: document.id,
      meta: { providerId: document.providerId, documentType: document.documentType?.name },
    });

    return res.redirect(url);
  } catch (e) {
    console.error("Error viewDocument:", e);
    return res.status(500).json({ error: "Error al abrir documento", detail: e.message });
  }
}

// ✅ DESCARGAR (attachment) — AQUI está el fix del 500
export async function downloadDocument(req, res) {
  try {
    const { documentId } = req.params;

    const document = await prisma.providerDocument.findUnique({
      where: { id: parseInt(documentId) },
      include: { provider: true, documentType: true },
    });

    if (!document) return res.status(404).json({ error: "Documento no encontrado" });

    const url = await resolveDocumentUrl(document);
    if (!url) return res.status(404).json({ error: "Archivo no encontrado" });

    await logAudit(req, {
      actorId: req.user?.id ?? null,
      action: "DOC_DOWNLOAD",
      entity: "ProviderDocument",
      entityId: document.id,
      meta: { providerId: document.providerId, documentType: document.documentType?.name },
    });

    const r = await fetch(url);
    if (!r.ok) {
      return res.status(502).json({ error: "No se pudo descargar desde storage" });
    }

    const contentType = r.headers.get("content-type") || "application/pdf";
    const baseName = `${document.provider?.businessName || "proveedor"}_${document.documentType?.code || "DOC"}`;
    const filename = safeFileName(baseName) + ".pdf";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    // ✅ node-fetch => r.body es Node Readable => pipe directo
    if (!r.body || typeof r.body.pipe !== "function") {
      return res.status(500).json({ error: "No se pudo streamear el archivo" });
    }

    return r.body.pipe(res);
  } catch (e) {
    console.error("Error downloadDocument:", e);
    return res.status(500).json({ error: "Error al descargar documento", detail: e.message });
  }
}

// ------------------ Groups Approve / Reject ------------------
export async function approveDocumentGroup(req, res) {
  try {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });

    const { groupId } = req.params;
    const { comment } = req.body || {};
    const userId = req.user.id;

    const [providerIdStr, groupKey] = String(groupId).split("|");
    const providerId = Number(providerIdStr);

    if (!providerId || !groupKey) {
      return res.status(400).json({ error: "groupId inválido" });
    }

    const docs = await prisma.providerDocument.findMany({
      where: { providerId },
      include: { documentType: { select: { code: true, name: true } }, provider: true },
    });

    const target = docs.filter((d) => groupFromDocType(d.documentType).groupKey === groupKey);
    const ids = target.map((d) => d.id);

    if (!ids.length) return res.status(404).json({ error: "Grupo sin documentos" });

    await prisma.$transaction(async (tx) => {
      await tx.providerDocument.updateMany({
        where: { id: { in: ids } },
        data: { status: "APPROVED", reviewedById: userId, notes: null },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: "APPROVE_DOCUMENT_GROUP",
          entity: "ProviderDocumentGroup",
          entityId: 0,
          meta: { providerId, groupKey, documents: ids, comment: comment || "" },
        },
      });
    });

    return res.json({ message: "Grupo aprobado", providerId, groupKey, updated: ids.length });
  } catch (error) {
    console.error("Error approveDocumentGroup:", error);
    return res.status(500).json({ error: "Error al aprobar grupo", detail: error.message });
  }
}

export async function rejectDocumentGroup(req, res) {
  try {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });

    const { groupId } = req.params;
    const { reason } = req.body || {};
    const userId = req.user.id;

    if (!reason || reason.trim().length < 3) {
      return res.status(400).json({ error: "Motivo inválido (mínimo 3 caracteres)" });
    }

    const [providerIdStr, groupKey] = String(groupId).split("|");
    const providerId = Number(providerIdStr);

    if (!providerId || !groupKey) {
      return res.status(400).json({ error: "groupId inválido" });
    }

    const docs = await prisma.providerDocument.findMany({
      where: { providerId },
      include: { documentType: { select: { code: true, name: true } }, provider: true },
    });

    const target = docs.filter((d) => groupFromDocType(d.documentType).groupKey === groupKey);
    const ids = target.map((d) => d.id);

    if (!ids.length) return res.status(404).json({ error: "Grupo sin documentos" });

    await prisma.$transaction(async (tx) => {
      await tx.providerDocument.updateMany({
        where: { id: { in: ids } },
        data: { status: "REJECTED", reviewedById: userId, notes: reason.trim() },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: "REJECT_DOCUMENT_GROUP",
          entity: "ProviderDocumentGroup",
          entityId: 0,
          meta: { providerId, groupKey, documents: ids, reason: reason.trim() },
        },
      });

      await tx.provider.update({
        where: { id: providerId },
        data: { isApproved: false },
      });
    });

    return res.json({ message: "Grupo rechazado", providerId, groupKey, updated: ids.length });
  } catch (error) {
    console.error("Error rejectDocumentGroup:", error);
    return res.status(500).json({ error: "Error al rechazar grupo", detail: error.message });
  }
}
