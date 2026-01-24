import { prisma } from '../src/config/prisma.js';

export async function searchProvidersByRfc(q, take = 50) {
  const query = String(q || '').toUpperCase();
  return prisma.satBlackList.findMany({
    where: { rfc: { startsWith: query } },
    select: { id: true, rfc: true, name: true },
    orderBy: { rfc: 'asc' },
    take,
  });
}

export async function findProviderByRfc(rfc) {
  const code = String(rfc || '').toUpperCase();
  return prisma.satBlackList.findFirst({
    where: { rfc: code },
    select: { id: true, rfc: true, name: true },
  });
}