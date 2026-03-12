// src/services/auth.service.js
import { prisma } from "../config/prisma.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { signJwt } from "../utils/jwt.js";
import { sendLoginCodeEmail, sendPasswordResetEmail } from "../utils/email.js";
import { addMinutes } from "date-fns";

const CODE_TTL_MIN = Number(
  process.env.LOGIN_CODE_TTL_MINUTES || process.env.CODE_TTL_MIN || 10
);

const TEST_MODE = String(process.env.TEST_MODE || "false").toLowerCase() === "true";
const FORCE_RETURN_CODE =
  String(process.env.FORCE_RETURN_CODE || "false").toLowerCase() === "true";
const MAILER_DISABLED =
  String(process.env.MAILER_DISABLED || "false").toLowerCase() === "true";

//  Helper: intenta enviar email, pero no deja caer el login si falla
async function trySendEmail(fn, fallbackLog) {
  if (MAILER_DISABLED) {
    // Dev puro: no enviar
    if (fallbackLog) console.log(fallbackLog);
    return { sent: false, skipped: true };
  }

  try {
    await fn();
    return { sent: true };
  } catch (e) {
    console.error("✉️ Email falló (no tumbo el login):", e?.message || e);
    if (fallbackLog) console.log(fallbackLog);
    return { sent: false, error: e?.message || String(e) };
  }
}

export async function createUserWithRoles({
  email,
  fullName,
  password,
  roles = ["APPROVER"],
}) {
  const passwordHash = await hashPassword(password);

  const ROLE_MAP = {
    ADMIN: "ADMIN",
    ADMINISTRADOR: "ADMIN",
    APPROVER: "APPROVER",
    APROBADOR: "APPROVER",
    PROVIDER: "PROVIDER",
    PROVEEDOR: "PROVIDER",
  };

  const normalizeRole = (input) => {
    const key = String(input || "").trim().toUpperCase();
    return ROLE_MAP[key] || null;
  };

  const roleArr = Array.isArray(roles) ? roles : [roles];
  const normalizedRoles = [...new Set(roleArr.map(normalizeRole))];

  if (normalizedRoles.some((r) => !r)) {
    const invalid = roleArr.filter((r) => !normalizeRole(r));
    const err = new Error(
      `Rol inválido: ${invalid.join(
        ", "
      )}. Usa ADMIN/APPROVER/PROVIDER (o Administrador/Aprobador/Proveedor).`
    );
    err.status = 400;
    throw err;
  }

  const roleRecords = await Promise.all(
    normalizedRoles.map((roleName) =>
      prisma.role.upsert({
        where: { name: roleName },
        update: {},
        create: { name: roleName },
      })
    )
  );

  try {
    const user = await prisma.user.create({
      data: {
        email,
        fullName,
        passwordHash,
        mustChangePassword: true,
        isActive: true,
        roles: { create: roleRecords.map((r) => ({ roleId: r.id })) },
      },
      include: { roles: { include: { role: true } } },
    });

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles: user.roles.map((r) => r.role.name),
    };
  } catch (e) {
    if (e.code === "P2002" && e.meta?.target?.includes("email")) {
      const err = new Error("El email ya está registrado");
      err.status = 409;
      throw err;
    }
    throw e;
  }
}

export async function getUserWithRolesByEmail(email) {
  return prisma.user.findUnique({
    where: { email },
    include: { roles: { include: { role: true } } },
  });
}

function generateNumericCode(len = 6) {
  const min = 10 ** (len - 1);
  const max = 10 ** len - 1;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
}

// Paso 1: valida credenciales y genera código temporal
export async function startLogin({ email, password }) {
  const user = await getUserWithRolesByEmail(email);
  if (!user) {
    const err = new Error("Credenciales inválidas");
    err.status = 401;
    throw err;
  }
  if (!user.isActive) {
    const err = new Error("Usuario inactivo");
    err.status = 403;
    throw err;
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const err = new Error("Credenciales inválidas");
    err.status = 401;
    throw err;
  }

  const code = generateNumericCode(6);
  const expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60 * 1000);

  await prisma.loginCode.create({
    data: { userId: user.id, code, expiresAt },
  });

  const fallbackLog = `[DEV] Código para ${email}: ${code}`;

  //  intenta correo; si falla NO cae
  const emailResult = await trySendEmail(
    () => sendLoginCodeEmail(user.email, code),
    (TEST_MODE || FORCE_RETURN_CODE) ? fallbackLog : null
  );

  const shouldReturnCode = TEST_MODE || FORCE_RETURN_CODE || MAILER_DISABLED || !emailResult.sent;

  return {
    message: emailResult.sent ? "Código enviado" : "Código generado (fallback)",
    ttlMinutes: CODE_TTL_MIN,
    code: shouldReturnCode ? code : undefined,
  };
}

