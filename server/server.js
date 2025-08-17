/* eslint-disable no-sync */
const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 7070;

// --- Paths
const ROOT = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(ROOT, 'client');
const DATA_DIR = path.join(ROOT, 'data');

const FILES = {
  products: path.join(DATA_DIR, 'products.json'),
  cats: path.join(DATA_DIR, 'cats.json'),
  orders: path.join(DATA_DIR, 'orders.json'),
  bank: path.join(DATA_DIR, 'bank.json'),
  users: path.join(DATA_DIR, 'users.json'),
  ts: path.join(DATA_DIR, '.ts.json'), // серверные метки (Unix ms) по ресурсам
};

// --- Helpers: safe fsync + atomic write
async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);

  const json = JSON.stringify(data, null, 2);

  // write tmp
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, json, 0, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  // rename over target
  fs.renameSync(tmp, filePath);

  // fsync directory (лучшая попытка; не везде доступно)
  try {
    const dfd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(dfd);
    } finally {
      fs.closeSync(dfd);
    }
  } catch (e) {
    // платформа может не поддерживать fsync на директории — игнорируем
  }
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    const buf = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(buf);
  } catch (e) {
    return fallback;
  }
}

function nowMs() {
  return Date.now();
}

// --- TS map (серверные метки версий)
async function readTs() {
  const map = await readJson(FILES.ts, {});
  return Object.assign({ catalog: 0, orders: 0, bank: 0, users: 0 }, map);
}
async function writeTs(map) {
  await writeJsonAtomic(FILES.ts, map);
}
async function bumpTs(key) {
  const map = await readTs();
  map[key] = nowMs();
  await writeTs(map);
  return map[key];
}

// --- Admin guard
function ensureAdmin(users) {
  let found = false;
  const next = (Array.isArray(users) ? users : []).map(function (u) {
    if (u && typeof u === 'object' && String(u.nick || '').toLowerCase() === 'admin') {
      found = true;
      // «обновляет/добавляет»: гарантируем пароль
      return Object.assign({}, u, { nick: 'admin', password: 'admin123', role: 'admin' });
    }
    return u;
  });
  if (!found) {
    next.push({ nick: 'admin', password: 'admin123', role: 'admin' });
  }
  return next;
}

// --- Bootstrap data on first run
async function bootstrap() {
  await ensureDir(DATA_DIR);

  const exists = async (p) => !!(await fsp.stat(p).catch(() => null));

  if (!(await exists(FILES.products))) {
    await writeJsonAtomic(FILES.products, [
      { id: 1, title: "Ararat T-Shirt", price: 9900, cat: "clothes" },
      { id: 2, title: "Pomegranate Magnet", price: 1900, cat: "souvenirs" },
      { id: 3, title: "Copper Coffee Pot", price: 5900, cat: "kitchen" },
    ]);
  }
  if (!(await exists(FILES.cats))) {
    await writeJsonAtomic(FILES.cats, [
      { id: "clothes", title: "Clothes" },
      { id: "souvenirs", title: "Souvenirs" },
      { id: "kitchen", title: "Kitchen" },
    ]);
  }
  if (!(await exists(FILES.orders))) {
    await writeJsonAtomic(FILES.orders, []);
  }
  if (!(await exists(FILES.bank))) {
    await writeJsonAtomic(FILES.bank, []);
  }
  if (!(await exists(FILES.users))) {
    await writeJsonAtomic(FILES.users, ensureAdmin([]));
  } else {
    // гарантируем админа на старте
    const users = await readJson(FILES.users, []);
    await writeJsonAtomic(FILES.users, ensureAdmin(users));
  }
  if (!(await exists(FILES.ts))) {
    await writeJsonAtomic(FILES.ts, {
      catalog: nowMs(),
      orders: nowMs(),
      bank: nowMs(),
      users: nowMs(),
    });
  }
}

// --- Middleware
app.use(express.json({ limit: '2mb' }));

// Health
app.get('/healthz', function (_req, res) {
  res.json({ ok: true, mode: 'files' });
});

