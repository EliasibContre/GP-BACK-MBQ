import { Router } from "express";
import { uploadMemory } from "../middlewares/uploadMemory.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import {
  uploadPaymentEvidence,
  listPaymentEvidence,
  getEvidenceSignedUrl,
} from "../controllers/paymentEvidence.controller.js";

const router = Router();
router.use(requireAuth);

router.post("/payments/:paymentId/evidence", uploadMemory.single("file"), uploadPaymentEvidence);
router.get("/payments/:paymentId/evidence", listPaymentEvidence);
router.get("/evidence/:id/signed-url", getEvidenceSignedUrl);

export default router;