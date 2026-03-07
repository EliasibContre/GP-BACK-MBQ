import multer from "multer";
export const uploadMemory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });