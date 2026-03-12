// src/schemas/payment.schema.js
import { z } from "zod";

const PaymentMethodEnum = z.enum(["TRANSFER", "CASH", "CARD", "OTHER"]);
const PaymentStatusEnum = z.enum([
  "PENDING",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "PAID",
]);

const RejectionTypeEnum = z.enum(["GENERAL", "INVOICE_ERROR"]);

export const listPaymentsSchema = z.object({
  query: z.object({
    status: PaymentStatusEnum.optional(),
    search: z.string().trim().optional(),
    method: PaymentMethodEnum.optional(),
  }),
});

export const decidePaymentSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z
    .object({
      decision: z.enum(["APPROVE", "REJECT"]),
      comment: z.string().trim().optional(),
      rejectionType: RejectionTypeEnum.optional(),
      invoiceErrors: z.array(z.string().trim().min(1)).optional(),
    })
    .superRefine((val, ctx) => {
      if (val.decision === "REJECT") {
        if (!val.comment || val.comment.trim().length < 10) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "El comentario es obligatorio y debe tener al menos 10 caracteres al rechazar.",
            path: ["comment"],
          });
        }
      }

      if (val.decision === "REJECT" && val.rejectionType === "INVOICE_ERROR") {
        if (!Array.isArray(val.invoiceErrors) || val.invoiceErrors.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Debes enviar al menos un error de factura cuando el rechazo sea por error de factura.",
            path: ["invoiceErrors"],
          });
        }
      }
    }),
});