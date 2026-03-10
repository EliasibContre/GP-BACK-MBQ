// src/controllers/payment.controller.js
import { prisma } from "../config/prisma.js";
import { createNotification } from "../services/notification.service.js";
import { sendPaymentRegisteredEmail } from "../utils/email.js";
import { logAudit } from "../utils/audit.js";

/**
 * Crear un nuevo pago
 * POST /api/payments
 */
export async function createPayment(req, res) {
  try {
    const {
      purchaseOrderId,
      amount,
      paidAt,
      closeAt,
      method,
      reference,
      isScheduled,
      installmentNo,
      installmentOf
    } = req.body;
    const userId = req.user?.id;
    const roles = (req.user && req.user.roles) || [];
    const isProviderRole = roles.some(
      (r) => String(r.name).toUpperCase() === "PROVIDER",
    );

    // Validar campos requeridos
    if (!purchaseOrderId || !amount || !paidAt) {
      return res.status(400).json({
        error: "purchaseOrderId, amount y paidAt son requeridos",
      });
    }

    // Validar que la orden existe (incluye contacto del proveedor)
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: parseInt(purchaseOrderId) },
      include: {
        provider: {
          select: {
            id: true,
            businessName: true,
            emailContacto: true,
            contacts: { select: { email: true } },
          },
        },
      },
    });

    if (!po) {
      return res.status(404).json({ error: "Orden de compra no encontrada" });
    }

    if (po.status !== "APPROVED") {
      return res.status(400).json({
        error: "Solo se pueden pagar órdenes aprobadas (APPROVED)",
        currentStatus: po.status,
      });
    }

    // Si es proveedor en sesión, validar que la orden le pertenece
    if (isProviderRole) {
      const provider = await prisma.provider.findFirst({
        where: {
          emailContacto: req.user.email,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!provider || provider.id !== po.provider.id) {
        return res
          .status(403)
          .json({
            error: "No puedes registrar pagos para órdenes de otro proveedor",
          });
      }
    }

    // Validar que no exista un pago duplicado en la misma fecha
    const existingPayment = await prisma.payment.findFirst({
      where: {
        purchaseOrderId: parseInt(purchaseOrderId),
        paidAt: {
          gte: new Date(new Date(paidAt).setHours(0, 0, 0, 0)),
          lte: new Date(new Date(paidAt).setHours(23, 59, 59, 999)),
        },
      },
    });

    if (existingPayment) {
      return res.status(400).json({
        error: "Ya existe un pago registrado para esta orden en esta fecha",
      });
    }

    // Crear pago
    const payment = await prisma.payment.create({
      data: {
        purchaseOrderId: parseInt(purchaseOrderId),
        amount: parseFloat(amount),
        paidAt: new Date(paidAt),
        closeAt: closeAt ? new Date(closeAt) : null,
        method: method ?? null,
        reference: reference ?? null,
        createdById: userId ?? null,
        installmentNo: installmentNo != null ? parseInt(installmentNo) : null,
        installmentOf: installmentOf != null ? parseInt(installmentOf) : null,
        isScheduled: Boolean(isScheduled),
      },
      include: {
        purchaseOrder: {
          select: {
            id: true,
            number: true,
            total: true,
            provider: { select: { id: true, businessName: true } },
          },
        },
      },
    });

    // Registrar en auditoría
    await prisma.auditLog.create({
      data: {
        actorId: userId,
        action: "CREATE_PAYMENT",
        entity: "Payment",
        entityId: payment.id,
        meta: {
          purchaseOrderId: parseInt(purchaseOrderId),
          amount: parseFloat(amount),
          closeAt: closeAt ?? null,
          method: method ?? null,
          reference: reference ?? null,
          isScheduled: Boolean(isScheduled),
          providerName: po.provider.businessName,
          installmentNo: installmentNo != null ? parseInt(installmentNo) : null,
          installmentOf: installmentOf != null ? parseInt(installmentOf) : null,
        },
      },
    });

    await logAudit(req, {
      actorId: userId ?? null,
      action: "PAYMENT_CREATE",
      entity: "Payment",
      entityId: payment.id,
      meta: {
        purchaseOrderId: parseInt(purchaseOrderId),
        amount: parseFloat(amount),
        closeAt: closeAt ?? null,
        method: method ?? null,
        reference: reference ?? null,
        providerName: po.provider.businessName,
        installmentNo: installmentNo != null ? parseInt(installmentNo) : null,
        installmentOf: installmentOf != null ? parseInt(installmentOf) : null,
      },
    });

    console.log(`✅ Pago creado: OC ${po.number}, Monto $${amount}`);

    res.status(201).json({
      message: "Pago registrado correctamente",
      payment,
    });

    // Crear notificaciones internas (usuarios de finanzas / administradores)
    try {
      // Buscar usuarios con rol FINANZAS; si no hay, fallback a ADMIN/APPROVER
      let financeUsers = await prisma.user.findMany({
        where: { roles: { some: { role: { name: "FINANZAS" } } } },
        select: { id: true, email: true },
      });

      if (!financeUsers || financeUsers.length === 0) {
        financeUsers = await prisma.user.findMany({
          where: {
            roles: { some: { role: { name: { in: ["ADMIN", "APPROVER"] } } } },
          },
          select: { id: true, email: true },
        });
      }

      const title = `Pago registrado - OC ${po.number}`;
      const message = `Se registró un pago de ${amount} para la orden ${po.number} (${po.provider.businessName}).`;

      for (const u of financeUsers) {
        await createNotification({
          userId: u.id,
          type: "PAYMENT_CREATED",
          entityType: "PAYMENT",
          entityId: payment.id,
          title,
          message,
          data: {
            paymentId: payment.id,
            purchaseOrderId: po.id,
            amount,
            installmentNo: payment.installmentNo,
            installmentOf: payment.installmentOf,
          },
        });
      }

      // Notificar al proveedor por notificación + correo si tiene email
      const providerEmail =
        po.provider?.emailContacto ||
        (po.provider?.contacts && po.provider.contacts[0]?.email);
      if (providerEmail) {
        // Create a notification if we have an associated user for provider (best-effort: try match by email)
        const providerUser = await prisma.user.findUnique({
          where: { email: providerEmail },
        });
        if (providerUser) {
          await createNotification({
            userId: providerUser.id,
            type: "PAYMENT_CREATED",
            entityType: "PAYMENT",
            entityId: payment.id,
            title: `Pago recibido - OC ${po.number}`,
            message: `Se registró el pago de ${amount} para la orden ${po.number}.`,
            data: {
              paymentId: payment.id,
              purchaseOrderId: po.id,
              amount,
              installmentNo: payment.installmentNo,
              installmentOf: payment.installmentOf,
            },
          });
        }

        // Enviar correo al proveedor
        try {
          await sendPaymentRegisteredEmail(providerEmail, payment, po);
        } catch (mailErr) {
          console.warn(
            "No se pudo enviar email al proveedor:",
            mailErr.message || mailErr,
          );
        }
      }
    } catch (notifyErr) {
      console.error(
        "Error creando notificaciones / correos tras crear pago:",
        notifyErr,
      );
    }
  } catch (error) {
    console.error("Error createPayment:", error);
    res
      .status(500)
      .json({ error: "Error al registrar pago", detail: error.message });
  }
}