export async function verifyLoginCodeAndIssueToken({ email, code }) {
  const user = await getUserWithRolesByEmail(email);
  if (!user) {
    const err = new Error("Código inválido");
    err.status = 401;
    throw err;
  }
  if (!user.isActive) {
    const err = new Error("Usuario inactivo");
    err.status = 403;
    throw err;
  }

  const now = new Date();
  const record = await prisma.loginCode.findFirst({
    where: { userId: user.id, code, usedAt: null, expiresAt: { gt: now } },
    orderBy: { expiresAt: "desc" },
  });

  if (!record) {
    const err = new Error("Código inválido o vencido");
    err.status = 401;
    throw err;
  }

  await prisma.loginCode.update({ where: { id: record.id }, data: { usedAt: now } });

  const ROLE_MAP = {
    ADMIN: "ADMIN",
    ADMINISTRADOR: "ADMIN",
    APPROVER: "APPROVER",
    APROBADOR: "APPROVER",
    PROVIDER: "PROVIDER",
    PROVEEDOR: "PROVIDER",
  };

  const roles = [
    ...new Set(
      (user.roles || [])
        .map((r) => ROLE_MAP[String(r.role?.name || "").toUpperCase()] || null)
        .filter(Boolean)
    ),
  ];

  const token = signJwt({
    sub: String(user.id),
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    roles,
    mustChangePassword: user.mustChangePassword,
  });

  const profile = {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    roles,
    mustChangePassword: user.mustChangePassword,
  };

  return { token, profile };
}

export async function resendLoginCode(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("Usuario no encontrado");

  await prisma.loginCode.deleteMany({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
  });

  const code = generateNumericCode(6);

  await prisma.loginCode.create({
    data: {
      userId: user.id,
      code,
      expiresAt: addMinutes(new Date(), CODE_TTL_MIN),
    },
  });

  const fallbackLog = `[DEV] Reenvío código para ${email}: ${code}`;

  const emailResult = await trySendEmail(
    () => sendLoginCodeEmail(user.email, code),
    (TEST_MODE || FORCE_RETURN_CODE) ? fallbackLog : null
  );

  const shouldReturnCode = TEST_MODE || FORCE_RETURN_CODE || MAILER_DISABLED || !emailResult.sent;

  return {
    message: emailResult.sent ? "Código reenviado" : "Código reenviado (fallback)",
    ttlMinutes: CODE_TTL_MIN,
    code: shouldReturnCode ? code : undefined,
  };
}

// ===== Cambio de contraseña (primer login y general) =====
export async function changePassword({ userId, currentPassword, newPassword }) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: true } } },
  });
  if (!user) {
    const err = new Error("Usuario no encontrado");
    err.status = 404;
    throw err;
  }

  if (!user.mustChangePassword && currentPassword) {
    if (!currentPassword) {
      const err = new Error("Contraseña actual requerida");
      err.status = 400;
      throw err;
    }
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) {
      const err = new Error("Contraseña actual incorrecta");
      err.status = 401;
      throw err;
    }
  }

  const passwordHash = await hashPassword(newPassword);

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false },
    include: { roles: { include: { role: true } } },
  });

  return {
    id: updated.id,
    email: updated.email,
    fullName: updated.fullName,
    roles: (updated.roles || []).map((r) => r.role?.name).filter(Boolean),
    mustChangePassword: updated.mustChangePassword,
  };
}

function generateResetToken(len = 6) {
  return Math.random().toString(36).substring(2, 2 + len).toUpperCase();
}

export async function requestPasswordReset(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return { message: "Si el correo existe, recibirá un código de recuperación" };
  }

  if (!user.isActive) {
    const err = new Error("Usuario inactivo");
    err.status = 403;
    throw err;
  }

  await prisma.passwordResetToken.deleteMany({
    where: { userId: user.id, expiresAt: { lt: new Date() } },
  });

  const token = generateResetToken(6);
  const expiresAt = addMinutes(new Date(), 15);

  await prisma.passwordResetToken.create({
    data: { userId: user.id, token, expiresAt },
  });

  const fallbackLog = `[DEV] Reset token para ${email}: ${token}`;

  await trySendEmail(
    () => sendPasswordResetEmail(user.email, token),
    (TEST_MODE || FORCE_RETURN_CODE) ? fallbackLog : null
  );

  return { message: "Si el correo existe, recibirá un código de recuperación" };
}

export async function resetPassword({ email, token, newPassword }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const err = new Error("Email o código inválido");
    err.status = 401;
    throw err;
  }

  const now = new Date();
  const resetRecord = await prisma.passwordResetToken.findFirst({
    where: { userId: user.id, token, expiresAt: { gt: now } },
  });

  if (!resetRecord) {
    const err = new Error("Código inválido o expirado");
    err.status = 401;
    throw err;
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });

  await prisma.passwordResetToken.delete({ where: { id: resetRecord.id } });

  return { message: "Contraseña actualizada correctamente" };
}