// --- Helpers: validators
function isArray(x) { return Array.isArray(x); }
function bad(res, code, msg) { res.status(code).json({ ok: false, error: msg || 'bad request' }); }

// --- API: Catalog (cats + products) with X-Shop-Ts
app.get('/api/catalog', async function (_req, res) {
  const cats = await readJson(FILES.cats, []);
  const products = await readJson(FILES.products, []);
  const ts = (await readTs()).catalog || 0;
  res.set('X-Shop-Ts', String(ts));
  res.json({ cats, products });
});

app.put('/api/catalog', async function (req, res) {
  const body = req.body || {};
  const cats = body.cats;
  const products = body.products;

  if (!isArray(cats) || !isArray(products)) {
    return bad(res, 400, 'cats and products must be arrays');
  }

  const tsMap = await readTs();
  const serverTs = tsMap.catalog || 0;

  const clientTsRaw = req.get('X-Shop-Ts');
  const clientTs = clientTsRaw ? Number(clientTsRaw) : 0;

  if (isNaN(clientTs)) {
    return bad(res, 400, 'invalid X-Shop-Ts');
  }

  if (clientTs < serverTs) {
    // устаревшая запись — отправляем актуальные данные
    const catsNow = await readJson(FILES.cats, []);
    const productsNow = await readJson(FILES.products, []);
    res.set('X-Shop-Ts', String(serverTs));
    return res.status(409).json({ cats: catsNow, products: productsNow });
  }

  // Записываем обе части атомарно (пофайлово)
  try {
    await writeJsonAtomic(FILES.cats, cats);
    await writeJsonAtomic(FILES.products, products);
    const newTs = await bumpTs('catalog');
    res.set('X-Shop-Ts', String(newTs));
    res.json({ cats, products });
  } catch (e) {
    bad(res, 500, 'write error');
  }
});

// --- API: Orders
app.get('/api/orders', async function (_req, res) {
  const orders = await readJson(FILES.orders, []);
  res.json({ orders });
});
app.put('/api/orders', async function (req, res) {
  const body = req.body || {};
  const orders = body.orders;
  if (!isArray(orders)) return bad(res, 400, 'orders must be an array');
  try {
    await writeJsonAtomic(FILES.orders, orders);
    await bumpTs('orders');
    res.json({ orders });
  } catch (e) {
    bad(res, 500, 'write error');
  }
});

// --- API: Bank log
app.get('/api/bank', async function (_req, res) {
  const log = await readJson(FILES.bank, []);
  res.json({ log });
});
app.put('/api/bank', async function (req, res) {
  const body = req.body || {};
  const log = body.log;
  if (!isArray(log)) return bad(res, 400, 'log must be an array');
  try {
    await writeJsonAtomic(FILES.bank, log);
    await bumpTs('bank');
    res.json({ log });
  } catch (e) {
    bad(res, 500, 'write error');
  }
});

// --- API: Users (с гарантией admin/admin123)
app.get('/api/users', async function (_req, res) {
  const users = await readJson(FILES.users, []);
  res.json({ users: ensureAdmin(users) });
});
app.put('/api/users', async function (req, res) {
  const body = req.body || {};
  let users = body.users;
  if (!isArray(users)) return bad(res, 400, 'users must be an array');
  users = ensureAdmin(users);
  try {
    await writeJsonAtomic(FILES.users, users);
    await bumpTs('users');
    res.json({ users });
  } catch (e) {
    bad(res, 500, 'write error');
  }
});

// --- Static
app.use(express.static(CLIENT_DIR, { index: 'index.html', extensions: ['html'] }));

// Fallback to index for root
app.get('/', function (_req, res) {
  res.sendFile(path.join(CLIENT_DIR, 'index.html'));
});

// --- Start
bootstrap().then(function () {
  app.listen(PORT, function () {
    console.log('File JSON server on http://localhost:' + PORT);
  });
}).catch(function (e) {
  console.error('Bootstrap failed:', e);
  process.exit(1);
});
