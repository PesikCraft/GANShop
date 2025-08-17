// server/db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Internal URL → PGSSL=disable (ssl:false). Внешний URL → оставь ssl по умолчанию.
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
  if (!r.rowCount) return fallback;
  // node-postgres обычно уже парсит jsonb в JS-объект; но на всякий случай — доп. обработка:
  const v = r.rows[0].v;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch (_) { return fallback; }
  }
  return v;
}

async function set(key, val) {
  // ВАЖНО: сериализуем в JSON-строку перед вставкой в jsonb
  const json = JSON.stringify(val);
  await pool.query(
    'INSERT INTO kv (k, v) VALUES ($1, $2::jsonb) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v',
    [key, json]
  );
}

module.exports = { init, get, set, pool };
