// src/controllers/documentReview.controller.js
import { prisma } from '../config/prisma.js';
import path from 'path';
import { sendDocumentApprovedEmail, sendDocumentRejectedEmail } from '../utils/email.js';
import { logAudit } from "../utils/audit.js";

export async function getPendingDocuments(req, res) {
  try {
    const { status, search } = req.query;
    const where = {};

    if (status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
      where.status = status;
    }

    if (search) {
      where.provider = {
        is: {
          OR: [
            { businessName: { contains: search, mode: 'insensitive' } },
            { rfc: { contains: search, mode: 'insensitive' } }
          ]
        }
      };
    }

    console.log('getPendingDocuments where:', JSON.stringify(where));

    const documents = await prisma.providerDocument.findMany({
      where,
      include: {
        provider: {
          select: {
            id: true,
            businessName: true,
            rfc: true,
            emailContacto: true,
            personType: true
          }
        },
        documentType: {
          select: { id: true, code: true, name: true, description: true }
        },
        uploadedBy: { select: { id: true, fullName: true, email: true } },
        reviewedBy: { select: { id: true, fullName: true, email: true } }
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }]
    });

    res.json(documents);
  } catch (error) {
    console.error('Error getPendingDocuments:', error);
    res.status(500).json({ error: 'Error al cargar documentos', detail: error.message });
  }
}

export async function approveDocument(req, res) {
  try {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    const { documentId } = req.params;
    const userId = req.user.id;

    const document = await prisma.providerDocument.findUnique({
      where: { id: parseInt(documentId) },
      include: {
        provider: { select: { id: true, businessName: true, emailContacto: true, personType: true } },
        documentType: { select: { name: true, code: true } }
      }
    });

    if (!document) return res.status(404).json({ error: 'Documento no encontrado' });
    if (document.status === 'APPROVED') return res.status(400).json({ error: 'El documento ya está aprobado' });

    const updatedDocument = await prisma.$transaction(async (tx) => {
      const doc = await tx.providerDocument.update({
        where: { id: parseInt(documentId) },
        data: { status: 'APPROVED', reviewedById: userId, notes: null },
        include: { documentType: true, provider: true }
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'APPROVE_DOCUMENT',
          entity: 'ProviderDocument',
          entityId: doc.id,
          meta: {
            providerId: doc.providerId,
            documentType: doc.documentType.name,
            providerName: doc.provider.businessName
          }
        }
      });

      if (doc.provider.personType) {
        const requiredDocs = await tx.documentType.findMany({
          where: {
            isRequired: true,
            requiredFor: { has: doc.provider.personType }
          }
        });

        const approvedDocs = await tx.providerDocument.count({
          where: { providerId: doc.providerId, status: 'APPROVED' }
        });

        if (requiredDocs.length > 0 && approvedDocs >= requiredDocs.length) {
          await tx.provider.update({
            where: { id: doc.providerId },
            data: { isApproved: true }
          });
        }
      }

      return doc;
    });

    // ✅ AUDIT extra con ip/ua
    await logAudit(req, {
      actorId: userId,
      action: "DOC_REVIEW_APPROVE",
      entity: "ProviderDocument",
      entityId: updatedDocument.id,
      meta: {
        providerId: updatedDocument.providerId,
        documentType: updatedDocument.documentType?.name,
        providerName: updatedDocument.provider?.businessName
      }
    });

    // Crear notificación y enviar email
    try {
      if (updatedDocument.provider.emailContacto) {
        const providerUser = await prisma.user.findUnique({
          where: { email: updatedDocument.provider.emailContacto }
        });

        if (providerUser) {
          await prisma.notification.create({
            data: {
              userId: providerUser.id,
              type: 'DOC_APPROVED',
              entityType: 'DOCUMENT',
              entityId: parseInt(documentId),
              title: 'Documento Aprobado',
              message: `Tu documento ${updatedDocument.documentType.name} ha sido aprobado.`,
              data: { documentType: updatedDocument.documentType.name, documentCode: updatedDocument.documentType.code }
            }
          }).catch(() => {});
        }

        if (String(process.env.MAILER_DISABLED || 'false') !== 'true') {
          await sendDocumentApprovedEmail(updatedDocument.provider.emailContacto, updatedDocument.documentType.name, updatedDocument.provider.businessName).catch((e) => console.error('Email error:', e.message));
        } else {
          console.log(`[DEV] Documento aprobado para ${updatedDocument.provider.emailContacto}: ${updatedDocument.documentType.name}`);
        }
      }
    } catch (e) {
      console.error('Error notificando aprobación de documento:', e);
    }

    res.json({ message: 'Documento aprobado correctamente', document: updatedDocument });
  } catch (error) {
    console.error('Error approveDocument:', error);
    res.status(500).json({ error: 'Error al aprobar documento', detail: error.message });
  }
}

