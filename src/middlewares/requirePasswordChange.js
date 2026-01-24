// src/middlewares/requirePasswordChange.js
// Bloquea el acceso a módulos protegidos si el usuario debe cambiar su contraseña.
export function requireNoPasswordChange(req, res, next) {
  const mustChange = Boolean(req.user?.mustChangePassword);
  if (mustChange) {
    return res.status(428).json({
      code: 'PASSWORD_CHANGE_REQUIRED',
      message: 'Debes cambiar tu contraseña antes de continuar.',
    });
  }
  next();
}