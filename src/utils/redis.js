import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || '';
const REDIS_ENABLED = Boolean(REDIS_URL) && process.env.REDIS_ENABLED !== 'false';

let client = null;
let connectLogged = false;

function createClient() {
  if (!REDIS_ENABLED) return null;

  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: true,
    connectTimeout: 5_000,
  });

  redis.on('error', (err) => {
    if (!connectLogged) {
      console.warn('[redis] Connection error — caching disabled for this process:', err.message);
    }
  });

  redis.on('connect', () => {
    if (!connectLogged) {
      connectLogged = true;
      console.log('[redis] Connected — reference data caching enabled');
    }
  });

  return redis;
}

export function isRedisEnabled() {
  return REDIS_ENABLED;
}

export async function getRedisClient() {
  if (!REDIS_ENABLED) return null;
  if (!client) client = createClient();

  if (client.status === 'wait') {
    try {
      await client.connect();
    } catch (err) {
      console.warn('[redis] Failed to connect:', err.message);
      return null;
    }
  }

  if (client.status !== 'ready') return null;
  return client;
}

export async function closeRedis() {
  if (client) {
    try {
      await client.quit();
    } catch {
      /* ignore */
    }
    client = null;
  }
}
