import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || '';
export const QUEUES_ENABLED =
  Boolean(REDIS_URL) &&
  process.env.QUEUES_ENABLED !== 'false' &&
  process.env.REDIS_ENABLED !== 'false';

let connection = null;

/**
 * BullMQ requires maxRetriesPerRequest: null on the ioredis client.
 */
export function getQueueConnection() {
  if (!QUEUES_ENABLED) return null;
  if (!connection) {
    connection = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      connectTimeout: 10_000,
    });
    connection.on('error', (err) => {
      console.warn('[bullmq] Redis connection error:', err.message);
    });
  }
  return connection;
}

export function isQueuesEnabled() {
  return QUEUES_ENABLED;
}

export async function closeQueueConnection() {
  if (connection) {
    try {
      await connection.quit();
    } catch {
      /* ignore */
    }
    connection = null;
  }
}
