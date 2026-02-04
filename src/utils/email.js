import { mailer } from "../config/mailer.js";

const FROM = process.env.MAIL_FROM || "MBQ Proveedores <no-reply@mbqinc.com>";

async function logMailInfo(info) {
  console.log("Mail enviado:", { messageId: info?.messageId, response: info?.response });

  try {
    const nodemailer = await import("nodemailer");
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) console.log("Preview URL:", preview);
  } catch {
    // ignore
  }
}

async function send({ to, subject, text, html }) {
  try {
    const info = await mailer.sendMail({ from: FROM, to, subject, text, html });
    await logMailInfo(info);
    return info;
  } catch (err) {
    console.error("Error enviando email:", err?.message || err);
    throw err;
  }
}

export function sendLoginCodeEmail(to, code) {
  const subject = "Tu código de acceso";
  const text =
    `Tu código de acceso es: ${code}\n\n` +
    `Este código expira en unos minutos. Si no lo solicitaste, ignora este correo.`;

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;line-height:1.5">
      <h2>Tu código de acceso</h2>
      <p>Usa este código para completar tu inicio de sesión:</p>
      <div style="font-size:24px;font-weight:700;letter-spacing:3px;margin:12px 0;">${code}</div>
      <p>Este código expira en unos minutos. Si no lo solicitaste, puedes ignorar este mensaje.</p>
    </div>
  `;

  return send({ to, subject, text, html });
}

export function sendPasswordResetEmail(to, code) {
  const subject = "Código para restablecer tu contraseña";
  const text =
    `Tu código de recuperación es: ${code}\n\n` +
    `Úsalo para restablecer tu contraseña. Este código expira en 15 minutos.\n\n` +
    `Si no solicitaste esto, ignora este correo.`;

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;line-height:1.5">
      <h2>Restablecer contraseña</h2>
      <p>Usa este código para restablecer tu contraseña:</p>
      <div style="font-size:24px;font-weight:700;letter-spacing:3px;margin:12px 0;background:#f0f9ff;padding:12px;border-radius:8px;">${code}</div>
      <p>Este código expira en <strong>15 minutos</strong>.</p>
      <p>Si no solicitaste este código, puedes ignorar este mensaje.</p>
    </div>
  `;

  return send({ to, subject, text, html });
}

export function sendTemporaryPasswordEmail(to, tempPassword) {
  const subject = "Tu contraseña temporal";
  const text =
    `Se generó una contraseña temporal: ${tempPassword}\n\n` +
    `Por seguridad, inicia sesión y cámbiala de inmediato.`;

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;line-height:1.5">
      <h2>Contraseña temporal</h2>
      <p>Se generó la siguiente contraseña temporal:</p>
      <div style="font-size:20px;font-weight:700;margin:12px 0;">${tempPassword}</div>
      <p>Inicia sesión y cámbiala de inmediato desde tu perfil.</p>
    </div>
  `;

  return send({ to, subject, text, html });
}

export function sendAccessRequestAckEmail(to, kind) {
  const typeLabel = kind === "INTERNAL" ? "usuario" : "proveedor";
  const subject = "Solicitud de acceso recibida";
  const text =
    `Tu solicitud de acceso como ${typeLabel} ha sido recibida.\n\n` +
    `Nos pondremos en contacto pronto para completar el proceso.`;

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;line-height:1.5">
      <h2>Solicitud recibida</h2>
      <p>Tu solicitud de acceso como <strong>${typeLabel}</strong> ha sido recibida correctamente.</p>
      <p>Nos pondremos en contacto pronto para completar el proceso de validación.</p>
      <p>Gracias por tu paciencia.</p>
    </div>
  `;

  return send({ to, subject, text, html });
}

export function sendAccessRequestRejectedEmail(to, reason) {
  const subject = "Tu solicitud de acceso ha sido rechazada";
  const text = `Lamentablemente, tu solicitud de acceso ha sido rechazada.\n\nMotivo: ${reason}`;

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;line-height:1.5">
      <h2>Solicitud rechazada</h2>
      <p>Lamentablemente, tu solicitud de acceso ha sido rechazada.</p>
      <p><strong>Motivo:</strong></p>
      <p style="background:#fee;padding:10px;border-radius:4px;">${reason}</p>
      <p>Si tienes preguntas, contacta al administrador.</p>
    </div>
  `;

  return send({ to, subject, text, html });
}

export function sendPurchaseOrderApprovedEmail(to, order) {
  const subject = `Orden ${order.number} aprobada`;
  const text = `Tu orden ${order.number} por ${order.total || ""} ha sido aprobada.`;

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;line-height:1.5">
      <h2>Orden aprobada</h2>
      <p>La orden <strong>${order.number}</strong> ha sido aprobada.</p>
      <p><strong>Monto:</strong> ${order.total || ""}</p>
      <p>Si necesitas más información, consulta tu panel de proveedor.</p>
    </div>
  `;

  return send({ to, subject, text, html });
}

