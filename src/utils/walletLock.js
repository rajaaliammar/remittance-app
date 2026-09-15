/**
 * Row-level wallet locking for concurrent debit/credit operations.
 * Uses SELECT … FOR UPDATE inside a Prisma interactive transaction.
 * Balance math uses integer-cents helpers to avoid float drift.
 */

import { toCents, fromCents, roundMoney } from './money.js';

export class WalletError extends Error {
  constructor(message, statusCode = 400, code = null) {
    super(message);
    this.name = 'WalletError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export async function lockCustomerWallet(tx, customerId) {
  const rows = await tx.$queryRaw`
    SELECT "availableBalance" FROM customers WHERE id = ${customerId} FOR UPDATE
  `;
  const row = rows?.[0];
  if (!row) {
    throw new WalletError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
  }
  const balance =
    row.availableBalance != null ? roundMoney(row.availableBalance) : 0;
  return balance;
}

export async function creditCustomerWallet(tx, customerId, amount) {
  const current = await lockCustomerWallet(tx, customerId);
  const credit = roundMoney(amount);
  if (!Number.isFinite(credit) || credit < 0) {
    throw new WalletError('Invalid credit amount', 400);
  }
  const newBalance = fromCents(toCents(current) + toCents(credit));
  // Atomic increment under the row lock (availableBalance = availableBalance + amount).
  await tx.$executeRaw`
    UPDATE customers
    SET "availableBalance" = COALESCE("availableBalance", 0) + ${credit}, "updatedAt" = NOW()
    WHERE id = ${customerId}
  `;
  return { previousBalance: current, newBalance };
}

export async function debitCustomerWallet(tx, customerId, amount) {
  const current = await lockCustomerWallet(tx, customerId);
  const debit = roundMoney(amount);
  if (!Number.isFinite(debit) || debit < 0) {
    throw new WalletError('Invalid debit amount', 400);
  }
  if (toCents(current) < toCents(debit)) {
    throw new WalletError(
      `Insufficient balance. Available: ${current.toFixed(2)}, required: ${debit.toFixed(2)}`,
      400,
      'INSUFFICIENT_BALANCE',
    );
  }
  const newBalance = fromCents(toCents(current) - toCents(debit));
  await tx.$executeRaw`
    UPDATE customers
    SET "availableBalance" = ${newBalance}, "updatedAt" = NOW()
    WHERE id = ${customerId}
  `;
  return { previousBalance: current, newBalance };
}
