/**
 * Script de ejemplo para crear pagos en órdenes de compra
 * 
 * Uso:
 * node prisma/create-payment-example.js
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createPaymentExample() {
  try {
    // 1. Obtener una orden de compra existente
    const purchaseOrder = await prisma.purchaseOrder.findFirst({
      where: {
        status: 'RECEIVED', // Orden recibida
      },
      include: {
        provider: true,
        payments: true
      }
    });

    if (!purchaseOrder) {
      console.log('❌ No se encontraron órdenes de compra recibidas');
      return;
    }

    console.log(`✅ Orden encontrada: ${purchaseOrder.number}`);
    console.log(`   Proveedor: ${purchaseOrder.provider.businessName}`);
    console.log(`   Total: $${purchaseOrder.total}`);
    console.log(`   Pagos existentes: ${purchaseOrder.payments.length}`);

    // 2. Calcular cuánto se ha pagado
    const totalPaid = purchaseOrder.payments.reduce(
      (sum, payment) => sum + Number(payment.amount), 
      0
    );
    
    const remaining = Number(purchaseOrder.total) - totalPaid;

    console.log(`   Total pagado: $${totalPaid}`);
    console.log(`   Restante: $${remaining}`);

    if (remaining <= 0) {
      console.log('⚠️  Esta orden ya está totalmente pagada');
      return;
    }

    // 3. Crear un pago de ejemplo
    const payment = await prisma.payment.create({
      data: {
        purchaseOrderId: purchaseOrder.id,
        amount: remaining, // Pagar el total restante
        paidAt: new Date(),
        method: 'TRANSFER',
        reference: `REF-${Date.now()}`
      }
    });

    console.log('\n🎉 Pago creado exitosamente:');
    console.log(`   ID: ${payment.id}`);
    console.log(`   Monto: $${payment.amount}`);
    console.log(`   Método: ${payment.method}`);
    console.log(`   Referencia: ${payment.reference}`);
    console.log(`   Fecha: ${payment.paidAt.toISOString()}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar
createPaymentExample();
