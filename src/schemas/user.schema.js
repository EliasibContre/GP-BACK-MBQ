import { z } from 'zod';

export const createUserSchema = z.object({
  fullName: z.string().min(3, 'Nombre completo requerido').transform(s => s.trim()),
  email: z.string().email('Email inválido')
    .transform(s => s.trim().toLowerCase())
    .refine(v => v.endsWith('@mbqinc.com') || v.endsWith('@gmail.com'), 'Solo se permiten correos @mbqinc.com o @gmail.com'),
  // 'aprobador' -> roleId 2, 'administrador' -> roleId 3
  role: z.enum(['aprobador', 'administrador']),
  department: z.enum([
    'SIN_ASIGNAR','RH','FINANZAS','COMPRAS','TI','VENTAS','MARKETING','OPERACIONES','LOGISTICA','CALIDAD','DIRECCION_GENERAL'
  ])
});

export const updateUserSchema = z.object({
  fullName: z.string().min(3, 'Nombre completo requerido').transform(s => s.trim()).optional(),
  department: z.enum([
    'SIN_ASIGNAR','RH','FINANZAS','COMPRAS','TI','VENTAS','MARKETING','OPERACIONES','LOGISTICA','CALIDAD','DIRECCION_GENERAL'
  ]).optional(),
  role: z.enum(['aprobador', 'administrador']).optional(),
  isActive: z.boolean().optional(),
});

export const updateMeSchema = z.object({
  fullName: z.string().min(3, 'Nombre completo requerido').optional(),
  department: z.enum([
    'SIN_ASIGNAR','RH','FINANZAS','COMPRAS','TI','VENTAS','MARKETING',
    'OPERACIONES','LOGISTICA','CALIDAD','DIRECCION_GENERAL'
  ]).optional(),
  phone: z.string().min(7, 'Teléfono inválido').optional()
});