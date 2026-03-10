// src/controllers/document.controller.js
import { prisma } from "../config/prisma.js";
import { uploadToSupabase, deleteFromSupabase, getSignedUrl } from "../config/supabase.js";
import { logAudit } from "../utils/audit.js";
import { detectContractSignature } from "../utils/contractSignatureDetector.js";

const DOCS_BUCKET = process.env.PROVIDER_DOCS_BUCKET || "provider-documents";
const SIGNED_URL_EXPIRES = Number(process.env.SIGNED_URL_EXPIRES || 3600);

// límites (ajusta si quieres)
const MAX_DOC_PDF_MB = Number(process.env.MAX_DOC_PDF_MB || 30);
const MAX_DOC_PDF_BYTES = Math.floor(MAX_DOC_PDF_MB * 1024 * 1024);

// Helpers
function safeUpper(s) {
  return String(s || "").trim().toUpperCase();
}
function getExt(name = "") {
  const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}
function isPdfFile(file) {
  const ext = getExt(file?.originalname);
  const mt = String(file?.mimetype || "").toLowerCase();
  return mt === "application/pdf" || ext === "pdf";
}
function assertFileSize(file, maxBytes, label) {
  const sz = Number(file?.size || 0);
  if (!sz) throw new Error(`Archivo inválido (${label})`);
  if (sz > maxBytes) throw new Error(`El archivo ${label} excede el límite (${Math.ceil(maxBytes / (1024 * 1024))}MB)`);
}

/**
 * ✅ StorageKey determinístico y fijo (SOLO PDF)
 * Un documento por tipo: siempre sobrescribe el mismo path.
 * Ej: 123/INE.pdf  |  123/CSF.pdf
 */
function buildDocStorageKey(providerId, docTypeCode) {
  const code = safeUpper(docTypeCode) || "DOC";
  return `${providerId}/${code}.pdf`;
}

async function attachSignedUrlsToDocuments(providerDocuments) {
  const docs = providerDocuments || [];
  const out = [];

  for (const d of docs) {
    let fileUrl = null;
    let canDownload = false;

    if (d?.storageKey) {
      try {
        fileUrl = await getSignedUrl(DOCS_BUCKET, d.storageKey, SIGNED_URL_EXPIRES);
        canDownload = Boolean(fileUrl);
      } catch {
        fileUrl = null;
        canDownload = false;
      }
    }

    out.push({ ...d, fileUrl, canDownload });
  }

  return out;
}

// Obtener tipos de documento según tipo de persona
export async function getDocumentTypes(req, res) {
  try {
    const { personType } = req.query;

    if (!personType || !["FISICA", "MORAL"].includes(personType)) {
      console.error(" Tipo de persona inválido:", personType);
      return res.status(400).json({ error: "Tipo de persona inválido. Debe ser FISICA o MORAL" });
    }

    const documentTypes = await prisma.documentType.findMany({
      where: { requiredFor: { has: personType } },
      orderBy: { name: "asc" },
    });

    return res.json(documentTypes);
  } catch (error) {
    console.error("Error al obtener tipos de documento:", error);
    return res.status(500).json({ error: "Error al cargar tipos de documento" });
  }
}

