/**
 * Script para crear órdenes de compra de prueba en estado DRAFT
 * Ejecutar: node prisma/create-draft-orders.js
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function crearOrdenesDraft() {
  try {

    // 1. Obtener proveedores activos
    const proveedores = await prisma.provider.findMany({
      where: { 
        isActive: true,
        inactivatedAt: null 
      },
      take: 3
    });

    if (proveedores.length === 0) {
      return;
    }


    // 2. Obtener un usuario admin para ser el creador
    const adminUser = await prisma.user.findFirst({
      where: {
        roles: {
          some: { roleId: 1 } // Admin
        }
      }
    });

    if (!adminUser) {
      return;
    }


    // 3. Crear órdenes DRAFT para cada proveedor
    const ordenes = [];
    const baseDate = new Date();

    for (let i = 0; i < proveedores.length; i++) {
      const proveedor = proveedores[i];
      const subtotal = (i + 1) * 10000; // 10000, 20000, 30000
      const tax = subtotal * 0.16;
      const total = subtotal + tax;

      const orden = await prisma.purchaseOrder.create({
        data: {
          number: `OC-2024-${String(i + 1).padStart(3, '0')}`,
          issuedAt: new Date(baseDate.getTime() + i * 24 * 60 * 60 * 1000), // Cada día
          total: total,
          taxes: tax,
          subtotal: subtotal,
          status: 'DRAFT', // Estado DRAFT para aprobación
          providerId: proveedor.id,
          createdById: adminUser.id,
          obervations: `Orden de compra para ${proveedor.businessName} - Pendiente de aprobación`,
          pdfUrl: null,
          invoicePdfUrl: null,
          invoiceXmlUrl: null
        },
        include: {
          provider: true
        }
      });

      ordenes.push(orden);
    }

    // 4. Crear una orden en estado SENT (ya aprobada)
    const ordenSent = await prisma.purchaseOrder.create({
      data: {
        number: 'OC-2024-100',
        issuedAt: new Date(baseDate.getTime() - 5 * 24 * 60 * 60 * 1000), // 5 días atrás
        approvedAt: new Date(baseDate.getTime() - 4 * 24 * 60 * 60 * 1000), // Aprobada 4 días atrás
        total: 50000,
        taxes: 8000,
        subtotal: 42000,
        status: 'APPROVED', // Ya aprobada
        providerId: proveedores[0].id,
        createdById: adminUser.id,
        approvedById: adminUser.id,
        obervations: 'Orden aprobada - Lista para marcar como recibida'
      },
      include: {
        provider: true
      }
    });

    // 5. Crear una orden RECEIVED (completa)
    const ordenReceived = await prisma.purchaseOrder.create({
      data: {
        number: 'OC-2024-101',
        issuedAt: new Date(baseDate.getTime() - 10 * 24 * 60 * 60 * 1000), // 10 días atrás
        approvedAt: new Date(baseDate.getTime() - 9 * 24 * 60 * 60 * 1000), // Aprobada 9 días atrás
        receivedAt: new Date(baseDate.getTime() - 2 * 24 * 60 * 60 * 1000), // Recibida 2 días atrás
        total: 75000,
        taxes: 12000,
        subtotal: 63000,
        status: 'RECEIVED', // Ya recibida
        providerId: proveedores[0].id,
        createdById: adminUser.id,
        approvedById: adminUser.id,
        obervations: 'Orden recibida - Lista para facturación y pago',
        invoiceUploadedAt: new Date(baseDate.getTime() - 1 * 24 * 60 * 60 * 1000) // Factura subida 1 día atrás
      },
      include: {
        provider: true
      }
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar
crearOrdenesDraft();
