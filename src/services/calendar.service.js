import { prisma } from '../config/prisma.js';

// Thresholds (days) for reminder/projection logic (tweak later as needed)
const THRESHOLDS = {
  approvalPendingDays: 7,
  receptionPendingDays: 5,
  invoiceMissingDays: 3,
  paymentPendingDays: 10,
  projectedReceptionOffsetDays: 5, // approvedAt + 5 days
  projectedPaymentOffsetDays: 10   // receivedAt + 10 days
};

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23,59,59,999);
  return d;
}

function lastMondayOfMonth(year, monthIndex) { // monthIndex 0-11
  const d = new Date(year, monthIndex + 1, 0); // last day of month
  while (d.getDay() !== 1) { // 1 = Monday
    d.setDate(d.getDate() - 1);
  }
  return d;
}

// Build a uniform event object
function buildEvent({ id, entityType, entityId, type, date, title, description = '', color, isReal, statusSnapshot, severity = 'info' }) {
  return {
    id,
    entityType,
    entityId,
    type,
    date,
    title,
    description,
    color,
    isReal,
    statusSnapshot,
    severity
  };
}

export async function generateCalendarEvents({ from, to, providerId, onlyApproved = false } = {}) {
  // Fetch purchase orders impacting the interval.
  const whereClause = {
    OR: [
      { createdAt: { gte: from, lte: to } },
      { approvedAt: { gte: from, lte: to } },
      { receivedAt: { gte: from, lte: to } },
      { invoiceUploadedAt: { gte: from, lte: to } },
      { updatedAt: { gte: from, lte: to } } // captures cancellations/updates
    ]
  };

  if (providerId) {
    whereClause.providerId = providerId;
  }

  if (onlyApproved) {
    // When requested, limit to approved POs only
    whereClause.status = 'APPROVED';
  }

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: whereClause,
    include: {
      payments: true,
      provider: { select: { businessName: true } }
    }
  });

  if (providerId || onlyApproved) {
    console.log(`📅 Calendar query: providerId=${providerId}, onlyApproved=${onlyApproved}, found=${purchaseOrders.length} POs`);
    purchaseOrders.forEach(po => {
      console.log(`  - PO ${po.id}: ${po.number}, status=${po.status}, provider=${po.provider?.businessName}`);
    });
  }

  const realEvents = [];
  const projectedEvents = [];

  const now = new Date();

  for (const po of purchaseOrders) {
    const providerName = po.provider?.businessName || 'Proveedor';
    const poLabel = `OC ${po.number}`;

    // Creation
    if (po.createdAt >= from && po.createdAt <= to) {
      realEvents.push(buildEvent({
        id: `po-${po.id}-created`,
        entityType: 'purchaseOrder',
        entityId: po.id,
        type: 'oc.created',
        date: po.createdAt,
        title: `${poLabel} creada`,
        description: `Creada para ${providerName}`,
        color: 'blue',
        isReal: true,
        statusSnapshot: po.status
      }));
    }

    // Approved (APPROVED or legacy SENT)
    if ((po.status === 'APPROVED' || po.status === 'SENT') && po.approvedAt && po.approvedAt >= from && po.approvedAt <= to) {
      realEvents.push(buildEvent({
        id: `po-${po.id}-approved`,
        entityType: 'purchaseOrder',
        entityId: po.id,
        type: 'oc.approved',
        date: po.approvedAt,
        title: `${poLabel} aprobada`,
        description: `Aprobada para ${providerName}`,
        color: 'indigo',
        isReal: true,
        statusSnapshot: po.status
      }));
    }

    // Rejected
    if (po.status === 'CANCELLED' && po.updatedAt >= from && po.updatedAt <= to) {
      realEvents.push(buildEvent({
        id: `po-${po.id}-rejected`,
        entityType: 'purchaseOrder',
        entityId: po.id,
        type: 'oc.rejected',
        date: po.updatedAt,
        title: `${poLabel} rechazada`,
        description: po.obervations || 'Rechazada',
        color: 'red',
        isReal: true,
        statusSnapshot: po.status,
        severity: 'warn'
      }));
    }

    // Received
    if (po.status === 'RECEIVED' && po.receivedAt && po.receivedAt >= from && po.receivedAt <= to) {
      realEvents.push(buildEvent({
        id: `po-${po.id}-received`,
        entityType: 'purchaseOrder',
        entityId: po.id,
        type: 'oc.received',
        date: po.receivedAt,
        title: `${poLabel} recepción completa`,
        description: `Recepción de bienes/servicios confirmada`,
        color: 'red',
        isReal: true,
        statusSnapshot: po.status
      }));
    }

    // Invoice uploaded
    if (po.invoiceUploadedAt && po.invoiceUploadedAt >= from && po.invoiceUploadedAt <= to) {
      realEvents.push(buildEvent({
        id: `po-${po.id}-invoice-uploaded`,
        entityType: 'purchaseOrder',
        entityId: po.id,
        type: 'invoice.uploaded',
        date: po.invoiceUploadedAt,
        title: `${poLabel} factura subida`,
        description: 'Factura asociada a la orden',
        color: 'yellow',
        isReal: true,
        statusSnapshot: po.status
      }));
    }

    // Payments real events
    for (const pay of po.payments) {
      if (pay.paidAt >= from && pay.paidAt <= to) {
        realEvents.push(buildEvent({
          id: `payment-${pay.id}-made`,
          entityType: 'payment',
          entityId: pay.id,
          type: 'payment.made',
          date: pay.paidAt,
          title: `Pago aplicado OC ${po.number} - ${providerName}`,
          description: `Pago $${pay.amount} para ${providerName}`,
          color: 'green',
          isReal: true,
          statusSnapshot: po.status
        }));
      }
    }

    // Reminders / projected events
    // approvalPending (still DRAFT older than threshold)
    if (po.status === 'DRAFT' && (now - po.createdAt) / (1000*60*60*24) >= THRESHOLDS.approvalPendingDays) {
      const reminderDate = now;
      if (reminderDate >= from && reminderDate <= to) {
        projectedEvents.push(buildEvent({
          id: `po-${po.id}-approval-pending`,
          entityType: 'purchaseOrder',
          entityId: po.id,
          type: 'reminder.approvalPending',
          date: reminderDate,
          title: `${poLabel} pendiente aprobación`,
          description: `Más de ${THRESHOLDS.approvalPendingDays} días sin aprobar`,
          color: 'violet',
          isReal: false,
          statusSnapshot: po.status,
          severity: 'warn'
        }));
      }
    }

    // receptionPending (approved but not received)
    if ((po.status === 'APPROVED' || po.status === 'SENT') && !po.receivedAt && po.approvedAt) {
      if ((now - po.approvedAt) / (1000*60*60*24) >= THRESHOLDS.receptionPendingDays) {
        const reminderDate = now;
        if (reminderDate >= from && reminderDate <= to) {
          projectedEvents.push(buildEvent({
            id: `po-${po.id}-reception-pending`,
            entityType: 'purchaseOrder',
            entityId: po.id,
            type: 'reminder.receptionPending',
            date: reminderDate,
            title: `${poLabel} recepción pendiente`,
            description: `Más de ${THRESHOLDS.receptionPendingDays} días sin marcar recibida`,
            color: 'violet',
            isReal: false,
            statusSnapshot: po.status,
            severity: 'info'
          }));
        }
      }
    }

    // invoiceMissing (approved/received but no invoice yet and older than threshold)
    if ((po.status === 'APPROVED' || po.status === 'RECEIVED') && !po.invoiceUploadedAt && po.approvedAt) {
      if ((now - po.approvedAt) / (1000*60*60*24) >= THRESHOLDS.invoiceMissingDays) {
        const reminderDate = now;
        if (reminderDate >= from && reminderDate <= to) {
          projectedEvents.push(buildEvent({
            id: `po-${po.id}-invoice-missing`,
            entityType: 'purchaseOrder',
            entityId: po.id,
            type: 'reminder.invoiceMissing',
            date: reminderDate,
            title: `${poLabel} factura pendiente`,
            description: `Más de ${THRESHOLDS.invoiceMissingDays} días sin factura`,
            color: 'violet',
            isReal: false,
            statusSnapshot: po.status,
            severity: 'info'
          }));
        }
      }
    }

    // paymentPending (invoice uploaded but no payment yet; older than threshold)
    if (po.invoiceUploadedAt && !po.payments.length) {
      if ((now - po.invoiceUploadedAt) / (1000*60*60*24) >= THRESHOLDS.paymentPendingDays) {
        const reminderDate = now;
        if (reminderDate >= from && reminderDate <= to) {
          projectedEvents.push(buildEvent({
            id: `po-${po.id}-payment-pending`,
            entityType: 'purchaseOrder',
            entityId: po.id,
            type: 'reminder.paymentPending',
            date: reminderDate,
            title: `${poLabel} pago pendiente`,
            description: `Factura sin pago > ${THRESHOLDS.paymentPendingDays} días`,
            color: 'violet',
            isReal: false,
            statusSnapshot: po.status,
            severity: 'info'
          }));
        }
      }
    }

    // projected.reception (approved but not received) using approvedAt + offset
    if ((po.status === 'APPROVED' || po.status === 'SENT') && !po.receivedAt && po.approvedAt) {
      const projectedDate = new Date(po.approvedAt.getTime() + THRESHOLDS.projectedReceptionOffsetDays * 86400000);
      if (projectedDate >= from && projectedDate <= to) {
        projectedEvents.push(buildEvent({
          id: `po-${po.id}-projected-reception`,
          entityType: 'purchaseOrder',
          entityId: po.id,
          type: 'projected.reception',
          date: projectedDate,
          title: `${poLabel} recepción estimada`,
          description: `Estimado +${THRESHOLDS.projectedReceptionOffsetDays} días desde aprobación`,
          color: 'gray',
          isReal: false,
          statusSnapshot: po.status,
          severity: 'info'
        }));
      }
    }

    // projected.payment (received and no payment yet) using receivedAt + offset
    if (po.receivedAt && !po.payments.length) {
      const projectedDate = new Date(po.receivedAt.getTime() + THRESHOLDS.projectedPaymentOffsetDays * 86400000);
      if (projectedDate >= from && projectedDate <= to) {
        projectedEvents.push(buildEvent({
          id: `po-${po.id}-projected-payment`,
          entityType: 'purchaseOrder',
          entityId: po.id,
          type: 'projected.payment',
          date: projectedDate,
          title: `${poLabel} pago estimado`,
          description: `Estimado +${THRESHOLDS.projectedPaymentOffsetDays} días desde recepción`,
          color: 'gray',
          isReal: false,
          statusSnapshot: po.status,
          severity: 'info'
        }));
      }
    }
  }

  // Month-wide generic deadlines (invoice upload day 15 & last Monday) always considered projected
  const monthStart = new Date(from.getFullYear(), from.getMonth(), 1);
  const invoiceDeadline = new Date(monthStart.getFullYear(), monthStart.getMonth(), 15);
  if (invoiceDeadline >= from && invoiceDeadline <= to) {
    projectedEvents.push(buildEvent({
      id: `month-${monthStart.getFullYear()}-${monthStart.getMonth()+1}-invoice-deadline`,
      entityType: 'month',
      entityId: monthStart.getMonth()+1,
      type: 'deadline.invoiceUpload',
      date: invoiceDeadline,
      title: 'Fecha límite factura',
      description: 'Subir factura antes de esta fecha',
      color: 'orange',
      isReal: false,
      statusSnapshot: null,
      severity: 'info'
    }));
  }

  const lastMonday = lastMondayOfMonth(monthStart.getFullYear(), monthStart.getMonth());
  if (lastMonday >= from && lastMonday <= to) {
    projectedEvents.push(buildEvent({
      id: `month-${monthStart.getFullYear()}-${monthStart.getMonth()+1}-reception-deadline`,
      entityType: 'month',
      entityId: monthStart.getMonth()+1,
      type: 'deadline.reception',
      date: lastMonday,
      title: 'Fecha límite recepción',
      description: 'Completar recepción antes de este día',
      color: 'orange',
      isReal: false,
      statusSnapshot: null,
      severity: 'info'
    }));
  }

  // Sort events by date ascending for consistency
  realEvents.sort((a,b) => new Date(a.date) - new Date(b.date));
  projectedEvents.sort((a,b) => new Date(a.date) - new Date(b.date));

  return { realEvents, projectedEvents };
}