// Obtener documentos del proveedor autenticado
export async function getMyDocuments(req, res) {
  try {
    const userEmail = req.user.email;

    const provider = await prisma.provider.findFirst({
      where: { emailContacto: userEmail, isActive: true },
      include: {
        documents: {
          include: {
            documentType: true,
            uploadedBy: { select: { fullName: true, email: true } },
            reviewedBy: { select: { fullName: true, email: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!provider) return res.status(404).json({ error: "Proveedor no encontrado" });

    const docsWithUrl = await attachSignedUrlsToDocuments(provider.documents);

    return res.json({
      providerId: provider.id,
      personType: provider.personType,
      documents: docsWithUrl,
    });
  } catch (error) {
    console.error("Error al obtener documentos:", error);
    return res.status(500).json({ error: "Error al cargar documentos" });
  }
}

// Subir documentos del proveedor (SOLO PDF)
export async function uploadDocuments(req, res) {
  try {
    const userEmail = req.user.email;
    const userId = req.user.id;
    const personTypeRaw = req.body?.personType;
    const personType = safeUpper(personTypeRaw);

    if (!personType || !["FISICA", "MORAL"].includes(personType)) {
      return res.status(400).json({
        error: "Tipo de persona inválido. Debe ser FISICA o MORAL",
        received: personTypeRaw ?? null,
      });
    }

    const provider = await prisma.provider.findFirst({
      where: { emailContacto: userEmail, isActive: true },
    });
    if (!provider) return res.status(404).json({ error: "Proveedor no encontrado" });

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No se subieron archivos" });
    }

    // ✅ validar required docs
    const requiredDocTypes = await prisma.documentType.findMany({
      where: { requiredFor: { has: personType }, isRequired: true },
    });

    const uploadedDocTypeCodes = req.files.map((f) => f.fieldname);
    const missingDocs = requiredDocTypes.filter((dt) => !uploadedDocTypeCodes.includes(dt.code));
    if (missingDocs.length > 0) {
      return res.status(400).json({
        error: "Faltan documentos requeridos",
        missing: missingDocs.map((d) => d.name),
      });
    }

    // ✅ validar que TODO sea PDF + tamaño
    // ✅ validación extra solo para CONTRATO: firma visible en última página / zona final
    for (const f of req.files) {
      if (!isPdfFile(f)) {
        return res.status(400).json({
          error: `El documento "${f.fieldname}" debe ser PDF.`,
          detail: { fileName: f.originalname, mimetype: f.mimetype },
        });
      }

      const docTypeCode = safeUpper(f.fieldname);

      // límite normal para todos los documentos
      let maxSize = MAX_DOC_PDF_BYTES;

      // si es contrato, permitir archivos mucho más grandes
      if (docTypeCode === "CONTRATO") {
        maxSize = 30 * 1024 * 1024; // 30MB
      }

      try {
        assertFileSize(f, maxSize, `PDF (${f.fieldname})`);
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }

      if (docTypeCode === "CONTRATO") {
        let signatureResult;

        try {
          signatureResult = await detectContractSignature(f.buffer, {
            scale: 2.2,

            // Ajustado a zona final del contrato
            regionTopRatio: 0.62,
            regionBottomRatio: 0.98,
            regionLeftRatio: 0.30,
            regionRightRatio: 0.98,

            // Umbrales iniciales razonables
            darkPixelThreshold: 175,
            minInkRatio: 0.0030,
            minActiveRows: 8,
            minActiveCols: 25,
            minDarkPixels: 350,
          });
        } catch (e) {
          console.error("Error analizando firma del contrato:", e);

          await logAudit(req, {
            actorId: userId,
            action: "CONTRACT_SIGNATURE_CHECK_ERROR",
            entity: "ProviderDocument",
            entityId: provider.id,
            meta: {
              providerId: provider.id,
              fileName: f.originalname,
              reason: e.message || String(e),
            },
          });

          return res.status(500).json({
            error: "No se pudo analizar la firma del contrato. Intenta nuevamente con un PDF legible.",
          });
        }

        if (!signatureResult?.detected) {
          await logAudit(req, {
            actorId: userId,
            action: "CONTRACT_SIGNATURE_NOT_DETECTED",
            entity: "ProviderDocument",
            entityId: provider.id,
            meta: {
              providerId: provider.id,
              fileName: f.originalname,
              detection: signatureResult,
            },
          });

          return res.status(400).json({
            error: "El contrato no presenta una firma visible en la zona final de la última página.",
            code: "CONTRACT_SIGNATURE_NOT_DETECTED",
            detection: signatureResult,
          });
        }

        await logAudit(req, {
          actorId: userId,
          action: "CONTRACT_SIGNATURE_DETECTED",
          entity: "ProviderDocument",
          entityId: provider.id,
          meta: {
            providerId: provider.id,
            fileName: f.originalname,
            detection: signatureResult,
          },
        });
      }
    }

    // ✅ AUDIT: intento subida
    await logAudit(req, {
      actorId: userId,
      action: "DOC_UPLOAD_START",
      entity: "ProviderDocument",
      entityId: provider.id,
      meta: {
        providerId: provider.id,
        personType,
        files: req.files.map((f) => ({ code: f.fieldname, name: f.originalname, size: f.size })),
      },
    });

    // Subir a Supabase fuera de transacción
    const uploads = []; // { docTypeCode, storageKey, fileName }
    for (const file of req.files) {
      const docTypeCode = file.fieldname;

      // ✅ path fijo: SIEMPRE {providerId}/{docType}.pdf
      const storageKey = buildDocStorageKey(provider.id, docTypeCode);

      try {
        await uploadToSupabase(DOCS_BUCKET, storageKey, file.buffer, {
          contentType: "application/pdf",
          upsert: true,
        });

        uploads.push({ docTypeCode, storageKey, fileName: file.originalname });

      } catch (e) {
        console.error("Error subiendo documento a Supabase (fuera tx) tipo:", docTypeCode, e);

        // best-effort cleanup
        for (const u of uploads) {
          try { await deleteFromSupabase(DOCS_BUCKET, u.storageKey); } catch (er) {
            console.warn("No se pudo eliminar archivo tras fallo:", u.storageKey, er.message || er);
          }
        }

        await logAudit(req, {
          actorId: userId,
          action: "DOC_UPLOAD_STORAGE_FAIL",
          entity: "ProviderDocument",
          entityId: provider.id,
          meta: { providerId: provider.id, personType, reason: e.message || String(e) },
        });

        return res.status(502).json({ error: "Error subiendo documento a storage", detail: e.message || String(e) });
      }
    }

    const savedDocuments = [];
    try {
      await prisma.$transaction(async (tx) => {
        await tx.provider.update({ where: { id: provider.id }, data: { personType } });

        for (const u of uploads) {
          const docType = await tx.documentType.findUnique({ where: { code: u.docTypeCode } });
          if (!docType) throw new Error(`Tipo de documento no encontrado: ${u.docTypeCode}`);

          const existing = await tx.providerDocument.findUnique({
            where: { providerId_documentTypeId: { providerId: provider.id, documentTypeId: docType.id } },
          });

          let document;
          if (existing) {
            // ✅ ya no borramos previo: path fijo + upsert sobrescribe
            document = await tx.providerDocument.update({
              where: { id: existing.id },
              data: {
                fileUrl: null,
                storageKey: u.storageKey,
                status: "PENDING",
                uploadedById: userId,
                reviewedById: null,
                notes: null,
              },
              include: { documentType: true },
            });
          } else {
            document = await tx.providerDocument.create({
              data: {
                providerId: provider.id,
                documentTypeId: docType.id,
                fileUrl: null,
                storageKey: u.storageKey,
                status: "PENDING",
                uploadedById: userId,
              },
              include: { documentType: true },
            });
          }

          savedDocuments.push(document);
        }

        await tx.auditLog.create({
          data: {
            actorId: userId,
            action: "UPLOAD_PROVIDER_DOCUMENTS",
            entity: "ProviderDocument",
            entityId: provider.id,
            meta: {
              personType,
              documentsCount: savedDocuments.length,
              documentTypes: savedDocuments.map((d) => d.documentType.name),
              storageKeys: savedDocuments.map((d) => d.storageKey),
            },
          },
        });
      });
    } catch (e) {
      console.error("Error en transacción al guardar documentos en BD:", e);

      for (const u of uploads) {
        try { await deleteFromSupabase(DOCS_BUCKET, u.storageKey); } catch (er) {
          console.warn("No se pudo eliminar archivo tras fallo transacción:", u.storageKey, er.message || er);
        }
      }

      await logAudit(req, {
        actorId: userId,
        action: "DOC_UPLOAD_DB_FAIL",
        entity: "ProviderDocument",
        entityId: provider.id,
        meta: { providerId: provider.id, personType, reason: e.message || String(e) },
      });

      return res.status(500).json({ error: "Error al guardar documentos en base de datos", detail: e.message || String(e) });
    }

    await logAudit(req, {
      actorId: userId,
      action: "DOC_UPLOAD_SUCCESS",
      entity: "ProviderDocument",
      entityId: provider.id,
      meta: {
        providerId: provider.id,
        personType,
        documentsCount: savedDocuments.length,
        documentIds: savedDocuments.map((d) => d.id),
      },
    });

    const docsWithSigned = await attachSignedUrlsToDocuments(savedDocuments);

    return res.status(201).json({ message: "Documentos subidos correctamente", documents: docsWithSigned });
  } catch (error) {
    console.error("Error al subir documentos:", error);

    await logAudit(req, {
      actorId: req.user?.id ?? null,
      action: "DOC_UPLOAD_FAIL",
      entity: "ProviderDocument",
      entityId: null,
      meta: { reason: error.message || String(error) },
    });

    return res.status(500).json({ error: error.message || "Error al subir documentos" });
  }
}

// Eliminar un documento
export async function deleteDocument(req, res) {
  try {
    const userEmail = req.user.email;
    const userId = req.user.id;
    const { documentId } = req.params;

    const provider = await prisma.provider.findFirst({
      where: { emailContacto: userEmail, isActive: true },
    });
    if (!provider) return res.status(404).json({ error: "Proveedor no encontrado" });

    const document = await prisma.providerDocument.findFirst({
      where: { id: parseInt(documentId), providerId: provider.id },
    });
    if (!document) return res.status(404).json({ error: "Documento no encontrado" });

    if (document.storageKey) {
      try {
        await deleteFromSupabase(DOCS_BUCKET, document.storageKey);
      } catch (e) {
        console.warn("No se pudo eliminar archivo de Supabase:", e.message);
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.providerDocument.delete({ where: { id: document.id } });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: "DELETE_PROVIDER_DOCUMENT",
          entity: "ProviderDocument",
          entityId: document.id,
          meta: { providerId: provider.id, documentTypeId: document.documentTypeId },
        },
      });
    });

    await logAudit(req, {
      actorId: userId,
      action: "DOC_DELETE",
      entity: "ProviderDocument",
      entityId: document.id,
      meta: { providerId: provider.id, documentTypeId: document.documentTypeId },
    });

    return res.json({ message: "Documento eliminado correctamente" });
  } catch (error) {
    console.error("Error al eliminar documento:", error);

    await logAudit(req, {
      actorId: req.user?.id ?? null,
      action: "DOC_DELETE_FAIL",
      entity: "ProviderDocument",
      entityId: parseInt(req.params.documentId) || null,
      meta: { reason: error.message || String(error) },
    });

    return res.status(500).json({ error: "Error al eliminar documento" });
  }
}