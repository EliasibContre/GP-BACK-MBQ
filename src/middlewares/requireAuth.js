import { verifyJwt } from '../utils/jwt.js';
import { prisma } from '../config/prisma.js';

export async function requireAuth(req, res, next) {
  const cookieName = process.env.COOKIE_NAME || 'gp_token';

  const token =
    req.cookies?.[cookieName] || req.cookies?.session ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null);

  if (!token) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const claims = verifyJwt(token); // ejemplo esperado: { id, email, role? / roleId? / roles? }

    // DEBUG opcional

    // Si NO hay role/roles, cargar desde BD (sin tocar la lógica de token)
    if (!claims.role && !claims.roleId && !claims.roles && claims.id) {
      const userRoles = await prisma.userRole.findMany({
        where: { userId: claims.id },
        include: { role: true }
      });
      // Guardar como array de nombres
      claims.roles = userRoles.map(r => ({
        id: r.roleId,
        name: r.role.name.toLowerCase()
      }));
    }

    // Buscar si el usuario está asociado a un proveedor
    if (claims.email) {
      const provider = await prisma.provider.findFirst({
        where: {
          emailContacto: claims.email,
          isActive: true
        },
        select: { id: true }
      });
      
      if (provider) {
        claims.providerId = provider.id;
      }
    }

    req.user = claims;
    return next();
  } catch {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}