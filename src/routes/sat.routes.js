// src/routes/sat.routes.js
import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireRole } from "../middlewares/requireRole.js";
import { importSatBlacklist, quickCheckRfc } from "../controllers/sat.controller.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ADMIN: importar lista (CSV/XLSX/XLS)
router.post("/admin/import", requireAuth, requireRole("ADMIN"), upload.single("file"), importSatBlacklist);

// ADMIN (o quien decidas): verificación rápida
router.get("/admin/quick-check/:rfc", requireAuth, requireRole("ADMIN"), quickCheckRfc);

export default router;
