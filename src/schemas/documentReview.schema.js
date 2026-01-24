import { z } from 'zod';

export const rejectDocumentSchema = z.object({
  params: z.object({
    documentId: z.string().regex(/^\d+$/, 'ID de documento inválido')
  }),
  body: z.object({
    reason: z.string()
      .min(3, 'El motivo debe tener al menos 3 caracteres')
      .max(500, 'El motivo no puede exceder 500 caracteres')
  })
});

export const approveDocumentSchema = z.object({
  params: z.object({
    documentId: z.string().regex(/^\d+$/, 'ID de documento inválido')
  })
});

export const getDocumentsSchema = z.object({
  query: z.object({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
    search: z.string().optional()
  })
});