/**
 * In-memory store for new-session requests (user requests to start chat again after session ended).
 * Keys: requestId (cuid). Value: { requestId, userId, supportUserId, createdAt }.
 */

const sessionRequests = new Map();

export function addSessionRequest({ userId, supportUserId }) {
  const requestId = `sreq_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const createdAt = new Date().toISOString();
  const entry = { requestId, userId: String(userId), supportUserId: String(supportUserId), createdAt };
  sessionRequests.set(requestId, entry);
  return entry;
}

export function getSessionRequest(requestId) {
  return sessionRequests.get(requestId) || null;
}

export function removeSessionRequest(requestId) {
  return sessionRequests.delete(requestId);
}

export function listSessionRequests() {
  return Array.from(sessionRequests.values()).sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );
}
