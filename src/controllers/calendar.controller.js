import { generateCalendarEvents } from '../services/calendar.service.js';
import { prisma } from '../config/prisma.js';

export const getCalendar = async (req, res, next) => {
  try {
    const { month, from, to } = req.query;

    let rangeFrom; let rangeTo;
    if (month) {
      const [yearStr, monthStr] = month.split('-');
      const year = parseInt(yearStr, 10);
      const monthIndex = parseInt(monthStr, 10) - 1;
      if (isNaN(year) || isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) {
        return res.status(400).json({ message: 'Parámetro month inválido. Use YYYY-MM.' });
      }
      rangeFrom = new Date(year, monthIndex, 1, 0,0,0,0);
      rangeTo = new Date(year, monthIndex + 1, 0, 23,59,59,999);
    } else if (from && to) {
      const f = new Date(from);
      const t = new Date(to);
      if (isNaN(f.getTime()) || isNaN(t.getTime())) {
        return res.status(400).json({ message: 'Parámetros from/to inválidos.' });
      }
      rangeFrom = f; rangeTo = t;
    } else {
      return res.status(400).json({ message: 'Debes enviar ?month=YYYY-MM o ?from=YYYY-MM-DD&to=YYYY-MM-DD' });
    }

    const roles = (req.user && req.user.roles) || [];
    const isProviderRole = roles.some(r => String(r.name).toUpperCase() === 'PROVIDER');

    let providerId = undefined;
    let onlyApproved = false;

    if (isProviderRole) {
      // Ignorar cualquier providerId enviado externamente: siempre el de la sesión
      try {
        const provider = await prisma.provider.findFirst({
          where: { emailContacto: req.user.email, isActive: true, deletedAt: null },
          select: { id: true }
        });
        if (!provider) {
          // Si el usuario tiene rol PROVIDER pero no se encuentra proveedor asociado, devolver vacío
            return res.json({ realEvents: [], projectedEvents: [] });
        }
        providerId = provider.id;
        onlyApproved = true; // Para proveedor mostrar solo aprobadas
      } catch (e) {
        console.warn('calendar.controller: error resolviendo proveedor de sesión:', e?.message || e);
        return res.json({ realEvents: [], projectedEvents: [] });
      }
    } else {
      // Roles administradores/aprobadores: permitir filtro explícito opcional
      if (req.query.providerId) {
        const parsed = parseInt(req.query.providerId, 10);
        if (!isNaN(parsed)) providerId = parsed;
      }
      // onlyApproved se puede forzar con ?onlyApproved=1 si se desea
      if (req.query.onlyApproved === '1') {
        onlyApproved = true;
      }
    }

    const events = await generateCalendarEvents({ from: rangeFrom, to: rangeTo, providerId, onlyApproved });
    res.json(events);
  } catch (err) {
    next(err);
  }
};
