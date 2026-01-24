import { Router } from 'express';
const r = Router();

r.get('/', (_req, res) => {
  res.json({ ok: true, message: 'Este es el backend de Gestor de proveedores' });
});

export default r;