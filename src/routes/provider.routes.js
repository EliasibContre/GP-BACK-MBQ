// src/routes/provider.routes.js
import { Router } from "express";

import {
  searchProviders,
  getProviderByRfc,
  createProvider,
  updateProvider,
  inactivateProvider,
  reactivateProvider,
  getProviderById,
  getMyProviderData,
  updateMyProviderData,
  getProviderByRfcStrict,
  getAdminProvidersTable, //  NUEVO
} from "../controllers/provider.controller.js";

import { requireAuth } from "../middlewares/requireAuth.js";
import { requireRole } from "../middlewares/requireRole.js"; //  NUEVO (necesario para ADMIN)
import validate from "../middlewares/validate.js";
import {
  createProviderSchema,
  updateProviderSchema,
  inactivateProviderSchema,
  updateMyProviderSchema,
} from "../schemas/provider.schema.js";

const router = Router();

/**
 *  NUEVA RUTA: tabla para dashboard/admin
 * IMPORTANTE: va ANTES de '/:rfc' para que no choque con el param dinámico.
 */
router.get("/admin/table", requireAuth, requireRole("ADMIN"), getAdminProvidersTable);

/**
 * Rutas para los datos del proveedor aprobado
 */
router.get("/me", requireAuth, getMyProviderData);
router.patch("/me", requireAuth, validate(updateMyProviderSchema), updateMyProviderData);

/**
 * Búsqueda
 */
router.get("/search", requireAuth, searchProviders);

/**
 * Rutas con prefijo
 */
router.get("/id/:id", requireAuth, getProviderById);

// nueva ruta para rfc baja estricta
router.get("/by-rfc/:rfc", requireAuth, getProviderByRfcStrict);

/**
 * RFC (catch-all) — DEBE ir al final para no comerse otras rutas
 */
router.get("/:rfc", requireAuth, getProviderByRfc);

/**
 * CRUD administración
 */
router.post("/", requireAuth, requireRole("ADMIN"), validate(createProviderSchema), createProvider);
router.patch("/:id", requireAuth, requireRole("ADMIN"), validate(updateProviderSchema), updateProvider);
router.patch("/:id/inactivate", requireAuth, requireRole("ADMIN"), validate(inactivateProviderSchema), inactivateProvider);
router.patch("/:id/reactivate", requireAuth, requireRole("ADMIN"), reactivateProvider);

export default router;
