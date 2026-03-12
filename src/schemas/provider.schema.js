import { z } from 'zod';

const RFC_REGEX = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i;

export const createProviderSchema = z.object({
  body: z.object({
    businessName: z.string().trim().min(3, 'Razón social muy corta'),
    rfc: z.string().trim().regex(RFC_REGEX, 'RFC inválido'),
    emailContacto: z.string().trim().email('Email inválido'),
    telefono: z.string().trim().optional(),
    direccionFiscal: z.string().trim().optional(),
    observaciones: z.string().trim().optional(),
    bankName: z.string().trim().optional(),
    clabe: z.string().trim()
      .optional()
      .refine(
        val => !val || val === '' || /^\d{18,21}$/.test(val),
        'CLABE o cuenta bancaria debe tener 18-21 dígitos si se proporciona'
      ),
    personType: z.enum(['FISICA','MORAL']).optional(),
    tipoProveedor: z.enum(['fisica','moral']).optional() // soporte para payload frontend existente
  })
});

export const updateProviderSchema = z.object({
  params: z.object({ id: z.string().regex(/^\d+$/) }),
  body: z.object({
    businessName: z.string().min(3).optional(),
    rfc: z.string().regex(RFC_REGEX, 'RFC inválido').optional(),
    emailContacto: z.string().email().optional(),
    telefono: z.string().optional(),
    direccionFiscal: z.string().optional(),
    observaciones: z.string().optional(),
    bankName: z.string().optional(),
    clabe: z.string()
      .optional()
      .refine(
        val => !val || val === '' || /^\d{18,21}$/.test(val),
        'CLABE o cuenta bancaria debe tener 18-21 dígitos si se proporciona'
      ),
      newPassword: z.string().min(8, 'La nueva contraseña debe tener al menos 8 caracteres').optional()
  })
});

export const inactivateProviderSchema = z.object({
  params: z.object({ id: z.string().regex(/^\d+$/) }),
  body: z.object({
    reason: z.string().min(3),
    notes: z.string().optional()
  })
});

export const updateMyProviderSchema = z.object({
  body: z.object({
    businessName: z.string().min(3).optional(),
    fiscalAddress: z.string().min(5).optional(),
    fullName: z.string().min(3).optional(),
    contactPosition: z.string().min(2).optional(),
    phone: z.string().optional(),
    clabe: z.string()
      .optional()
      .refine(
        val => !val || val === '' || /^\d{18,21}$/.test(val),
        'CLABE o cuenta bancaria debe tener 18-21 dígitos si se proporciona'
      ),
    bankName: z.string().min(3).optional(),
    bankAccountId: z.number().optional()
  })
});