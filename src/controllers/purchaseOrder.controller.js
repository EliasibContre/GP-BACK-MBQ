// src/controllers/purchaseOrder.controller.js
import { prisma } from '../config/prisma.js';
import { sendPurchaseOrderApprovedEmail, sendPurchaseOrderRejectedEmail } from '../utils/email.js';
import { uploadToSupabase, deleteFromSupabase } from '../config/supabase.js';
import path from 'path';

// Crear orden de compra (proveedor) - MULTI FACTURAS
export async function createPurchaseOrder(req, res) {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;
    const { monto, fecha, numeroOrden, rfc, observaciones } = req.body;

    const provider = await prisma.provider.findFirst({
      where: { emailContacto: userEmail, rfc, isActive: true }
    });
    if (!provider) return res.status(404).json({ error: 'Proveedor no encontrado o RFC no coincide' });

    const existingPO = await prisma.purchaseOrder.findUnique({ where: { number: numeroOrden } });
    if (existingPO) return res.status(400).json({ error: 'El número de orden ya existe' });

    // Archivos
    const orderFile = req.files?.archivoOrden?.[0] || null;
    const invoicePdfFiles = req.files?.archivoFacturaPdf || [];
    const invoiceXmlFiles = req.files?.archivoFacturaXml || [];

    if (!orderFile) return res.status(400).json({ error: 'El PDF de la orden es obligatorio' });

    // Debe haber al menos 1 PDF y 1 XML
    if (invoicePdfFiles.length === 0) return res.status(400).json({ error: 'Debe subir al menos un PDF de factura' });
    if (invoiceXmlFiles.length === 0) return res.status(400).json({ error: 'Debe subir al menos un XML de factura' });

    // Deben venir pareados (mismas cantidades)
    if (invoicePdfFiles.length !== invoiceXmlFiles.length) {
      return res.status(400).json({
        error: 'La cantidad de facturas PDF debe ser igual a la cantidad de facturas XML',
        pdfCount: invoicePdfFiles.length,
        xmlCount: invoiceXmlFiles.length
      });
    }

    const ts = Date.now();

    // Vamos a subir a storage primero, y si algo falla, hacemos rollback
    const uploadedKeys = []; // { bucket, key }
    const uploadedInvoices = []; // { pdfUrl, pdfStorageKey, xmlUrl, xmlStorageKey }

    // 1) Subir Orden de Compra a Supabase Storage (purchase-orders)
    const orderFilename = `PO_${numeroOrden}_${ts}.pdf`;
    const orderPath = `${provider.id}/${orderFilename}`;

    let pdfUrl = null;
    let storageKey = null;

    try {
      const orderUpload = await uploadToSupabase(
        'purchase-orders',
        orderPath,
        orderFile.buffer,
        'application/pdf'
      );
      pdfUrl = orderUpload.url;
      storageKey = orderUpload.path;
      uploadedKeys.push({ bucket: 'purchase-orders', key: orderUpload.path });
    } catch (e) {
      console.error('Error subiendo Orden de Compra a Supabase:', e.message || e);
      return res.status(502).json({ error: 'Error subiendo archivo de orden de compra', detail: e.message || String(e) });
    }

    // 2) Subir N facturas (PDF + XML) a Supabase Storage (invoices)
    try {
      for (let i = 0; i < invoicePdfFiles.length; i++) {
        const pdfF = invoicePdfFiles[i];
        const xmlF = invoiceXmlFiles[i];

        const idx = i + 1;

        const pdfName = `FAC_${numeroOrden}_${ts}_${idx}.pdf`;
        const xmlName = `FAC_${numeroOrden}_${ts}_${idx}.xml`;

        const pdfPath = `${provider.id}/${pdfName}`;
        const xmlPath = `${provider.id}/${xmlName}`;

        const upPdf = await uploadToSupabase('invoices', pdfPath, pdfF.buffer, 'application/pdf');
        uploadedKeys.push({ bucket: 'invoices', key: upPdf.path });

        const upXml = await uploadToSupabase('invoices', xmlPath, xmlF.buffer, 'application/xml');
        uploadedKeys.push({ bucket: 'invoices', key: upXml.path });

        uploadedInvoices.push({
          pdfUrl: upPdf.url,
          pdfStorageKey: upPdf.path,
          xmlUrl: upXml.url,
          xmlStorageKey: upXml.path
        });
      }
    } catch (e) {
      console.error('Error subiendo facturas a Supabase:', e.message || e);

      // Rollback de TODO lo subido (incluida la orden)
      for (const k of uploadedKeys.reverse()) {
        try { await deleteFromSupabase(k.bucket, k.key); } catch (er) {
          console.warn('No se pudo eliminar en rollback:', k.bucket, k.key, er.message || er);
        }
      }

      return res.status(502).json({ error: 'Error subiendo archivos de facturas', detail: e.message || String(e) });
    }

    // Compatibilidad: guardar la primera factura en los campos legacy
    const firstInv = uploadedInvoices[0];
    const invoiceUploadedAt = new Date();

    // 3) Guardar en BD en transacción
    const purchaseOrder = await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.create({
        data: {
          number: numeroOrden,
          providerId: provider.id,
          status: 'DRAFT',
          total:String(monto),
          issuedAt: new Date(fecha),
          obervations: observaciones || null,

          pdfUrl,
          storageKey,

          // legacy (primera factura)
          invoicePdfUrl: firstInv?.pdfUrl || null,
          invoiceStorageKey: firstInv?.pdfStorageKey || null,
          invoiceXmlUrl: firstInv?.xmlUrl || null,
          invoiceXmlStorageKey: firstInv?.xmlStorageKey || null,
          invoiceUploadedAt,

          createdById: userId
        },
        include: {
          provider: { select: { businessName: true, rfc: true } }
        }
      });

      // crear N registros de invoices hijas
      await tx.purchaseOrderInvoice.createMany({
        data: uploadedInvoices.map((inv) => ({
          purchaseOrderId: po.id,
          pdfUrl: inv.pdfUrl,
          pdfStorageKey: inv.pdfStorageKey,
          xmlUrl: inv.xmlUrl,
          xmlStorageKey: inv.xmlStorageKey
        }))
      });

      // Auditoría
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'CREATE_PURCHASE_ORDER',
          entity: 'PurchaseOrder',
          entityId: po.id,
          meta: {
            number: numeroOrden,
            provider: provider.businessName,
            total: monto,
            orderStorageKey: storageKey,
            invoicesCount: uploadedInvoices.length,
            invoices: uploadedInvoices.map((x) => ({
              pdf: x.pdfStorageKey,
              xml: x.xmlStorageKey
            }))
          }
        }
      });

      // devolver PO con poInvoices
      const poFull = await tx.purchaseOrder.findUnique({
        where: { id: po.id },
        include: {
          provider: { select: { businessName: true, rfc: true } },
          poInvoices: true
        }
      });

      return poFull;
    });

    res.status(201).json({
      message: 'Orden de compra registrada correctamente',
      data: purchaseOrder
    });
  } catch (error) {
    console.error('Error al crear orden de compra:', error);
    res.status(500).json({ error: 'Error al registrar la orden de compra' });
  }
}

