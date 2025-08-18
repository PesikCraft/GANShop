'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const app  = express();
const PORT = process.env.PORT || 7070;

const BASE_DIR   = path.join(__dirname, '..');
const CLIENT_DIR = path.join(BASE_DIR, 'client');
const DATA_DIR   = path.join(BASE_DIR, 'data');

// Создаёт директорию, если её нет
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Чтение JSON с fallback
function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

// fsync на каталоге
function fsyncDir(dirPath) {
  try {
    const fd = fs.openSync(dirPath, 'r');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch (e) {
    // noop
  }
}

// Атомарная запись: tmp → fsync(tmp) → rename → fsync(parent dir)
function writeFileAtomicSync(filePath, dataString) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmp = filePath + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2);
  let fd;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, dataString, 0, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, filePath);
    fsyncDir(dir);
  } catch (e) {
    try { if (typeof fd === 'number') fs.closeSync(fd); } catch (_) {}
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}

// Инициализация файлов данных
function initData() {
  ensureDir(DATA_DIR);
  const seeds = [
    {
      name: 'products.json',
      value: [
        { "id": 1, "title": "Demo T-Shirt", "price": 1990 },
        { "id": 2, "title": "Demo Hoodie", "price": 3990 },
        { "id": 3, "title": "Demo Cap",   "price": 990 }
      ]
    },
    {
      name: 'cats.json',
      value: [
        { "id": 1, "title": "Apparel" },
        { "id": 2, "title": "Hoodies" },
        { "id": 3, "title": "Accessories" }
      ]
    },
    { name: 'orders.json', value: [] },
    { name: 'bank.json',   value: [] }
  ];
  seeds.forEach(function (s) {
    const fp = path.join(DATA_DIR, s.name);
    if (!fs.existsSync(fp)) {
      writeFileAtomicSync(fp, JSON.stringify(s.value, null, 2));
    }
  });
}
initData();

// Отключаем кэш для всех ответов
app.use(function (req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '1mb' }));

// Раздача статики из client/
app.use(express.static(CLIENT_DIR, {
  etag: false,
  lastModified: false,
  cacheControl: false
}));

/* ========== API ========== */

// GET /api/catalog → { cats:[...], products:[...] }
app.get('/api/catalog', function (req, res) {
  try {
    const products = readJson(path.join(DATA_DIR, 'products.json'), []);
    const cats     = readJson(path.join(DATA_DIR, 'cats.json'), []);
    res.json({ cats: cats, products: products });
  } catch (e) {
    res.status(500).json({ error: 'failed to read catalog' });
  }
});

// PUT /api/catalog ← { cats:[...], products:[...] }
app.put('/api/catalog', function (req, res) {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.cats) || !Array.isArray(body.products)) {
      return res.status(400).json({ error: 'cats and products must be arrays' });
    }
    writeFileAtomicSync(path.join(DATA_DIR, 'cats.json'), JSON.stringify(body.cats, null, 2));
    writeFileAtomicSync(path.join(DATA_DIR, 'products.json'), JSON.stringify(body.products, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'failed to write catalog' });
  }
});

// GET /api/orders → { orders:[...] }
app.get('/api/orders', function (req, res) {
  try {
    const orders = readJson(path.join(DATA_DIR, 'orders.json'), []);
    res.json({ orders: orders });
  } catch (e) {
    res.status(500).json({ error: 'failed to read orders' });
  }
});

// PUT /api/orders ← { orders:[...] }
app.put('/api/orders', function (req, res) {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.orders)) {
      return res.status(400).json({ error: 'orders must be an array' });
    }
    writeFileAtomicSync(path.join(DATA_DIR, 'orders.json'), JSON.stringify(body.orders, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'failed to write orders' });
  }
});

// GET /api/bank → { log:[...] }
app.get('/api/bank', function (req, res) {
  try {
    const log = readJson(path.join(DATA_DIR, 'bank.json'), []);
    res.json({ log: log });
  } catch (e) {
    res.status(500).json({ error: 'failed to read bank' });
  }
});

// PUT /api/bank ← { log:[...] }
app.put('/api/bank', function (req, res) {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.log)) {
      return res.status(400).json({ error: 'log must be an array' });
    }
    writeFileAtomicSync(path.join(DATA_DIR, 'bank.json'), JSON.stringify(body.log, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'failed to write bank' });
  }
});

/* ====== SPA fallback ====== */
app.get('*', function (req, res) {
  res.sendFile(path.join(CLIENT_DIR, 'index.html'));
});

app.listen(PORT, function () {
  console.log('Server listening on http://localhost:' + PORT);
});