/**
 * Actualizar un pago existente
 * PUT /api/payments/:id
 */
export async function updatePayment(req, res) {
  try {
    const { id } = req.params;
    const { amount, paidAt, method, reference } = req.body;
    const userId = req.user?.id;

    const payment = await prisma.payment.findUnique({
      where: { id: parseInt(id) },
      include: { purchaseOrder: { select: { number: true } } },
    });

    if (!payment) {
      return res.status(404).json({ error: "Pago no encontrado" });
    }

    const updateData = {};
    if (amount !== undefined) updateData.amount = parseFloat(amount);
    if (paidAt !== undefined) updateData.paidAt = new Date(paidAt);
    if (method !== undefined) updateData.method = method;
    if (reference !== undefined) updateData.reference = reference;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No hay campos para actualizar" });
    }

    const updatedPayment = await prisma.payment.update({
      where: { id: parseInt(id) },
      data: updateData,
      include: {
        purchaseOrder: {
          select: {
            id: true,
            number: true,
            total: true,
            provider: { select: { businessName: true } },
          },
        },
      },
    });

    // Registrar en auditoría
    await prisma.auditLog.create({
      data: {
        actorId: userId,
        action: "UPDATE_PAYMENT",
        entity: "Payment",
        entityId: parseInt(id),
        meta: { updatedFields: Object.keys(updateData) },
      },
    });

    await logAudit(req, {
      actorId: userId ?? null,
      action: "PAYMENT_UPDATE",
      entity: "Payment",
      entityId: parseInt(id),
      meta: { updatedFields: Object.keys(updateData) },
    });

    res.json({
      message: "Pago actualizado correctamente",
      payment: updatedPayment,
    });
  } catch (error) {
    console.error("Error updatePayment:", error);
    res
      .status(500)
      .json({ error: "Error al actualizar pago", detail: error.message });
  }
}

