// src/controllers/digitalFiles.controller.js
import { prisma } from "../config/prisma.js";
import { getSignedUrl } from "../config/supabase.js";

function safeFileName(s = "") {
  return String(s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\w\-\.]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// =======================
// LISTADOS
// =======================
export async function getProviders(req, res) {
  try {
    const { search, status, personType } = req.query;
    const where = {};

    if (status === "Activo") where.isActive = true;
    else if (status === "Inactivo") where.isActive = false;

    if (personType && ["FISICA", "MORAL"].includes(personType)) {
      where.personType = personType;
    }

    if (search) {
      where.OR = [
        { businessName: { contains: search, mode: "insensitive" } },
        { emailContacto: { contains: search, mode: "insensitive" } },
        { rfc: { contains: search, mode: "insensitive" } },
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
            documentType: { select: { name: true, code: true } },
          },
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
            invoiceXmlStorageKey: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(providers);
  } catch (error) {
    console.error("Error getProviders:", error);
    res
      .status(500)
      .json({ error: "Error al cargar proveedores", detail: error.message });
  }
}

export async function getProviderDocuments(req, res) {
  try {
    const { providerId } = req.params;
    const { status } = req.query;

    const where = { providerId: parseInt(providerId) };
    if (status && ["PENDING", "APPROVED", "REJECTED"].includes(status)) {
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

    res.json(documents);
  } catch (error) {
    console.error("Error getProviderDocuments:", error);
    res
      .status(500)
      .json({ error: "Error al cargar documentos", detail: error.message });
  }
}

export async function getProviderPurchaseOrders(req, res) {
  try {
    const { providerId } = req.params;

    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: { providerId: parseInt(providerId) },
      include: {
        provider: { select: { id: true, businessName: true, rfc: true } },
        createdBy: { select: { id: true, fullName: true, email: true } },
        approvedBy: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(purchaseOrders);
  } catch (error) {
    console.error("Error getProviderPurchaseOrders:", error);
    res.status(500).json({
      error: "Error al cargar órdenes de compra",
      detail: error.message,
    });
  }
}

// =======================
// HELPERS DE ARCHIVOS
// =======================
async function resolvePurchaseOrderFile(order) {
  if (order.storageKey) {
    const signed = await getSignedUrl(
      "purchase-orders",
      order.storageKey,
      60 * 10,
    );
    return signed;
  }

  if (order.pdfUrl && order.pdfUrl.includes("supabase")) return order.pdfUrl;
  return null;
}

async function resolveInvoicePdfFile(order) {
  if (order.invoiceStorageKey) {
    const signed = await getSignedUrl(
      "invoices",
      order.invoiceStorageKey,
      60 * 10,
    );
    return signed;
  }

  if (order.invoicePdfUrl && order.invoicePdfUrl.includes("supabase"))
    return order.invoicePdfUrl;
  return null;
}

async function resolveInvoiceXmlFile(order) {
  if (order.invoiceXmlStorageKey) {
    const signed = await getSignedUrl(
      "invoices",
      order.invoiceXmlStorageKey,
      60 * 10,
    );
    return signed;
  }

  if (order.invoiceXmlUrl && order.invoiceXmlUrl.includes("supabase"))
    return order.invoiceXmlUrl;
  return null;
}

async function fetchStorageFile(url) {
  const r = await fetch(url);

  if (!r.ok) {
    throw new Error(`Storage responded ${r.status}`);
  }

  const arrayBuffer = await r.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return {
    buffer,
    storageContentType:
      r.headers.get("content-type") || "application/octet-stream",
  };
}

async function sendInlineFile(res, url, { filename, forcedContentType }) {
  const { buffer } = await fetchStorageFile(url);

  res.setHeader(
    "Content-Type",
    forcedContentType || "application/octet-stream",
  );
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${filename || "archivo"}"`,
  );
  res.setHeader("Content-Length", buffer.length);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  return res.status(200).send(buffer);
}

async function sendAttachmentFile(res, url, { filename, fallbackContentType }) {
  const { buffer, storageContentType } = await fetchStorageFile(url);

  res.setHeader(
    "Content-Type",
    storageContentType || fallbackContentType || "application/octet-stream",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename || "archivo"}"`,
  );
  res.setHeader("Content-Length", buffer.length);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  return res.status(200).send(buffer);
}

// =======================
// VIEW endpoints
// =======================
export async function viewPurchaseOrder(req, res) {
  try {
    const { orderId } = req.params;

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: parseInt(orderId) },
      include: { provider: true },
    });

    if (!order) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    const url = await resolvePurchaseOrderFile(order);
    if (!url) {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }

    const filename = `OC_${order.number || order.id}_${safeFileName(order.provider?.businessName || "Proveedor")}.pdf`;

    return await sendInlineFile(res, url, {
      filename,
      forcedContentType: "application/pdf",
    });
  } catch (error) {
    console.error("Error viewPurchaseOrder:", error);
    return res.status(500).json({
      error: "Error al visualizar orden",
      detail: error.message,
    });
  }
}

