// src/middlewares/validate.js
import { ZodError } from 'zod';

const validate = (schema) => async (req, res, next) => {
  try {
    // intenta validar body plano
    try {
      await schema.parseAsync(req.body ?? {});
      return next();
    } catch (_) {
      // intenta validar con wrapper { body, params, query }
      await schema.parseAsync({
        body: req.body ?? {},
        params: req.params ?? {},
        query: req.query ?? {},
      });
      return next();
    }
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = (err.issues || []).map(e => ({
        path: e.path.join('.') || 'root',
        message: e.message,
        code: e.code,
      }));
      console.error(`Validation error ${req.method} ${req.originalUrl}`, issues);
      // envía ambas llaves para que el front pueda leerlas
      return res.status(400).json({ error: 'Validation error', issues, details: issues });
    }
    console.error(' Internal validation error:', err);
    return res.status(500).json({ message: 'Error interno en la validación', error: err.message });
  }
};

export default validate;