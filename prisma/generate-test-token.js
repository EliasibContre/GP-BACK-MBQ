// Script temporal para generar token de prueba en Postman
import { PrismaClient } from '@prisma/client';
import { signJwt } from '../src/utils/jwt.js';

const prisma = new PrismaClient();

async function generateTestToken() {
  try {
    // Buscar un usuario (ajusta el email si es necesario)
    const user = await prisma.user.findFirst({
      where: { isActive: true },
      include: { roles: { include: { role: true } } }
    });

    if (!user) {
      console.log('❌ No se encontró ningún usuario activo');
      return;
    }

    const roles = user.roles.map(r => ({
      id: r.roleId,
      name: r.role.name.toLowerCase()
    }));

    const token = signJwt({
      id: user.id,
      email: user.email,
      roles
    });

    console.log('\n✅ Token generado para:', user.email);
    console.log('\n📋 Copia este token para Postman:\n');
    console.log(token);
    console.log('\n🔧 Usa en Headers de Postman:');
    console.log(`Cookie: gp_token=${token}`);
    console.log('\n🔧 O en Authorization:');
    console.log(`Bearer ${token}`);
    console.log('\n');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

generateTestToken();
