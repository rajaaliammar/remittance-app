import { getRedisClient, isRedisEnabled } from './redis.js';

/** Default TTL for static reference lists (15 minutes). */
export const REFERENCE_TTL_SECONDS = parseInt(process.env.CACHE_REFERENCE_TTL_SECONDS || '900', 10);

/** Shorter TTL for exchange rates (5 minutes). */
export const EXCHANGE_RATE_TTL_SECONDS = parseInt(process.env.CACHE_EXCHANGE_RATE_TTL_SECONDS || '300', 10);

const KEY_PREFIX = process.env.CACHE_KEY_PREFIX || 'remittance';

export function cacheKey(...parts) {
  return [KEY_PREFIX, ...parts.filter((p) => p != null && p !== '')].join(':');
}

export function stableQueryKey(query = {}) {
  const entries = Object.entries(query)
    .filter(([, value]) => value != null && String(value).trim() !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return 'default';
  return entries.map(([k, v]) => `${k}=${String(v).trim()}`).join('&');
}

export const CacheKeys = {
  countriesList: (query) => cacheKey('ref', 'countries', stableQueryKey(query)),
  exchangeRate: ({ countryId, bankId, walletId, serviceId }) =>
    cacheKey(
      'ref',
      'exchange-rate',
      countryId || 'none',
      bankId ? `bank=${bankId}` : '',
      walletId ? `wallet=${walletId}` : '',
      serviceId ? `service=${serviceId}` : '',
    ),
  levelsList: () => cacheKey('ref', 'levels', 'list'),
  faqsList: () => cacheKey('ref', 'faqs', 'list'),
  registrationSettings: () => cacheKey('ref', 'settings', 'registration'),
  purposesList: (query) => cacheKey('ref', 'purposes', stableQueryKey(query)),
  sourceOfFundsList: (query) => cacheKey('ref', 'source-of-funds', stableQueryKey(query)),
  employmentStatusesList: (query) => cacheKey('ref', 'employment-statuses', stableQueryKey(query)),
  legalDocumentsPublished: () => cacheKey('ref', 'legal-documents', 'published'),
  legalDocumentByType: (docType) => cacheKey('ref', 'legal-documents', docType),
};

async function redisGet(key) {
  const redis = await getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    if (raw == null) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[cache] get failed:', key, err.message);
    return null;
  }
}

async function redisSet(key, value, ttlSeconds) {
  const redis = await getRedisClient();
  if (!redis) return false;
  try {
    const payload = JSON.stringify(value);
    if (ttlSeconds > 0) {
      await redis.set(key, payload, 'EX', ttlSeconds);
    } else {
      await redis.set(key, payload);
    }
    return true;
  } catch (err) {
    console.warn('[cache] set failed:', key, err.message);
    return false;
  }
}

/**
 * Return cached value or fetch, store with TTL, and return fresh data.
 * Falls back to fetchFn when Redis is unavailable.
 */
export async function getOrSet(key, ttlSeconds, fetchFn) {
  const cached = await redisGet(key);
  if (cached !== null) {
    return cached;
  }

  const value = await fetchFn();
  if (value !== undefined) {
    await redisSet(key, value, ttlSeconds);
  }
  return value;
}

export async function cacheDel(key) {
  const redis = await getRedisClient();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch (err) {
    console.warn('[cache] del failed:', key, err.message);
  }
}

/** Delete all keys matching remittance:ref:{segment}:* */
export async function cacheInvalidateSegment(segment) {
  const redis = await getRedisClient();
  if (!redis) return;
  const pattern = cacheKey('ref', segment, '*');
  try {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== '0');
  } catch (err) {
    console.warn('[cache] invalidate segment failed:', segment, err.message);
  }
}

export async function invalidateCountriesCache() {
  await cacheInvalidateSegment('countries');
  await cacheInvalidateSegment('exchange-rate');
}

export async function invalidateLevelsCache() {
  await cacheDel(CacheKeys.levelsList());
}

export async function invalidateFaqsCache() {
  await cacheDel(CacheKeys.faqsList());
}

export async function invalidateRegistrationSettingsCache() {
  await cacheDel(CacheKeys.registrationSettings());
}

export async function invalidatePurposesCache() {
  await cacheInvalidateSegment('purposes');
}

export async function invalidateSourceOfFundsCache() {
  await cacheInvalidateSegment('source-of-funds');
}

export async function invalidateEmploymentStatusesCache() {
  await cacheInvalidateSegment('employment-statuses');
}

export async function invalidateLegalDocumentsCache() {
  await cacheInvalidateSegment('legal-documents');
}

export { isRedisEnabled };
