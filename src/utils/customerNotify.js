import prisma from './prisma.js';
import { sendPushToCustomer } from './push.js';

/**
 * Save to in-app notification inbox and send FCM to the customer's device.
 * Fire-and-forget safe — callers should not await unless they need the record id.
 */
export async function deliverCustomerNotification(
  customerId,
  { title, body = '', imageUrl, data = {} }
) {
  if (!customerId) return { saved: false, pushed: false };

  const notificationTitle =
    typeof title === 'string' && title.trim() ? title.trim() : 'OneZaPay';
  const notificationBody = typeof body === 'string' ? body.trim() : '';

  let created = null;
  try {
    if (prisma.customerNotification) {
      created = await prisma.customerNotification.create({
        data: {
          customerId: String(customerId),
          title: notificationTitle,
          body: notificationBody,
          imageUrl: imageUrl || null,
        },
      });
    }
  } catch (e) {
    console.warn('[Notify] Inbox save failed:', e?.message || e);
  }

  const pushData = {
    ...data,
    type: data?.type || 'general',
    ...(created?.id ? { id: String(created.id) } : {}),
  };

  const pushResult = await sendPushToCustomer(customerId, {
    title: notificationTitle,
    body: notificationBody,
    image: imageUrl || undefined,
    data: pushData,
  });

  return {
    saved: !!created,
    notificationId: created?.id,
    pushed: !!(pushResult && pushResult.success),
    pushError: pushResult?.error,
  };
}

/** Non-blocking wrapper for HTTP handlers. */
export function notifyCustomerAsync(customerId, payload, io = null) {
  void (async () => {
    const result = await deliverCustomerNotification(customerId, payload);
    if (io && result.notificationId) {
      try {
        io.to(`user:${String(customerId)}`).emit('admin:notification', {
          id: result.notificationId,
          title: payload.title,
          body: payload.body,
          imageUrl: payload.imageUrl || null,
          sentAt: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('[Notify] Socket emit failed:', e?.message || e);
      }
    }
  })();
}
