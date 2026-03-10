import multer from "multer";
export const uploadMemory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });