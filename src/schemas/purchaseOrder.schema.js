// src/schemas/purchaseOrder.schema.js
import { z } from 'zod';

export const createPurchaseOrderSchema = z.object({
  body: z.object({
    monto: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Formato de monto inválido'),
    fecha: z.string().refine(val => !isNaN(Date.parse(val)), 'Fecha inválida'),
    numeroOrden: z.string().min(3, 'Número de orden muy corto'),
    rfc: z.string().regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, 'RFC inválido'),
    observaciones: z.string().max(500).optional()
  })
});