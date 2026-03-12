// src/schemas/auth.schema.js
import { z } from "zod";

const passwordRule = z
  .string()
  .min(8, "Mínimo 8 caracteres")
  .regex(/[A-Z]/, "Debe incluir al menos 1 mayúscula")
  .regex(/[a-z]/, "Debe incluir al menos 1 minúscula")
  .regex(/[0-9]/, "Debe incluir al menos 1 dígito");

const corporateEmailRule = z
  .string()
  .email("Email inválido")
  .transform((v) => v.trim().toLowerCase())
  .refine((v) => v.endsWith("@mbqinc.com"), {
    message: "Solo se permiten correos @mbqinc.com",
  });

export const registerSchema = z.object({
  email: corporateEmailRule,
  fullName: z
    .string()
    .min(3, "Nombre muy corto")
    .max(120)
    .transform((v) => v.trim()),
  password: passwordRule,
  roles: z.array(z.enum(["ADMIN", "APPROVER", "PROVIDER"])).default(["APPROVER"]).optional(),
});

// Paso 1: credenciales (email + password)
export const loginStartSchema = z.object({
  email: corporateEmailRule,
  password: z.string().min(1, "Requerido"),
});

// Paso 2: verificación de código (email + code)
export const loginVerifySchema = z.object({
  email: corporateEmailRule,
  code: z.string().min(4).max(10),
});

export const loginResendSchema = z.object({
  email: corporateEmailRule,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z
    .string()
    .min(8, "Mínimo 8 caracteres")
    .regex(/[A-Z]/, "Debe incluir al menos 1 mayúscula")
    .regex(/[a-z]/, "Debe incluir al menos 1 minúscula")
    .regex(/[0-9]/, "Debe incluir al menos 1 dígito"),
});

export const passwordResetRequestSchema = z.object({
  email: corporateEmailRule,
});

export const passwordResetConfirmSchema = z.object({
  email: corporateEmailRule,
  token: z.string().min(4, "Token requerido"),
  newPassword: z
    .string()
    .min(8, "Mínimo 8 caracteres")
    .regex(/[A-Z]/, "Debe incluir al menos 1 mayúscula")
    .regex(/[a-z]/, "Debe incluir al menos 1 minúscula")
    .regex(/[0-9]/, "Debe incluir al menos 1 dígito"),
});