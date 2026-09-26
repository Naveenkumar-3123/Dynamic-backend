import { Pool, QueryResult } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

let pool: {
  query: (text: string, params?: any[]) => Promise<QueryResult<any>>;
};

let isMemDb = false;

// If a PostgreSQL connection string is provided, use node-postgres Pool
if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '') {
  const isRemote =
    process.env.NODE_ENV === 'production' ||
    process.env.DATABASE_URL.includes('supabase.co') ||
    process.env.DATABASE_URL.includes('pooler.supabase.com');

  const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isRemote ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Handle idle client connection resets gracefully (common with Supabase connection poolers)
  pgPool.on('error', (err) => {
    console.warn('[DB Pool] Non-fatal idle client error (connection reset):', err.message);
  });

  pool = pgPool;
} else {
  // Graceful in-memory PostgreSQL engine for local development & offline testing
  try {
    const { newDb } = require('pg-mem');
    const memDb = newDb();

    // Register extensions / functions if needed
    memDb.public.registerFunction({
      name: 'now',
      implementation: () => new Date(),
    });

    const { Pool: MemPool } = memDb.adapters.createPg();
    pool = new MemPool();
    isMemDb = true;
    console.log('[DB] Running with in-memory PostgreSQL engine (DATABASE_URL not set).');
  } catch (err) {
    // Fallback stub pool if pg-mem is not loaded
    console.warn('[DB] DATABASE_URL not set and pg-mem unavailable. Queries will fail until configured.');
    pool = {
      query: async () => {
        throw new Error('DATABASE_URL is not configured.');
      },
    };
  }
}

/**
 * Execute a parameterized SQL query safely.
 *
 * @param text Parameterized SQL statement (e.g. "SELECT * FROM dynamic_qrs WHERE short_code = $1")
 * @param params Parameter array
 */
export async function query(text: string, params?: any[]): Promise<QueryResult<any>> {
  return pool.query(text, params);
}

/**
 * Initializes the database tables if they do not exist.
 */
export async function initDatabase(): Promise<void> {
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const sql = fs.readFileSync(schemaPath, 'utf-8');
    await pool.query(sql);
  } else {
    // Fallback embedded schema
    const fallbackSql = `
      CREATE TABLE IF NOT EXISTS dynamic_qrs (
          id UUID PRIMARY KEY,
          short_code VARCHAR(20) UNIQUE NOT NULL,
          destination_url TEXT NOT NULL,
          scan_count INTEGER NOT NULL DEFAULT 0,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_dynamic_qrs_short_code ON dynamic_qrs(short_code);
    `;
    await pool.query(fallbackSql);
  }
  console.log('[DB] Database schema verified successfully.');
}

export function isUsingMemoryDb(): boolean {
  return isMemDb;
}

export default pool;
