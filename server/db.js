// server/db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Для Internal Database URL на Render ставим PGSSL=disable (тогда ssl:false).
  // Для внешнего URL переменную PGSSL не задаем: используем SSL по умолчанию.
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false }
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kv (
      k TEXT PRIMARY KEY,
      v JSONB NOT NULL
    )
  `);
}

async function get(key, fallback) {
  const r = await pool.query('SELECT v FROM kv WHERE k=$1', [key]);
  return r.rowCount ? r.rows[0].v : fallback;
}

async function set(key, val) {
  await pool.query(
    'INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v',
    [key, val]
  );
}

module.exports = { init, get, set, pool };

