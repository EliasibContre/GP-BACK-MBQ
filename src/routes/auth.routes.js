// src/routes/auth.routes.js
import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import  validate  from '../middlewares/validate.js';
import { changePasswordSchema, passwordResetRequestSchema, passwordResetConfirmSchema } from '../schemas/auth.schema.js';
import {
  loginStartCtrl,
  loginVerifyCtrl,
  resendCodeCtrl,
  changePasswordCtrl,
  meCtrl,
  logoutCtrl,
  requestPasswordResetCtrl,
  resetPasswordCtrl,
} from '../controllers/auth.controller.js';

const router = Router();

/**
 * /auth/register
 * - Requiere estar autenticado (JWT en cookie HttpOnly)
 * - Requiere rol ADMIN
 * - Solo así se permite crear usuarios
 */
//router.post(
  //'/register',
  //requireAuth,               // ← debe haber iniciado sesión
  ////requireRole(['ADMIN']),    // ← y tener rol ADMIN
  //validate(registerSchema, 'body'),
  //asyncHandler(registerCtrl)
//);

// Paso 1: credenciales → envía código por email
router.post('/login/start', asyncHandler(loginStartCtrl));

// Paso 2: verifica código → crea cookie HttpOnly
router.post(
  '/login/verify',
  asyncHandler(loginVerifyCtrl)
);

// Resend code
router.post(
  '/login/resend',
  asyncHandler(resendCodeCtrl)
);

// Perfil (requiere cookie / JWT)
router.get('/me', requireAuth, asyncHandler(meCtrl));

// Cerrar sesión (borra cookie)
router.post('/logout', asyncHandler(logoutCtrl));

// Cambio de contraseña (primer login o general) — requiere estar autenticado
router.post(
  '/change-password',
  requireAuth,
  validate(changePasswordSchema),
  asyncHandler(changePasswordCtrl)
);

// Password reset: Paso 1 - Solicitar código de recuperación
router.post(
  '/password-reset/request',
  validate(passwordResetRequestSchema, 'body'),
  asyncHandler(requestPasswordResetCtrl)
);

// Password reset: Paso 2 - Confirmar código y cambiar contraseña
router.post(
  '/password-reset/confirm',
  validate(passwordResetConfirmSchema, 'body'),
  asyncHandler(resetPasswordCtrl)
);

export default router;