export async function rejectDocument(req, res) {
  try {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    const { documentId } = req.params;
    const { reason } = req.body;
    const userId = req.user.id;

    if (!reason || reason.trim().length < 3) {
      return res.status(400).json({ error: 'Motivo inválido (mínimo 3 caracteres)' });
    }

    const document = await prisma.providerDocument.findUnique({
      where: { id: parseInt(documentId) },
      include: {
        provider: { select: { id: true, businessName: true } },
        documentType: { select: { name: true, code: true } }
      }
    });

    if (!document) return res.status(404).json({ error: 'Documento no encontrado' });
    if (document.status === 'REJECTED') return res.status(400).json({ error: 'Ya está rechazado' });

    const updatedDocument = await prisma.$transaction(async (tx) => {
      const doc = await tx.providerDocument.update({
        where: { id: parseInt(documentId) },
        data: { status: 'REJECTED', reviewedById: userId, notes: reason.trim() },
        include: { documentType: true, provider: true }
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'REJECT_DOCUMENT',
          entity: 'ProviderDocument',
          entityId: doc.id,
          meta: {
            providerId: doc.providerId,
            providerName: doc.provider.businessName,
            documentType: doc.documentType.name,
            reason: reason.trim()
          }
        }
      });

      await tx.provider.update({
        where: { id: doc.providerId },
        data: { isApproved: false }
      });

      return doc;
    });

    // ✅ AUDIT extra con ip/ua
    await logAudit(req, {
      actorId: userId,
      action: "DOC_REVIEW_REJECT",
      entity: "ProviderDocument",
      entityId: updatedDocument.id,
      meta: {
        providerId: updatedDocument.providerId,
        documentType: updatedDocument.documentType?.name,
        providerName: updatedDocument.provider?.businessName,
        reason: reason.trim()
      }
    });

    // Crear notificación y enviar email
    try {
      if (updatedDocument.provider.emailContacto) {
        const providerUser = await prisma.user.findUnique({
          where: { email: updatedDocument.provider.emailContacto }
        });

        if (providerUser) {
          await prisma.notification.create({
            data: {
              userId: providerUser.id,
              type: 'DOC_REJECTED',
              entityType: 'DOCUMENT',
              entityId: parseInt(documentId),
              title: 'Documento Rechazado',
              message: `Tu documento ${updatedDocument.documentType.name} ha sido rechazado. Motivo: ${reason.trim()}`,
              data: { documentType: updatedDocument.documentType.name, documentCode: updatedDocument.documentType.code, reason: reason.trim() }
            }
          }).catch(() => {});
        }

        if (String(process.env.MAILER_DISABLED || 'false') !== 'true') {
          await sendDocumentRejectedEmail(updatedDocument.provider.emailContacto, updatedDocument.documentType.name, reason.trim()).catch((e) => console.error('Email error:', e.message));
        } else {
          console.log(`[DEV] Documento rechazado para ${updatedDocument.provider.emailContacto}: ${updatedDocument.documentType.name}. Motivo: ${reason.trim()}`);
        }
      }
    } catch (e) {
      console.error('Error notificando rechazo de documento:', e);
    }

    res.json({ message: 'Documento rechazado correctamente', document: updatedDocument });
  } catch (error) {
    console.error('Error rejectDocument:', error);
    res.status(500).json({ error: 'Error al rechazar documento', detail: error.message });
  }
}

export async function downloadDocument(req, res) {
  try {
    const { documentId } = req.params;

    const document = await prisma.providerDocument.findUnique({
      where: { id: parseInt(documentId) },
      include: { provider: true, documentType: true }
    });

    if (!document) return res.status(404).json({ error: 'Documento no encontrado' });
    if (!document.storageKey) return res.status(404).json({ error: 'Archivo no encontrado' });

    // ✅ AUDIT download
    await logAudit(req, {
      actorId: req.user?.id ?? null,
      action: "DOC_DOWNLOAD",
      entity: "ProviderDocument",
      entityId: document.id,
      meta: { providerId: document.providerId, documentType: document.documentType?.name }
    });

    if (document.fileUrl && document.fileUrl.includes('supabase')) {
      return res.redirect(document.fileUrl);
    }

    const filepath = path.join(process.cwd(), 'uploads', 'provider-documents', document.providerId.toString(), document.storageKey);
    const fs = await import('fs/promises');
    try { await fs.access(filepath); }
    catch { return res.status(404).json({ error: 'Archivo físico no existe' }); }

    const downloadName = `${document.provider.businessName.replace(/\s+/g, '_')}_${document.documentType.code}.pdf`;
    res.download(filepath, downloadName, (err) => {
      if (err && !res.headersSent) {
        console.error('Error download:', err);
        res.status(500).json({ error: 'Error al descargar archivo' });
      }
    });
  } catch (error) {
    console.error('Error downloadDocument:', error);
    res.status(500).json({ error: 'Error al descargar documento', detail: error.message });
  }
}

export async function getDocumentStats(req, res) {
  try {
    const [pending, approved, rejected, total] = await Promise.all([
      prisma.providerDocument.count({ where: { status: 'PENDING' } }),
      prisma.providerDocument.count({ where: { status: 'APPROVED' } }),
      prisma.providerDocument.count({ where: { status: 'REJECTED' } }),
      prisma.providerDocument.count()
    ]);
    res.json({ pending, approved, rejected, total });
  } catch (error) {
    console.error('Error getDocumentStats:', error);
    res.status(500).json({ error: 'Error al cargar estadísticas', detail: error.message });
  }
}
