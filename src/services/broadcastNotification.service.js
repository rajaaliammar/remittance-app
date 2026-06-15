import prisma from '../utils/prisma.js';
import { deliverCustomerNotification } from '../utils/customerNotify.js';
import { getPushConfigStatus } from '../utils/push.js';
import { getSocketIo } from '../utils/socketIo.js';

const BATCH_SIZE = 50;

/**
 * Process admin broadcast in background — cursor-paginated customer batches.
 */
export async function processBroadcastNotificationJob({
  title,
  body,
  imageUrl,
}) {
  const notificationTitle =
    typeof title === 'string' && title.trim() ? title.trim() : 'BrandPay';
  const notificationBody = typeof body === 'string' ? body.trim() : '';
  if (!notificationBody) {
    throw new Error('Broadcast body is required');
  }

  let cursor = null;
  let total = 0;
  let saved = 0;
  let pushed = 0;

  const io = getSocketIo();

  while (true) {
    const customers = await prisma.customer.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true },
    });

    if (customers.length === 0) break;

    const results = await Promise.all(
      customers.map((c) =>
        deliverCustomerNotification(String(c.id), {
          title: notificationTitle,
          body: notificationBody,
          imageUrl: imageUrl || null,
          data: { screen: 'notifications', type: 'admin' },
        }),
      ),
    );

    for (let i = 0; i < customers.length; i++) {
      const result = results[i];
      const customerId = String(customers[i].id);
      total += 1;
      if (result.saved) saved += 1;
      if (result.pushed) pushed += 1;
      if (io && result.notificationId) {
        try {
          io.to(`user:${customerId}`).emit('admin:notification', {
            id: result.notificationId,
            title: notificationTitle,
            body: notificationBody,
            imageUrl: imageUrl || null,
            sentAt: new Date().toISOString(),
          });
        } catch (e) {
          console.warn('[Broadcast] Socket emit failed:', e?.message || e);
        }
      }
    }

    cursor = customers[customers.length - 1].id;
    if (customers.length < BATCH_SIZE) break;
  }

  const pushStatus = getPushConfigStatus();
  console.log(
    `[Broadcast] Complete: total=${total} saved=${saved} pushed=${pushed} pushConfigured=${pushStatus.configured}`,
  );

  return { total, saved, pushed, pushConfigured: !!pushStatus.configured };
}
