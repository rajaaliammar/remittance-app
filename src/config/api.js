/**
 * External BrandPay API base URL.
 * Used when the backend needs to call apibrandpay.appliedline.com (e.g. verifications, accounts).
 * Set EXTERNAL_API_URL in .env to override (e.g. for staging). No trailing slash.
 */
const base = (process.env.EXTERNAL_API_URL || 'https://apibrandpay.appliedline.com').replace(/\/+$/, '');
export const EXTERNAL_API_BASE = base;
export const EXTERNAL_API_URL = `${base}/api`;
