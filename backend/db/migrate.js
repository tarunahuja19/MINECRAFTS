'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const targetDb = process.env.PGDATABASE || 'mine_subsidence';

async function migrate() {
  console.log(`[migrate] Connecting to PostgreSQL at ${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432}...`);

  // Step 1: Connect to default 'postgres' database to ensure target database exists
  const adminClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'labpass123',
    database: 'postgres'
  });

  await adminClient.connect();
  try {
    const checkRes = await adminClient.query(
      `SELECT 1 FROM pg_database WHERE datname = $1;`,
      [targetDb]
    );

    if (checkRes.rowCount === 0) {
      console.log(`[migrate] Database "${targetDb}" does not exist. Creating...`);
      await adminClient.query(`CREATE DATABASE "${targetDb}";`);
      console.log(`[migrate] Database "${targetDb}" created successfully.`);
    } else {
      console.log(`[migrate] Database "${targetDb}" already exists.`);
    }
  } finally {
    await adminClient.end();
  }

  // Step 2: Connect to target database and apply schema
  console.log(`[migrate] Connecting to "${targetDb}" to apply DDL schema...`);
  const dbClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'labpass123',
    database: targetDb
  });

  await dbClient.connect();
  try {
    const isReset = process.argv.includes('--reset');
    if (isReset) {
      console.log(`[migrate] Reset flag detected. Dropping existing tables...`);
      await dbClient.query(`DROP TABLE IF EXISTS readings, simulation_packets, alarms, nodes CASCADE;`);
    } else {
      await dbClient.query(`ALTER TABLE IF EXISTS nodes DROP CONSTRAINT IF EXISTS nodes_status_check;`);
    }

    const schemaPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await dbClient.query(sql);
    console.log(`[migrate] Schema successfully applied.`);

    // Verify tables
    const tableRes = await dbClient.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.log(`[migrate] Public tables in "${targetDb}":`, tableRes.rows.map(r => r.table_name).join(', '));
  } finally {
    await dbClient.end();
  }
}

if (require.main === module) {
  migrate()
    .then(() => {
      console.log('[migrate] Migration completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[migrate] Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { migrate };