/**
 * Eliminar un pago
 * DELETE /api/payments/:id
 */
export async function deletePayment(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const payment = await prisma.payment.findUnique({
      where: { id: parseInt(id) },
      include: {
        purchaseOrder: {
          select: {
            number: true,
            provider: { select: { businessName: true } },
          },
        },
      },
    });

    if (!payment) {
      return res.status(404).json({ error: "Pago no encontrado" });
    }

    await prisma.payment.delete({
      where: { id: parseInt(id) },
    });

    // Registrar en auditoría
    await prisma.auditLog.create({
      data: {
        actorId: userId,
        action: "DELETE_PAYMENT",
        entity: "Payment",
        entityId: parseInt(id),
        meta: {
          purchaseOrderNumber: payment.purchaseOrder.number,
          providerName: payment.purchaseOrder.provider.businessName,
        },
      },
    });

    await logAudit(req, {
      actorId: userId ?? null,
      action: "PAYMENT_DELETE",
      entity: "Payment",
      entityId: parseInt(id),
      meta: {
        purchaseOrderNumber: payment.purchaseOrder.number,
        providerName: payment.purchaseOrder.provider.businessName,
      },
    });

    console.log(`🗑️ Pago eliminado: OC ${payment.purchaseOrder.number}`);

    res.json({ message: "Pago eliminado correctamente" });
  } catch (error) {
    console.error("Error deletePayment:", error);
    res
      .status(500)
      .json({ error: "Error al eliminar pago", detail: error.message });
  }
}

/**
 * Listar pagos con filtros opcionales
 * GET /api/payments?purchaseOrderId=1&from=2025-01-01&to=2025-12-31
 */
export async function listPayments(req, res) {
  try {
    const { purchaseOrderId, from, to, limit = 50, offset = 0 } = req.query;

    const where = {};

    if (purchaseOrderId) {
      where.purchaseOrderId = parseInt(purchaseOrderId);
    }

    if (from || to) {
      where.paidAt = {};
      if (from) where.paidAt.gte = new Date(from);
      if (to) where.paidAt.lte = new Date(to);
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: {
          purchaseOrder: {
            select: {
              id: true,
              number: true,
              status: true,
              total: true,
              provider: {
                select: {
                  id: true,
                  businessName: true,
                },
              },
            },
          },
        },
        orderBy: { paidAt: "desc" },
        take: parseInt(limit, 10),
        skip: parseInt(offset, 10),
      }),
      prisma.payment.count({ where }),
    ]);

    return res.json({
      payments,
      pagination: {
        total,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
        hasMore: parseInt(offset, 10) + parseInt(limit, 10) < total,
      },
    });
  } catch (error) {
    console.error("Error listPayments:", error);
    return res.status(500).json({
      error: "Error al listar pagos",
      detail: error.message,
    });
  }
}
/**
 * Obtener un pago específico
 * GET /api/payments/:id
 */
export async function getPayment(req, res) {
  try {
    const { id } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id: parseInt(id, 10) },
      include: {
        evidences: {
          where: { isActive: true },
          select: {
            id: true,
            kind: true,
            fileName: true,
            createdAt: true,
            isActive: true,
            comment: true,
          },
        },
        decidedBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        purchaseOrder: {
          select: {
            id: true,
            number: true,
            status: true,
            total: true,
            invoiceUploadedAt: true,
            receivedAt: true,
            provider: {
              select: {
                id: true,
                businessName: true,
                rfc: true,
              },
            },
          },
        },
      },
    });

    if (!payment) {
      return res.status(404).json({ error: "Pago no encontrado" });
    }

    res.json(payment);
  } catch (error) {
    console.error("Error getPayment:", error);
    res.status(500).json({
      error: "Error al obtener pago",
      detail: error.message,
    });
  }
}

/**
 * Listar pagos para aprobación
 * GET /api/payments/approval?status=SUBMITTED&search=...&method=TRANSFER
 * Acceso: ADMIN, APPROVER
 */
export async function listPaymentsForApproval(req, res) {
  try {
    const {
      status = "SUBMITTED", // SUBMITTED | APPROVED | REJECTED | PAID | PENDING
      search = "",
      method,
      limit = 100,
      offset = 0,
    } = req.query;

    const where = {};

    if (status) where.status = status;
    if (method) where.method = method;

    if (search && String(search).trim()) {
      const q = String(search).trim();
      where.OR = [
        { reference: { contains: q, mode: "insensitive" } },
        { purchaseOrder: { number: { contains: q, mode: "insensitive" } } },
        {
          purchaseOrder: {
            provider: { businessName: { contains: q, mode: "insensitive" } },
          },
        },
        { decidedBy: { fullName: { contains: q, mode: "insensitive" } } },
      ];
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: {
          evidences: {
            where: { isActive: true },
            select: {
              id: true,
              kind: true,
              fileName: true,
              createdAt: true,
              isActive: true,
            },
          },
          decidedBy: { select: { id: true, fullName: true, email: true } },
          createdBy: { select: { id: true, fullName: true, email: true } },
          purchaseOrder: {
            select: {
              id: true,
              number: true,
              total: true,
              status: true,
              provider: { select: { id: true, businessName: true, rfc: true } },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }],
        take: parseInt(limit, 10),
        skip: parseInt(offset, 10),
      }),
      prisma.payment.count({ where }),
    ]);

    res.json({
      payments,
      pagination: {
        total,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
        hasMore: parseInt(offset, 10) + parseInt(limit, 10) < total,
      },
    });
  } catch (error) {
    console.error("Error listPaymentsForApproval:", error);
    res.status(500).json({
      error: "Error al listar pagos para aprobación",
      detail: error.message,
    });
  }
}

/**
 * Decidir un pago (aprobar/rechazar)
 * PATCH /api/payments/:id/decision
 * body: {
 *   decision: "APPROVE" | "REJECT",
 *   comment?: string,
 *   rejectionType?: "GENERAL" | "INVOICE_ERROR",
 *   invoiceErrors?: string[]
 * }
 * Acceso: ADMIN, APPROVER
 */
