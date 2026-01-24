import { prisma } from '../config/prisma.js';
import { sendAccessRequestAckEmail, sendTemporaryPasswordEmail, sendAccessRequestRejectedEmail } from '../utils/email.js';
import { hashPassword } from '../utils/password.js';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export async function createAccessRequest(data) {
  const { tipo, subtipo, nombre, empresa, area, rfc, correo } = data;
  const email = normalizeEmail(correo);

  if (!email) { const err = new Error('Correo requerido'); err.status = 400; throw err; }

  // Verifica que no exista el usuario
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) { const err = new Error('El correo ya está registrado'); err.status = 409; throw err; }

  // Verifica que no haya otra solicitud pendiente
  const pending = await prisma.accessRequest.findFirst({ where: { email, status: 'PENDING' } });
  if (pending) { const err = new Error('Ya existe una solicitud pendiente para este correo'); err.status = 409; throw err; }

  // Mapeo de tipo
  let kind; // INTERNAL | PROVIDER
  let personType = null; // FISICA | MORAL
  let fullName = null;
  let companyName = null;
  let department = null;
  let RFC = null;

  if (tipo === 'usuario') {
    kind = 'INTERNAL';
    fullName = nombre?.trim();
    department = (area || '').toUpperCase();
  } else if (tipo === 'proveedor') {
    kind = 'PROVIDER';
    if (subtipo === 'fisica') {
      personType = 'FISICA';
      fullName = nombre?.trim();
    } else if (subtipo === 'moral') {
      personType = 'MORAL';
      companyName = empresa?.trim();
    } else {
      const err = new Error('Subtipo de proveedor inválido'); err.status = 400; throw err; }
    RFC = rfc?.trim()?.toUpperCase();
  } else {
    const err = new Error('Tipo inválido'); err.status = 400; throw err; }

  if (kind === 'INTERNAL') {
    if (!fullName) { const err = new Error('Nombre requerido'); err.status = 400; throw err; }
    if (!department) { const err = new Error('Área requerida'); err.status = 400; throw err; }
  } else if (kind === 'PROVIDER') {
    if (personType === 'FISICA' && !fullName) { const err = new Error('Nombre requerido'); err.status = 400; throw err; }
    if (personType === 'MORAL' && !companyName) { const err = new Error('Empresa requerida'); err.status = 400; throw err; }
    if (!RFC) { const err = new Error('RFC requerido'); err.status = 400; throw err; }
  }

  const record = await prisma.accessRequest.create({
    data: {
      kind,
      personType,
      fullName,
      companyName,
      department: department || undefined,
      rfc: RFC,
      email,
      status: 'PENDING'
    }
  });

  if (String(process.env.MAILER_DISABLED || 'false') !== 'true') {
    try { await sendAccessRequestAckEmail(email, kind); } catch (_) { /* ignore */ }
  } else {
    console.log(`[DEV] Solicitud de acceso creada #${record.id} para ${email}`);
  }

  return { message: 'Solicitud recibida. Te avisaremos cuando sea revisada.' };
}

export async function listAccessRequests({ status = 'PENDING', limit = 50, cursor }) {
  const where = {};
  if (status) where.status = status;
  const take = Math.min(Number(limit) || 50, 100);
  const query = {
    where,
    orderBy: { id: 'desc' },
    take: take + 1,
    select: {
      id: true,
      kind: true,
      personType: true,
      fullName: true,
      companyName: true,
      department: true,
      rfc: true,
      email: true,
      status: true,
      createdAt: true,
      decidedAt: true,
      createdUserId: true
    }
  };
  if (cursor) query.cursor = { id: Number(cursor) };
  const rows = await prisma.accessRequest.findMany(query);
  const hasMore = rows.length > take;
  return { data: rows.slice(0, take), hasMore, nextCursor: hasMore ? rows[rows.length - 1].id : null };
}

export async function getAccessRequest(id) {
  return prisma.accessRequest.findUnique({
    where: { id: Number(id) },
    include: { decidedBy: { select: { id: true, email: true, fullName: true } }, createdUser: { select: { id: true, email: true, fullName: true } } }
  });
}

