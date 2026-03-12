// prisma/seed.js
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // 1. Crear Roles
  const [ADMIN, APPROVER, PROVIDER] = await Promise.all([
    prisma.role.upsert({ where: { name: 'ADMIN' }, update: {}, create: { name: 'ADMIN' } }),
    prisma.role.upsert({ where: { name: 'APPROVER' }, update: {}, create: { name: 'APPROVER' } }),
    prisma.role.upsert({ where: { name: 'PROVIDER' }, update: {}, create: { name: 'PROVIDER' } }),
  ]);

  // 2. Crear Admin inicial
  // Credenciales: jtelpalo@mbqinc.com / Aa12345!
  const passwordHash = await bcrypt.hash('Aa12345!', 10);
  
  await prisma.user.upsert({
    where: { email: 'cmendez@mbqinc.com' },
    update: {
      passwordHash, // Actualizamos el hash por si cambiaste la semilla
      mustChangePassword: true
    },
    create: {
      email: 'cmendez@mbqinc.com',
      fullName: 'Admin Demo',
      passwordHash,
      mustChangePassword: true,
      roles: { 
        create: [{ roleId: ADMIN.id }] // Asignamos rol de ADMIN para que puedas ver todo
      }
    }
  });

  // 3. Tipos de documento (CORREGIDO: Agregados los 'code')
  const docTypes = [
    { code: 'CONSTANCIA_FISCAL', name: 'Constancia de Situación Fiscal', isRequired: true },
    { code: 'EDO_CUENTA', name: 'Comprobante Bancario', isRequired: true },
    { code: 'ID_OFICIAL', name: 'Identificación Oficial', isRequired: false },
    { code: 'OPINION_CUMPLIMIENTO', name: 'Opinión de Cumplimiento', isRequired: false },
    { code: 'ACTA_CONSTITUTIVA', name: 'Acta Constitutiva', isRequired: false },
    { code: 'PODER_LEGAL', name: 'Poder Legal', isRequired: false }
  ];

  for (const dt of docTypes) {
    await prisma.documentType.upsert({
      where: { code: dt.code }, // Usamos 'code' como identificador único
      update: { 
        name: dt.name,
        isRequired: dt.isRequired 
      },
      create: {
        code: dt.code,
        name: dt.name,
        isRequired: dt.isRequired
      }
    });
  }
  
  // 4. Proveedor Demo (Opcional, movido dentro de main para orden)
  await prisma.provider.upsert({
    where: { rfc: 'ABC123456T12' },
    update: {},
    create: { 
      rfc: 'ABC123456T12', 
      businessName: 'Proveedor Demo SA de CV', 
      isApproved: true,
      isActive: true
    },
  });
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });