import { prisma } from '../config/prisma.js';
import { createNotification } from '../services/notification.service.js';
import { sendPaymentRegisteredEmail } from '../utils/email.js';

/**
 * Crear un nuevo pago
 * POST /api/payments
 */
export async function createPayment(req, res) {
  try {
    const { purchaseOrderId, amount, paidAt, method, reference } = req.body;
    const userId = req.user?.id;
    const roles = (req.user && req.user.roles) || [];
    const isProviderRole = roles.some(r => String(r.name).toUpperCase() === 'PROVIDER');

    // Validar campos requeridos
    if (!purchaseOrderId || !amount || !paidAt) {
      return res.status(400).json({ 
        error: 'purchaseOrderId, amount y paidAt son requeridos' 
      });
    }

    // Validar que la orden existe (incluye contacto del proveedor)
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: parseInt(purchaseOrderId) },
      include: { provider: { select: { id: true, businessName: true, emailContacto: true, contacts: { select: { email: true } } } } }
    });

    if (!po) {
      return res.status(404).json({ error: 'Orden de compra no encontrada' });
    }

    if (po.status !== 'APPROVED') {
      return res.status(400).json({
        error: 'Solo se pueden pagar órdenes aprobadas (APPROVED)',
        currentStatus: po.status
      });
    }

    // Si es proveedor en sesión, validar que la orden le pertenece
    if (isProviderRole) {
      const provider = await prisma.provider.findFirst({
        where: { emailContacto: req.user.email, isActive: true, deletedAt: null },
        select: { id: true }
      });
      if (!provider || provider.id !== po.provider.id) {
        return res.status(403).json({ error: 'No puedes registrar pagos para órdenes de otro proveedor' });
      }
    }

    // Validar que no exista un pago duplicado en la misma fecha
    const existingPayment = await prisma.payment.findFirst({
      where: {
        purchaseOrderId: parseInt(purchaseOrderId),
        paidAt: {
          gte: new Date(new Date(paidAt).setHours(0, 0, 0, 0)),
          lte: new Date(new Date(paidAt).setHours(23, 59, 59, 999))
        }
      }
    });

    if (existingPayment) {
      return res.status(400).json({
        error: 'Ya existe un pago registrado para esta orden en esta fecha'
      });
    }

    // Crear pago
    const payment = await prisma.payment.create({
      data: {
        purchaseOrderId: parseInt(purchaseOrderId),
        amount: parseFloat(amount),
        paidAt: new Date(paidAt),
        method: method || 'TRANSFER',
        reference: reference || null
      },
      include: {
        purchaseOrder: {
          select: {
            id: true,
            number: true,
            total: true,
            provider: { select: { id: true, businessName: true } }
          }
        }
      }
    });

    // Registrar en auditoría
    await prisma.auditLog.create({
      data: {
        actorId: userId,
        action: 'CREATE_PAYMENT',
        entity: 'Payment',
        entityId: payment.id,
        meta: {
          purchaseOrderId,
          amount: parseFloat(amount),
          method: method || 'TRANSFER',
          providerName: po.provider.businessName
        }
      }
    });

    console.log(`✅ Pago creado: OC ${po.number}, Monto $${amount}`);

    res.status(201).json({
      message: 'Pago registrado correctamente',
      payment
    });
    
    // Crear notificaciones internas (usuarios de finanzas / administradores)
    try {
      // Buscar usuarios con rol FINANZAS; si no hay, fallback a ADMIN/APPROVER
      let financeUsers = await prisma.user.findMany({
        where: { roles: { some: { role: { name: 'FINANZAS' } } } },
        select: { id: true, email: true }
      });

      if (!financeUsers || financeUsers.length === 0) {
        financeUsers = await prisma.user.findMany({
          where: { roles: { some: { role: { name: { in: ['ADMIN', 'APPROVER'] } } } } },
          select: { id: true, email: true }
        });
      }

      const title = `Pago registrado - OC ${po.number}`;
      const message = `Se registró un pago de ${amount} para la orden ${po.number} (${po.provider.businessName}).`;

      for (const u of financeUsers) {
        await createNotification({
          userId: u.id,
          type: 'PAYMENT_CREATED',
          entityType: 'PAYMENT',
          entityId: payment.id,
          title,
          message,
          data: { paymentId: payment.id, purchaseOrderId: po.id, amount }
        });
      }

      // Notificar al proveedor por notificación + correo si tiene email
      const providerEmail = po.provider?.emailContacto || (po.provider?.contacts && po.provider.contacts[0]?.email);
      if (providerEmail) {
        // Create a notification if we have an associated user for provider (best-effort: try match by email)
        const providerUser = await prisma.user.findUnique({ where: { email: providerEmail } });
        if (providerUser) {
          await createNotification({
            userId: providerUser.id,
            type: 'PAYMENT_CREATED',
            entityType: 'PAYMENT',
            entityId: payment.id,
            title: `Pago recibido - OC ${po.number}`,
            message: `Se registró el pago de ${amount} para la orden ${po.number}.`,
            data: { paymentId: payment.id, purchaseOrderId: po.id, amount }
          });
        }

        // Enviar correo al proveedor
        try {
          await sendPaymentRegisteredEmail(providerEmail, payment, po);
        } catch (mailErr) {
          console.warn('No se pudo enviar email al proveedor:', mailErr.message || mailErr);
        }
      }
    } catch (notifyErr) {
      console.error('Error creando notificaciones / correos tras crear pago:', notifyErr);
    }
  } catch (error) {
    console.error('Error createPayment:', error);
    res.status(500).json({ error: 'Error al registrar pago', detail: error.message });
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
      include: { purchaseOrder: { select: { number: true } } }
    });

    if (!payment) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    const updateData = {};
    if (amount !== undefined) updateData.amount = parseFloat(amount);
    if (paidAt !== undefined) updateData.paidAt = new Date(paidAt);
    if (method !== undefined) updateData.method = method;
    if (reference !== undefined) updateData.reference = reference;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
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
            provider: { select: { businessName: true } }
          }
        }
      }
    });

    // Registrar en auditoría
    await prisma.auditLog.create({
      data: {
        actorId: userId,
        action: 'UPDATE_PAYMENT',
        entity: 'Payment',
        entityId: parseInt(id),
        meta: { updatedFields: Object.keys(updateData) }
      }
    });

    res.json({
      message: 'Pago actualizado correctamente',
      payment: updatedPayment
    });
  } catch (error) {
    console.error('Error updatePayment:', error);
    res.status(500).json({ error: 'Error al actualizar pago', detail: error.message });
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
      include: { purchaseOrder: { select: { number: true, provider: { select: { businessName: true } } } } }
    });

    if (!payment) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    await prisma.payment.delete({
      where: { id: parseInt(id) }
    });

    // Registrar en auditoría
    await prisma.auditLog.create({
      data: {
        actorId: userId,
        action: 'DELETE_PAYMENT',
        entity: 'Payment',
        entityId: parseInt(id),
        meta: {
          purchaseOrderNumber: payment.purchaseOrder.number,
          providerName: payment.purchaseOrder.provider.businessName
        }
      }
    });

    console.log(`🗑️ Pago eliminado: OC ${payment.purchaseOrder.number}`);

    res.json({ message: 'Pago eliminado correctamente' });
  } catch (error) {
    console.error('Error deletePayment:', error);
    res.status(500).json({ error: 'Error al eliminar pago', detail: error.message });
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
              receivedAt: true,
              provider: {
                select: {
                  id: true,
                  businessName: true,
                  rfc: true
                }
              }
            }
          }
        },
        orderBy: { paidAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset)
      }),
      prisma.payment.count({ where })
    ]);

    res.json({
      payments,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: parseInt(offset) + parseInt(limit) < total
      }
    });
  } catch (error) {
    console.error('Error listPayments:', error);
    res.status(500).json({ error: 'Error al listar pagos', detail: error.message });
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
      where: { id: parseInt(id) },
      include: {
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
                rfc: true
              }
            }
          }
        }
      }
    });

    if (!payment) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    res.json(payment);
  } catch (error) {
    console.error('Error getPayment:', error);
    res.status(500).json({ error: 'Error al obtener pago', detail: error.message });
  }
}
