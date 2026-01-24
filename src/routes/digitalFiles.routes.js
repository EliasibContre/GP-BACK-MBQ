import { Router } from 'express';
import { requireAuth } from '../middlewares/requireAuth.js';
import { requireRole } from '../middlewares/requireRole.js';
import {
  getProviders,
  getProviderDocuments,
  getProviderPurchaseOrders,
  downloadPurchaseOrder,
  downloadInvoice,
  downloadInvoiceXml
} from '../controllers/digitalFiles.controller.js';

const router = Router();

// Todas las rutas requieren autenticación
router.use(requireAuth);

// Proveedores (solo admin/approver)
router.get('/providers', requireRole(['admin', 'approver']), getProviders);

// Documentos de un proveedor (solo admin/approver)
router.get('/providers/:providerId/documents', requireRole(['admin', 'approver']), getProviderDocuments);

// Órdenes de compra de un proveedor (solo admin/approver)
router.get('/providers/:providerId/purchase-orders', requireRole(['admin', 'approver']), getProviderPurchaseOrders);

// Descargar PDFs (accesible para todos los usuarios autenticados)
router.get('/purchase-orders/:orderId/download', downloadPurchaseOrder);
router.get('/purchase-orders/:orderId/invoice/download', downloadInvoice);
router.get('/purchase-orders/:orderId/invoice/xml', downloadInvoiceXml);

export default router;