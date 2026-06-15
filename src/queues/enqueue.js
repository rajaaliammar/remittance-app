import { Queue } from 'bullmq';
import { getQueueConnection, isQueuesEnabled } from './connection.js';
import { QUEUE_NAMES, JOB_NAMES } from './names.js';
import { runPostTransactionJobsInline } from '../services/postTransactionJobs.service.js';

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 500 },
};

let amlQueue = null;
let ledgerQueue = null;
let complianceQueue = null;
let notificationQueue = null;
let broadcastQueue = null;

function getAmlQueue() {
  if (!amlQueue) {
    amlQueue = new Queue(QUEUE_NAMES.AML, {
      connection: getQueueConnection(),
      defaultJobOptions,
    });
  }
  return amlQueue;
}

function getLedgerQueue() {
  if (!ledgerQueue) {
    ledgerQueue = new Queue(QUEUE_NAMES.LEDGER, {
      connection: getQueueConnection(),
      defaultJobOptions,
    });
  }
  return ledgerQueue;
}

function getComplianceQueue() {
  if (!complianceQueue) {
    complianceQueue = new Queue(QUEUE_NAMES.COMPLIANCE, {
      connection: getQueueConnection(),
      defaultJobOptions,
    });
  }
  return complianceQueue;
}

function getNotificationQueue() {
  if (!notificationQueue) {
    notificationQueue = new Queue(QUEUE_NAMES.NOTIFICATION, {
      connection: getQueueConnection(),
      defaultJobOptions,
    });
  }
  return notificationQueue;
}

function getBroadcastQueue() {
  if (!broadcastQueue) {
    broadcastQueue = new Queue(QUEUE_NAMES.BROADCAST, {
      connection: getQueueConnection(),
      defaultJobOptions: {
        ...defaultJobOptions,
        attempts: 2,
      },
    });
  }
  return broadcastQueue;
}

/**
 * Enqueue AML, ledger, compliance, and notification jobs after transaction create.
 * Compliance worker chains the notification job when it finishes.
 */
export async function enqueuePostTransactionJobs(payload) {
  const { transactionId } = payload;

  if (!isQueuesEnabled()) {
    void runPostTransactionJobsInline(payload);
    return { queued: false, mode: 'inline' };
  }

  const conn = getQueueConnection();
  if (!conn) {
    void runPostTransactionJobsInline(payload);
    return { queued: false, mode: 'inline' };
  }

  await Promise.all([
    getAmlQueue().add(JOB_NAMES.AML_SYNC, payload, {
      jobId: `aml:${transactionId}`,
    }),
    getLedgerQueue().add(JOB_NAMES.LEDGER_INITIATE, payload, {
      jobId: `ledger:${transactionId}`,
    }),
    getComplianceQueue().add(JOB_NAMES.COMPLIANCE_EVALUATE, payload, {
      jobId: `compliance:${transactionId}`,
    }),
  ]);

  console.log(
    '[Queues] Post-transaction jobs enqueued | transactionId=',
    transactionId,
  );

  return { queued: true, mode: 'bullmq' };
}

export async function enqueueNotificationJob(payload) {
  const { transactionId } = payload;

  if (!isQueuesEnabled()) {
    const { processNotificationJob } = await import(
      '../services/postTransactionJobs.service.js'
    );
    await processNotificationJob(payload);
    return;
  }

  await getNotificationQueue().add(JOB_NAMES.NOTIFY_CUSTOMER, payload, {
    jobId: `notify:${transactionId}:${Date.now()}`,
  });
}

export async function enqueueBroadcastNotificationJob(payload) {
  const jobId = `broadcast:${Date.now()}`;

  if (!isQueuesEnabled()) {
    const { processBroadcastNotificationJob } = await import(
      '../services/broadcastNotification.service.js'
    );
    void processBroadcastNotificationJob(payload);
    return { queued: false, mode: 'inline', jobId };
  }

  const conn = getQueueConnection();
  if (!conn) {
    const { processBroadcastNotificationJob } = await import(
      '../services/broadcastNotification.service.js'
    );
    void processBroadcastNotificationJob(payload);
    return { queued: false, mode: 'inline', jobId };
  }

  await getBroadcastQueue().add(JOB_NAMES.BROADCAST_ALL, payload, { jobId });
  return { queued: true, mode: 'bullmq', jobId };
}

export async function closeQueues() {
  const closers = [amlQueue, ledgerQueue, complianceQueue, notificationQueue, broadcastQueue]
    .filter(Boolean)
    .map((q) => q.close());
  await Promise.allSettled(closers);
  amlQueue = null;
  ledgerQueue = null;
  complianceQueue = null;
  notificationQueue = null;
  broadcastQueue = null;
}
