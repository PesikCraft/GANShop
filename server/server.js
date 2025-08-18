'use strict';

var express = require('express');
var fs = require('fs');
var path = require('path');

var app = express();
var PORT = process.env.PORT || 7070;

var BASE_DIR = path.join(__dirname, '..');
var CLIENT_DIR = path.join(BASE_DIR, 'client');
var DATA_DIR = path.join(BASE_DIR, 'data');

function ensureDir(p) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

function readJson(filePath, fallback) {
  try {
    var raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function fsyncDirSync(dirPath) {
  try {
    var dfd = fs.openSync(dirPath, 'r');
    try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
  } catch (e) { /* noop */ }
}

// tmp → fsync(tmp) → rename → fsync(dir)
function writeFileAtomicSync(filePath, dataString) {
  var dir = path.dirname(filePath);
  ensureDir(dir);
  var tmp = filePath + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2);
  var fd;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, dataString, 0, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, filePath);
    fsyncDirSync(dir);
  } catch (e) {
    try { if (typeof fd === 'number') fs.closeSync(fd); } catch (_) {}
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}

function initData() {
  ensureDir(DATA_DIR);
  var seeds = [
{ name: 'users.json', value: [
  { "nick": "admin", "pass": "admin123", "isAdmin": true, "createdAt": Date.now() }
] }

  	
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
  for (var i = 0; i < seeds.length; i++) {
    var fp = path.join(DATA_DIR, seeds[i].name);
    if (!fs.existsSync(fp)) {
      writeFileAtomicSync(fp, JSON.stringify(seeds[i].value, null, 2));
    }
  }
}

initData();

// Глобально отключаем кэш (и для API, и для статики)
app.use(function (req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(express.json({ limit: '1mb' }));

// Раздача клиентской статики
app.use(express.static(CLIENT_DIR, {
  etag: false,
  lastModified: false,
  cacheControl: false
}));

/* ============ API ============ */

// GET /api/catalog → { cats:[...], products:[...] }
app.get('/api/catalog', function (req, res) {
  try {
    var products = readJson(path.join(DATA_DIR, 'products.json'), []);
    var cats = readJson(path.join(DATA_DIR, 'cats.json'), []);
    res.json({ cats: cats, products: products });
  } catch (e) {
    res.status(500).json({ error: 'failed to read catalog' });
  }
});

// PUT /api/catalog ← { cats:[...], products:[...] }
app.put('/api/catalog', function (req, res) {
  try {
    var body = req.body || {};
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
    var orders = readJson(path.join(DATA_DIR, 'orders.json'), []);
    res.json({ orders: orders });
  } catch (e) {
    res.status(500).json({ error: 'failed to read orders' });
  }
});

// PUT /api/orders ← { orders:[...] }
app.put('/api/orders', function (req, res) {
  try {
    var body = req.body || {};
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
    var log = readJson(path.join(DATA_DIR, 'bank.json'), []);
    res.json({ log: log });
  } catch (e) {
    res.status(500).json({ error: 'failed to read bank' });
  }
});

// PUT /api/bank ← { log:[...] }
app.put('/api/bank', function (req, res) {
  try {
    var body = req.body || {};
    if (!Array.isArray(body.log)) {
      return res.status(400).json({ error: 'log must be an array' });
    }
    writeFileAtomicSync(path.join(DATA_DIR, 'bank.json'), JSON.stringify(body.log, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'failed to write bank' });
  }
});

/* ======= SPA fallback (если есть client-side routing) ======= */
app.get('*', function (req, res) {
  res.sendFile(path.join(CLIENT_DIR, 'index.html'));
});

app.listen(PORT, function () {
  console.log('Server listening on http://localhost:' + PORT);
});

