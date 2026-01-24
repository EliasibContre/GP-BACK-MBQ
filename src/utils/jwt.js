import jwt from 'jsonwebtoken';

const SECRET  = process.env.JWT_SECRET || 'dev-secret';
const EXPIRES = process.env.TOKEN_EXPIRES || '8h';

export function signJwt(payload, opts = {}) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES, ...opts });
}

export function verifyJwt(token) {
  return jwt.verify(token, SECRET);
}