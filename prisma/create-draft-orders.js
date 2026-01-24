/**
 * Script para crear órdenes de compra de prueba en estado DRAFT
 * Ejecutar: node prisma/create-draft-orders.js
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function crearOrdenesDraft() {
  try {
    console.log('🚀 Iniciando creación de órdenes de compra DRAFT...\n');

    // 1. Obtener proveedores activos
    const proveedores = await prisma.provider.findMany({
      where: { 
        isActive: true,
        inactivatedAt: null 
      },
      take: 3
    });

    if (proveedores.length === 0) {
      console.log('❌ No hay proveedores activos. Primero crea proveedores.');
      return;
    }

    console.log(`✅ Encontrados ${proveedores.length} proveedores activos\n`);

    // 2. Obtener un usuario admin para ser el creador
    const adminUser = await prisma.user.findFirst({
      where: {
        roles: {
          some: { roleId: 1 } // Admin
        }
      }
    });

    if (!adminUser) {
      console.log('❌ No hay usuario admin. Primero crea un usuario admin.');
      return;
    }

    console.log(`✅ Usuario admin encontrado: ${adminUser.email}\n`);

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

      console.log(`✅ Orden creada: ${orden.number}`);
      console.log(`   Proveedor: ${proveedor.businessName}`);
      console.log(`   Total: $${parseFloat(total).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`);
      console.log(`   Estado: ${orden.status}`);
      console.log(`   Fecha emisión: ${orden.issuedAt.toLocaleDateString('es-MX')}\n`);
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

    console.log(`✅ Orden en estado APPROVED creada: ${ordenSent.number}`);
    console.log(`   Proveedor: ${ordenSent.provider.businessName}`);
    console.log(`   Total: $${parseFloat(ordenSent.total).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`);
    console.log(`   Estado: ${ordenSent.status} (puede marcarse como recibida)\n`);

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

    console.log(`✅ Orden en estado RECEIVED creada: ${ordenReceived.number}`);
    console.log(`   Proveedor: ${ordenReceived.provider.businessName}`);
    console.log(`   Total: $${parseFloat(ordenReceived.total).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`);
    console.log(`   Estado: ${ordenReceived.status} (completa)\n`);

    // 6. Resumen
    console.log('=' .repeat(60));
    console.log('📊 RESUMEN');
    console.log('=' .repeat(60));
    console.log(`✅ ${ordenes.length} órdenes DRAFT creadas (pendientes de aprobación)`);
    console.log(`✅ 1 orden SENT creada (para marcar como recibida)`);
    console.log(`✅ 1 orden RECEIVED creada (ejemplo completo)`);
    console.log(`\n📝 Total de órdenes creadas: ${ordenes.length + 2}\n`);

    console.log('🎯 Próximos pasos:');
    console.log('1. Inicia sesión como APROBADOR en el frontend');
    console.log('2. Ve a la sección "Aprobación"');
    console.log('3. En el tab "Órdenes de Compra" verás las órdenes DRAFT');
    console.log('4. Prueba aprobar, rechazar o marcar como recibida\n');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar
crearOrdenesDraft();
