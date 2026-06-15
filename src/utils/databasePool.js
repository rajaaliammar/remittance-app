/**
 * PostgreSQL connection pooling via PgBouncer.
 * Runtime queries use DATABASE_URL (PgBouncer); migrations use DIRECT_DATABASE_URL (Postgres).
 */

export function resolveDirectDatabaseUrl() {
  const direct = process.env.DIRECT_DATABASE_URL?.trim();
  if (direct) return direct;

  const pooled = process.env.DATABASE_URL?.trim();
  if (pooled) {
    process.env.DIRECT_DATABASE_URL = pooled;
    return pooled;
  }

  return null;
}

export function usesPgBouncer(url = process.env.DATABASE_URL || '') {
  if (!url) return false;
  if (/[?&]pgbouncer=true/i.test(url)) return true;
  try {
    const parsed = new URL(url.replace(/^postgresql:/i, 'http:'));
    return parsed.port === '6432';
  } catch {
    return url.includes(':6432');
  }
}

export function getPrismaConnectionLimit() {
  const raw = process.env.PRISMA_CONNECTION_LIMIT?.trim();
  const n = raw ? parseInt(raw, 10) : 10;
  return Number.isFinite(n) && n > 0 ? n : 10;
}

export function logDatabasePoolConfig() {
  const url = process.env.DATABASE_URL || '';
  const pooled = usesPgBouncer(url);
  const limit = getPrismaConnectionLimit();

  if (pooled) {
    console.log(
      `[DB] PgBouncer pool | connection_limit=${limit} per Node process | migrations → DIRECT_DATABASE_URL`,
    );
  } else {
    console.log(
      `[DB] Direct PostgreSQL | connection_limit=${limit} | for pooling: docker compose up -d and point DATABASE_URL to :6432`,
    );
  }
}
