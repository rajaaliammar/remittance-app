/** Tell the admin portal to refresh customer lists (Socket.IO broadcast). */
export function emitCustomersUpdated(req) {
  try {
    const io = req.app?.get?.('io');
    if (io) {
      io.emit('customers:updated', { at: new Date().toISOString() });
    }
  } catch {
    /* optional */
  }
}
