/**
 * Externalize base64 image blobs to S3/local storage before persisting to PostgreSQL.
 * Accepts data URLs, raw base64, or nested JSON (manage content, menus, gateways).
 */
import {
  persistBase64Image,
  generateUploadFilename,
  resolvePublicFileUrl,
} from './objectStorage.js';

const DATA_URL_RE = /^data:image\/[\w+.+-]+;base64,/i;
const IMAGE_KEY_RE =
  /(?:^|_)(logo|flag|icon|image|photo|avatar|banner|background|displayimage|profileimage|selfie|thumbnail)(?:$|_)/i;

/** Minimum length to treat a string as embedded image data (skips emoji/text logos). */
const MIN_BASE64_LENGTH = 256;

export function isBase64ImageValue(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (!s || s.length < MIN_BASE64_LENGTH) return false;
  if (DATA_URL_RE.test(s)) return true;
  if (/^https?:\/\//i.test(s) || s.startsWith('/uploads/')) return false;
  if (s.length >= MIN_BASE64_LENGTH && /^[A-Za-z0-9+/=\s]+$/.test(s.replace(/\s/g, ''))) {
    return true;
  }
  return false;
}

function guessContentType(value) {
  if (DATA_URL_RE.test(value)) {
    const m = value.match(/^data:(image\/[\w+.+-]+);base64,/i);
    if (m?.[1]) return m[1];
  }
  return 'image/png';
}

function guessExtension(contentType) {
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('gif')) return '.gif';
  if (contentType.includes('svg')) return '.svg';
  return '.png';
}

/**
 * Upload a single base64/data-URL string; returns public URL or original on failure.
 */
export async function externalizeBase64Image(value, { category = 'cms', hint = 'image' } = {}) {
  if (!isBase64ImageValue(value)) {
    return typeof value === 'string' ? value.trim() : value;
  }

  const contentType = guessContentType(value);
  const ext = guessExtension(contentType);
  const filename = generateUploadFilename(hint, `blob${ext}`, hint);

  const stored = await persistBase64Image(value, category, filename, contentType);
  return resolvePublicFileUrl(stored?.url) || value;
}

function isImageFieldKey(key) {
  if (!key || typeof key !== 'string') return false;
  if (IMAGE_KEY_RE.test(key)) return true;
  return ['logo', 'flag', 'icon', 'image', 'displayImage', 'profileImage'].includes(key);
}

/**
 * Recursively replace base64 image strings in objects/arrays.
 */
export async function sanitizeImageFieldsDeep(data, options = {}) {
  const category = options.category || 'cms';
  const path = options.path || 'root';

  if (data == null) return data;

  if (Array.isArray(data)) {
    const out = [];
    for (let i = 0; i < data.length; i++) {
      out.push(
        await sanitizeImageFieldsDeep(data[i], {
          ...options,
          path: `${path}[${i}]`,
        }),
      );
    }
    return out;
  }

  if (typeof data === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(data)) {
      const fieldPath = `${path}.${key}`;
      if (typeof val === 'string' && isImageFieldKey(key)) {
        out[key] = await externalizeBase64Image(val, { category, hint: key });
      } else if (val && typeof val === 'object') {
        out[key] = await sanitizeImageFieldsDeep(val, { ...options, path: fieldPath });
      } else {
        out[key] = val;
      }
    }
    return out;
  }

  if (typeof data === 'string' && options.scanAllStrings && isBase64ImageValue(data)) {
    return externalizeBase64Image(data, { category, hint: path });
  }

  return data;
}

/** Sanitize known top-level string image columns on write. */
export async function sanitizeLogoField(value, category = 'logos') {
  if (value == null || value === '') return value;
  if (typeof value !== 'string') return value;
  return externalizeBase64Image(value, { category, hint: 'logo' });
}

export async function sanitizeManageContentPayload({ englishData, spanishData, images }) {
  return {
    englishData: englishData
      ? await sanitizeImageFieldsDeep(englishData, { category: 'cms', path: 'englishData' })
      : englishData,
    spanishData: spanishData
      ? await sanitizeImageFieldsDeep(spanishData, { category: 'cms', path: 'spanishData' })
      : spanishData,
    images: images
      ? await sanitizeImageFieldsDeep(images, { category: 'cms', path: 'images' })
      : images,
  };
}

export async function sanitizeMenuPayload(body) {
  const out = { ...body };
  if (out.logo !== undefined) {
    out.logo = await sanitizeLogoField(out.logo, 'menus');
  }
  if (out.items) {
    out.items = await sanitizeImageFieldsDeep(out.items, { category: 'menus', path: 'items' });
  }
  if (out.footerPages) {
    out.footerPages = await sanitizeImageFieldsDeep(out.footerPages, {
      category: 'menus',
      path: 'footerPages',
    });
  }
  if (out.footerUsefulLinks) {
    out.footerUsefulLinks = await sanitizeImageFieldsDeep(out.footerUsefulLinks, {
      category: 'menus',
      path: 'footerUsefulLinks',
    });
  }
  if (out.footerSupportLinks) {
    out.footerSupportLinks = await sanitizeImageFieldsDeep(out.footerSupportLinks, {
      category: 'menus',
      path: 'footerSupportLinks',
    });
  }
  return out;
}
