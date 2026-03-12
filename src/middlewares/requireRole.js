// src/middlewares/requireRole.js
export function requireRole(rolesAllowed) {
  const allowed = (Array.isArray(rolesAllowed) ? rolesAllowed : [rolesAllowed])
    .map(r => r.toString().toUpperCase());

  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

    let userRoleNames = [];

    // Prioridad: roles array
    if (Array.isArray(req.user.roles)) {
      userRoleNames = req.user.roles.map(r => {
        if (typeof r === 'string') return r.toUpperCase();
        if (typeof r === 'number') return r.toString().toUpperCase();
        if (r && typeof r === 'object') {
          if (r.name) return r.name.toUpperCase();
          if (r.id) return r.id.toString().toUpperCase();
        }
        return '';
      }).filter(Boolean);
    } else {
      // Campos simples
      const raw = req.user.role ?? req.user.roleId ?? req.user.rol ?? req.user.userRole;
      if (raw != null) {
        if (Array.isArray(raw)) {
          userRoleNames = raw.map(x =>
            typeof x === 'number'
              ? x.toString().toUpperCase()
              : x.toString().toUpperCase()
          );
        } else if (typeof raw === 'number') {
          userRoleNames = [raw.toString().toUpperCase()];
        } else {
          userRoleNames = [raw.toString().toUpperCase()];
        }
      }
    }

    if (userRoleNames.length === 0) {
      return res.status(403).json({ message: 'Role missing' });
    }

    const hasAllowed = userRoleNames.some(r => allowed.includes(r));
    if (!hasAllowed) {
      return res.status(403).json({ message: 'Forbidden: roles ' + userRoleNames.join(',') });
    }

    next();
  };
}