// src/services/payment.service.js
import { prisma } from "../config/prisma.js";

export async function listPayments({ status, search, method }) {
  const where = {};

  if (status) where.status = status;
  if (method) where.method = method;

  if (search) {
    where.OR = [
      { reference: { contains: search, mode: "insensitive" } },
      { purchaseOrder: { number: { contains: search, mode: "insensitive" } } },
      {
        purchaseOrder: {
          provider: { businessName: { contains: search, mode: "insensitive" } },
        },
      },
      { decidedBy: { fullName: { contains: search, mode: "insensitive" } } },
    ];
  }

  return prisma.payment.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: {
      decidedBy: { select: { id: true, fullName: true, email: true } },
      purchaseOrder: {
        select: {
          id: true,
          number: true,
          provider: { select: { id: true, businessName: true } },
        },
      },
    },
  });
}

export async function decidePayment({ id, decision, comment, userId }) {
  // Validar existe
  const payment = await prisma.payment.findUnique({
    where: { id },
    select: { id: true, status: true },
  });

  if (!payment) {
    const err = new Error("Pago no encontrado.");
    err.status = 404;
    throw err;
  }

  // Evitar doble decisión
  if (payment.status !== "PENDING") {
    const err = new Error("Este pago ya fue decidido.");
    err.status = 409;
    throw err;
  }

  const nextStatus = decision === "APPROVE" ? "APPROVED" : "REJECTED";

  return prisma.payment.update({
    where: { id },
    data: {
      status: nextStatus,
      decidedById: userId,
      decidedAt: new Date(),
      decisionComment: decision === "REJECT" ? comment.trim() : null,
    },
    include: {
      decidedBy: { select: { id: true, fullName: true, email: true } },
      purchaseOrder: {
        select: {
          id: true,
          number: true,
          provider: { select: { id: true, businessName: true } },
        },
      },
    },
  });
}
