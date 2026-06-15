/**
 * Socket.io Redis adapter — broadcast chat and realtime events across all API instances.
 * Requires REDIS_URL; uses separate pub/sub clients from cache/BullMQ connections.
 */
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const REDIS_URL = process.env.REDIS_URL || '';

let pubClient = null;
let subClient = null;
let adapterAttached = false;

export function isSocketRedisAdapterEnabled() {
  return (
    Boolean(REDIS_URL.trim()) &&
    process.env.REDIS_ENABLED !== 'false' &&
    process.env.SOCKET_REDIS_ADAPTER !== 'false'
  );
}

/**
 * Attach Redis pub/sub adapter to a Socket.io server instance.
 * Safe to call when Redis is unavailable — falls back to single-instance mode.
 */
export async function attachSocketRedisAdapter(io) {
  if (!isSocketRedisAdapterEnabled()) {
    console.log('[Socket] Redis adapter disabled — single-instance broadcasts only');
    return false;
  }

  if (adapterAttached) return true;

  try {
    const keyPrefix = process.env.SOCKET_REDIS_KEY_PREFIX?.trim() || 'socket.io';

    pubClient = createClient({ url: REDIS_URL });
    subClient = pubClient.duplicate();

    pubClient.on('error', (err) => {
      console.warn('[Socket/redis] pub error:', err.message);
    });
    subClient.on('error', (err) => {
      console.warn('[Socket/redis] sub error:', err.message);
    });

    await Promise.all([pubClient.connect(), subClient.connect()]);

    io.adapter(createAdapter(pubClient, subClient, { key: keyPrefix }));
    adapterAttached = true;
    console.log(
      `[Socket] Redis adapter enabled (key=${keyPrefix}) — events reach all API instances`,
    );
    return true;
  } catch (err) {
    console.warn('[Socket] Redis adapter setup failed — single-instance mode:', err.message);
    await closeSocketRedisAdapter();
    return false;
  }
}

export function isSocketRedisAdapterAttached() {
  return adapterAttached;
}

export async function closeSocketRedisAdapter() {
  const closers = [];
  if (pubClient?.isOpen) {
    closers.push(pubClient.quit().catch(() => {}));
  }
  if (subClient?.isOpen) {
    closers.push(subClient.quit().catch(() => {}));
  }
  await Promise.allSettled(closers);
  pubClient = null;
  subClient = null;
  adapterAttached = false;
}
