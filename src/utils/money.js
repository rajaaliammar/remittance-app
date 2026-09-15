/**
 * Decimal-safe monetary helpers.
 * All arithmetic goes through integer cents to avoid IEEE-754 drift.
 */

const RATE_SCALE = 1_000_000; // 6 decimal places for FX rates (matches Prisma Decimal(18,6))

function assertFiniteNumber(value, label = 'amount') {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new TypeError(`Invalid ${label}: ${value}`);
  }
  return n;
}

/** Convert a major-unit amount (e.g. 12.34) to integer cents. */
export function toCents(amount) {
  const n = assertFiniteNumber(amount);
  // Number(`${n}e2`) avoids IEEE-754 artifacts like 1.005 * 100 === 100.4999…
  return Math.round(Number(`${n}e2`));
}

/** Convert integer cents back to a major-unit number with exactly 2 decimal places. */
export function fromCents(cents) {
  const c = Math.round(assertFiniteNumber(cents, 'cents'));
  return Number(`${c}e-2`);
}

/** Round a major-unit amount to currency precision (2 dp) via cents. */
export function roundMoney(amount) {
  return fromCents(toCents(amount));
}

/** Add two major-unit amounts safely. */
export function addMoney(a, b) {
  return fromCents(toCents(a) + toCents(b));
}

/** Subtract major-unit amounts safely (a - b). */
export function subtractMoney(a, b) {
  return fromCents(toCents(a) - toCents(b));
}

/**
 * Multiply a major-unit amount by an FX rate and round to cents.
 * Uses fixed-point scaling so send * rate does not accumulate float error.
 */
export function multiplyByRate(amount, rate) {
  const amountCents = toCents(amount);
  const rateScaled = Math.round(assertFiniteNumber(rate, 'rate') * RATE_SCALE);
  // (amountCents * rateScaled) / RATE_SCALE  → receive cents (rounded)
  const receiveCents = Math.round((amountCents * rateScaled) / RATE_SCALE);
  return fromCents(receiveCents);
}

/**
 * Absolute relative drift between two amounts: |a - b| / max(|b|, epsilon).
 * Returns a ratio (0.005 = 0.5%).
 */
export function relativeDrift(a, b) {
  const aCents = toCents(a);
  const bCents = toCents(b);
  const denom = Math.max(Math.abs(bCents), 1);
  return Math.abs(aCents - bCents) / denom;
}

/**
 * True when |client - server| / |server| exceeds maxDrift (default 0.5%).
 */
export function exceedsDrift(clientAmount, serverAmount, maxDrift = 0.005) {
  if (!Number.isFinite(Number(clientAmount))) return false;
  return relativeDrift(clientAmount, serverAmount) > maxDrift;
}

export default {
  toCents,
  fromCents,
  roundMoney,
  addMoney,
  subtractMoney,
  multiplyByRate,
  relativeDrift,
  exceedsDrift,
};
