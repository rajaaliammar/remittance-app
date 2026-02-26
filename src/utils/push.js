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
        if (!fs.existsSync(resolved)) {
          console.error('[PUSH] ❌ Firebase service account file not found:', resolved);
          console.error('[PUSH] Set FIREBASE_SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS environment variable');
          messaging = false;
          return false;
        }
        const key = JSON.parse(fs.readFileSync(resolved, 'utf8'));
        admin.initializeApp({ credential: admin.credential.cert(key) });
        console.log('[PUSH] ✅ Firebase Admin initialized successfully');
      } else {
        console.warn('[PUSH] ⚠️ Firebase Admin not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS');
        console.warn('[PUSH] Push notifications will not be sent until Firebase Admin is configured');
        messaging = false;
        return false;
      }
    }
    messaging = admin.messaging();
    return messaging;
  } catch (e) {
    console.error('[PUSH] ❌ Firebase Admin initialization failed:', e?.message || e);
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
  if (!m) {
    console.warn('[PUSH] ⚠️ Cannot send push: Firebase Admin not configured');
    return { success: false, error: 'Firebase Admin not configured', code: 'FIREBASE_NOT_CONFIGURED' };
  }
  if (!fcmToken) {
    console.warn('[PUSH] ⚠️ Cannot send push: No FCM token provided');
    return { success: false, error: 'No FCM token provided', code: 'NO_TOKEN' };
  }
  
  try {
    console.log('[PUSH] 📤 Sending push notification to token:', fcmToken.substring(0, 20) + '...');
    console.log('[PUSH] Title:', title, 'Body:', body);
    
    const dataPayload = stringifyData({
      ...data,
      title: String(title),
      body: String(body),
      ...(image && { image: String(image) }),
      fromAdmin: 'true', // Mark as admin notification so app always shows it
      type: data?.type || 'admin', // Ensure type is set
    });
    const notification = { title, body };
    if (image && typeof image === 'string' && image.trim()) {
      notification.image = image.trim();
    }
    const message = {
      notification,
      data: dataPayload,
      android: {
        priority: 'high', // Ensure notification shows even when app is in background
        data: dataPayload,
        notification: {
          ...(notification.image && { image: notification.image }),
          channelId: 'default', // Use default channel for admin notifications
          sound: 'default',
          priority: 'high',
        },
      },
      apns: {
        payload: { 
          aps: { 
            sound: 'default',
            contentAvailable: true,
            priority: 10, // High priority for iOS
          } 
        },
        fcmOptions: notification.image ? { image: notification.image } : {},
      },
      token: fcmToken,
    };
    await m.send(message);
    console.log('[PUSH] ✅ Push notification sent successfully');
    return { success: true };
  } catch (e) {
    const errorCode = e?.code || 'UNKNOWN_ERROR';
    const errorMessage = e?.message || String(e);
    
    console.error('[PUSH] ❌ sendPushToToken failed');
    console.error('[PUSH] Error code:', errorCode);
    console.error('[PUSH] Error message:', errorMessage);
    console.error('[PUSH] Full error:', e);
    
    // Handle specific Firebase error codes
    let userMessage = 'Failed to send push notification';
    if (errorCode === 'messaging/registration-token-not-registered') {
      userMessage = 'Device token is invalid or not registered. The user may have uninstalled the app.';
      console.error('[PUSH] ❌ Token invalid (not registered). Consider clearing from customer.');
    } else if (errorCode === 'messaging/invalid-registration-token') {
      userMessage = 'Invalid device token format.';
    } else if (errorCode === 'messaging/registration-token-not-registered') {
      userMessage = 'Device token expired or app was uninstalled.';
    } else if (errorCode === 'messaging/message-rate-exceeded') {
      userMessage = 'Message rate exceeded. Please try again later.';
    } else if (errorCode === 'messaging/invalid-argument') {
      userMessage = 'Invalid notification payload.';
    } else if (errorCode === 'messaging/unavailable') {
      userMessage = 'Firebase service is temporarily unavailable.';
    } else if (errorCode === 'messaging/internal-error') {
      userMessage = 'Firebase internal error occurred.';
    }
    
    return { 
      success: false, 
      error: userMessage,
      code: errorCode,
      details: errorMessage
    };
  }
}

/**
 * Send a push notification to a customer by ID (uses stored fcmToken).
 * @param {string} customerId - Customer id
 * @param {{ title: string, body?: string, image?: string, data?: object }} options - title, body, optional image URL, and optional data
 * @returns {Promise<boolean>} - true if sent, false if skipped/failed
 */
export async function sendPushToCustomer(customerId, { title, body = '', image, data = {} }) {
  if (!customerId) {
    return { success: false, error: 'Customer ID is required', code: 'NO_CUSTOMER_ID' };
  }
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { fcmToken: true },
    });
    if (!customer?.fcmToken) {
      return { success: false, error: 'Customer has no FCM token registered', code: 'NO_TOKEN' };
    }
    return await sendPushToToken(customer.fcmToken, { title, body, image, data });
  } catch (e) {
    console.error('[PUSH] sendPushToCustomer failed:', e?.message || e);
    return { success: false, error: e?.message || 'Unknown error', code: 'DATABASE_ERROR' };
  }
}
