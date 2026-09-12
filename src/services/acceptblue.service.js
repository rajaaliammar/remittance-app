/**
 * Accept.blue API Service
 *
 * Wraps all HTTP interactions with the Accept.blue payment gateway.
 * Uses Basic Auth (API key as username, PIN as password).
 */

/** Ensure ACCEPTBLUE_BASE_URL is an absolute http(s) URL (common .env mistake: missing protocol). */
function getBaseUrl() {
  const fallback = 'https://api.accept.blue/api/v2';
  let url = String(process.env.ACCEPTBLUE_BASE_URL || fallback).trim().replace(/\/+$/, '');
  if (!url) url = fallback;
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url.replace(/^\/+/, '')}`;
  }
  return url.replace(/\/+$/, '');
}

function getApiKey() {
  return process.env.ACCEPTBLUE_API_KEY || '';
}

function getPin() {
  return process.env.ACCEPTBLUE_PIN || '';
}

export function isAcceptBlueConfigured() {
  return Boolean(String(getApiKey()).trim() && String(getPin()).trim());
}

function getAuthHeader() {
  const credentials = Buffer.from(`${getApiKey()}:${getPin()}`).toString('base64');
  return `Basic ${credentials}`;
}

async function request(method, path, body = null) {
  if (!isAcceptBlueConfigured()) {
    const err = new Error(
      'Accept.blue is not configured. Set ACCEPTBLUE_API_KEY and ACCEPTBLUE_PIN (and ACCEPTBLUE_BASE_URL for sandbox).'
    );
    err.status = 503;
    throw err;
  }

  const url = `${getBaseUrl()}${path}`;
  const headers = {
    Authorization: getAuthHeader(),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const base =
      data.error_message ||
      data.message ||
      data.error ||
      data.detail ||
      `Accept.blue API error (${response.status})`;
    const required = data.error_details?.required;
    const suffix =
      Array.isArray(required) && required.length
        ? ` Missing or invalid: ${required.join(', ')}.`
        : '';
    const error = new Error(`${base}${suffix}`);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

/**
 * Create a customer profile in Accept.blue.
 * API expects identifier + customer_number + email + active + first_name/last_name
 * (see e.g. Pinelab Accept Blue client — `name` alone is rejected).
 *
 * @param {{ email: string, firstName?: string|null, lastName?: string|null }} customerData
 * @returns {Promise<{ id: number|string }>}
 */
export async function createCustomer({ email, firstName, lastName }) {
  const emailTrim = String(email || '').trim();
  if (!emailTrim) {
    const err = new Error('Customer email is required for Accept.blue');
    err.status = 400;
    throw err;
  }
  const fn = String(firstName || '').trim() || 'Customer';
  const ln = String(lastName || '').trim() || fn;

  return request('POST', '/customers', {
    identifier: emailTrim,
    customer_number: emailTrim,
    email: emailTrim,
    active: true,
    first_name: fn,
    last_name: ln,
  });
}

/**
 * Retrieve a customer by their Accept.blue customer ID.
 * @param {string|number} customerId
 */
export async function getCustomer(customerId) {
  return request('GET', `/customers/${customerId}`);
}

/**
 * Validate a card by running a $0 authorization (verify-only).
 * @param {{ card: string, expiry_month: string, expiry_year: string, cvv: string, zip?: string }} cardData
 * @returns verification result
 */
export async function verifyCard({ card, expiry_month, expiry_year, cvv, zip }) {
  const month = parseInt(String(expiry_month).replace(/\D/g, ''), 10);
  let year = parseInt(String(expiry_year).replace(/\D/g, ''), 10);
  if (!Number.isFinite(year)) year = 0;
  if (year > 0 && year < 100) year += 2000;

  return request('POST', '/transactions/verify', {
    card,
    expiry_month: month,
    expiry_year: year,
    cvv,
    zip: zip || undefined,
    amount: 0,
  });
}

/**
 * Create (vault) a payment method attached to a customer.
 * This tokenizes the card under the customer's profile.
 * @param {string|number} customerId - Accept.blue customer ID
 * @param {{ card: string, expiry_month: string, expiry_year: string, cvv: string, name?: string, zip?: string }} cardData
 */
export async function createPaymentMethod(customerId, { card, expiry_month, expiry_year, cvv, name, zip }) {
  const month = parseInt(String(expiry_month).replace(/\D/g, ''), 10);
  let year = parseInt(String(expiry_year).replace(/\D/g, ''), 10);
  if (!Number.isFinite(year)) year = 0;
  if (year > 0 && year < 100) year += 2000;

  return request('POST', `/customers/${customerId}/payment-methods`, {
    card,
    expiry_month: month,
    expiry_year: year,
    cvv,
    name: name || undefined,
    avs_zip: zip || undefined,
  });
}

/**
 * List all payment methods for a customer.
 * @param {string|number} customerId
 */
export async function listPaymentMethods(customerId) {
  return request('GET', `/customers/${customerId}/payment-methods`);
}

/**
 * Delete a payment method from Accept.blue.
 * @param {string|number} paymentMethodId
 */
export async function deletePaymentMethod(paymentMethodId) {
  return request('DELETE', `/payment-methods/${paymentMethodId}`);
}

/**
 * Charge a saved payment method.
 * Accept.blue expects `source: "pm-{paymentMethodId}"` (numeric id; prefix normalized here).
 *
 * @param {{ payment_method_id: string|number, amount: number, description?: string }} chargeData
 */
export async function createCharge({ payment_method_id, amount, description }) {
  const raw = String(payment_method_id).replace(/^pm-/i, '');
  return request('POST', '/transactions/charge', {
    source: `pm-${raw}`,
    amount,
    description: description || undefined,
  });
}

function toReferenceNumber(reference) {
  const n = Number(String(reference ?? '').replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function assertProcessingSuccess(data, action) {
  const status = String(data?.status ?? '').toLowerCase();
  const errorMessage =
    data?.error_message || data?.errorMessage || data?.error || data?.detail || null;
  if (errorMessage || ['error', 'declined', 'failed'].includes(status)) {
    const err = new Error(
      `Accept.blue ${action} failed: ${errorMessage || data?.status || 'unknown provider error'}`,
    );
    err.status = 502;
    err.code = 'ACCEPTBLUE_REFUND_FAILED';
    err.details = data;
    throw err;
  }
  return data;
}

/**
 * Fetch a processed transaction by Accept.blue id / reference number.
 * @param {string|number} transactionId
 */
export async function getTransaction(transactionId) {
  const ref = toReferenceNumber(transactionId);
  if (!ref) {
    const err = new Error('Accept.blue transaction lookup requires a numeric reference.');
    err.status = 400;
    throw err;
  }
  return request('GET', `/transactions/${ref}`);
}

/**
 * Void an unsettled (same-day) charge. Body uses `reference_number`.
 * @param {{ reference_number: string|number }} params
 */
export async function voidTransaction({ reference_number }) {
  const ref = toReferenceNumber(reference_number);
  if (!ref) {
    const err = new Error('Accept.blue void requires a numeric transaction reference.');
    err.status = 400;
    throw err;
  }
  const data = await request('POST', '/transactions/void', { reference_number: ref });
  return assertProcessingSuccess(data, 'void');
}

/**
 * Refund a settled charge back to the original card. Body uses `reference_number`.
 * @param {{ reference_number: string|number, amount?: number }} params
 */
export async function refundTransaction({ reference_number, amount }) {
  const ref = toReferenceNumber(reference_number);
  if (!ref) {
    const err = new Error('Accept.blue refund requires a numeric transaction reference.');
    err.status = 400;
    throw err;
  }
  const body = { reference_number: ref };
  if (amount != null && Number.isFinite(Number(amount))) {
    body.amount = Number(Number(amount).toFixed(2));
  }
  const data = await request('POST', '/transactions/refund', body);
  return assertProcessingSuccess(data, 'refund');
}

function isAlreadyReversedStatus(status) {
  const s = String(status || '').toLowerCase();
  return ['voided', 'cancelled', 'canceled', 'refunded'].includes(s);
}

function isSettledStatus(status) {
  return String(status || '').toLowerCase() === 'settled';
}

/**
 * Same-rail card reversal: void if the charge has not settled, otherwise refund.
 * Throws with the provider message; callers must not mark the remittance refunded.
 *
 * @param {{ reference_number: string|number, amount?: number }} params
 * @returns {Promise<{ method: 'void'|'refund'|'already_reversed', originalReference: number, response: object }>}
 */
export async function voidOrRefund({ reference_number, amount }) {
  const ref = toReferenceNumber(reference_number);
  if (!ref) {
    const err = new Error('Accept.blue void/refund requires a numeric transaction reference.');
    err.status = 400;
    err.code = 'MISSING_CARD_CHARGE_REF';
    throw err;
  }

  let settled = false;
  try {
    const existing = await getTransaction(ref);
    if (isAlreadyReversedStatus(existing?.status)) {
      return { method: 'already_reversed', originalReference: ref, response: existing };
    }
    settled = isSettledStatus(existing?.status);
  } catch {
    // Lookup is advisory; fall through to void then refund.
  }

  const tryRefund = async (priorErr) => {
    try {
      const response = await refundTransaction({ reference_number: ref, amount });
      return { method: 'refund', originalReference: ref, response };
    } catch (refundErr) {
      const error = new Error(
        `Accept.blue void/refund failed: ${refundErr.message || priorErr?.message || 'unknown provider error'}`,
      );
      error.status = refundErr.status || priorErr?.status || 502;
      error.code = 'ACCEPTBLUE_REFUND_FAILED';
      error.details = {
        void: priorErr?.details || priorErr?.message || null,
        refund: refundErr.details || refundErr.message,
      };
      throw error;
    }
  };

  if (settled) {
    return tryRefund(null);
  }

  try {
    const response = await voidTransaction({ reference_number: ref });
    return { method: 'void', originalReference: ref, response };
  } catch (voidErr) {
    return tryRefund(voidErr);
  }
}

export default {
  isAcceptBlueConfigured,
  createCustomer,
  getCustomer,
  verifyCard,
  createPaymentMethod,
  listPaymentMethods,
  deletePaymentMethod,
  createCharge,
  getTransaction,
  voidTransaction,
  refundTransaction,
  voidOrRefund,
};
