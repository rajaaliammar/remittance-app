/**
 * Accept.blue API Service
 *
 * Wraps all HTTP interactions with the Accept.blue payment gateway.
 * Uses Basic Auth (API key as username, PIN as password).
 */

/** Read env at call time — process.env is populated after env-bootstrap runs. */
function getBaseUrl() {
  return (process.env.ACCEPTBLUE_BASE_URL || 'https://api.accept.blue/api/v2').replace(/\/+$/, '');
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

export default {
  isAcceptBlueConfigured,
  createCustomer,
  getCustomer,
  verifyCard,
  createPaymentMethod,
  listPaymentMethods,
  deletePaymentMethod,
  createCharge,
};
