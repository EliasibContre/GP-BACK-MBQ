// src/controllers/user.controller.js
import { prisma } from "../config/prisma.js";
import { hashPassword } from "../utils/password.js";
import { sendTemporaryPasswordEmail } from "../utils/email.js";

// ✅ Include reutilizable: trae pivote + role.name
const USER_INCLUDE = {
  roles: { include: { role: true } },
};

// ✅ Normaliza roles a array de strings: ["ADMIN", "APPROVER"]
const rolesToNames = (user) => {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  return roles
    .map((r) => r?.role?.name || r?.name)
    .filter(Boolean);
};

function generateTempPassword(length = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  let out = "";
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  // Garantiza al menos una mayúscula, minúscula, dígito
  if (!/[A-Z]/.test(out)) out = "A" + out.slice(1);
  if (!/[a-z]/.test(out)) out = out.slice(0, -1) + "a";
  if (!/[0-9]/.test(out)) out = out.slice(0, 1) + "3" + out.slice(2);
  return out;
}

// ✅ Soporta role: "ADMIN" o roles: ["ADMIN"]
function pickRoleFromBody(body) {
  if (typeof body?.role === "string" && body.role.trim()) return body.role.trim();
  if (Array.isArray(body?.roles) && body.roles.length) {
    const first = body.roles[0];
    if (typeof first === "string") return first.trim();
    if (first?.name) return String(first.name).trim();
  }
  return undefined;
}

