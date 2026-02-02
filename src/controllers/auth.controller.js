import {
  createUserWithRoles,
  startLogin,
  verifyLoginCodeAndIssueToken,
  changePassword,
  requestPasswordReset,
  resetPassword,
} from '../services/auth.service.js';
import { verifyJwt, signJwt } from '../utils/jwt.js';
import { resendLoginCode } from '../services/auth.service.js';
import { changePassword  as changePasswordSvc} from '../services/auth.service.js';

const COOKIE_NAME = process.env.COOKIE_NAME || 'gp_token';

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: (process.env.COOKIE_SAMESITE || 'lax').toLowerCase() === 'none' ? 'none' : 'lax',     // para localhost funciona con fetch/axios
    secure: (process.env.COOKIE_SECURE || 'false') === 'true',       // en prod ponlo en true detrás de HTTPS
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días
  };
}

function buildSessionFromClaims(claims) {
  const iat = Number(claims.iat || 0);
  const exp = Number(claims.exp || 0);
  return {
    issuedAt: new Date(iat * 1000).toISOString(),
    expiresAt: new Date(exp * 1000).toISOString(),
    ttlSeconds: Math.max(0, exp - iat),
  };
}

export async function registerCtrl(req, res) {
  const { email, fullName, password, roles } = req.body;
  const user = await createUserWithRoles({ email, fullName, password, roles });
  return res.status(201).json({ message: 'Usuario creado', user });
}

// Paso 1: credenciales
export async function loginStartCtrl(req, res) {
  const { email, password } = req.body;

  try {
    const result = await startLogin({ email, password }); // servicio que crea/elimina el LoginCode y (posiblemente) envía el email

    // Si estamos en modo desarrollo/disabled, devolver también el código para facilitar pruebas
    if (String(process.env.MAILER_DISABLED || 'false') === 'true') {
      // Si el servicio devuelve el código en el body, lo incluimos en debugCode
      if (result && result.code) {
        console.log(`[DEV] Login code for ${email}: ${result.code}`);
        return res.status(200).json({ ...result, debugCode: result.code });
      }

      // fallback: loguear resultado y devolver éxito para permitir continuar con la verificación
      console.log('[DEV] startLogin result (no code returned):', result);
      return res.status(200).json({ message: result?.message || 'Código generado (dev)' });
    }

    return res.status(200).json(result); // comportamiento normal
  } catch (err) {
    console.error('loginStart error:', err);

    // Si el fallo es por SMTP y el desarrollador pidió desactivar el mailer, devolver éxito en dev
    if (String(process.env.MAILER_DISABLED || 'false') === 'true') {
      console.log(`[DEV] Ignoring error because MAILER_DISABLED=true: ${err.message}`);
      return res.status(200).json({ message: 'Código generado (dev)' });
    }

    // Responder error real en producción/si no está deshabilitado
    return res.status(500).json({ message: err.message || 'Error del servidor' });
  }
}

// Paso 2: verifica código, setea cookie y responde con user + session
export async function loginVerifyCtrl(req, res) {
  const { email, code } = req.body;
  const { token, profile} = await verifyLoginCodeAndIssueToken({ email, code });

  // Cookie HttpOnly
  res.cookie(COOKIE_NAME, token, cookieOptions());

  // Construir bloque de sesión a partir de los claims del token
  const claims = verifyJwt(token);
  const session = buildSessionFromClaims(claims);

  return res.status(200).json({
    message: 'Login OK',
    user: profile,
    session,
  });
}

export async function resendCodeCtrl(req, res) {
  const { email } = req.body;
  await resendLoginCode(email);
  return  res.json( { message: 'Código reenviado' } );
}

// Perfil: devuelve un JSON limpio (sin iat/exp/sub crudos)
export async function meCtrl(req, res) {
  const { id, email, fullName, roles, mustChangePassword, iat, exp } = req.user || {};
  const session = buildSessionFromClaims({ iat, exp });
  return res.status(200).json({
    user: { id, email, fullName, roles, mustChangePassword },
    session,
  });
}

export async function logoutCtrl(req, res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite:
      (process.env.COOKIE_SAMESITE || "lax").toLowerCase() === "none"
        ? "none"
        : "lax",
    secure: (process.env.COOKIE_SECURE || "false") === "true",
    path: "/",
  });

  return res.status(200).json({ message: "Logout OK" });
}

// ===== Cambio de contraseña (primer login) =====
export async function changePasswordCtrl(req, res) {
  const userId = req.user?.id;
  const { currentPassword, newPassword } = req.body;

  // 1) Actualiza la contraseña y limpia mustChangePassword
  const profile = await changePasswordSvc({ userId, currentPassword, newPassword });

  // 2) Reemitir JWT con mustChangePassword=false
  const token = signJwt({
    sub: String(profile.id),
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    roles: profile.roles,
    mustChangePassword: profile.mustChangePassword, // ahora false
  });

  // 3) Actualizar cookie HttpOnly
  res.cookie(COOKIE_NAME, token, cookieOptions());

  // 4) Armar bloque de sesión
  const claims = verifyJwt(token);
  const session = buildSessionFromClaims(claims);

  return res.status(200).json({
    message: 'Contraseña actualizada',
    user: profile,
    session,
  });
}

// ===== Recuperación de contraseña =====
export async function requestPasswordResetCtrl(req, res) {
  const { email } = req.body;
  const result = await requestPasswordReset(email);
  
  // En dev/test, si hay debugCode, devolverlo
  if (process.env.TEST_MODE === 'true' || process.env.MAILER_DISABLED === 'true') {
    // Nota: el service genera el token, pero no lo devuelve por seguridad
    // En test mode, necesitarías consultarlo desde la BD o modificar el service
    console.log(`[DEV] Password reset requested for ${email}`);
  }

  return res.status(200).json(result);
}

export async function resetPasswordCtrl(req, res) {
  const { email, token, newPassword } = req.body;
  const result = await resetPassword({ email, token, newPassword });
  return res.status(200).json(result);
}