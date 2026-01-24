import nodemailer from 'nodemailer';

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  MAILER_DISABLED
} = process.env;

const useStreamTransport = String(MAILER_DISABLED || 'false') === 'true' || !SMTP_HOST;

export const mailer = useStreamTransport
  ? nodemailer.createTransport({ streamTransport: true, newline: 'unix', buffer: true })
  : nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT || 587),
      secure: String(SMTP_SECURE || 'false') === 'true',
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
      logger: true,
      debug: true
    });

export async function verifyMailer() {
  try {
    await mailer.verify();
    console.log('Mailer: transporte SMTP OK');
  } catch (err) {
    console.warn('Mailer: no se pudo verificar SMTP:', err.message);
  }
}