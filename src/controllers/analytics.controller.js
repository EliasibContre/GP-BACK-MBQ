import { prisma } from '../config/prisma.js';

/**
 * GET /api/analytics/dashboard
 * Obtiene estadísticas generales para el dashboard de administración
 */
export async function getDashboardStats(req, res) {
  try {
    // Estadísticas de Proveedores
    const [
      proveedoresAprobados,
      proveedoresRechazados
    ] = await Promise.all([
      prisma.provider.count({ where: { isApproved: true, isActive: true } }),
      prisma.provider.count({ where: { isApproved: false, isActive: true } })
    ]);

    // Estadísticas de Facturas (basadas en PurchaseOrder con facturas)
    const purchaseOrdersWithInvoices = await prisma.purchaseOrder.groupBy({
      by: ['status'],
      where: {
        invoicePdfUrl: { not: null }
      },
      _count: true
    });

    const facturasAprobadas = purchaseOrdersWithInvoices.find(po => po.status === 'APPROVED')?._count || 0;
    const facturasRechazadas = purchaseOrdersWithInvoices.find(po => po.status === 'CANCELLED')?._count || 0;
    
    // Contar facturas pendientes de pago (APPROVED pero sin Payment)
    const facturasPendientesPago = await prisma.purchaseOrder.count({
      where: {
        status: 'APPROVED',
        invoicePdfUrl: { not: null },
        payments: { none: {} }
      }
    });

    // Contar facturas pagadas (tienen al menos un pago)
    const facturasPagadas = await prisma.purchaseOrder.count({
      where: {
        invoicePdfUrl: { not: null },
        payments: { some: {} }
      }
    });

    // Estadísticas de Órdenes de Compra
    const purchaseOrdersByStatus = await prisma.purchaseOrder.groupBy({
      by: ['status'],
      _count: true
    });

    const ordenesAprobadas = purchaseOrdersByStatus.find(po => po.status === 'APPROVED')?._count || 0;
    const ordenesRechazadas = purchaseOrdersByStatus.find(po => po.status === 'CANCELLED')?._count || 0;
    const ordenesRetrasadas = purchaseOrdersByStatus.find(po => po.status === 'SENT')?._count || 0;

    // Estadísticas de Contratos/Documentos
    const documentsByStatus = await prisma.providerDocument.groupBy({
      by: ['status'],
      _count: true
    });

    const documentosNuevos = documentsByStatus.find(d => d.status === 'PENDING')?._count || 0;
    const documentosEnAviso = documentsByStatus.find(d => d.status === 'EXPIRED')?._count || 0;
    const documentosVencidos = documentsByStatus.find(d => d.status === 'REJECTED')?._count || 0;

    res.json({
      proveedores: {
        aprobado: proveedoresAprobados,
        rechazado: proveedoresRechazados
      },
      facturas: {
        aprobadas: facturasAprobadas,
        rechazadas: facturasRechazadas,
        "pendientes por pagar": facturasPendientesPago,
        pagadas: facturasPagadas
      },
      contratos: {
        nuevos: documentosNuevos,
        "en aviso": documentosEnAviso,
        vencidos: documentosVencidos
      },
      ordenesCompra: {
        retrasadas: ordenesRetrasadas,
        aprobadas: ordenesAprobadas,
        rechazadas: ordenesRechazadas
      }
    });

  } catch (error) {
    console.error('Error obteniendo estadísticas del dashboard:', error);
    res.status(500).json({ 
      error: 'Error al obtener estadísticas',
      message: error.message 
    });
  }
}

/**
 * Calcula tiempos promedio por estado de órdenes de compra
 */
