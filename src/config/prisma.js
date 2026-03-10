// Conexión única de Prisma para toda la app
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { withAccelerate } from '@prisma/extension-accelerate';

const datasourceUrl = process.env.PRISMA_DATA_PROXY_URL || process.env.DATABASE_URL;
// Log a masked version of the datasource host/path to help confirm we're targeting the expected DB
try {
	if (datasourceUrl) {
		const parsed = new URL(datasourceUrl);
		const host = parsed.hostname;
		const pathname = parsed.pathname || '';
		const dbName = pathname.replace(/^\//, '') || '[no-db]';
	}
} catch (e) {
	// datasourceUrl may be in a special format (prisma+postgres) — try a fallback parse
	try {
		const raw = datasourceUrl || '';
		if (raw.includes('accelerate.prisma-data.net')) {
		} else if (raw) {
		}
	} catch (err) {
		console.warn('No se pudo parsear datasource URL for diagnostics');
	}
}

// Enable query and error logging to help diagnose missing writes
const prismaClient = new PrismaClient({
	log: ['query', 'info', 'warn', 'error']
});

export const prisma = prismaClient.$extends(withAccelerate());