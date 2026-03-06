// src/routes/notifications.routes.js
import express from "express";
import {
  getMyNotifications,
  readNotification,
  readAllNotifications,
  deleteUserRequestNotif,
} from "../controllers/notifications.controller.js";

// IMPORTANTE: Asumo que tu middleware auth ya protege este router en app.js.
// Si aquí lo aplicas local, déjalo como ya lo tengas.

const router = express.Router();

// Listar
router.get("/", getMyNotifications);

// Marcar como leída una
router.patch("/:id/read", readNotification);

// Marcar todas como leídas
router.patch("/read-all", readAllNotifications);

// ✅ NUEVO: borrar SOLO notis de solicitudes
router.delete("/:id/user-request", deleteUserRequestNotif);

export default router;