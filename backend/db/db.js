'use strict';

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'labpass123',
  database: process.env.PGDATABASE || 'mine_subsidence',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

// Also support DATABASE_URL if provided
if (process.env.DATABASE_URL) {
  config.connectionString = process.env.DATABASE_URL;
  // Cloud providers like Supabase require SSL
  if (
    process.env.DATABASE_URL.includes('supabase.co') ||
    process.env.DATABASE_URL.includes('pooler.supabase.com') ||
    process.env.DATABASE_URL.includes('sslmode=require') ||
    process.env.PGSSL === 'true'
  ) {
    config.ssl = { rejectUnauthorized: false };
  }
}

const pool = new Pool(config);

pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client:', err.message);
});

async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.DEBUG_SQL === 'true') {
    console.log('[db:query]', { text, duration: `${duration}ms`, rows: res.rowCount });
  }
  return res;
}

async function testConnection() {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT NOW() AS now, current_database() AS db;');
    return { ok: true, now: res.rows[0].now, db: res.rows[0].db };
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query,
  testConnection
};