// Obtener órdenes de compra del proveedor autenticado
export async function getMyPurchaseOrders(req, res) {
  try {
    const userEmail = req.user.email;

    const provider = await prisma.provider.findFirst({
      where: { 
        emailContacto: userEmail,
        isActive: true 
      }
    });

    if (!provider) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }

    const orders = await prisma.purchaseOrder.findMany({
      where: { providerId: provider.id },
      include: {
        provider: {
          select: { businessName: true, rfc: true }
        },
        createdBy: {
          select: { fullName: true, email: true }
        },
        poInvoices: true // ✅ NUEVO
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(orders);
  } catch (error) {
    console.error('Error al obtener órdenes:', error);
    res.status(500).json({ error: 'Error al cargar las órdenes' });
  }
}

// Obtener órdenes pendientes de aprobación (para aprobadores/administradores)
export async function getPendingApprovalPurchaseOrders(req, res) {
  try {
    const { status, limit = 50, cursor } = req.query;
    let statuses = [];
    if (status) {
      statuses = String(status).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    } else {
      statuses = ['DRAFT', 'SENT'];
    }

    const take = Math.min(Number(limit) || 50, 200);
    const query = {
      where: { status: { in: statuses } },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      include: {
        provider: { select: { businessName: true, rfc: true } },
        createdBy: { select: { id: true, fullName: true, email: true } },
        poInvoices: true // ✅ NUEVO
      }
    };
    if (cursor) query.cursor = { id: Number(cursor) };

    const rows = await prisma.purchaseOrder.findMany(query);
    const hasMore = rows.length > take;
    const data = rows.slice(0, take);

    res.json({ data, hasMore, nextCursor: hasMore ? rows[rows.length - 1].id : null });
  } catch (error) {
    console.error('Error al cargar órdenes pendientes de aprobación:', error);
    res.status(500).json({ error: 'Error al cargar órdenes' });
  }
}

// Aprobar una orden de compra
export async function approvePurchaseOrder(req, res) {
  try {
    const id = Number(req.params.id);
    const approverId = req.user?.id;
    const po = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) return res.status(404).json({ error: 'Orden no encontrada' });
    if (!(po.status === 'DRAFT' || po.status === 'SENT')) return res.status(400).json({ error: 'Orden no puede aprobarse en su estado actual' });

    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: approverId, approvedAt: new Date() },
      include: { provider: true, createdBy: true }
    });

    await prisma.auditLog.create({ data: { actorId: approverId, action: 'APPROVE_PURCHASE_ORDER', entity: 'PurchaseOrder', entityId: id } });

    // Crear notificación para el usuario que creó la orden (si existe)
    try {
      const recipientUserId = updated.createdById || (updated.createdBy ? updated.createdBy.id : null);
      if (recipientUserId) {
        await prisma.notification.create({ data: {
          userId: recipientUserId,
          type: 'PO_APPROVED',
          entityType: 'PURCHASE_ORDER',
          entityId: id,
          title: 'Orden Aprobada',
          message: `Tu orden ${updated.number} ha sido aprobada.`,
          data: { number: updated.number, total: updated.total ? String(updated.total) : null }
        }});
      }

      // Enviar correo al contacto del proveedor si existe
      const providerEmail = updated.provider?.emailContacto;
      if (providerEmail && String(process.env.MAILER_DISABLED || 'false') !== 'true') {
        try { await sendPurchaseOrderApprovedEmail(providerEmail, { number: updated.number, total: updated.total ? String(updated.total) : '' }); } catch (e) { console.error('Error enviando email PO aprobado:', e.message); }
      } else if (providerEmail) {
        console.log(`[DEV] PO aprobada para ${providerEmail}: ${updated.number}`);
      }
    } catch (e) {
      console.error('Error notificando/mandando email al aprobar PO:', e);
    }

    res.json({ message: 'Orden aprobada', data: updated });
  } catch (error) {
    console.error('Error aprobando orden:', error);
    res.status(500).json({ error: 'Error al aprobar la orden' });
  }
}

