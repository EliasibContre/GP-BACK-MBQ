// src/schemas/payment.schema.js
import { z } from "zod";

const PaymentMethodEnum = z.enum(["TRANSFER", "CASH", "CARD", "OTHER"]);
const PaymentStatusEnum = z.enum(["PENDING", "APPROVED", "REJECTED"]);

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
    }),
});