export async function decidePayment(req, res) {
  try {
    const { id } = req.params;
    const { decision, comment, rejectionType, invoiceErrors } = req.body;
    const userId = req.user?.id;

    if (!decision || !["APPROVE", "REJECT"].includes(decision)) {
      return res.status(400).json({
        error: "decision debe ser APPROVE o REJECT",
      });
    }

    const trimmedComment = String(comment || "").trim();

    if (decision === "REJECT") {
      if (!trimmedComment || trimmedComment.length < 10) {
        return res.status(400).json({
          error:
            "El comentario es obligatorio (mín. 10 caracteres) para rechazar.",
        });
      }

      if (
        rejectionType === "INVOICE_ERROR" &&
        (!Array.isArray(invoiceErrors) || invoiceErrors.length === 0)
      ) {
        return res.status(400).json({
          error:
            "Debes enviar al menos un error de factura para este tipo de rechazo.",
        });
      }
    }

    const payment = await prisma.payment.findUnique({
      where: { id: parseInt(id, 10) },
      include: {
        purchaseOrder: {
          select: {
            id: true,
            number: true,
            provider: { select: { businessName: true } },
          },
        },
      },
    });

    if (!payment) {
      return res.status(404).json({ error: "Pago no encontrado" });
    }

    if (payment.status !== "SUBMITTED") {
      return res.status(409).json({
        error: "Este pago no está disponible para revisión",
        currentStatus: payment.status,
      });
    }

    const nextStatus = decision === "APPROVE" ? "APPROVED" : "REJECTED";

    const updated = await prisma.payment.update({
      where: { id: parseInt(id, 10) },
      data: {
        status: nextStatus,
        decidedById: userId,
        decidedAt: new Date(),
        decisionComment: trimmedComment || null,
        rejectionType:
          decision === "REJECT" ? rejectionType || "GENERAL" : null,
        invoiceErrorsJson:
          decision === "REJECT"
            ? Array.isArray(invoiceErrors)
              ? invoiceErrors
              : []
            : null,
      },
      include: {
        evidences: {
          where: { isActive: true },
          select: { id: true, kind: true, fileName: true, createdAt: true },
        },
        decidedBy: { select: { id: true, fullName: true, email: true } },
        purchaseOrder: {
          select: {
            id: true,
            number: true,
            total: true,
            provider: { select: { id: true, businessName: true } },
          },
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: userId,
        action: decision === "APPROVE" ? "APPROVE_PAYMENT" : "REJECT_PAYMENT",
        entity: "Payment",
        entityId: updated.id,
        meta: {
          purchaseOrderNumber: payment.purchaseOrder.number,
          providerName: payment.purchaseOrder.provider.businessName,
          decision,
          comment: trimmedComment || null,
          rejectionType:
            decision === "REJECT" ? rejectionType || "GENERAL" : null,
          invoiceErrors:
            decision === "REJECT"
              ? Array.isArray(invoiceErrors)
                ? invoiceErrors
                : []
              : [],
        },
      },
    });

    await logAudit(req, {
      actorId: userId ?? null,
      action: decision === "APPROVE" ? "PAYMENT_APPROVE" : "PAYMENT_REJECT",
      entity: "Payment",
      entityId: updated.id,
      meta: {
        purchaseOrderNumber: payment.purchaseOrder.number,
        providerName: payment.purchaseOrder.provider.businessName,
        decision,
        comment: trimmedComment || null,
        rejectionType:
          decision === "REJECT" ? rejectionType || "GENERAL" : null,
        invoiceErrors:
          decision === "REJECT"
            ? Array.isArray(invoiceErrors)
              ? invoiceErrors
              : []
            : [],
      },
    });

    res.json({
      message: decision === "APPROVE" ? "Pago aprobado" : "Pago rechazado",
      payment: updated,
    });
  } catch (error) {
    console.error("Error decidePayment:", error);
    res.status(500).json({
      error: "Error al decidir pago",
      detail: error.message,
    });
  }
}

/**
 * Marcar un pago como pagado
 * PATCH /api/payments/:id/mark-paid
 * body: { note?: string }
 * Acceso: ADMIN, APPROVER
 */
export async function markPaymentPaid(req, res) {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const userId = req.user?.id ?? null;

    const payment = await prisma.payment.findUnique({
      where: { id: parseInt(id) },
      include: {
        purchaseOrder: {
          select: {
            id: true,
            number: true,
            provider: { select: { id: true, businessName: true } },
          },
        },
      },
    });

    if (!payment) return res.status(404).json({ error: "Pago no encontrado" });

    // Solo permitir marcar como pagada si ya está APPROVED (tu regla UI)
    if (payment.status !== "APPROVED") {
      return res.status(409).json({
        error: "Solo puedes marcar como pagado un pago APPROVED",
        currentStatus: payment.status,
      });
    }

    const updated = await prisma.payment.update({
      where: { id: parseInt(id) },
      data: {
        status: "PAID",
        // si mandan nota, la guardamos en reference (opción A, sin crear columnas nuevas)
        reference: note ? String(note).trim().slice(0, 120) : payment.reference,
      },
      include: {
        evidences: {
          where: { isActive: true },
          select: { id: true, kind: true, fileName: true, createdAt: true },
        },
        purchaseOrder: {
          select: {
            id: true,
            number: true,
            total: true,
            status: true,
            provider: { select: { id: true, businessName: true, rfc: true } },
          },
        },
      },
    });

    // Auditoría
    await prisma.auditLog.create({
      data: {
        actorId: userId,
        action: "MARK_PAYMENT_PAID",
        entity: "Payment",
        entityId: updated.id,
        meta: {
          purchaseOrderNumber: payment.purchaseOrder.number,
          providerName: payment.purchaseOrder.provider.businessName,
          note: note ? String(note).trim() : null,
        },
      },
    });

    await logAudit(req, {
      actorId: userId,
      action: "PAYMENT_MARK_PAID",
      entity: "Payment",
      entityId: updated.id,
      meta: {
        purchaseOrderNumber: payment.purchaseOrder.number,
        providerName: payment.purchaseOrder.provider.businessName,
        note: note ? String(note).trim() : null,
      },
    });

    return res.json({
      message: "Pago marcado como pagado",
      payment: updated,
    });
  } catch (error) {
    console.error("Error markPaymentPaid:", error);
    return res
      .status(500)
      .json({
        error: "Error al marcar pago como pagado",
        detail: error.message,
      });
  }
}