// Rechazar / cancelar una orden de compra
export async function rejectPurchaseOrder(req, res) {
  try {
    const id = Number(req.params.id);
    const approverId = req.user?.id;
    const { reason } = req.body || {};
    if (!reason || String(reason).trim().length < 3) return res.status(400).json({ error: 'Motivo requerido' });

    const po = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) return res.status(404).json({ error: 'Orden no encontrada' });
    if (po.status === 'CANCELLED' || po.status === 'RECEIVED') return res.status(400).json({ error: 'Orden no puede rechazarse en su estado actual' });

    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'CANCELLED', obervations: (po.obervations || '') + '\nRECHAZO: ' + String(reason).trim() },
      include: { provider: true, createdBy: true }
    });

    await prisma.auditLog.create({ data: { actorId: approverId, action: 'REJECT_PURCHASE_ORDER', entity: 'PurchaseOrder', entityId: id, meta: { reason } } });

    // Notificar y enviar correo al proveedor/usuario creador
    try {
      const recipientUserId = updated.createdById || (updated.createdBy ? updated.createdBy.id : null);
      if (recipientUserId) {
        await prisma.notification.create({ data: {
          userId: recipientUserId,
          type: 'PO_REJECTED',
          entityType: 'PURCHASE_ORDER',
          entityId: id,
          title: 'Orden Rechazada',
          message: `Tu orden ${updated.number} ha sido rechazada. Motivo: ${reason}`,
          data: { number: updated.number, reason }
        }});
      }

      const providerEmail = updated.provider?.emailContacto;
      if (providerEmail && String(process.env.MAILER_DISABLED || 'false') !== 'true') {
        try { await sendPurchaseOrderRejectedEmail(providerEmail, { number: updated.number, total: updated.total ? String(updated.total) : '' }, reason); } catch (e) { console.error('Error enviando email PO rechazado:', e.message); }
      } else if (providerEmail) {
        console.log(`[DEV] PO rechazada para ${providerEmail}: ${updated.number} - motivo: ${reason}`);
      }
    } catch (e) {
      console.error('Error notificando/mandando email al rechazar PO:', e);
    }

    res.json({ message: 'Orden rechazada', data: updated });
  } catch (error) {
    console.error('Error rechazando orden:', error);
    res.status(500).json({ error: 'Error al rechazar la orden' });
  }
}

