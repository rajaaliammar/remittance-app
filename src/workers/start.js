/**
 * Standalone worker process — run alongside the API server in production.
 *   node src/workers/start.js
 */
import '../env-bootstrap.js';
import { startTransactionWorkers, stopTransactionWorkers } from './transactionWorkers.js';
import { closeQueueConnection } from '../queues/connection.js';

startTransactionWorkers();

async function shutdown() {
  console.log('[Workers] Shutting down…');
  await stopTransactionWorkers();
  await closeQueueConnection();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
