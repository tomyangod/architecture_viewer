'use strict';

const crypto = require('crypto');

function secret() {
  const s = process.env.ARCH_PRO_SECRET || '';
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    const err = new Error('生产环境必须设置 ARCH_PRO_SECRET');
    err.status = 500;
    throw err;
  }
  return 'dev-only-change-me';
}

function key32() {
  return crypto.createHash('sha256').update(secret()).digest();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 2) return false;
  const salt = Buffer.from(parts[0], 'hex');
  const expected = Buffer.from(parts[1], 'hex');
  const actual = crypto.scryptSync(password, salt, 32);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function encrypt(plain) {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key32(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + enc.toString('hex');
}

function decrypt(packed) {
  if (!packed) return '';
  const parts = String(packed).split(':');
  if (parts.length !== 3) return '';
  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const enc = Buffer.from(parts[2], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key32(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

function hmacHex(text) {
  return crypto.createHmac('sha256', secret()).update(String(text)).digest('hex');
}

function randomToken(bytes) {
  return crypto.randomBytes(bytes || 24).toString('hex');
}

module.exports = {
  secret,
  hashPassword,
  verifyPassword,
  encrypt,
  decrypt,
  hmacHex,
  randomToken
};
