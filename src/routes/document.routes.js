import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middlewares/requireAuth.js';
import {
  getDocumentTypes,
  getMyDocuments,
  uploadDocuments,
  deleteDocument
} from '../controllers/document.controller.js';

const router = Router();

// Configurar multer para múltiples archivos
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB por archivo
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PDF'));
    }
  }
});

// Obtener tipos de documento según tipo de persona
router.get('/types', requireAuth, getDocumentTypes);

// Obtener documentos del proveedor autenticado
router.get('/me', requireAuth, getMyDocuments);

// Subir documentos (múltiples archivos con campos dinámicos)
router.post(
  '/me',
  requireAuth,
  upload.any(), // Acepta cualquier cantidad de archivos con diferentes nombres
  uploadDocuments
);

// Eliminar un documento
router.delete('/me/:documentId', requireAuth, deleteDocument);

export default router;