export function sendPurchaseOrderRejectedEmail(to, order, reason) {
  const subject = `Orden ${order.number} rechazada`;
  const text = `Tu orden ${order.number} ha sido rechazada. Motivo: ${reason}`;

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;line-height:1.5">
      <h2>Orden rechazada</h2>
      <p>La orden <strong>${order.number}</strong> ha sido rechazada.</p>
      <p><strong>Motivo:</strong></p>
      <div style="background:#fee;padding:10px;border-radius:4px;">${reason}</div>
      <p>Si crees que esto es un error, contacta al administrador.</p>
    </div>
  `;

  return send({ to, subject, text, html });
}

export function sendDocumentApprovedEmail(to, docType) {
  const subject = `Documento ${docType} aprobado`;
  const text = `Tu documento ${docType} ha sido aprobado.`;

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;line-height:1.5">
      <h2>Documento aprobado</h2>
      <p>Tu documento <strong>${docType}</strong> ha sido aprobado correctamente.</p>
      <p>Puedes continuar con el proceso de validación de tu perfil.</p>
    </div>
  `;

  return send({ to, subject, text, html });
}

export function sendDocumentRejectedEmail(to, docType, reason) {
  const subject = `Documento ${docType} rechazado`;
  const text = `Tu documento ${docType} ha sido rechazado. Motivo: ${reason}`;

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;line-height:1.5">
      <h2>Documento rechazado</h2>
      <p>Tu documento <strong>${docType}</strong> ha sido rechazado.</p>
      <p><strong>Motivo:</strong></p>
      <div style="background:#fee;padding:10px;border-radius:4px;">${reason}</div>
      <p>Por favor, sube nuevamente el documento corregido.</p>
    </div>
  `;

  return send({ to, subject, text, html });
}

export function sendPaymentRegisteredEmail(to, payment, purchaseOrder) {
  const subject = `Pago registrado - Orden ${purchaseOrder.number}`;
  const text = `Se ha registrado un pago por ${payment.amount} para la orden ${purchaseOrder.number}.`;

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;line-height:1.5">
      <h2>Pago registrado</h2>
      <p>Se ha registrado un pago para la orden <strong>${purchaseOrder.number}</strong>.</p>
      <p><strong>Proveedor:</strong> ${purchaseOrder.provider?.businessName || ""}</p>
      <p><strong>Monto:</strong> ${payment.amount}</p>
      <p><strong>Fecha de pago:</strong> ${new Date(payment.paidAt).toLocaleDateString()}</p>
      <p>Si tienes dudas, contacta al área de finanzas.</p>
    </div>
  `;

  return send({ to, subject, text, html });
}

export function sendProviderWelcomeEmail(to, provider, tempPassword, personType) {
  const subject = "Alta de proveedor - Acceso al portal";
  const tipo =
    personType === "FISICA"
      ? "Persona Física"
      : personType === "MORAL"
      ? "Persona Moral"
      : "Proveedor";

  const text =
    `Bienvenido/a ${provider.businessName}\n\n` +
    `Tu registro como ${tipo} fue creado.\n` +
    `RFC: ${provider.rfc}\n` +
    `Contraseña temporal: ${tempPassword}\n\n` +
    `Inicia sesión y cambia tu contraseña inmediatamente.\n` +
    `Si no solicitaste este acceso contacta al administrador.`;

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;line-height:1.5">
      <h2>Bienvenido/a</h2>
      <p>Tu registro como <strong>${tipo}</strong> ha sido creado correctamente.</p>
      <p><strong>Razón Social / Nombre:</strong> ${provider.businessName}</p>
      <p><strong>RFC:</strong> ${provider.rfc}</p>
      <p style="margin-top:16px">Utiliza la siguiente contraseña temporal para iniciar sesión y cámbiala de inmediato:</p>
      <div style="font-size:20px;font-weight:700;margin:12px 0;background:#f0f9ff;padding:12px;border-radius:8px;">${tempPassword}</div>
      <p style="font-size:14px;color:#444">Por seguridad, esta contraseña debe ser cambiada al primer acceso.</p>
      <p style="margin-top:20px;font-size:12px;color:#666">Si no solicitaste este acceso, contacta al administrador.</p>
    </div>
  `;

  return send({ to, subject, text, html });
}
