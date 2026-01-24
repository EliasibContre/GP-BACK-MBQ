// ...existing code...
import 'dotenv/config';
import { prisma } from './prisma.js';

async function main() {
  try {
    const rows = await prisma.$queryRaw`SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;`;
    console.table(rows);
    // comprobar existencia exacta de la tabla que usa Prisma
    const exists = rows.some(r => String(r.table_name).toLowerCase() === 'user' || String(r.table_name) === 'User');
    console.log('¿User existe (insensitivo a mayúsculas)?:', exists);
  } catch (err) {
    console.error('Error listando tablas:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
// ...existing code...