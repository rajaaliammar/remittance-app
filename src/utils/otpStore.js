/**
 * Short-lived OTP codes for phone/email verification (signup + forgot PIN).
 * Codes are hashed in memory; never return plaintext OTP to clients when SMTP works.
 */

import crypto from 'crypto';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
/** @type {Map<string, { hash: string, expiresAt: number }>} */
const store = new Map();

function normalizeKey(kind, value) {
  return `${kind}:${String(value || '').trim().toLowerCase()}`;
}

export function generateOtpCode(length = 6) {
  const digits = '0123456789';
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i += 1) {
    out += digits[bytes[i] % 10];
  }
  // Avoid leading zero ambiguity in some SMS/email clients
  if (out[0] === '0') out = `1${out.slice(1)}`;
  return out;
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code).trim()).digest('hex');
}

export function saveOtp(kind, value, code, ttlMs = DEFAULT_TTL_MS) {
  const key = normalizeKey(kind, value);
  store.set(key, {
    hash: hashOtp(code),
    expiresAt: Date.now() + ttlMs,
  });
  return key;
}

export function consumeOtp(kind, value, code) {
  const key = normalizeKey(kind, value);
  const entry = store.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return false;
  }
  const ok = entry.hash === hashOtp(code);
  if (ok) store.delete(key);
  return ok;
}

export function peekOtpValid(kind, value, code) {
  const key = normalizeKey(kind, value);
  const entry = store.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return false;
  }
  return entry.hash === hashOtp(code);
}

export function clearOtp(kind, value) {
  store.delete(normalizeKey(kind, value));
}

export function hasOtp(kind, value) {
  const key = normalizeKey(kind, value);
  const entry = store.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return false;
  }
  return true;
}
