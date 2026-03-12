import 'dotenv/config';
import { prisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/utils/password.js';

async function main() {
  const email = process.argv[2] || 'proveedor@mbqinc.com';
  const password = process.argv[3] || 'KennyPonce0610.';
  const fullName = process.argv[4] || 'Proveedor test';
  const roleId = Number(process.argv[5] || 1);

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) {
    console.error('Role id no encontrado:', roleId);
    console.table(await prisma.role.findMany());
    process.exit(1);
  }

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    console.error('Ya existe usuario con ese email:', email);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      email,
      fullName,
      passwordHash,
      mustChangePassword: false,
      isActive: true,
    },
  });

  await prisma.userRole.create({
    data: { userId: user.id, roleId },
  });

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });