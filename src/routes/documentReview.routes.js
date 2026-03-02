// src/routes/documentReview.routes.js
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireRole } from "../middlewares/requireRole.js";
import validate from "../middlewares/validate.js";

import {
  getPendingDocuments,
  approveDocument,
  rejectDocument,
  downloadDocument,
  viewDocument,
  getDocumentStats,
  getDocumentGroups,
  getDocumentGroupFiles,
  approveDocumentGroup,
  rejectDocumentGroup,
} from "../controllers/documentReview.controller.js";

import {
  getDocumentsSchema,
  approveDocumentSchema,
  rejectDocumentSchema,
} from "../schemas/documentReview.schema.js";

const router = Router();

router.use(requireAuth);

// stats
router.get("/stats", requireRole(["admin", "approver"]), getDocumentStats);

// groups
router.get("/groups", requireRole(["admin", "approver"]), getDocumentGroups);

router.get(
  "/groups/:groupId/files",
  requireRole(["admin", "approver"]),
  getDocumentGroupFiles
);

router.post(
  "/groups/:groupId/approve",
  requireRole(["admin", "approver"]),
  validate(approveDocumentSchema),
  approveDocumentGroup
);

router.post(
  "/groups/:groupId/reject",
  requireRole(["admin", "approver"]),
  validate(rejectDocumentSchema),
  rejectDocumentGroup
);

// ✅ ver / descargar (por documentId)
router.get("/:documentId/view", viewDocument);
router.get("/:documentId/download", downloadDocument);

// listado
router.get(
  "/",
  requireRole(["admin", "approver"]),
  validate(getDocumentsSchema),
  getPendingDocuments
);

// aprobar / rechazar
router.post(
  "/:documentId/approve",
  requireRole(["admin", "approver"]),
  validate(approveDocumentSchema),
  approveDocument
);

router.post(
  "/:documentId/reject",
  requireRole(["admin", "approver"]),
  validate(rejectDocumentSchema),
  rejectDocument
);

export default router;