export async function viewInvoice(req, res) {
  try {
    const { orderId } = req.params;

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: parseInt(orderId) },
      include: { provider: true },
    });

    if (!order) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    const url = await resolveInvoicePdfFile(order);
    if (!url) {
      return res.status(404).json({ error: "Factura no encontrada" });
    }

    const filename = `FAC_${order.number || order.id}_${safeFileName(order.provider?.businessName || "Proveedor")}.pdf`;

    return await sendInlineFile(res, url, {
      filename,
      forcedContentType: "application/pdf",
    });
  } catch (error) {
    console.error("Error viewInvoice:", error);
    return res.status(500).json({
      error: "Error al visualizar factura",
      detail: error.message,
    });
  }
}

export async function viewInvoiceXml(req, res) {
  try {
    const { orderId } = req.params;

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: parseInt(orderId) },
      include: { provider: true },
    });

    if (!order) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    const url = await resolveInvoiceXmlFile(order);
    if (!url) {
      return res.status(404).json({ error: "XML no encontrado" });
    }

    const filename = `FAC_${order.number || order.id}_${safeFileName(order.provider?.businessName || "Proveedor")}.xml`;

    return await sendInlineFile(res, url, {
      filename,
      forcedContentType: "application/xml; charset=utf-8",
    });
  } catch (error) {
    console.error("Error viewInvoiceXml:", error);
    return res.status(500).json({
      error: "Error al visualizar XML",
      detail: error.message,
    });
  }
}

// =======================
// DOWNLOAD endpoints
// =======================
export async function downloadPurchaseOrder(req, res) {
  try {
    const { orderId } = req.params;

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: parseInt(orderId) },
      include: { provider: true },
    });

    if (!order) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    const url = await resolvePurchaseOrderFile(order);
    if (!url) {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }

    const filename = `OC_${order.number || order.id}_${safeFileName(order.provider?.businessName || "Proveedor")}.pdf`;

    return await sendAttachmentFile(res, url, {
      filename,
      fallbackContentType: "application/pdf",
    });
  } catch (error) {
    console.error("Error downloadPurchaseOrder:", error);
    return res.status(500).json({
      error: "Error al descargar orden",
      detail: error.message,
    });
  }
}

export async function downloadInvoice(req, res) {
  try {
    const { orderId } = req.params;

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: parseInt(orderId) },
      include: { provider: true },
    });

    if (!order) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    const url = await resolveInvoicePdfFile(order);
    if (!url) {
      return res.status(404).json({ error: "Factura no encontrada" });
    }

    const filename = `FAC_${order.number || order.id}_${safeFileName(order.provider?.businessName || "Proveedor")}.pdf`;

    return await sendAttachmentFile(res, url, {
      filename,
      fallbackContentType: "application/pdf",
    });
  } catch (error) {
    console.error("Error downloadInvoice:", error);
    return res.status(500).json({
      error: "Error al descargar factura",
      detail: error.message,
    });
  }
}

export async function downloadInvoiceXml(req, res) {
  try {
    const { orderId } = req.params;

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: parseInt(orderId) },
      include: { provider: true },
    });

    if (!order) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    const url = await resolveInvoiceXmlFile(order);
    if (!url) {
      return res.status(404).json({ error: "XML no encontrado" });
    }

    const filename = `FAC_${order.number || order.id}_${safeFileName(order.provider?.businessName || "Proveedor")}.xml`;

    return await sendAttachmentFile(res, url, {
      filename,
      fallbackContentType: "application/xml; charset=utf-8",
    });
  } catch (error) {
    console.error("Error downloadInvoiceXml:", error);
    return res.status(500).json({
      error: "Error al descargar XML",
      detail: error.message,
    });
  }
}

// =======================
// RAW XML endpoint
// =======================
export async function rawInvoiceXml(req, res) {
  try {
    const { orderId } = req.params;

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: parseInt(orderId) },
      include: { provider: true },
    });

    if (!order) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    const url = await resolveInvoiceXmlFile(order);
    if (!url) {
      return res.status(404).json({ error: "XML no encontrado" });
    }

    const r = await fetch(url);
    if (!r.ok) {
      return res.status(502).json({
        error: "No se pudo obtener XML desde almacenamiento",
        detail: `Storage responded ${r.status}`,
      });
    }

    const xmlText = await r.text();

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).send(xmlText);
  } catch (error) {
    console.error("Error rawInvoiceXml:", error);
    return res.status(500).json({
      error: "Error al obtener XML (raw)",
      detail: error.message,
    });
  }
}