function generateTempPassword(len = 10) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const nums = '23456789';
  const all = upper + lower + nums;
  let out = '';
  out += upper[Math.floor(Math.random() * upper.length)];
  out += lower[Math.floor(Math.random() * lower.length)];
  out += nums[Math.floor(Math.random() * nums.length)];
  for (let i = 3; i < len; i++) out += all[Math.floor(Math.random() * all.length)];
  return out.split('').sort(() => Math.random() - 0.5).join('');
}

export async function decideAccessRequest({ id, decision, approverUserId, roles = [], department, notes }) {
  const request = await prisma.accessRequest.findUnique({ where: { id: Number(id) } });
  if (!request) { const err = new Error('Solicitud no encontrada'); err.status = 404; throw err; }
  if (request.status !== 'PENDING') { const err = new Error('Solicitud ya procesada'); err.status = 400; throw err; }

  if (decision === 'REJECTED') {
    if (!notes || !notes.trim()) { const err = new Error('Motivo requerido para rechazo'); err.status = 400; throw err; }
    const updated = await prisma.accessRequest.update({
      where: { id: request.id },
      data: { status: 'REJECTED', decidedAt: new Date(), decidedById: approverUserId, notes }
    });
    if (String(process.env.MAILER_DISABLED || 'false') !== 'true') {
      try { await sendAccessRequestRejectedEmail(request.email, notes); } catch (e) { console.error('Error email rechazo:', e.message); }
    } else {
      console.log(`[DEV] Rechazo para ${request.email} con motivo: ${notes}`);
    }
    await prisma.auditLog.create({ data: { actorId: approverUserId, action: 'ACCESS_REQUEST_REJECTED', entity: 'AccessRequest', entityId: request.id, meta: { notes } } });
    return { message: 'Solicitud rechazada' };
  }

  if (decision !== 'APPROVED') { const err = new Error('Decisión inválida'); err.status = 400; throw err; }

  // Aprobación
  let userRoles = [];
  let userDepartment = 'SIN_ASIGNAR';
  if (request.kind === 'INTERNAL') {
    if (!department) { const err = new Error('Departamento requerido'); err.status = 400; throw err; }
    userDepartment = department;
    if (!roles || roles.length === 0) { const err = new Error('Asignar al menos un rol'); err.status = 400; throw err; }
    userRoles = roles;
  } else if (request.kind === 'PROVIDER') {
    userRoles = ['PROVIDER'];
  }

  // Verificar que roles existen
  const roleRecords = await prisma.role.findMany({ where: { name: { in: userRoles } } });
  console.log('[DEBUG] userRoles:', userRoles, 'roleRecords:', roleRecords.map(r => r.name));
  if (roleRecords.length !== userRoles.length) { 
    const err = new Error(`Rol inválido: esperados ${userRoles.join(', ')}, encontrados ${roleRecords.map(r => r.name).join(', ')}`); 
    err.status = 400; 
    throw err; 
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const user = await prisma.user.create({
    data: {
      email: request.email,
      fullName: request.fullName || request.companyName || 'Sin nombre',
      department: userDepartment,
      passwordHash,
      mustChangePassword: true,
      isActive: true,
      roles: { create: roleRecords.map(r => ({ roleId: r.id })) }
    }
  });

  await prisma.accessRequest.update({
    where: { id: request.id },
    data: { status: 'APPROVED', decidedAt: new Date(), decidedById: approverUserId, createdUserId: user.id }
  });

  if (String(process.env.MAILER_DISABLED || 'false') !== 'true') {
    try { await sendTemporaryPasswordEmail(request.email, tempPassword); } catch (e) { console.error('Error email temp password:', e.message); }
  } else {
    console.log(`[DEV] Temp password para ${request.email}: ${tempPassword}`);
  }

  await prisma.auditLog.create({ data: { actorId: approverUserId, action: 'ACCESS_REQUEST_APPROVED', entity: 'AccessRequest', entityId: request.id, meta: { roles: userRoles, department: userDepartment } } });

  return { message: 'Solicitud aprobada y usuario creado', tempPassword: process.env.MAILER_DISABLED === 'true' ? tempPassword : undefined };
}