// Marcar como recibida
export async function markReceivedPurchaseOrder(req, res) {
  try {
    const id = Number(req.params.id);
    const userId = req.user?.id;
    const po = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) return res.status(404).json({ error: 'Orden no encontrada' });
    if (po.status !== 'APPROVED' && po.status !== 'SENT') return res.status(400).json({ error: 'Orden no puede marcarse como recibida en su estado actual' });

    const updated = await prisma.purchaseOrder.update({ where: { id }, data: { status: 'RECEIVED', receivedAt: new Date() } });
    await prisma.auditLog.create({ data: { actorId: userId, action: 'MARK_RECEIVED_PURCHASE_ORDER', entity: 'PurchaseOrder', entityId: id } });
    res.json({ message: 'Orden marcada como recibida', data: updated });
  } catch (error) {
    console.error('Error marcando recibida orden:', error);
    res.status(500).json({ error: 'Error al marcar como recibida' });
  }
}

// Listar órdenes con filtros
export async function listPurchaseOrders(req, res) {
  try {
    const { status, providerId, limit = 50, offset = 0 } = req.query;

    const where = {};
    if (status) {
      where.status = status.toUpperCase();
    }
    if (providerId) {
      where.providerId = parseInt(providerId);
    }

    const [purchaseOrders, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: {
          provider: {
            select: {
              id: true,
              businessName: true,
              rfc: true,
              emailContacto: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset)
      }),
      prisma.purchaseOrder.count({ where })
    ]);

    res.json({
      purchaseOrders,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: parseInt(offset) + parseInt(limit) < total
      }
    });
  } catch (error) {
    console.error('Error listando órdenes:', error);
    res.status(500).json({ error: 'Error al listar órdenes', detail: error.message });
  }
}

// Listar únicamente órdenes aprobadas del proveedor en sesión
export async function listApprovedForSessionProvider(req, res) {
  try {
    const roles = (req.user && req.user.roles) || [];
    const isProviderRole = roles.some(r => String(r.name).toUpperCase() === 'PROVIDER');
    if (!isProviderRole) {
      return res.status(403).json({ error: 'Solo disponible para rol PROVIDER' });
    }

    const provider = await prisma.provider.findFirst({
      where: { emailContacto: req.user.email, isActive: true, deletedAt: null },
      select: { id: true }
    });
    if (!provider) {
      return res.json({ purchaseOrders: [] });
    }

    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: { providerId: provider.id, status: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, number: true, total: true, status: true, providerId: true }
    });

    return res.json({ purchaseOrders });
  } catch (error) {
    console.error('Error listApprovedForSessionProvider:', error);
    res.status(500).json({ error: 'Error al listar órdenes aprobadas del proveedor', detail: error.message });
  }
}

// Listar órdenes aprobadas sin pagos registrados (vista admin/aprobador)
export async function listApprovedUnpaidPurchaseOrders(req, res) {
  try {
    const { providerId, limit = 100, offset = 0 } = req.query;
    const where = {
      status: 'APPROVED',
      NOT: { payments: { some: {} } }
    };
    if (providerId) where.providerId = parseInt(providerId);

    const [purchaseOrders, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: {
          provider: { select: { id: true, businessName: true, emailContacto: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset)
      }),
      prisma.purchaseOrder.count({ where })
    ]);

    res.json({
      purchaseOrders,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: parseInt(offset) + parseInt(limit) < total
      }
    });
  } catch (error) {
    console.error('Error listApprovedUnpaidPurchaseOrders:', error);
    res.status(500).json({ error: 'Error al listar órdenes aprobadas sin pago', detail: error.message });
  }
}