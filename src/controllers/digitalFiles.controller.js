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

function withDownloadParam(urlString, filename) {
  const url = new URL(urlString);
  // Supabase Storage acepta ?download=... para forzar Content-Disposition: attachment
  url.searchParams.set("download", filename || "archivo");
  return url.toString();
}

async function redirectSupabaseView(res, url) {
  // “View” = sin download param → el navegador lo abre
  return res.redirect(url);
}

async function redirectSupabaseDownload(res, url, filename) {
  // “Download” = con download param → Chrome baja directo
  return res.redirect(withDownloadParam(url, filename));
}

// =======================
// LISTADOS (igual que tenías)
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
    res.status(500).json({ error: "Error al cargar proveedores", detail: error.message });
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
          select: { id: true, businessName: true, rfc: true, emailContacto: true, personType: true },
        },
        documentType: { select: { id: true, code: true, name: true, description: true } },
        uploadedBy: { select: { id: true, fullName: true, email: true } },
        reviewedBy: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });

    res.json(documents);
  } catch (error) {
    console.error("Error getProviderDocuments:", error);
    res.status(500).json({ error: "Error al cargar documentos", detail: error.message });
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
    res.status(500).json({ error: "Error al cargar órdenes de compra", detail: error.message });
  }
}

// =======================
// VIEW / DOWNLOAD helpers por tipo
// =======================
async function resolvePurchaseOrderFile(order) {
  // Regla: si hay storageKey, firmar desde bucket purchase-orders
  if (order.storageKey) {
    const signed = await getSignedUrl("purchase-orders", order.storageKey, 60 * 10);
    return signed;
  }
  // si no, usar pdfUrl si existe
  if (order.pdfUrl && order.pdfUrl.includes("supabase")) return order.pdfUrl;
  return null;
}

async function resolveInvoicePdfFile(order) {
  if (order.invoiceStorageKey) {
    const signed = await getSignedUrl("invoices", order.invoiceStorageKey, 60 * 10);
    return signed;
  }
  if (order.invoicePdfUrl && order.invoicePdfUrl.includes("supabase")) return order.invoicePdfUrl;
  return null;
}

async function resolveInvoiceXmlFile(order) {
  if (order.invoiceXmlStorageKey) {
    const signed = await getSignedUrl("invoices", order.invoiceXmlStorageKey, 60 * 10);
    return signed;
  }
  if (order.invoiceXmlUrl && order.invoiceXmlUrl.includes("supabase")) return order.invoiceXmlUrl;
  return null;
}

// =======================
// ✅ VIEW endpoints (abre en navegador)
// =======================
export async function viewPurchaseOrder(req, res) {
  try {
    const { orderId } = req.params;
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: parseInt(orderId) },
      include: { provider: true },
    });
    if (!order) return res.status(404).json({ error: "Orden no encontrada" });

    const url = await resolvePurchaseOrderFile(order);
    if (url) return redirectSupabaseView(res, url);

    return res.status(404).json({ error: "Archivo no encontrado" });
  } catch (error) {
    console.error("Error viewPurchaseOrder:", error);
    res.status(500).json({ error: "Error al visualizar orden", detail: error.message });
  }
}

export async function viewInvoice(req, res) {
  try {
    const { orderId } = req.params;
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: parseInt(orderId) },
      include: { provider: true },
    });
    if (!order) return res.status(404).json({ error: "Orden no encontrada" });

    const url = await resolveInvoicePdfFile(order);
    if (url) return redirectSupabaseView(res, url);

    return res.status(404).json({ error: "Factura no encontrada" });
  } catch (error) {
    console.error("Error viewInvoice:", error);
    res.status(500).json({ error: "Error al visualizar factura", detail: error.message });
  }
}

export async function viewInvoiceXml(req, res) {
  try {
    const { orderId } = req.params;
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: parseInt(orderId) },
      include: { provider: true },
    });
    if (!order) return res.status(404).json({ error: "Orden no encontrada" });

    const url = await resolveInvoiceXmlFile(order);
    if (url) return redirectSupabaseView(res, url);

    return res.status(404).json({ error: "XML no encontrado" });
  } catch (error) {
    console.error("Error viewInvoiceXml:", error);
    res.status(500).json({ error: "Error al visualizar XML", detail: error.message });
  }
}

// =======================
// ✅ DOWNLOAD endpoints (descarga directo)
// =======================
export async function downloadPurchaseOrder(req, res) {
  try {
    const { orderId } = req.params;
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: parseInt(orderId) },
      include: { provider: true },
    });
    if (!order) return res.status(404).json({ error: "Orden no encontrada" });

    const filename = `OC_${order.number || order.id}_${safeFileName(order.provider?.businessName || "Proveedor")}.pdf`;

    const url = await resolvePurchaseOrderFile(order);
    if (url) return redirectSupabaseDownload(res, url, filename);

    return res.status(404).json({ error: "Archivo no encontrado" });
  } catch (error) {
    console.error("Error downloadPurchaseOrder:", error);
    res.status(500).json({ error: "Error al descargar orden", detail: error.message });
  }
}

export async function downloadInvoice(req, res) {
  try {
    const { orderId } = req.params;
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: parseInt(orderId) },
      include: { provider: true },
    });
    if (!order) return res.status(404).json({ error: "Orden no encontrada" });

    const filename = `FAC_${order.number || order.id}_${safeFileName(order.provider?.businessName || "Proveedor")}.pdf`;

    const url = await resolveInvoicePdfFile(order);
    if (url) return redirectSupabaseDownload(res, url, filename);

    return res.status(404).json({ error: "Factura no encontrada" });
  } catch (error) {
    console.error("Error downloadInvoice:", error);
    res.status(500).json({ error: "Error al descargar factura", detail: error.message });
  }
}

export async function downloadInvoiceXml(req, res) {
  try {
    const { orderId } = req.params;
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: parseInt(orderId) },
      include: { provider: true },
    });
    if (!order) return res.status(404).json({ error: "Orden no encontrada" });

    const filename = `FAC_${order.number || order.id}_${safeFileName(order.provider?.businessName || "Proveedor")}.xml`;

    const url = await resolveInvoiceXmlFile(order);
    if (url) return redirectSupabaseDownload(res, url, filename);

    return res.status(404).json({ error: "XML no encontrado" });
  } catch (error) {
    console.error("Error downloadInvoiceXml:", error);
    res.status(500).json({ error: "Error al descargar XML", detail: error.message });
  }
}

// =======================
// ✅ RAW XML endpoint (NO REDIRECT)
// Devuelve el XML como texto para poder renderizarlo bonito en front
// =======================
export async function rawInvoiceXml(req, res) {
  try {
    const { orderId } = req.params;

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: parseInt(orderId) },
      include: { provider: true },
    });

    if (!order) return res.status(404).json({ error: "Orden no encontrada" });

    // Reutiliza tu resolver (firma URL o usa URL guardada)
    const url = await resolveInvoiceXmlFile(order);
    if (!url) return res.status(404).json({ error: "XML no encontrado" });

    // ✅ Descargar desde el server (evita CORS del navegador)
    const r = await fetch(url);
    if (!r.ok) {
      return res.status(502).json({
        error: "No se pudo obtener XML desde almacenamiento",
        detail: `Storage responded ${r.status}`,
      });
    }

    const xmlText = await r.text();

    // ✅ Responder como XML (sin redirect)
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
