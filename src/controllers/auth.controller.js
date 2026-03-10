// src/controllers/auth.controller.js
import {
  createUserWithRoles,
  startLogin,
  verifyLoginCodeAndIssueToken,
  requestPasswordReset,
  resetPassword,
  resendLoginCode,
  changePassword as changePasswordSvc,
} from "../services/auth.service.js";

import { logAudit } from "../utils/audit.js";
import { verifyJwt, signJwt } from "../utils/jwt.js";

const ROLE_MAP = {
  ADMIN: "ADMIN",
  ADMINISTRADOR: "ADMIN",

  APPROVER: "APPROVER",
  APROBADOR: "APPROVER",

  PROVIDER: "PROVIDER",
  PROVEEDOR: "PROVIDER",
};

function normalizeRole(input) {
  const key = String(input || "").trim().toUpperCase();
  return ROLE_MAP[key] || null;
}

// Normaliza roles del body (string o array) => array de roles canónicos
function normalizeRoles(inputRoles) {
  if (!inputRoles) return [];

  const arr = Array.isArray(inputRoles) ? inputRoles : [inputRoles];

  const normalized = [];
  const invalid = [];

  for (const r of arr) {
    const nr = normalizeRole(r);
    if (!nr) invalid.push(r);
    else normalized.push(nr);
  }

  const unique = [...new Set(normalized)];
  return { unique, invalid };
}

const COOKIE_NAME = process.env.COOKIE_NAME || "gp_token";

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite:
      (process.env.COOKIE_SAMESITE || "lax").toLowerCase() === "none"
        ? "none"
        : "lax",
    secure: (process.env.COOKIE_SECURE || "false") === "true",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
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

// ✅ REGISTRO
export async function registerCtrl(req, res) {
  try {
    const { email, fullName, password, roles } = req.body;

    const { unique: normalizedRoles, invalid } = normalizeRoles(roles);

    if (invalid.length) {
      return res.status(400).json({
        message:
          "Rol inválido. Usa ADMIN / APPROVER / PROVIDER (o Administrador/Aprobador/Proveedor).",
        invalid,
      });
    }

    if (!normalizedRoles.length) {
      return res.status(400).json({
        message: "Debes enviar al menos un rol (ADMIN, APPROVER o PROVIDER).",
      });
    }

    const user = await createUserWithRoles({
      email,
      fullName,
      password,
      roles: normalizedRoles,
    });

    await logAudit(req, {
      actorId: req.user?.id ?? null,
      action: "AUTH_REGISTER_USER",
      entity: "User",
      entityId: user?.id ?? null,
      meta: { email, fullName, roles: normalizedRoles },
    });

    return res.status(201).json({ message: "Usuario creado", user });
  } catch (err) {
    console.error("registerCtrl error:", err);
    return res.status(500).json({ message: err.message || "Error del servidor" });
  }
}

