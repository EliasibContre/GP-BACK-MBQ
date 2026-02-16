// src/middlewares/multerErrorHandler.js
import multer from "multer";

/**
 * Captura errores de multer (LIMIT_FILE_SIZE, LIMIT_FILE_COUNT, etc.)
 * y errores normales del fileFilter (new Error("...")).
 */
export function multerErrorHandler(err, req, res, next) {
    if (!err) return next();

    // Errores típicos de multer
    if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
            return res
                .status(400)
                .json({ error: "Archivo demasiado grande. Máximo 10MB por archivo." });
        }
        if (err.code === "LIMIT_FILE_COUNT") {
            return res
                .status(400)
                .json({ error: "Demasiados archivos en la solicitud." });
        }
        if (err.code === "LIMIT_UNEXPECTED_FILE") {
            return res
                .status(400)
                .json({ error: "Archivo inesperado (campo incorrecto o no permitido)." });
        }

        return res.status(400).json({ error: `Error de carga: ${err.code}` });
    }

    // Error del fileFilter u otro error normal
    return res.status(400).json({ error: err.message || "Archivo inválido" });
}