async function resolveProviderIdFromSession(req) {
  if (req.user?.providerId) return req.user.providerId;
  if (req.user?.provider?.id) return req.user.provider.id;

  const email = String(req.user?.email || "").trim().toLowerCase();
  if (!email) return null;

  const provider = await prisma.provider.findFirst({
    where: {
      emailContacto: email,
      isActive: true,
      deletedAt: null,
    },
    select: { id: true },
  });

  return provider?.id ?? null;
}

// =========================
// PROVIDER: Mis parcialidades
// GET /api/payments/my-plans
// =========================
export async function listMyPaymentPlans(req, res) {
  try {
    console.log("REQ.USER my-plans =>", req.user);

    const providerId = req.user?.providerId ?? req.user?.provider?.id ?? null;

    console.log("providerId detectado =>", providerId);

    if (!providerId) {
      return res.status(400).json({
        error: "No se pudo identificar el proveedor del usuario actual.",
      });
    }

    const payments = await prisma.payment.findMany({
      where: {
        purchaseOrder: {
          is: {
            providerId,
          },
        },
      },
      include: {
        evidences: {
          where: { isActive: true },
          orderBy: [{ kind: "asc" }, { version: "desc" }, { createdAt: "desc" }],
        },
        purchaseOrder: {
          include: {
            provider: {
              select: {
                id: true,
                businessName: true,
                rfc: true,
              },
            },
          },
        },
      },
      orderBy: [
        { purchaseOrderId: "asc" },
        { installmentNo: "asc" },
        { createdAt: "asc" },
      ],
    });

    return res.json({ payments });
  } catch (error) {
    console.error("Error listMyPaymentPlans:", error);
    return res.status(500).json({
      error: "Error al listar parcialidades del proveedor",
      detail: error.message,
    });
  }
}

// =========================
// PROVIDER: Enviar a revisión
// PATCH /api/payments/:id/submit
// =========================
export async function submitPaymentForReview(req, res) {
  try {
    const paymentId = Number(req.params.id);

    if (!Number.isFinite(paymentId)) {
      return res.status(400).json({ error: "ID de pago inválido" });
    }

    const providerId = req.user?.providerId ?? req.user?.provider?.id ?? null;

    if (!providerId) {
      return res.status(400).json({
        error: "No se pudo identificar el proveedor del usuario actual.",
      });
    }

    const payment = await prisma.payment.findFirst({
      where: {
        id: paymentId,
        purchaseOrder: {
          is: {
            providerId,
          },
        },
      },
      include: {
        evidences: {
          where: { isActive: true },
          select: { id: true, kind: true, fileName: true },
        },
      },
    });

    if (!payment) {
      return res.status(404).json({
        error: "Parcialidad no encontrada para este proveedor.",
      });
    }

    if (payment.status !== "PENDING" && payment.status !== "REJECTED") {
      return res.status(409).json({
        error:
          "Solo se pueden enviar a revisión parcialidades en estado PENDING o REJECTED.",
        currentStatus: payment.status,
      });
    }

    const hasPdf = payment.evidences.some(
      (e) => String(e.kind || "").toUpperCase() === "PDF",
    );
    const hasXml = payment.evidences.some(
      (e) => String(e.kind || "").toUpperCase() === "XML",
    );

    if (!hasPdf || !hasXml) {
      return res.status(400).json({
        error:
          "Debes subir al menos un PDF y un XML antes de enviar a revisión.",
      });
    }

    const updated = await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: "SUBMITTED",
        decidedAt: null,
        decidedById: null,
        decisionComment: null,
        rejectionType: null,
        invoiceErrorsJson: null,
      },
      include: {
        evidences: {
          where: { isActive: true },
          select: { id: true, kind: true, fileName: true },
        },
        purchaseOrder: {
          select: {
            id: true,
            number: true,
            provider: {
              select: {
                id: true,
                businessName: true,
              },
            },
          },
        },
      },
    });

    return res.json({
      message: "Parcialidad enviada a revisión",
      payment: updated,
    });
  } catch (error) {
    console.error("Error submitPaymentForReview:", error);
    return res.status(500).json({
      error: "Error al enviar parcialidad a revisión",
      detail: error.message,
    });
  }
}