// ✅ Paso 1: credenciales (FIX)
export async function loginStartCtrl(req, res) {
  const { email, password } = req.body;

  try {
    const result = await startLogin({ email, password });

    // ✅ AUDIT: start ok
    await logAudit(req, {
      actorId: result?.user?.id ?? null,
      action: "AUTH_LOGIN_START_OK",
      entity: "AUTH",
      entityId: null,
      meta: { email },
    });

    // Si estás en modo dev/test, el service puede regresar code y aquí lo exponemos
    const dev = String(process.env.MAILER_DISABLED || "false") === "true";
    const test = String(process.env.TEST_MODE || "false") === "true";
    const force = String(process.env.FORCE_RETURN_CODE || "false") === "true";

    if ((dev || test || force) && result?.code) {
      return res.status(200).json({ ...result, debugCode: result.code });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("loginStart error:", err);

    // ✅ AUDIT: start fail
    await logAudit(req, {
      actorId: null,
      action: "AUTH_LOGIN_START_FAIL",
      entity: "AUTH",
      entityId: null,
      meta: { email, reason: err?.message || "UNKNOWN" },
    });

    // 👇 Si estás en dev/test y aun así tronó, no tumbes el login con 500
    const dev = String(process.env.MAILER_DISABLED || "false") === "true";
    const test = String(process.env.TEST_MODE || "false") === "true";
    if (dev || test) {
      return res.status(200).json({
        message:
          "Modo dev/test: se intentó generar el código. Revisa logs si no llegó code.",
      });
    }

    return res.status(500).json({ message: err.message || "Error del servidor" });
  }
}

// Paso 2: verifica código
export async function loginVerifyCtrl(req, res) {
  const { email, code } = req.body;

  try {
    const { token, profile } = await verifyLoginCodeAndIssueToken({ email, code });

    await logAudit(req, {
      actorId: profile?.id ?? null,
      action: "AUTH_LOGIN_SUCCESS",
      entity: "User",
      entityId: profile?.id ?? null,
      meta: { email },
    });

    res.cookie(COOKIE_NAME, token, cookieOptions());

    const claims = verifyJwt(token);
    const session = buildSessionFromClaims(claims);

    return res.status(200).json({
      message: "Login OK",
      user: profile,
      session,
    });
  } catch (err) {
    await logAudit(req, {
      actorId: null,
      action: "AUTH_LOGIN_FAIL",
      entity: "AUTH",
      entityId: null,
      meta: { email, reason: err?.message || "INVALID_OR_EXPIRED_CODE" },
    });

    return res.status(401).json({ message: err.message || "Código inválido" });
  }
}

export async function resendCodeCtrl(req, res) {
  const { email } = req.body;
  await resendLoginCode(email);

  await logAudit(req, {
    actorId: null,
    action: "AUTH_RESEND_CODE",
    entity: "AUTH",
    entityId: null,
    meta: { email },
  });

  return res.json({ message: "Código reenviado" });
}

// Perfil
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
      (process.env.COOKIE_SAMESITE || "lax").toLowerCase() === "none" ? "none" : "lax",
    secure: (process.env.COOKIE_SECURE || "false") === "true",
    path: "/",
  });

  await logAudit(req, {
    actorId: req.user?.id ?? null,
    action: "AUTH_LOGOUT",
    entity: "User",
    entityId: req.user?.id ?? null,
    meta: { email: req.user?.email },
  });

  return res.status(200).json({ message: "Logout OK" });
}

// ===== Cambio de contraseña (primer login) =====
export async function changePasswordCtrl(req, res) {
  const userId = req.user?.id;
  const { currentPassword, newPassword } = req.body;

  const profile = await changePasswordSvc({ userId, currentPassword, newPassword });

  const token = signJwt({
    sub: String(profile.id),
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    roles: profile.roles,
    mustChangePassword: profile.mustChangePassword,
  });

  res.cookie(COOKIE_NAME, token, cookieOptions());

  const claims = verifyJwt(token);
  const session = buildSessionFromClaims(claims);

  await logAudit(req, {
    actorId: profile?.id ?? userId ?? null,
    action: "AUTH_PASSWORD_CHANGE",
    entity: "User",
    entityId: profile?.id ?? userId ?? null,
    meta: { email: profile?.email },
  });

  return res.status(200).json({
    message: "Contraseña actualizada",
    user: profile,
    session,
  });
}

// ===== Recuperación de contraseña =====
export async function requestPasswordResetCtrl(req, res) {
  const { email } = req.body;

  await logAudit(req, {
    actorId: null,
    action: "AUTH_PASSWORD_RESET_REQUEST",
    entity: "AUTH",
    entityId: null,
    meta: { email },
  });

  const result = await requestPasswordReset(email);

  if (process.env.TEST_MODE === "true" || process.env.MAILER_DISABLED === "true") {
  }

  return res.status(200).json(result);
}

export async function resetPasswordCtrl(req, res) {
  const { email, token, newPassword } = req.body;
  const result = await resetPassword({ email, token, newPassword });

  await logAudit(req, {
    actorId: null,
    action: "AUTH_PASSWORD_RESET_SUCCESS",
    entity: "AUTH",
    entityId: null,
    meta: { email },
  });

  return res.status(200).json(result);
}
