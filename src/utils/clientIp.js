/** Normalize IPv6-mapped and loopback forms for display/storage. */
export function normalizeClientIp(raw) {
  if (raw == null) return null;
  let ip = String(raw).trim();
  if (!ip) return null;
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

/** True when IP is present and not a placeholder sent to AML. */
export function isUsableClientIp(ip) {
  const n = normalizeClientIp(ip);
  if (!n) return false;
  if (n === '0.0.0.0' || n === '127.0.0.1') return false;
  return true;
}

/** Best-effort client IP from reverse proxy or socket (Express req). */
export function extractClientIp(req) {
  const candidates = [
    req.headers?.['x-forwarded-for']?.split(',')[0]?.trim(),
    req.headers?.['x-real-ip'],
    req.headers?.['cf-connecting-ip'],
    req.ip,
    req.socket?.remoteAddress,
    req.connection?.remoteAddress,
  ];

  for (const raw of candidates) {
    const ip = normalizeClientIp(raw);
    if (isUsableClientIp(ip)) return ip;
  }

  return normalizeClientIp(candidates.find(Boolean)) || null;
}
