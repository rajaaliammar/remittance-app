/**
 * Accept.blue API Service
 *
 * Wraps all HTTP interactions with the Accept.blue payment gateway.
 * Uses Basic Auth (API key as username, PIN as password).
 */

const BASE_URL = process.env.ACCEPTBLUE_BASE_URL || 'https://api.accept.blue/api/v2';
const API_KEY = process.env.ACCEPTBLUE_API_KEY || '';
const PIN = process.env.ACCEPTBLUE_PIN || '';

function getAuthHeader() {
  const credentials = Buffer.from(`${API_KEY}:${PIN}`).toString('base64');
  return `Basic ${credentials}`;
}

async function request(method, path, body = null) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Authorization': getAuthHeader(),
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.message || data.error || `Accept.blue API error (${response.status})`);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

/**
 * Create a customer profile in Accept.blue.
 * @param {{ name: string, email: string }} customerData
 * @returns {Promise<{ id: number|string }>}
 */
export async function createCustomer({ name, email }) {
  return request('POST', '/customers', {
    name,
    email,
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
  return request('POST', '/transactions/verify', {
    card,
    expiry_month,
    expiry_year,
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
  return request('POST', `/customers/${customerId}/payment-methods`, {
    card,
    expiry_month,
    expiry_year,
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
 * @param {{ customer_id: string|number, payment_method_id: string|number, amount: number, description?: string }} chargeData
 */
export async function createCharge({ customer_id, payment_method_id, amount, description }) {
  return request('POST', '/transactions/charge', {
    customer_id,
    source: `payment-method:${payment_method_id}`,
    amount,
    description: description || undefined,
  });
}

export default {
  createCustomer,
  getCustomer,
  verifyCard,
  createPaymentMethod,
  listPaymentMethods,
  deletePaymentMethod,
  createCharge,
};
