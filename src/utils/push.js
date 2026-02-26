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
 * Uses both notification and data payloads so the message is delivered and shown by the system
 * even when the app is closed; the user sees it in the notification tray and when they open the app.
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

export async function sendPushToToken(fcmToken, { title, body = '', image, data = {} }) {
  const m = getMessaging();
  if (!m || !fcmToken) return false;
  try {
    const dataPayload = stringifyData({
      ...data,
      title: String(title),
      body: String(body),
      ...(image && { image: String(image) }),
    });
    const notification = { title, body };
    if (image && typeof image === 'string' && image.trim()) {
      notification.image = image.trim();
    }
    const message = {
      notification,
      data: dataPayload,
      android: {
        data: dataPayload,
        ...(notification.image && { notification: { title, body, image: notification.image } }),
      },
      apns: {
        payload: { aps: { sound: 'default' } },
        fcmOptions: notification.image ? { image: notification.image } : {},
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
 * @param {{ title: string, body?: string, image?: string, data?: object }} options - title, body, optional image URL, and optional data
 * @returns {Promise<boolean>} - true if sent, false if skipped/failed
 */
export async function sendPushToCustomer(customerId, { title, body = '', image, data = {} }) {
  if (!customerId) return false;
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { fcmToken: true },
    });
    if (!customer?.fcmToken) return false;
    return sendPushToToken(customer.fcmToken, { title, body, image, data });
  } catch (e) {
    console.warn('[PUSH] sendPushToCustomer failed:', e?.message || e);
    return false;
  }
}
