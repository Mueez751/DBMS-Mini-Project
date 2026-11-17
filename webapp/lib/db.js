import pg from 'pg';

const { Pool, types } = pg;

// NUMERIC -> number, BIGINT/COUNT -> number, DATE -> 'YYYY-MM-DD' string (no timezone shifts)
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(20, (v) => parseInt(v, 10));
types.setTypeParser(1082, (v) => v);

const g = globalThis;

/** One shared connection pool per server process. Credentials come only from DATABASE_URL. */
export function pool() {
  if (!g.__pgPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.');
    g.__pgPool = new Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined,
    });
    g.__pgPool.on('error', (err) => console.error('Unexpected PostgreSQL pool error:', err.message));
  }
  return g.__pgPool;
}

/** Always use parameters ($1, $2, ...) for values. Never build SQL by string concatenation. */
export function query(text, params) {
  return pool().query(text, params);
}
