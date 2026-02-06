import { prisma } from '../config/prisma.js';

// Obtener todos los proveedores con sus documentos
export async function getProviders(req, res) {
  try {
    const { search, status, personType } = req.query;
    const where = {};

    if (status === 'Activo') where.isActive = true;
    else if (status === 'Inactivo') where.isActive = false;

    if (personType && ['FISICA', 'MORAL'].includes(personType)) {
      where.personType = personType;
    }

    if (search) {
      where.OR = [
        { businessName: { contains: search, mode: 'insensitive' } },
        { emailContacto: { contains: search, mode: 'insensitive' } },
        { rfc: { contains: search, mode: 'insensitive' } }
      ];
    }

    const providers = await prisma.provider.findMany({
      where,
      select: {
        id: true,
        businessName: true,
        emailContacto: true,
        telefono: true,
        rfc: true,
        personType: true,
        isActive: true,
        isApproved: true,
        createdAt: true,
        bankAccounts: {
          select: { bankName: true, clabe: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        documents: {
          select: {
            id: true,
            status: true,
            documentType: { select: { name: true, code: true } }
          }
        },
        purchaseOrders: {
          select: {
            id: true,
            number: true,
            status: true,
            total: true,
            issuedAt: true,
            pdfUrl: true,
            storageKey: true,
            invoicePdfUrl: true,
            invoiceStorageKey: true,
            invoiceXmlUrl: true,
            invoiceXmlStorageKey: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(providers);
  } catch (error) {
    console.error('Error getProviders:', error);
    res.status(500).json({ error: 'Error al cargar proveedores', detail: error.message });
  }
}

// Obtener documentos de un proveedor específico (con datos completos para tabla de documentos)
export async function getProviderDocuments(req, res) {
  try {
    const { providerId } = req.params;
    const { status } = req.query;

    const where = { providerId: parseInt(providerId) };
    if (status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
      where.status = status;
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
    console.error('Error getProviderDocuments:', error);
    res.status(500).json({ error: 'Error al cargar documentos', detail: error.message });
  }
}

// Obtener órdenes de compra de un proveedor
export async function getProviderPurchaseOrders(req, res) {
  try {
    const { providerId } = req.params;

    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: { providerId: parseInt(providerId) },
      include: {
        provider: {
          select: { id: true, businessName: true, rfc: true }
        },
        createdBy: {
          select: { id: true, fullName: true, email: true }
        },
        approvedBy: {
          select: { id: true, fullName: true, email: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(purchaseOrders);
  } catch (error) {
    console.error('Error getProviderPurchaseOrders:', error);
    res.status(500).json({ error: 'Error al cargar órdenes de compra', detail: error.message });
  }
}

// Descargar PDF de orden de compra
export async function downloadPurchaseOrder(req, res) {
  try {
    const { orderId } = req.params;
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: parseInt(orderId) },
      include: { provider: true }
    });

    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

    // Si el archivo está en Supabase, redirigir directamente
    if (order.pdfUrl && order.pdfUrl.includes('supabase')) {
      return res.redirect(order.pdfUrl);
    }

    if (!order.storageKey) return res.status(404).json({ error: 'Archivo no encontrado' });

    // Fallback: archivo local
    const path = await import('path');
    const fs = await import('fs/promises');
    const filepath = path.default.join(process.cwd(), 'uploads', 'purchase-orders', order.storageKey);

    try { await fs.access(filepath); } catch { return res.status(404).json({ error: 'Archivo físico no existe' }); }

    const downloadName = `OC_${order.number}_${order.provider.businessName.replace(/\s+/g, '_')}.pdf`;
    res.download(filepath, downloadName, (err) => {
      if (err && !res.headersSent) {
        console.error('Error download:', err);
        res.status(500).json({ error: 'Error al descargar archivo' });
      }
    });
  } catch (error) {
    console.error('Error downloadPurchaseOrder:', error);
    res.status(500).json({ error: 'Error al descargar orden', detail: error.message });
  }
}

// Descargar PDF de factura asociada a orden de compra
export async function downloadInvoice(req, res) {
  try {
    const { orderId } = req.params;
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: parseInt(orderId) },
      include: { provider: true }
    });

    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

    // Si el archivo está en Supabase, redirigir directamente
    if (order.invoicePdfUrl && order.invoicePdfUrl.includes('supabase')) {
      return res.redirect(order.invoicePdfUrl);
    }

    if (!order.invoiceStorageKey) return res.status(404).json({ error: 'Factura no encontrada' });

    // Fallback: archivo local
    const path = await import('path');
    const fs = await import('fs/promises');
    const filepath = path.default.join(process.cwd(), 'uploads', 'invoices', order.invoiceStorageKey);

    try { await fs.access(filepath); } catch { return res.status(404).json({ error: 'Archivo físico no existe' }); }

    const downloadName = `FAC_${order.number}_${order.provider.businessName.replace(/\s+/g, '_')}.pdf`;
    res.download(filepath, downloadName, (err) => {
      if (err && !res.headersSent) {
        console.error('Error download:', err);
        res.status(500).json({ error: 'Error al descargar archivo' });
      }
    });
  } catch (error) {
    console.error('Error downloadInvoice:', error);
    res.status(500).json({ error: 'Error al descargar factura', detail: error.message });
  }
}

// Descargar XML de factura asociada a orden de compra
export async function downloadInvoiceXml(req, res) {
  try {
    const { orderId } = req.params;
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: parseInt(orderId) },
      include: { provider: true }
    });

    console.log('DEBUG_XML', {
      orderId,
      hasOrder: !!order,
      keys: Object.keys(order || {}),
      invoiceXmlStorageKey: order?.invoiceXmlStorageKey,
    });

    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

    // Si el archivo está en Supabase, redirigir directamente
    if (order.invoiceXmlUrl && order.invoiceXmlUrl.includes('supabase')) {
      return res.redirect(order.invoiceXmlUrl);
    }

    if (!order.invoiceXmlStorageKey) return res.status(404).json({ error: 'XML de factura no encontrado' });

    // Fallback: archivo local
    const path = await import('path');
    const fs = await import('fs/promises');
    const filepath = path.default.join(process.cwd(), 'uploads', 'invoices', order.invoiceXmlStorageKey);

    try { await fs.access(filepath); } catch { return res.status(404).json({ error: 'Archivo físico no existe' }); }

    const downloadName = `FAC_${order.number}_${order.provider.businessName.replace(/\s+/g, '_')}.xml`;
    res.download(filepath, downloadName, (err) => {
      if (err && !res.headersSent) {
        console.error('Error download:', err);
        res.status(500).json({ error: 'Error al descargar archivo' });
      }
    });
  } catch (error) {
    console.error('Error downloadInvoiceXml:', error);
    res.status(500).json({ error: 'Error al descargar XML', detail: error.message });
  }
}