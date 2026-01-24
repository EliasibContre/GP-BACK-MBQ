import { prisma } from '../config/prisma.js';
import { uploadToSupabase, deleteFromSupabase, getPublicUrl } from '../config/supabase.js';
import fs from 'fs/promises';
import path from 'path';

// Obtener tipos de documento según tipo de persona
export async function getDocumentTypes(req, res) {
  try {
    const { personType } = req.query;
    console.log('GET /api/documents/types personType:', personType);


    if (!personType || !['FISICA', 'MORAL'].includes(personType)) {
    console.error(' Tipo de persona inválido:', personType);
      return res.status(400).json({ 
        error: 'Tipo de persona inválido. Debe ser FISICA o MORAL' 
      });
    }

    const documentTypes = await prisma.documentType.findMany({
      where: {
        requiredFor: {
          has: personType
        }
      },
      orderBy: { name: 'asc' }
    });

    console.log('Documentos encontrados:', documentTypes.length);
    res.json(documentTypes);
  } catch (error) {
    console.error('Error al obtener tipos de documento:', error);
    res.status(500).json({ error: 'Error al cargar tipos de documento' });
  }
}

// Obtener documentos del proveedor autenticado
export async function getMyDocuments(req, res) {
  try {
    const userEmail = req.user.email;

    // Buscar proveedor por email
    const provider = await prisma.provider.findFirst({
      where: { 
        emailContacto: userEmail,
        isActive: true 
      },
      include: {
        documents: {
          include: {
            documentType: true,
            uploadedBy: {
              select: {
                fullName: true,
                email: true
              }
            },
            reviewedBy: {
              select: {
                fullName: true,
                email: true
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!provider) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }

    res.json({
      providerId: provider.id,
      personType: provider.personType,
      documents: provider.documents
    });
  } catch (error) {
    console.error('Error al obtener documentos:', error);
    res.status(500).json({ error: 'Error al cargar documentos' });
  }
}

// Subir documentos del proveedor
export async function uploadDocuments(req, res) {
  try {
    const userEmail = req.user.email;
    const userId = req.user.id;
    const { personType } = req.body;

    if (!personType || !['FISICA', 'MORAL'].includes(personType)) {
      return res.status(400).json({ 
        error: 'Tipo de persona inválido. Debe ser FISICA o MORAL' 
      });
    }

    // Buscar proveedor por email
    const provider = await prisma.provider.findFirst({
      where: { 
        emailContacto: userEmail,
        isActive: true 
      }
    });

    if (!provider) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }

    // Verificar que se subieron archivos
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se subieron archivos' });
    }

    // Obtener tipos de documento requeridos
    const requiredDocTypes = await prisma.documentType.findMany({
      where: {
        requiredFor: { has: personType },
        isRequired: true
      }
    });

    // Validar que se subieron todos los documentos requeridos
    const uploadedDocTypeCodes = req.files.map(f => f.fieldname);
    const missingDocs = requiredDocTypes.filter(dt => 
      !uploadedDocTypeCodes.includes(dt.code)
    );

    if (missingDocs.length > 0) {
      return res.status(400).json({ 
        error: 'Faltan documentos requeridos',
        missing: missingDocs.map(d => d.name)
      });
    }

    // Primero: subir todos los archivos a Supabase fuera de la transacción
    const uploads = [];
    for (const file of req.files) {
      const docTypeCode = file.fieldname;
      const timestamp = Date.now();
      const ext = path.extname(file.originalname);
      const filename = `${docTypeCode}_${timestamp}${ext}`;
      const filePath = `${provider.id}/${filename}`;
      const contentType = file.mimetype || 'application/pdf';

      try {
        const upload = await uploadToSupabase('provider-documents', filePath, file.buffer, contentType);
        uploads.push({ file, docTypeCode, fileUrl: upload.url, storageKey: upload.path });
        console.log('Uploaded to Supabase:', { bucket: 'provider-documents', path: filePath, storageKey: upload.path });
      } catch (e) {
        console.error('Error subiendo documento a Supabase (fuera tx) tipo:', docTypeCode, e);
        // Si falla una subida, intentar limpiar las previas
        for (const u of uploads) {
          try { await deleteFromSupabase('provider-documents', u.storageKey); } catch (er) { console.warn('No se pudo eliminar archivo tras fallo:', u.storageKey, er.message || er); }
        }
        return res.status(502).json({ error: 'Error subiendo documento a storage', detail: e.message || String(e) });
      }
    }

    console.log('All uploads completed, proceeding to DB transaction. uploads count:', uploads.length);

    // Ahora ejecutar la transacción para actualizar BD usando los resultados de las subidas
    const savedDocuments = [];
    try {
      await prisma.$transaction(async (tx) => {
        const upd = await tx.provider.update({ where: { id: provider.id }, data: { personType } });
        console.log('Provider personType updated in tx:', { providerId: provider.id, personType, updatedAt: upd.updatedAt });

        for (const u of uploads) {
          const docType = await tx.documentType.findUnique({ where: { code: u.docTypeCode } });
          if (!docType) throw new Error(`Tipo de documento no encontrado: ${u.docTypeCode}`);

          const existing = await tx.providerDocument.findUnique({
            where: { providerId_documentTypeId: { providerId: provider.id, documentTypeId: docType.id } }
          });

          let document;
          if (existing) {
            if (existing.storageKey) {
              try { await deleteFromSupabase('provider-documents', existing.storageKey); } catch (e) { console.warn('No se pudo eliminar archivo antiguo de Supabase:', e.message || e); }
            }

            document = await tx.providerDocument.update({
              where: { id: existing.id },
              data: {
                fileUrl: u.fileUrl,
                storageKey: u.storageKey,
                status: 'PENDING',
                uploadedById: userId,
                reviewedById: null,
                notes: null
              },
              include: { documentType: true }
            });
            console.log('Updated existing providerDocument in tx:', { id: existing.id, documentTypeId: docType.id });
          } else {
            document = await tx.providerDocument.create({
              data: {
                providerId: provider.id,
                documentTypeId: docType.id,
                fileUrl: u.fileUrl,
                storageKey: u.storageKey,
                status: 'PENDING',
                uploadedById: userId
              },
              include: { documentType: true }
            });
            console.log('Created new providerDocument in tx:', { id: document.id, documentTypeId: docType.id });
          }

          savedDocuments.push(document);
        }

        await tx.auditLog.create({
          data: {
            actorId: userId,
            action: 'UPLOAD_PROVIDER_DOCUMENTS',
            entity: 'ProviderDocument',
            entityId: provider.id,
            meta: { personType, documentsCount: savedDocuments.length, documentTypes: savedDocuments.map(d => d.documentType.name) }
          }
        });
      });
    } catch (e) {
      console.error('Error en transacción al guardar documentos en BD:', e);
      // Si la transacción falla, eliminar los archivos ya subidos para evitar orfanatos
      for (const u of uploads) {
        try { await deleteFromSupabase('provider-documents', u.storageKey); } catch (er) { console.warn('No se pudo eliminar archivo tras fallo transacción:', u.storageKey, er.message || er); }
      }
      return res.status(500).json({ error: 'Error al guardar documentos en base de datos', detail: e.message || String(e) });
    }

    res.status(201).json({ message: 'Documentos subidos correctamente', documents: savedDocuments });
  } catch (error) {
    console.error('Error al subir documentos:', error);
    res.status(500).json({ 
      error: error.message || 'Error al subir documentos' 
    });
  }
}

// Eliminar un documento
export async function deleteDocument(req, res) {
  try {
    const userEmail = req.user.email;
    const userId = req.user.id;
    const { documentId } = req.params;

    // Buscar proveedor
    const provider = await prisma.provider.findFirst({
      where: { 
        emailContacto: userEmail,
        isActive: true 
      }
    });

    if (!provider) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }

    // Buscar documento
    const document = await prisma.providerDocument.findFirst({
      where: {
        id: parseInt(documentId),
        providerId: provider.id
      }
    });

    if (!document) {
      return res.status(404).json({ error: 'Documento no encontrado' });
    }

    // Eliminar archivo de Supabase Storage
    if (document.storageKey) {
      try {
        await deleteFromSupabase('provider-documents', document.storageKey);
      } catch (e) {
        console.warn('No se pudo eliminar archivo de Supabase:', e.message);
      }
    }

    // Eliminar registro de BD
    await prisma.$transaction(async (tx) => {
      await tx.providerDocument.delete({
        where: { id: document.id }
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'DELETE_PROVIDER_DOCUMENT',
          entity: 'ProviderDocument',
          entityId: document.id,
          meta: {
            providerId: provider.id,
            documentTypeId: document.documentTypeId
          }
        }
      });
    });

    res.json({ message: 'Documento eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar documento:', error);
    res.status(500).json({ error: 'Error al eliminar documento' });
  }
}