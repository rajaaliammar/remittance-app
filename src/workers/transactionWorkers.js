import { Worker } from 'bullmq';
import { getQueueConnection, isQueuesEnabled } from '../queues/connection.js';
import { QUEUE_NAMES, JOB_NAMES } from '../queues/names.js';
import { enqueueNotificationJob } from '../queues/enqueue.js';
import {
  processAmlSyncJob,
  processLedgerJob,
  processComplianceJob,
  processNotificationJob,
} from '../services/postTransactionJobs.service.js';
import { processBroadcastNotificationJob } from '../services/broadcastNotification.service.js';

const workers = [];

function attachWorkerEvents(worker, label) {
  worker.on('completed', (job) => {
    console.log(`[Worker:${label}] completed job ${job.id}`);
  });
  worker.on('failed', (job, err) => {
    console.error(`[Worker:${label}] failed job ${job?.id}:`, err?.message || err);
  });
}

export function startTransactionWorkers() {
  if (!isQueuesEnabled()) {
    console.log('[Workers] Queues disabled — background jobs run inline in API process');
    return [];
  }

  const connection = getQueueConnection();
  if (!connection) {
    console.warn('[Workers] No Redis connection — workers not started');
    return [];
  }

  const amlWorker = new Worker(
    QUEUE_NAMES.AML,
    async (job) => processAmlSyncJob(job.data),
    { connection, concurrency: 5 },
  );
  attachWorkerEvents(amlWorker, 'aml');

  const ledgerWorker = new Worker(
    QUEUE_NAMES.LEDGER,
    async (job) => processLedgerJob(job.data),
    { connection, concurrency: 3 },
  );
  attachWorkerEvents(ledgerWorker, 'ledger');

  const complianceWorker = new Worker(
    QUEUE_NAMES.COMPLIANCE,
    async (job) => {
      const result = await processComplianceJob(job.data);
      await enqueueNotificationJob({
        ...job.data,
        holdActive: result.hold,
        finalStatus: result.finalStatus,
      });
      return result;
    },
    { connection, concurrency: 3 },
  );
  attachWorkerEvents(complianceWorker, 'compliance');

  const notificationWorker = new Worker(
    QUEUE_NAMES.NOTIFICATION,
    async (job) => processNotificationJob(job.data),
    { connection, concurrency: 10 },
  );
  attachWorkerEvents(notificationWorker, 'notification');

  const broadcastWorker = new Worker(
    QUEUE_NAMES.BROADCAST,
    async (job) => processBroadcastNotificationJob(job.data),
    { connection, concurrency: 1 },
  );
  attachWorkerEvents(broadcastWorker, 'broadcast');

  workers.push(amlWorker, ledgerWorker, complianceWorker, notificationWorker, broadcastWorker);
  console.log('[Workers] Transaction workers started (aml, ledger, compliance, notification, broadcast)');

  return workers;
}

export async function stopTransactionWorkers() {
  await Promise.allSettled(workers.map((w) => w.close()));
  workers.length = 0;
}
