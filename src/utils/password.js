import bcrypt from 'bcryptjs';

const SALT_ROUNDS = Number(process.env.PASSWORD_SALT_ROUNDS || 10);

export async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export function generateTempPassword(length = 12) {
  const lowers = 'abcdefghijklmnopqrstuvwxyz';
  const uppers = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  const symbols = '!@#$%^&*()-_=+[]{}|;:,.<>?';
  const all = lowers + uppers + digits + symbols;
  const pick = s => s[Math.floor(Math.random() * s.length)];

  let psw = pick(lowers) + pick(uppers) + pick(digits) + pick(symbols); 
  while (psw.length < length) psw += pick(all);
  return psw.split("").sort(() => 0.5 - Math.random()).join("");
}