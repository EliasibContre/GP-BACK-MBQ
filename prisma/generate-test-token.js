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

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

generateTestToken();