export async function createUser(req, res, next) {
  try {
    const { fullName, email, department } = req.body;

    // ✅ soporta role o roles[]
    const roleRaw = pickRoleFromBody(req.body);
    const roleName = String(roleRaw || "").toUpperCase(); // ADMIN / APPROVER / PROVIDER

    if (!fullName || !email) {
      return res.status(400).json({ message: "fullName y email son requeridos" });
    }
    if (!roleName) {
      return res.status(400).json({ message: "role es requerido (ADMIN/APPROVER/PROVIDER)" });
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    const result = await prisma.$transaction(
      async (tx) => {
        const exists = await tx.user.findUnique({ where: { email } });
        if (exists) {
          const err = new Error("El email ya está registrado");
          err.status = 409;
          throw err;
        }

        // Buscar o crear el rol dinámicamente
        let dbRole = await tx.role.findUnique({ where: { name: roleName } });
        if (!dbRole) {
          dbRole = await tx.role.create({ data: { name: roleName } });
        }

        const user = await tx.user.create({
          data: {
            fullName,
            email,
            department,
            passwordHash,
            mustChangePassword: true,
            isActive: true,
          },
        });

        await tx.userRole.create({
          data: { userId: user.id, roleId: dbRole.id },
        });

        // ✅ incluye role.name
        return await tx.user.findUnique({
          where: { id: user.id },
          include: USER_INCLUDE,
        });
      },
      { timeout: 15000, maxWait: 10000 }
    );

    // Enviar correo con contraseña temporal
    let emailSent = false;
    if (String(process.env.MAILER_DISABLED || "false") !== "true") {
      try {
        await sendTemporaryPasswordEmail(email, tempPassword);
        emailSent = true;
      } catch (e) {
        console.error("Error enviando contraseña temporal:", e.message);
      }
    } else {
    }

    // ✅ devuelve roles como strings también
    res.status(201).json({
      message: "Usuario creado correctamente",
      user: {
        ...result,
        roles: rolesToNames(result),
      },
      emailSent,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
}

export async function listUsers(req, res, next) {
  try {
    const users = await prisma.user.findMany({
      include: { roles: { include: { role: true } } }, 
      orderBy: { id: "asc" },
    });
    res.json({ users });
  } catch (err) {
    next(err);
  }
}

export async function updateUser(req, res, next) {
  try {
    const { id } = req.params;
    const userId = parseInt(id, 10);

    if (isNaN(userId)) {
      return res.status(400).json({ message: "ID de usuario inválido" });
    }

    const { fullName, department, isActive } = req.body;

    // ✅ soporta role o roles[]
    const roleRaw = pickRoleFromBody(req.body);
    const roleName = roleRaw ? String(roleRaw).toUpperCase() : undefined;

    const result = await prisma.$transaction(
      async (tx) => {
        // Verifica que el usuario existe
        const user = await tx.user.findUnique({
          where: { id: userId },
          include: USER_INCLUDE,
        });

        if (!user) {
          const err = new Error("Usuario no encontrado");
          err.status = 404;
          throw err;
        }

        // Actualiza datos básicos del usuario
        const updateData = {};
        if (fullName !== undefined) updateData.fullName = String(fullName).trim();
        if (department !== undefined) updateData.department = department;
        if (isActive !== undefined) updateData.isActive = isActive;

        if (Object.keys(updateData).length) {
          await tx.user.update({
            where: { id: userId },
            data: updateData,
          });
        }

        // Si se cambió el rol, actualiza UserRole
        if (roleName !== undefined) {
          let dbRole = await tx.role.findUnique({ where: { name: roleName } });
          if (!dbRole) {
            dbRole = await tx.role.create({ data: { name: roleName } });
          }
          const newRoleId = dbRole.id;

          // roles actuales (pivote)
          const currentRole = Array.isArray(user.roles) ? user.roles[0] : null;

          if (currentRole && currentRole.roleId !== newRoleId) {
            // Elimina rol anterior usando la clave compuesta
            await tx.userRole.delete({
              where: {
                userId_roleId: {
                  userId: user.id,
                  roleId: currentRole.roleId,
                },
              },
            });

            // Crea el nuevo rol
            await tx.userRole.create({
              data: { userId: user.id, roleId: newRoleId },
            });
          } else if (!currentRole) {
            // Si no tenía rol, crea uno
            await tx.userRole.create({
              data: { userId: user.id, roleId: newRoleId },
            });
          }
        }

        // Retorna usuario actualizado con relaciones completas
        return await tx.user.findUnique({
          where: { id: userId },
          include: USER_INCLUDE,
        });
      },
      { timeout: 15000, maxWait: 10000 }
    );

    res.json({
      message: "Usuario actualizado exitosamente",
      user: {
        ...result,
        roles: rolesToNames(result),
      },
    });
  } catch (err) {
    console.error("Error en updateUser:", err);
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === "P2025") {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    next(err);
  }
}

export async function deleteUser(req, res, next) {
  try {
    const { id } = req.params;
    const userId = parseInt(id, 10);

    if (isNaN(userId)) {
      return res.status(400).json({ message: "ID de usuario inválido" });
    }

    await prisma.$transaction(
      async (tx) => {
        // Verifica que el usuario existe
        const user = await tx.user.findUnique({
          where: { id: userId },
          include: USER_INCLUDE,
        });

        if (!user) {
          const err = new Error("Usuario no encontrado");
          err.status = 404;
          throw err;
        }

        // Elimina primero los roles asociados
        if (Array.isArray(user.roles) && user.roles.length > 0) {
          await tx.userRole.deleteMany({
            where: { userId: user.id },
          });
        }

        // Elimina códigos de login si existen
        await tx.loginCode.deleteMany({
          where: { userId: user.id },
        });

        // Finalmente elimina el usuario
        await tx.user.delete({
          where: { id: userId },
        });
      },
      { timeout: 15000, maxWait: 10000 }
    );

    res.json({
      message: "Usuario eliminado exitosamente",
    });
  } catch (err) {
    console.error("Error en deleteUser:", err);
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === "P2025") {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    if (err.code === "P2003") {
      return res.status(409).json({
        message: "No se puede eliminar el usuario porque tiene registros relacionados",
      });
    }
    next(err);
  }
}

export async function getMe(req, res, next) {
  try {
    const userId = req.user?.uid || req.user?.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: USER_INCLUDE, // ✅ ya unificado
    });

    if (!user) return res.status(404).json({ message: "Usuario no encontrado" });

    res.json({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      department: user.department || null,
      phone: user.phone || user.telefono || null,
      roles: rolesToNames(user),
    });
  } catch (e) {
    next(e);
  }
}

export async function updateMe(req, res, next) {
  try {
    const userId = req.user?.uid || req.user?.id;
    const { fullName, department, phone } = req.body;

    const data = {};
    if (typeof fullName === "string") data.fullName = fullName;
    if (typeof department === "string") data.department = department;
    if (typeof phone === "string") data.phone = phone;

    const updated = await prisma.user.update({
      where: { id: userId },
      data,
    });

    res.json({
      id: updated.id,
      email: updated.email,
      fullName: updated.fullName,
      department: updated.department || null,
      phone: updated.phone || null,
    });
  } catch (e) {
    next(e);
  }
}
