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

const DEFAULT_SERVICE_ACCOUNT_FILE = 'firebase-service-account.json';

function isServiceAccountFileName(name) {
  return (
    name === DEFAULT_SERVICE_ACCOUNT_FILE ||
    (name.endsWith('.json') && name.includes('firebase-adminsdk'))
  );
}

function readServiceAccountFile(filePath) {
  try {
    const key = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (key?.project_id && key?.private_key && key?.client_email) {
      return key;
    }
  } catch {
    /* invalid */
  }
  return null;
}

/** Resolve Firebase Admin JSON path (env, backend dir, or recent Downloads in dev). */
export function resolveServiceAccountPath() {
  const envPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS;

  const tryPath = (p) => {
    if (!p) return null;
    const resolved = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
    return fs.existsSync(resolved) ? resolved : null;
  };

  if (envPath) {
    const hit = tryPath(envPath);
    if (hit) return hit;
  }

  const cwd = process.cwd();
  let dirNames = [];
  try {
    dirNames = fs.readdirSync(cwd);
  } catch {
    dirNames = [];
  }
  const localCandidates = [
    path.join(cwd, DEFAULT_SERVICE_ACCOUNT_FILE),
    ...dirNames.filter(isServiceAccountFileName).map((name) => path.join(cwd, name)),
  ];

  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate) && readServiceAccountFile(candidate)) {
      return candidate;
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    const downloads = path.join(process.env.HOME || '', 'Downloads');
    if (fs.existsSync(downloads)) {
      const fromDownloads = fs
        .readdirSync(downloads)
        .filter(isServiceAccountFileName)
        .map((name) => path.join(downloads, name))
        .filter((p) => readServiceAccountFile(p))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      if (fromDownloads[0]) {
        const target = path.join(cwd, DEFAULT_SERVICE_ACCOUNT_FILE);
        try {
          fs.copyFileSync(fromDownloads[0], target);
          fs.chmodSync(target, 0o600);
          console.log(
            `[PUSH] Copied Firebase key from Downloads → ${DEFAULT_SERVICE_ACCOUNT_FILE}`,
          );
          return target;
        } catch (e) {
          console.warn('[PUSH] Could not copy key from Downloads:', e?.message || e);
          return fromDownloads[0];
        }
      }
    }
  }

  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
  }
  return path.resolve(cwd, DEFAULT_SERVICE_ACCOUNT_FILE);
}

/** Whether Firebase credentials are present (does not initialize Admin SDK). */
export function getPushConfigStatus() {
  const jsonInline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (jsonInline && String(jsonInline).trim()) {
    try {
      const key = JSON.parse(jsonInline);
      return {
        configured: !!(key?.project_id && key?.private_key && key?.client_email),
        projectId: key?.project_id || null,
        source: 'FIREBASE_SERVICE_ACCOUNT_JSON',
      };
    } catch {
      return { configured: false, projectId: null, source: 'FIREBASE_SERVICE_ACCOUNT_JSON', error: 'invalid_json' };
    }
  }

  const resolved = resolveServiceAccountPath();
  if (!fs.existsSync(resolved)) {
    return {
      configured: false,
      projectId: null,
      source: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || null,
      error: 'file_not_found',
      expectedPath: resolved,
    };
  }
  const key = readServiceAccountFile(resolved);
  if (!key) {
    return { configured: false, projectId: null, source: resolved, error: 'invalid_json' };
  }
  return {
    configured: true,
    projectId: key.project_id || null,
    source: resolved,
  };
}

function loadServiceAccountKey() {
  const jsonInline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (jsonInline && String(jsonInline).trim()) {
    try {
      return JSON.parse(jsonInline);
    } catch (e) {
      console.error('[PUSH] ❌ FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON:', e?.message || e);
      return null;
    }
  }

  const resolved = resolveServiceAccountPath();
  if (!fs.existsSync(resolved)) {
    console.error('[PUSH] ❌ Firebase service account file not found:', resolved);
    console.error('[PUSH] Download from Firebase Console (project super-app-71711) and save as firebase-service-account.json');
    console.error('[PUSH] Or run: cd Remittance_backend && npm run firebase:setup');
    console.error('[PUSH] Or set FIREBASE_SERVICE_ACCOUNT_JSON with the full JSON contents');
    return null;
  }
  const key = readServiceAccountFile(resolved);
  if (!key) {
    console.error('[PUSH] ❌ Invalid Firebase service account file:', resolved);
    return null;
  }
  return key;
}

