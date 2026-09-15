import crypto from 'crypto';
import { getRedisClient, isRedisEnabled } from '../utils/redis.js';

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const KEY_PREFIX = process.env.CACHE_KEY_PREFIX || 'remittance';

/** Process-local fallback when Redis is unavailable (single-instance / local dev). */
const memoryStore = new Map();

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function hashPayload(body) {
  return crypto.createHash('sha256').update(stableStringify(body ?? {})).digest('hex');
}

function redisKey(scope, actorId, idempotencyKey) {
  return `${KEY_PREFIX}:idempotency:${scope}:${actorId || 'anon'}:${idempotencyKey}`;
}

function memoryGet(key) {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return entry.record;
}

function memorySet(key, record, ttlSeconds) {
  memoryStore.set(key, {
    record,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

function memoryDel(key) {
  memoryStore.delete(key);
}

/** SET NX semantics for the in-memory store. */
function memorySetNx(key, record, ttlSeconds) {
  if (memoryGet(key) != null) return false;
  memorySet(key, record, ttlSeconds);
  return true;
}

async function storeGet(redis, key) {
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Keep memory warm for same-process replays
        memorySet(key, parsed, IDEMPOTENCY_TTL_SECONDS);
        return parsed;
      }
    } catch (err) {
      console.warn('[idempotency] redis get failed, using memory:', err.message);
    }
  }
  return memoryGet(key);
}

async function storeSet(redis, key, record, ttlSeconds) {
  memorySet(key, record, ttlSeconds);
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(record), 'EX', ttlSeconds);
  } catch (err) {
    console.warn('[idempotency] redis set failed (memory retained):', err.message);
  }
}

async function storeSetNx(redis, key, record, ttlSeconds) {
  if (redis) {
    try {
      const claimed = await redis.set(
        key,
        JSON.stringify(record),
        'EX',
        ttlSeconds,
        'NX',
      );
      if (claimed === 'OK') {
        memorySet(key, record, ttlSeconds);
        return true;
      }
      return false;
    } catch (err) {
      console.warn('[idempotency] redis setnx failed, using memory:', err.message);
    }
  }
  return memorySetNx(key, record, ttlSeconds);
}

async function storeDel(redis, key) {
  memoryDel(key);
  if (!redis) return;
  try {
    await redis.del(key);
  } catch (err) {
    console.warn('[idempotency] redis del failed:', err.message);
  }
}

function isCompletedRecord(record) {
  return (
    record &&
    record.state !== 'in_progress' &&
    record.status != null &&
    record.body !== undefined
  );
}

function sendReplay(res, record) {
  res.setHeader('X-Idempotent-Replay', 'true');
  res.setHeader('X-Cache', 'HIT');
  return res.status(record.status).json(record.body);
}

function conflictReuse(res) {
  return res.status(409).json({
    success: false,
    message: 'Idempotency-Key was already used with a different request payload.',
    code: 'IDEMPOTENCY_KEY_REUSED',
  });
}

function conflictInProgress(res) {
  return res.status(409).json({
    success: false,
    message: 'A request with this Idempotency-Key is already in progress.',
    code: 'IDEMPOTENCY_IN_PROGRESS',
  });
}

/**
 * Express idempotency middleware.
 * Expects header `Idempotency-Key`.
 *
 * Storage: Redis when available; otherwise process-local memory (dev / single instance).
 * Caches terminal responses (2xx and 4xx). Clears the claim on 5xx so clients can retry.
 * Replay responses include `X-Idempotent-Replay: true` and `X-Cache: HIT`.
 */
export function idempotencyMiddleware({ scope = 'default' } = {}) {
  return async function idempotency(req, res, next) {
    const rawKey = req.headers['idempotency-key'] || req.headers['Idempotency-Key'];
    const idempotencyKey = rawKey != null ? String(rawKey).trim() : '';

    if (!idempotencyKey) {
      return next();
    }

    let redis = null;
    if (isRedisEnabled()) {
      redis = await getRedisClient();
    }

    const actorId = req.user?.id || req.user?.userId || 'anon';
    const storageKey = redisKey(scope, actorId, idempotencyKey);
    const bodyHash = hashPayload(req.body);

    try {
      const existing = await storeGet(redis, storageKey);

      if (existing) {
        if (existing.bodyHash && existing.bodyHash !== bodyHash) {
          return conflictReuse(res);
        }
        if (isCompletedRecord(existing)) {
          return sendReplay(res, existing);
        }
        if (existing.state === 'in_progress') {
          return conflictInProgress(res);
        }
      }

      const claim = {
        state: 'in_progress',
        bodyHash,
        status: null,
        body: null,
        createdAt: new Date().toISOString(),
      };

      const claimed = await storeSetNx(redis, storageKey, claim, IDEMPOTENCY_TTL_SECONDS);

      if (!claimed) {
        const raced = await storeGet(redis, storageKey);
        if (raced?.bodyHash && raced.bodyHash !== bodyHash) {
          return conflictReuse(res);
        }
        if (isCompletedRecord(raced)) {
          return sendReplay(res, raced);
        }
        return conflictInProgress(res);
      }

      const originalJson = res.json.bind(res);
      res.json = (body) => {
        const status = res.statusCode || 200;

        // Allow retry after server errors — do not cache 5xx as terminal.
        if (status >= 500) {
          void storeDel(redis, storageKey);
          return originalJson(body);
        }

        const record = {
          state: 'completed',
          bodyHash,
          status,
          body,
          completedAt: new Date().toISOString(),
        };

        // Memory write is synchronous so same-process replays hit immediately.
        memorySet(storageKey, record, IDEMPOTENCY_TTL_SECONDS);
        if (redis) {
          redis
            .set(storageKey, JSON.stringify(record), 'EX', IDEMPOTENCY_TTL_SECONDS)
            .catch((err) => {
              console.warn('[idempotency] failed to cache response in redis:', err.message);
            });
        }

        res.setHeader('X-Idempotent-Replay', 'false');
        res.setHeader('X-Cache', 'MISS');
        return originalJson(body);
      };

      return next();
    } catch (err) {
      console.warn('[idempotency] middleware error — proceeding without cache:', err.message);
      return next();
    }
  };
}

export default idempotencyMiddleware;