export async function getPaymentStatusTimings(req, res) {
  try {
    const orders = await prisma.purchaseOrder.findMany({
      select: {
        id: true,
        status: true,
        createdAt: true,
        issuedAt: true,
        approvedAt: true,
        receivedAt: true
      },
      where: {
        status: {
          in: ['SENT', 'APPROVED', 'RECEIVED']
        }
      }
    });

    if (orders.length === 0) {
      return res.json({
        DRAFT: { days: 0, count: 0, label: 'Pendiente de validación', status: 'DRAFT' },
        SENT: { days: 0, count: 0, label: 'En revisión', status: 'SENT' },
        APPROVED: { days: 0, count: 0, label: 'Autorizado', status: 'APPROVED' },
        RECEIVED: { days: 0, count: 0, label: 'Pagado', status: 'RECEIVED' }
      });
    }

    // Agrupar órdenes por estado y calcular tiempos promedio
    const timingsByStatus = {
      DRAFT: { total: 0, count: 0, label: 'Pendiente de validación' },
      SENT: { total: 0, count: 0, label: 'En revisión' },
      APPROVED: { total: 0, count: 0, label: 'Autorizado' },
      RECEIVED: { total: 0, count: 0, label: 'Pagado' }
    };

    orders.forEach(order => {
      let daysInStatus = 0;

      if (order.status === 'DRAFT') {
        // Tiempo desde creación hasta que se envía
        daysInStatus = order.issuedAt ? getDaysDifference(order.createdAt, order.issuedAt) : 0;
      } else if (order.status === 'SENT') {
        // Tiempo desde envío hasta aprobación
        daysInStatus = order.approvedAt ? getDaysDifference(order.issuedAt, order.approvedAt) : 
                       getDaysDifference(order.issuedAt, new Date());
      } else if (order.status === 'APPROVED') {
        // Tiempo desde aprobación hasta recepción
        daysInStatus = order.receivedAt ? getDaysDifference(order.approvedAt, order.receivedAt) : 
                       getDaysDifference(order.approvedAt, new Date());
      } else if (order.status === 'RECEIVED') {
        // Tiempo desde recepción hasta hoy
        daysInStatus = getDaysDifference(order.receivedAt, new Date());
      }

      if (timingsByStatus[order.status]) {
        timingsByStatus[order.status].total += daysInStatus;
        timingsByStatus[order.status].count += 1;
      }
    });

    // Calcular promedios
    const result = {};
    Object.entries(timingsByStatus).forEach(([status, data]) => {
      const avgDays = data.count > 0 ? Math.round(data.total / data.count) : 0;
      result[status] = {
        days: avgDays,
        count: data.count,
        label: data.label,
        status
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Error en getPaymentStatusTimings:', error);
    res.status(500).json({ error: 'Error al calcular tiempos de pago' });
  }
}

/**
 * GET /api/analytics/provider-dashboard
 * Obtiene estadísticas específicas para el proveedor autenticado
 */
export async function getProviderDashboardStats(req, res) {
  try {
    const providerId = req.user?.providerId;
    
    if (!providerId) {
      return res.status(403).json({ error: 'No autorizado como proveedor' });
    }

    // Estadísticas de Facturas del proveedor (basadas en PurchaseOrder con factura)
    // Facturas = órdenes que tienen invoicePdfUrl O invoiceStorageKey
    const todasLasOrdenes = await prisma.purchaseOrder.findMany({
      where: {
        providerId: providerId,
        OR: [
          { invoicePdfUrl: { not: null } },
          { invoiceStorageKey: { not: null } }
        ]
      },
      select: { status: true }
    });

    const facturasCerradas = todasLasOrdenes.filter(o => o.status === 'APPROVED').length;
    const facturasRetrasadas = todasLasOrdenes.filter(o => o.status === 'CANCELLED').length;
    const facturasVolumenActivo = todasLasOrdenes.filter(o => o.status === 'SENT' || o.status === 'DRAFT').length;

    // Estadísticas de Contratos/Documentos del proveedor
    const documentsByStatus = await prisma.providerDocument.groupBy({
      by: ['status'],
      where: {
        providerId: providerId
      },
      _count: true
    });

    const documentosNuevos = documentsByStatus.find(d => d.status === 'PENDING')?._count || 0;
    const documentosEnAviso = documentsByStatus.find(d => d.status === 'EXPIRED')?._count || 0;
    const documentosVencidos = documentsByStatus.find(d => d.status === 'REJECTED')?._count || 0;

    // Estadísticas de Órdenes de Compra del proveedor (TODAS las órdenes, tengan o no factura)
    const todasLasOrdenesCompra = await prisma.purchaseOrder.findMany({
      where: {
        providerId: providerId
      },
      select: { status: true }
    });

    const ordenesCerradas = todasLasOrdenesCompra.filter(o => o.status === 'APPROVED').length;
    const ordenesRetrasadas = todasLasOrdenesCompra.filter(o => o.status === 'CANCELLED').length;
    const ordenesVolumenActivo = todasLasOrdenesCompra.filter(o => o.status === 'SENT' || o.status === 'DRAFT').length;

    res.json({
      facturas: {
        retrasadas: facturasRetrasadas,
        cerradas: facturasCerradas,
        "volumen activo": facturasVolumenActivo
      },
      contratos: {
        nuevos: documentosNuevos,
        "en aviso": documentosEnAviso,
        vencidos: documentosVencidos
      },
      ordenesCompra: {
        retrasadas: ordenesRetrasadas,
        cerradas: ordenesCerradas,
        "volumen activo": ordenesVolumenActivo
      }
    });

  } catch (error) {
    console.error('Error obteniendo estadísticas del proveedor:', error);
    res.status(500).json({ 
      error: 'Error al obtener estadísticas',
      message: error.message 
    });
  }
}

/**
 * Calcula la diferencia en días entre dos fechas
 */
function getDaysDifference(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffMs = Math.abs(end - start);
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return diffDays;
}
