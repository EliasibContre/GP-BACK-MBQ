import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const map = {
    Admin: 'ADMIN',
    Approver: 'APPROVER',
    Provider: 'PROVIDER',
  };

  const upperRoles = await prisma.role.findMany({
    where: { name: { in: Object.values(map) } },
  });
  const upperByName = Object.fromEntries(upperRoles.map(r => [r.name, r]));

  const lowerRoles = await prisma.role.findMany({
    where: { name: { in: Object.keys(map) } },
  });

  if (lowerRoles.length === 0) {
    console.log('No hay roles en minúscula/título para limpiar.');
    const roles = await prisma.role.findMany({ orderBy: { id: 'asc' } });
    console.table(roles);
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const low of lowerRoles) {
      const targetUpperName = map[low.name];
      const targetUpper = upperByName[targetUpperName] || await tx.role.findFirst({ where: { name: targetUpperName } });
      if (!targetUpper) {
        throw new Error(`No existe el rol objetivo ${targetUpperName}. Asegúrate de correr el seed primero.`);
      }

      const affected = await tx.userRole.updateMany({
        where: { roleId: low.id },
        data: { roleId: targetUpper.id },
      });
      console.log(`Migradas ${affected.count} asignaciones de '${low.name}' -> '${targetUpper.name}'.`);

      await tx.role.delete({ where: { id: low.id } });
      console.log(`Eliminado rol duplicado '${low.name}' (id=${low.id}).`);
    }
  });

  const rolesAfter = await prisma.role.findMany({ orderBy: { id: 'asc' } });
  console.table(rolesAfter);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
