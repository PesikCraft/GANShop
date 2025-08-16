// server/server.js
const path = require('path');
const fs = require('fs');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 7070;
const BODY_LIMIT = process.env.BODY_LIMIT || '25mb';

const ROOT = path.join(__dirname, '..');
const FS_DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data'); // fallback на файлы
const CLIENT_DIR = path.join(ROOT, 'client');

const USE_DB = !!process.env.DATABASE_URL;
let db = null;

app.use(express.json({ limit: BODY_LIMIT, strict: true }));
app.use(express.urlencoded({ limit: BODY_LIMIT, extended: true }));
app.use(express.static(CLIENT_DIR, { etag: false, lastModified: false, cacheControl: false }));

// ---------- FS helpers (fallback) ----------
function ensureDirSync(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function readJsonSync(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (e) { if (fallback !== undefined) return fallback; throw e; }
}
function writeFileAtomicSync(filePath, dataString) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, '.' + base + '.tmp-' + process.pid + '-' + Date.now());
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, dataString, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, filePath);
  let dfd; try { dfd = fs.openSync(dir, 'r'); fs.fsyncSync(dfd); } catch (_) {} finally { if (dfd) fs.closeSync(dfd); }
}
function writeJsonAtomicSync(filePath, obj) {
  writeFileAtomicSync(filePath, JSON.stringify(obj, null, 2) + '\n');
}

// ---------- Files & Keys ----------
const FILES = {
  products: path.join(FS_DATA_DIR, 'products.json'),
  cats:     path.join(FS_DATA_DIR, 'cats.json'),
  orders:   path.join(FS_DATA_DIR, 'orders.json'),
  bank:     path.join(FS_DATA_DIR, 'bank.json'),
  users:    path.join(FS_DATA_DIR, 'users.json'),
};
const KEYS = { products:'products', cats:'cats', orders:'orders', bank:'bank', users:'users' };

// ---------- Bootstrap ----------
function fsBootstrap() {
  ensureDirSync(FS_DATA_DIR);
  if (!fs.existsSync(FILES.products)) {
    writeJsonAtomicSync(FILES.products, [
      { id: 1, title: 'Demo футболка', price: 1990 },
      { id: 2, title: 'Demo худи',     price: 3990 },
      { id: 3, title: 'Demo кружка',   price:  990 }
    ]);
  }
  if (!fs.existsSync(FILES.cats))   writeJsonAtomicSync(FILES.cats,   [{ id:'apparel', title:'Одежда' },{ id:'accessories', title:'Аксессуары' }]);
  if (!fs.existsSync(FILES.orders)) writeJsonAtomicSync(FILES.orders, []);
  if (!fs.existsSync(FILES.bank))   writeJsonAtomicSync(FILES.bank,   []);
  if (!fs.existsSync(FILES.users))  writeJsonAtomicSync(FILES.users,  []);
}
async function dbBootstrap() {
  await db.init();
  async function ensure(key, defVal) {
    const v = await db.get(key, null);
    if (v === null || typeof v === 'undefined') await db.set(key, defVal);
  }
  await ensure(KEYS.products, [
    { id: 1, title: 'Demo футболка', price: 1990 },
    { id: 2, title: 'Demo худи',     price: 3990 },
    { id: 3, title: 'Demo кружка',   price:  990 }
  ]);
  await ensure(KEYS.cats,   [{ id:'apparel', title:'Одежда' },{ id:'accessories', title:'Аксессуары' }]);
  await ensure(KEYS.orders, []);
  await ensure(KEYS.bank,   []);
  await ensure(KEYS.users,  []);
}
function ensureAdminInArray(arr) {
  const pwd = process.env.ADMIN_PASSWORD || 'admin';
  let changed = false, found = false;
  for (let i = 0; i < arr.length; i++) {
    const u = arr[i] || {};
    const name = (u.nick || u.login || u.username || u.id || u.name || '').toString();
    if (name === 'admin') {
      found = true;
      if (u.role !== 'admin') { u.role = 'admin'; changed = true; }
      if (!u.password) { u.password = pwd; changed = true; }
      arr[i] = u;
      break;
    }
  }
  if (!found) { arr.push({ nick: 'admin', password: pwd, role: 'admin', createdAt: Date.now() }); changed = true; }
  return { changed, arr };
}
function fsEnsureAdmin() {
  const users = readJsonSync(FILES.users, []);
  const { changed, arr } = ensureAdminInArray(Array.isArray(users) ? users : []);
  if (changed) writeJsonAtomicSync(FILES.users, arr);
}
async function dbEnsureAdmin() {
  const users = await db.get(KEYS.users, []);
  const { changed, arr } = ensureAdminInArray(Array.isArray(users) ? users : []);
  if (changed) await db.set(KEYS.users, arr);
}

// ---------- Helpers ----------
function bad(res, msg) { return res.status(400).json({ error: msg || 'Bad Request' }); }
function isArray(x) { return Array.isArray(x); }

// ---------- Routes ----------
app.get('/api/catalog', async (_req, res) => {
  try {
    if (USE_DB) {
      const [cats, products] = await Promise.all([db.get(KEYS.cats, []), db.get(KEYS.products, [])]);
      return res.json({ cats, products });
    }
    res.json({ cats: readJsonSync(FILES.cats, []), products: readJsonSync(FILES.products, []) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal Server Error' }); }
});
app.put('/api/catalog', async (req, res) => {
  try {
    const b = req.body || {};
    if (!isArray(b.cats) || !isArray(b.products)) return bad(res, 'Both "cats" and "products" must be arrays');
    if (USE_DB) { await Promise.all([db.set(KEYS.cats, b.cats), db.set(KEYS.products, b.products)]); }
    else { writeJsonAtomicSync(FILES.cats, b.cats); writeJsonAtomicSync(FILES.products, b.products); }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal Server Error' }); }
});

app.get('/api/orders', async (_req, res) => {
  try {
    const orders = USE_DB ? await db.get(KEYS.orders, []) : readJsonSync(FILES.orders, []);
    res.json({ orders });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal Server Error' }); }
});
app.put('/api/orders', async (req, res) => {
  try {
    const b = req.body || {};
    if (!isArray(b.orders)) return bad(res, '"orders" must be an array');
    if (USE_DB) await db.set(KEYS.orders, b.orders);
    else writeJsonAtomicSync(FILES.orders, b.orders);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal Server Error' }); }
});

app.get('/api/bank', async (_req, res) => {
  try {
    const log = USE_DB ? await db.get(KEYS.bank, []) : readJsonSync(FILES.bank, []);
    res.json({ log });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal Server Error' }); }
});
app.put('/api/bank', async (req, res) => {
  try {
    const b = req.body || {};
    if (!isArray(b.log)) return bad(res, '"log" must be an array');
    if (USE_DB) await db.set(KEYS.bank, b.log);
    else writeJsonAtomicSync(FILES.bank, b.log);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal Server Error' }); }
});

app.get('/api/users', async (_req, res) => {
  try {
    const users = USE_DB ? await db.get(KEYS.users, []) : readJsonSync(FILES.users, []);
    res.json({ users });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal Server Error' }); }
});
app.put('/api/users', async (req, res) => {
  try {
    const b = req.body || {};
    if (!isArray(b.users)) return bad(res, '"users" must be an array');
    if (USE_DB) await db.set(KEYS.users, b.users);
    else writeJsonAtomicSync(FILES.users, b.users);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Internal Server Error' }); }
});

// ---------- Start ----------
(async function start() {
  if (USE_DB) {
    db = require('./db');
    await dbBootstrap();
    await dbEnsureAdmin();
  } else {
    fsBootstrap();
    fsEnsureAdmin();
  }

// Health check (Render -> Settings -> Health Check Path = /healthz)
app.get('/healthz', async (_req, res) => {
  try {
    if (USE_DB && db && db.get) {
      // лёгкий пинг БД (не критично, если таблица пустая)
      await db.get('health', []);
    }
    res.status(200).json({ ok: true, mode: USE_DB ? 'postgres' : 'files' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});


  app.listen(PORT, () => console.log('JSON server on http://localhost:' + PORT + ' (mode=' + (USE_DB?'postgres':'files') + ')'));
})();