function getMessaging() {
  if (messaging !== null) return messaging;
  try {
    const admin = require('firebase-admin');
    if (admin.apps.length === 0) {
      const key = loadServiceAccountKey();
      if (!key) {
        console.warn('[PUSH] ⚠️ Firebase Admin not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH, GOOGLE_APPLICATION_CREDENTIALS, or FIREBASE_SERVICE_ACCOUNT_JSON');
        console.warn('[PUSH] Push notifications will not be sent until Firebase Admin is configured');
        messaging = false;
        return false;
      }
      admin.initializeApp({ credential: admin.credential.cert(key) });
      console.log('[PUSH] ✅ Firebase Admin initialized successfully', key.project_id ? `(project: ${key.project_id})` : '');
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
 *
 * Android: data-only (no top-level `notification` key) so OneZaPayMessagingService
 * onMessageReceived runs when the app is killed/background and posts to the system tray.
 * iOS: APNS alert payload for the same behavior on Apple devices.
 *
 * @param {string} fcmToken - Device FCM token
 * @param {{ title: string, body?: string, image?: string, data?: object }} options
 */
/** Public API origin for absolute image URLs in FCM (relative /uploads/... paths). */
function getPublicApiOrigin() {
  const raw =
    process.env.PUBLIC_API_URL ||
    process.env.API_PUBLIC_URL ||
    process.env.EXTERNAL_API_URL ||
    (process.env.NODE_ENV !== 'production'
      ? `http://10.0.2.2:${process.env.PORT || 3001}`
      : `http://localhost:${process.env.PORT || 3001}`);
  return String(raw).replace(/\/api\/?$/i, '').replace(/\/+$/, '');
}

function absolutePushImageUrl(image) {
  if (!image || typeof image !== 'string') return undefined;
  const trimmed = image.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const base = getPublicApiOrigin();
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${base}${path}`;
}

function androidChannelForType(type) {
  const t = String(type || '').toLowerCase();
  if (
    t === 'transaction' ||
    t === 'activity' ||
    t === 'transfer' ||
    t === 'kyc' ||
    t === 'security'
  ) {
    return 'transactions';
  }
  return 'default';
}

/** FCM data payload values must be strings */
function stringifyData(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

/** Find FCM token for a customer; copies token onto this record if found on a duplicate account. */
export async function resolveCustomerFcmToken(customerId) {
  if (!customerId) return null;
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, fcmToken: true, email: true, phone: true },
    });
    if (!customer) return null;
    if (customer.fcmToken) return customer.fcmToken;

    const or = [];
    if (customer.email) or.push({ email: customer.email });
    if (customer.phone) or.push({ phone: customer.phone });
    if (!or.length) return null;

    const other = await prisma.customer.findFirst({
      where: { OR: or, fcmToken: { not: null }, NOT: { id: customer.id } },
      select: { fcmToken: true },
    });
    if (!other?.fcmToken) return null;

    await prisma.customer.update({
      where: { id: customerId },
      data: { fcmToken: other.fcmToken },
    });
    console.log('[PUSH] Copied FCM token onto customer record:', customerId);
    return other.fcmToken;
  } catch (e) {
    console.warn('[PUSH] resolveCustomerFcmToken failed:', e?.message || e);
    return null;
  }
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
    
    const notifType = data?.type || 'admin';
    const channelId = androidChannelForType(notifType);
    const imageUrl = absolutePushImageUrl(image);

    const dataPayload = stringifyData({
      ...data,
      title: String(title),
      body: String(body),
      ...(imageUrl && { image: imageUrl }),
      fromAdmin: 'true',
      type: notifType,
      screen: data?.screen || 'notifications',
    });

    const bodyText = String(body || title || 'OneZaPay');
    const titleText = String(title || 'OneZaPay');

    // Data-only on Android → custom MessagingService always runs (app closed/background).
    // Do not set top-level `notification` — it can prevent onMessageReceived on Android.
    const message = {
      data: {
        ...dataPayload,
        channelId,
      },
      android: {
        priority: 'high',
        ttl: 86400000,
        directBootOk: true,
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: {
          aps: {
            alert: { title: titleText, body: bodyText },
            sound: 'default',
            'content-available': 1,
          },
        },
        ...(imageUrl ? { fcmOptions: { image: imageUrl } } : {}),
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
    const fcmToken = await resolveCustomerFcmToken(customerId);
    if (!fcmToken) {
      return { success: false, error: 'Customer has no FCM token registered', code: 'NO_TOKEN' };
    }
    return await sendPushToToken(fcmToken, {
      title,
      body,
      image,
      data: { screen: 'notifications', ...data },
    });
  } catch (e) {
    console.error('[PUSH] sendPushToCustomer failed:', e?.message || e);
    return { success: false, error: e?.message || 'Unknown error', code: 'DATABASE_ERROR' };
  }
}
