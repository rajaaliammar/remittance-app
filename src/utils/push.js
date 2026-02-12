/**
 * Server-side push notification utility (FCM).
 * Optional: set FIREBASE_SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS
 * to enable sending. If not set, all send functions no-op.
 */
import prisma from './prisma.js';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let messaging = null;

function getMessaging() {
  if (messaging !== null) return messaging;
  try {
    const admin = require('firebase-admin');
    if (admin.apps.length === 0) {
      const credPath =
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
        process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (credPath) {
        const resolved = path.isAbsolute(credPath)
          ? credPath
          : path.resolve(process.cwd(), credPath);
        const key = JSON.parse(fs.readFileSync(resolved, 'utf8'));
        admin.initializeApp({ credential: admin.credential.cert(key) });
      } else {
        messaging = false;
        return false;
      }
    }
    messaging = admin.messaging();
    return messaging;
  } catch (e) {
    console.warn('[PUSH] Firebase Admin not available:', e?.message || e);
    messaging = false;
    return false;
  }
}

/**
 * Send a push notification to an FCM token.
 * @param {string} fcmToken - Device FCM token
 * @param {{ title: string, body?: string, data?: object }} options - title, body, and optional data payload
 * @returns {Promise<boolean>} - true if sent, false if skipped/failed
 */
/** FCM data payload values must be strings */
function stringifyData(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

export async function sendPushToToken(fcmToken, { title, body = '', data = {} }) {
  const m = getMessaging();
  if (!m || !fcmToken) return false;
  try {
    const dataPayload = stringifyData({ ...data, title: String(title), body: String(body) });
    const message = {
      notification: { title, body },
      data: dataPayload,
      android: { data: dataPayload },
      apns: {
        payload: { aps: { sound: 'default' } },
        fcmOptions: {},
      },
      token: fcmToken,
    };
    await m.send(message);
    return true;
  } catch (e) {
    if (e?.code === 'messaging/registration-token-not-registered') {
      // Token invalid; caller may want to clear it from DB
      console.warn('[PUSH] Token invalid, consider clearing from customer:', e?.message);
    } else {
      console.warn('[PUSH] sendPushToToken failed:', e?.message || e);
    }
    return false;
  }
}

/**
 * Send a push notification to a customer by ID (uses stored fcmToken).
 * @param {string} customerId - Customer id
 * @param {{ title: string, body?: string, data?: object }} options - title, body, and optional data (e.g. type, screen)
 * @returns {Promise<boolean>} - true if sent, false if skipped/failed
 */
export async function sendPushToCustomer(customerId, { title, body = '', data = {} }) {
  if (!customerId) return false;
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { fcmToken: true },
    });
    if (!customer?.fcmToken) return false;
    return sendPushToToken(customer.fcmToken, { title, body, data });
  } catch (e) {
    console.warn('[PUSH] sendPushToCustomer failed:', e?.message || e);
    return false;
  }
}
