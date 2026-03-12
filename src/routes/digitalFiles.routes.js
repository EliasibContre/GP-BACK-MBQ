// src/routes/digitalFiles.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireRole } from "../middlewares/requireRole.js";
import {
  getProviders,
  getProviderDocuments,
  getProviderPurchaseOrders,

  // download
  downloadPurchaseOrder,
  downloadInvoice,
  downloadInvoiceXml,

  // view
  viewPurchaseOrder,
  viewInvoice,
  viewInvoiceXml,

  //  RAW
  rawInvoiceXml,
} from "../controllers/digitalFiles.controller.js";

const router = Router();

// Todas requieren auth
router.use(requireAuth);

// Admin/Approver
router.get("/providers", requireRole(["admin", "approver"]), getProviders);
router.get("/providers/:providerId/documents", requireRole(["admin", "approver"]), getProviderDocuments);
router.get("/providers/:providerId/purchase-orders", requireRole(["admin", "approver"]), getProviderPurchaseOrders);

//  VIEW (abre en navegador)
router.get("/purchase-orders/:orderId/view", viewPurchaseOrder);
router.get("/purchase-orders/:orderId/invoice/view", viewInvoice);
router.get("/purchase-orders/:orderId/invoice/xml/view", viewInvoiceXml);

//  RAW (NO REDIRECT) -> para visor bonito en front
router.get("/purchase-orders/:orderId/invoice/xml/raw", rawInvoiceXml);

//  DOWNLOAD (descarga directo)
router.get("/purchase-orders/:orderId/download", downloadPurchaseOrder);
router.get("/purchase-orders/:orderId/invoice/download", downloadInvoice);
router.get("/purchase-orders/:orderId/invoice/xml/download", downloadInvoiceXml); //  FIX

export default router;
