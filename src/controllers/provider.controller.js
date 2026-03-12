// src/controllers/provider.controller.js
import { prisma } from '../config/prisma.js';
import { generateTempPassword, hashPassword } from '../utils/password.js';
import { sendProviderWelcomeEmail } from '../utils/email.js';
import { createNotification } from '../services/notification.service.js';
import { logAudit } from "../utils/audit.js";

const RFC_REGEX = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i;

export async function searchProviders(req, res, next) {
  try {
    const q = String(req.query.q || '').trim().toUpperCase();

    // Si no hay query, devolver todos los proveedores activos
    if (!q) {
      const providers = await prisma.provider.findMany({
        where: {
          isActive: true
        },
        select: {
          id: true,
          rfc: true,
          businessName: true,
          emailContacto: true,
          telefono: true,
          direccionFiscal: true,
          isActive: true,
          personType: true,
          contactPosition: true
        },
        orderBy: { businessName: 'asc' },
        take: 100
      });
      return res.json({ results: providers });
    }

    // Busca en ambas tablas
    const [providers, satList] = await Promise.all([
      prisma.provider.findMany({
        where: {
          AND: [
            { isActive: true },
            {
              OR: [
                { rfc: { contains: q, mode: 'insensitive' } },
                { businessName: { contains: q, mode: 'insensitive' } },
              ]
            }
          ]
        },
        select: {
          id: true,
          rfc: true,
          businessName: true,
          emailContacto: true,
          telefono: true,
          direccionFiscal: true,
          isActive: true,
          personType: true,
          contactPosition: true
        },
        take: 25
      }),
      prisma.satBlacklist.findMany({
        where: {
          OR: [
            { rfc: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
          ]
        },
        select: { id: true, rfc: true, name: true },
        take: 25
      })
    ]);

    // Combina resultados (primero proveedores, luego SAT)
    const results = [
      ...providers,
      ...satList.map(s => ({ ...s, businessName: s.name, isBlacklisted: true }))
    ];

    res.json({ results: results.slice(0, 50) });
  } catch (err) {
    console.error('Error en searchProviders:', err);
    next(err);
  }
}

export async function getProviderByRfc(req, res, next) {
  try {
    const rfc = String(req.params.rfc || '').trim().toUpperCase();
    if (!RFC_REGEX.test(rfc)) return res.status(400).json({ message: 'RFC inválido' });

    const entry = await prisma.satBlacklist.findFirst({
      where: { rfc: { contains: rfc, mode: 'insensitive' } },
      select: { id: true, rfc: true, name: true }
    });

    if (!entry || entry.rfc.trim().toUpperCase() !== rfc) {
      return res.status(404).json({ message: 'No está en lista negra', blacklisted: false });
    }

    res.json({ provider: { ...entry, rfc: entry.rfc.trim() }, blacklisted: true });
  } catch (err) {
    next(err);
  }
}

export async function getProviderByRfcStrict(req, res, next) {
  try {
    const RFC_REGEX = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i;
    const rfc = String(req.params.rfc || '').trim().toUpperCase();
    if (!RFC_REGEX.test(rfc)) return res.status(400).json({ message: 'RFC inválido' });

    const provider = await prisma.provider.findFirst({
      where: { rfc, isActive: true },
      select: {
        id: true, rfc: true, businessName: true, emailContacto: true,
        telefono: true, direccionFiscal: true, observaciones: true
      }
    });

    if (!provider) return res.status(404).json({ message: 'Proveedor no encontrado' });
    res.json({ provider });
  } catch (err) {
    next(err);
  }
}

export async function createProvider(req, res, next) {
  try {
    const {
      businessName, rfc, emailContacto, telefono,
      direccionFiscal, observaciones, bankName, clabe,
      personType, tipoProveedor
    } = req.body;

    const email = String(emailContacto).trim().toLowerCase();
    const rfcNorm = String(rfc).trim().toUpperCase();
    if (!RFC_REGEX.test(rfcNorm)) return res.status(400).json({ message: 'RFC inválido' });

    let isNewUser = false;
    let provisionalPassword;

    let personTypeEnum = null;
    if (personType) {
      const upper = String(personType).toUpperCase();
      if (['FISICA', 'MORAL'].includes(upper)) personTypeEnum = upper;
    } else if (tipoProveedor) {
      const lower = String(tipoProveedor).toLowerCase();
      if (lower === 'fisica') personTypeEnum = 'FISICA';
      else if (lower === 'moral') personTypeEnum = 'MORAL';
    }

    const result = await prisma.$transaction(async (tx) => {
      // Usuario
      let user = await tx.user.findUnique({ where: { email } });
      if (!user) {
        isNewUser = true;
        provisionalPassword = generateTempPassword(12);
        const passwordHash = await hashPassword(provisionalPassword);
        user = await tx.user.create({
          data: {
            email,
            passwordHash,
            fullName: 'Proveedor',
            isActive: true,
            mustChangePassword: true
          }
        });
      }

      // Asegurar rol PROVIDER
      let providerRole = await tx.role.findFirst({
        where: { name: { in: ['PROVIDER', 'provider', 'Provider'] } }
      });
      if (!providerRole) {
        providerRole = await tx.role.create({ data: { name: 'PROVIDER' } });
      }

      const existingUserProviderRole = await tx.userRole.findFirst({
        where: { userId: user.id, roleId: providerRole.id }
      });

      if (!existingUserProviderRole) {
        await tx.userRole.create({ data: { userId: user.id, roleId: providerRole.id } });
      }

      // Duplicado por RFC
      const existingProvider = await tx.provider.findFirst({ where: { rfc: rfcNorm } });
      if (existingProvider) {
        const e = new Error('El RFC ya está registrado como proveedor');
        e.status = 409;
        throw e;
      }

      // Proveedor
      const provider = await tx.provider.create({
        data: {
          businessName,
          rfc: rfcNorm,
          emailContacto: email,
          telefono: telefono || null,
          direccionFiscal: direccionFiscal || null,
          observaciones: observaciones || null,
          personType: personTypeEnum,
          isApproved: false
        }
      });

      // Cuenta bancaria opcional
      if (bankName || clabe) {
        await tx.providerBankAccount.create({
          data: {
            providerId: provider.id,
            bankName: bankName || null,
            clabe: clabe || null
          }
        });
      }

      //  Auditoría (tx)
      await tx.auditLog.create({
        data: {
          actorId: req.user?.id ?? null,
          action: "PROVIDER_CREATE",
          entity: "Provider",
          entityId: provider.id,
          meta: {
            providerId: provider.id,
            businessName: provider.businessName,
            rfc: provider.rfc,
            emailContacto: provider.emailContacto,
            personType: provider.personType,
            isNewUser
          }
        }
      });

      return {
        userId: user.id,
        providerId: provider.id,
        providerBusinessName: provider.businessName,
        providerRfc: provider.rfc,
        personType: provider.personType
      };
    });

    //  Audit extra con ip/ua
    await logAudit(req, {
      actorId: req.user?.id ?? null,
      action: "PROVIDER_CREATE",
      entity: "Provider",
      entityId: result.providerId,
      meta: {
        providerId: result.providerId,
        businessName: result.providerBusinessName,
        rfc: result.providerRfc,
        personType: result.personType,
        emailContacto: email,
        isNewUser
      }
    });

    //  NUEVO: notificación a admins/aprobadores
    try {
      const adminUsers = await prisma.user.findMany({
        where: {
          roles: {
            some: {
              role: {
                name: { in: ['ADMIN', 'APPROVER'] }
              }
            }
          }
        },
        select: { id: true }
      });

      for (const admin of adminUsers) {
        await createNotification({
          userId: admin.id,
          type: 'PROVIDER_CREATED',
          entityType: 'PROVIDER',
          entityId: result.providerId,
          title: 'Nuevo proveedor registrado',
          message: `Se registró el proveedor ${result.providerBusinessName} (${result.providerRfc}).`,
          data: {
            providerId: result.providerId,
            businessName: result.providerBusinessName,
            rfc: result.providerRfc,
            personType: result.personType,
            emailContacto: email,
            isNewUser
          }
        });
      }
    } catch (notifyErr) {
      console.error(
        'No se pudieron crear notificaciones de proveedor:',
        notifyErr?.message || notifyErr
      );
    }

    if (
      isNewUser &&
      provisionalPassword &&
      email &&
      String(process.env.MAILER_DISABLED || 'false') !== 'true'
    ) {
      try {
        await sendProviderWelcomeEmail(
          email,
          { businessName: result.providerBusinessName, rfc: result.providerRfc },
          provisionalPassword,
          result.personType
        );
      } catch (mailErr) {
        console.error('No se pudo enviar correo de bienvenida proveedor:', mailErr.message || mailErr);
      }
    }

    res.status(201).json({
      userId: result.userId,
      providerId: result.providerId,
      personType: result.personType,
      passwordSent: !!(isNewUser && provisionalPassword)
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === 'P2002' && err.meta?.target?.includes('rfc')) {
      return res.status(409).json({ message: 'El RFC ya está registrado como proveedor' });
    }
    next(err);
  }
}

export async function inactivateProvider(req, res, next) {
  try {
    const { id } = req.params;
    const { reason, notes } = req.body;
    const userId = req.user.id;

    const providerId = parseInt(id);
    if (isNaN(providerId)) {
      return res.status(400).json({ message: 'ID de proveedor inválido' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const provider = await tx.provider.findUnique({
        where: { id: providerId },
      });

      if (!provider) {
        const err = new Error('Proveedor no encontrado');
        err.status = 404;
        throw err;
      }

      if (!provider.isActive) {
        const err = new Error('El proveedor ya está inactivo');
        err.status = 400;
        throw err;
      }

      const updated = await tx.provider.update({
        where: { id: providerId },
        data: {
          isActive: false,
          inactivatedAt: new Date(),
          inactivatedBy: userId,
          inactiveReason: reason,
          observaciones: notes || provider.observaciones,
        },
        include: {
          inactivatedByUser: {
            select: { id: true, fullName: true, email: true },
          },
        },
      });

      return updated;
    });

    await logAudit(req, {
      actorId: userId,
      action: "PROVIDER_INACTIVATE",
      entity: "Provider",
      entityId: providerId,
      meta: { reason, notes }
    });

    res.json({
      message: 'Proveedor dado de baja exitosamente',
      provider: result,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
}

// Opcional: reactivar proveedor
export async function reactivateProvider(req, res, next) {
  try {
    const { id } = req.params;
    const providerId = parseInt(id);

    const updated = await prisma.provider.update({
      where: { id: providerId },
      data: {
        isActive: true,
        inactivatedAt: null,
        inactivatedBy: null,
        inactiveReason: null,
      },
    });

    await logAudit(req, {
      actorId: req.user?.id ?? null,
      action: "PROVIDER_REACTIVATE",
      entity: "Provider",
      entityId: providerId,
      meta: {}
    });

    res.json({
      message: 'Proveedor reactivado exitosamente',
      provider: updated,
    });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Proveedor no encontrado' });
    }
    next(err);
  }
}

export async function updateProvider(req, res, next) {
  try {
    const { id } = req.params;
    const providerId = parseInt(id);
    const actorId = req.user?.id ?? null;

    if (isNaN(providerId)) {
      return res.status(400).json({ message: 'ID de proveedor inválido' });
    }

    const {
      businessName, emailContacto, telefono,
      direccionFiscal, observaciones, bankName, clabe,
      rfc, newPassword
    } = req.body;

    const result = await prisma.$transaction(async (tx) => {
      const provider = await tx.provider.findUnique({
        where: { id: providerId },
        include: { bankAccounts: true }
      });

      if (!provider) {
        const err = new Error('Proveedor no encontrado');
        err.status = 404;
        throw err;
      }

      const before = {
        businessName: provider.businessName,
        rfc: provider.rfc,
        emailContacto: provider.emailContacto,
        telefono: provider.telefono,
        direccionFiscal: provider.direccionFiscal,
        observaciones: provider.observaciones,
      };

      if (rfc && rfc !== provider.rfc) {
        const existingRfc = await tx.provider.findFirst({
          where: {
            rfc: rfc.toUpperCase(),
            id: { not: providerId }
          }
        });

        if (existingRfc) {
          const err = new Error('El RFC ya está registrado por otro proveedor');
          err.status = 409;
          throw err;
        }
      }

      if (emailContacto !== undefined || newPassword !== undefined) {
        const currentUser = await tx.user.findUnique({
          where: { email: provider.emailContacto }
        });

        if (currentUser) {
          const userUpdateData = {};

          if (emailContacto !== undefined && emailContacto !== provider.emailContacto) {
            const normalizedEmail = emailContacto.trim().toLowerCase();

            const emailExists = await tx.user.findUnique({
              where: { email: normalizedEmail }
            });

            if (emailExists && emailExists.id !== currentUser.id) {
              const err = new Error('El nuevo email ya está en uso por otro usuario');
              err.status = 409;
              throw err;
            }

            userUpdateData.email = normalizedEmail;
          }

          if (newPassword) {
            userUpdateData.passwordHash = await hashPassword(newPassword);
            userUpdateData.mustChangePassword = false;
          }

          if (Object.keys(userUpdateData).length > 0) {
            await tx.user.update({
              where: { id: currentUser.id },
              data: userUpdateData
            });
          }
        }
      }

      const updateProviderData = {};
      if (businessName !== undefined) updateProviderData.businessName = businessName.trim();
      if (emailContacto !== undefined) updateProviderData.emailContacto = emailContacto.trim().toLowerCase();
      if (telefono !== undefined) updateProviderData.telefono = telefono || null;
      if (direccionFiscal !== undefined) updateProviderData.direccionFiscal = direccionFiscal || null;
      if (observaciones !== undefined) updateProviderData.observaciones = observaciones || null;
      if (rfc !== undefined) updateProviderData.rfc = rfc.toUpperCase();

      const updatedProvider = await tx.provider.update({
        where: { id: providerId },
        data: updateProviderData
      });

      if (bankName !== undefined || clabe !== undefined) {
        const existingBankAccount = provider.bankAccounts[0];

        if (existingBankAccount) {
          await tx.providerBankAccount.update({
            where: { id: existingBankAccount.id },
            data: {
              bankName: bankName !== undefined ? (bankName || null) : existingBankAccount.bankName,
              clabe: clabe !== undefined ? (clabe || null) : existingBankAccount.clabe,
            }
          });
        } else if (bankName || clabe) {
          await tx.providerBankAccount.create({
            data: {
              providerId: provider.id,
              bankName: bankName || null,
              clabe: clabe || null,
            }
          });
        }
      }

      const after = {
        businessName: updatedProvider.businessName,
        rfc: updatedProvider.rfc,
        emailContacto: updatedProvider.emailContacto,
        telefono: updatedProvider.telefono,
        direccionFiscal: updatedProvider.direccionFiscal,
        observaciones: updatedProvider.observaciones,
      };

      const changed = {};
      for (const k of Object.keys(after)) {
        if (before[k] !== after[k]) changed[k] = { from: before[k], to: after[k] };
      }
      if (newPassword) changed.password = { from: "****", to: "****" };
      if (bankName !== undefined || clabe !== undefined) changed.bankAccount = true;

      await tx.auditLog.create({
        data: {
          actorId,
          action: "PROVIDER_UPDATE",
          entity: "Provider",
          entityId: updatedProvider.id,
          meta: { providerId: updatedProvider.id, changes: changed }
        }
      });

      return await tx.provider.findUnique({
        where: { id: providerId },
        include: { bankAccounts: true }
      });

    }, { maxWait: 10000, timeout: 15000 });

    await logAudit(req, {
      actorId,
      action: "PROVIDER_UPDATE",
      entity: "Provider",
      entityId: providerId,
      meta: { providerId, changedFields: Object.keys(req.body || {}) }
    });

    res.json({
      message: 'Proveedor actualizado exitosamente',
      provider: result,
      passwordUpdated: !!newPassword
    });
  } catch (err) {
    console.error('Error en updateProvider:', err);
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === 'P2025') {
      return res.status(404).json({ message: 'Proveedor no encontrado' });
    }
    if (err.code === 'P2002') {
      const field = err.meta?.target?.[0];
      if (field === 'rfc') {
        return res.status(409).json({ message: 'El RFC ya está registrado' });
      }
    }
    if (err.code === 'P2028') {
      return res.status(500).json({ message: 'Transacción expirada. Intente nuevamente.' });
    }
    next(err);
  }
}

export async function getProviderById(req, res, next) {
  try {
    const { id } = req.params;
    const providerId = parseInt(id);

    if (isNaN(providerId)) {
      return res.status(400).json({ message: 'ID de proveedor inválido' });
    }

    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      include: {
        bankAccounts: true,
        inactivatedByUser: {
          select: { id: true, fullName: true, email: true }
        }
      }
    });

    if (!provider) {
      return res.status(404).json({ message: 'Proveedor no encontrado' });
    }

    res.json({ provider });
  } catch (err) {
    next(err);
  }
}

export async function getMyProviderData(req, res, next) {
  try {
    const userEmail = req.user.email;
    const userId = req.user.id;

    const provider = await prisma.provider.findFirst({
      where: {
        emailContacto: userEmail,
        isActive: true
      },
      include: {
        bankAccounts: {
          select: {
            id: true,
            clabe: true,
            bankName: true
          }
        }
      }
    });

    if (!provider) {
      return res.status(404).json({
        error: 'No se encontró información del proveedor'
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true
      }
    });

    const response = {
      businessName: provider.businessName || '',
      rfc: provider.rfc || '',
      fiscalAddress: provider.direccionFiscal || '',
      fullName: user?.fullName || '',
      contactPosition: provider.contactPosition || '',
      email: userEmail,
      phone: user?.phone || provider.telefono || '',
      deliveryAddress: provider.direccionFiscal || '',
      clabe: provider.bankAccounts[0]?.clabe || '',
      bankName: provider.bankAccounts[0]?.bankName || '',
      bankAccountId: provider.bankAccounts[0]?.id || null,
      providerId: provider.id
    };

    res.json(response);
  } catch (error) {
    console.error('Error al obtener datos del proveedor:', error);
    res.status(500).json({ error: 'Error al cargar los datos' });
  }
}

// Actualizar datos del proveedor autenticado
export async function updateMyProviderData(req, res, next) {
  try {
    const userEmail = req.user.email;
    const userId = req.user.id;
    const {
      businessName,
      rfc,
      fiscalAddress,
      fullName,
      contactPosition,
      phone,
      clabe,
      bankName,
      bankAccountId
    } = req.body;

    const provider = await prisma.provider.findFirst({
      where: {
        emailContacto: userEmail,
        isActive: true
      },
      include: { bankAccounts: true }
    });

    if (!provider) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }

    if (rfc && rfc !== provider.rfc) {
      const existingRfc = await prisma.provider.findFirst({
        where: {
          rfc,
          id: { not: provider.id }
        }
      });

      if (existingRfc) {
        return res.status(400).json({ error: 'El RFC ya está registrado por otro proveedor' });
      }
    }

    await prisma.$transaction(async (tx) => {
      if (fullName || phone) {
        await tx.user.update({
          where: { id: userId },
          data: {
            ...(fullName && { fullName }),
            ...(phone && { phone })
          }
        });
      }

      await tx.provider.update({
        where: { id: provider.id },
        data: {
          ...(businessName && { businessName }),
          ...(rfc && { rfc }),
          ...(fiscalAddress && { direccionFiscal: fiscalAddress }),
          ...(contactPosition && { contactPosition }),
          ...(phone && { telefono: phone })
        }
      });

      if (clabe && bankName) {
        const clabeExists = await tx.providerBankAccount.findFirst({
          where: {
            clabe,
            ...(bankAccountId && { id: { not: bankAccountId } })
          }
        });

        if (clabeExists) {
          throw new Error('CLABE_EXISTS');
        }

        if (bankAccountId) {
          await tx.providerBankAccount.update({
            where: { id: bankAccountId },
            data: { clabe, bankName }
          });
        } else {
          await tx.providerBankAccount.create({
            data: {
              providerId: provider.id,
              clabe,
              bankName
            }
          });
        }
      }
    }, {
      maxWait: 10000,
      timeout: 15000
    });

    res.json({
      message: 'Datos actualizados correctamente',
      success: true
    });
  } catch (error) {
    console.error('Error al actualizar datos del proveedor:', error);

    if (error.message === 'CLABE_EXISTS') {
      return res.status(400).json({ error: 'La CLABE interbancaria ya esta registrada con un proveedor' });
    }

    if (error.code === 'P2002') {
      const field = error.meta?.target?.[0];
      if (field === 'rfc') {
        return res.status(400).json({ error: 'El RFC ya está registrado' });
      }
    }

    res.status(500).json({ error: 'Error al actualizar los datos' });
  }
}

export async function getAdminProvidersTable(req, res, next) {
  try {
    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "active").trim().toLowerCase();

    const where = {
      ...(q
        ? {
            OR: [
              { businessName: { contains: q, mode: "insensitive" } },
              { rfc: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    if (status === "active") where.isActive = true;
    else if (status === "inactive") where.isActive = false;
    else if (status === "all") {
    } else {
      where.isActive = true;
    }

    const providers = await prisma.provider.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        businessName: true,
        rfc: true,
        isActive: true,
        isApproved: true,
        personType: true,
        observaciones: true,
        inactivatedAt: true,
        inactiveReason: true,
        invoices: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            number: true,
            pdfUrl: true,
            createdAt: true,
          },
        },
        purchaseOrders: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            number: true,
            pdfUrl: true,
            createdAt: true,
          },
        },
        documents: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            fileUrl: true,
            createdAt: true,
            documentType: { select: { name: true } },
          },
        },
      },
    });

    const rows = providers.map((p) => {
      const estatus = !p.isActive ? "Inactivo" : !p.isApproved ? "En revisión" : "Activo";
      const categoria = p.personType ? (p.personType === "MORAL" ? "Moral" : "Física") : "Sin categoría";

      return {
        id: p.id,
        proveedor: p.businessName,
        categoria,
        estatus,
        comentarios: p.observaciones ? [p.observaciones] : [],
        inactivatedAt: p.inactivatedAt || null,
        inactiveReason: p.inactiveReason || null,
        facturas: p.invoices.map((i) => ({
          id: i.id,
          nombre: `factura_${i.number || i.id}.pdf`,
          tamaño: "-",
          url: i.pdfUrl || null,
        })),
        ordenesCompra: p.purchaseOrders.map((o) => ({
          id: o.id,
          nombre: `oc_${o.number || o.id}.pdf`,
          tamaño: "-",
          url: o.pdfUrl || null,
        })),
        documentosRespaldo: p.documents.map((d) => ({
          id: d.id,
          nombre: `${d.documentType?.name || "documento"}.pdf`,
          tamaño: "-",
          url: d.fileUrl || null,
        })),
      };
    });

    return res.json({ results: rows });
  } catch (err) {
    console.error("Error en getAdminProvidersTable:", err);
    next(err);
  }
}
