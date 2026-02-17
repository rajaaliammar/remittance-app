/**
 * In-memory store for active chat sessions: one backoffice user per customer.
 * Key: customerId. Value: { backofficeUserId, startedAt }.
 * When a backoffice user opens chat with a customer, they claim that customer.
 * No other backoffice user can chat with that customer until the chat is released (e.g. End chat).
 */

const activeChats = new Map();

export function claimChat(customerId, backofficeUserId) {
  const key = String(customerId).trim();
  if (!key) return { success: false, reason: 'invalid_customer' };
  const existing = activeChats.get(key);
  if (existing) {
    if (String(existing.backofficeUserId) === String(backofficeUserId)) {
      return { success: true, claimedBy: backofficeUserId };
    }
    return { success: false, claimedBy: existing.backofficeUserId, startedAt: existing.startedAt };
  }
  const startedAt = new Date().toISOString();
  activeChats.set(key, { backofficeUserId: String(backofficeUserId), startedAt });
  return { success: true, claimedBy: backofficeUserId };
}

export function releaseChat(customerId) {
  const key = String(customerId).trim();
  return activeChats.delete(key);
}

export function getActiveChat(customerId) {
  const key = String(customerId).trim();
  const entry = activeChats.get(key);
  return entry ? { claimedBy: entry.backofficeUserId, startedAt: entry.startedAt } : null;
}

export function isCustomerClaimedBy(customerId, backofficeUserId) {
  const active = getActiveChat(customerId);
  if (!active) return false;
  return String(active.claimedBy) === String(backofficeUserId);
}

/**
 * Transfer a chat from one backoffice user to another.
 * Only the current claimant can transfer.
 */
export function transferChat(customerId, fromBackofficeUserId, toBackofficeUserId) {
  const key = String(customerId).trim();
  if (!key) return { success: false, reason: 'invalid_customer' };
  const existing = activeChats.get(key);
  if (!existing) {
    return { success: false, reason: 'no_active_chat' };
  }
  if (String(existing.backofficeUserId) !== String(fromBackofficeUserId)) {
    return { success: false, reason: 'not_claimed_by_you', claimedBy: existing.backofficeUserId };
  }
  const startedAt = new Date().toISOString();
  activeChats.set(key, { backofficeUserId: String(toBackofficeUserId), startedAt });
  return { success: true };
}
