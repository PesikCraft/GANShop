/**
 * JSON server for offline shop + users
 * Static: ../client
 * Data: ../data
 * Port: 7070
 * Atomic writes: tmp -> fsync -> rename
 * Endpoints:
 *   GET/PUT /api/catalog { cats:[...], products:[...] }
 *   GET/PUT /api/orders  { orders:[...] }
 *   GET/PUT /api/bank    { log:[...] }
 *   GET/PUT /api/users   { users:[...] }   // NEW
 */
const path = require('path');
const fs = require('fs');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 7070;

const BODY_LIMIT = process.env.BODY_LIMIT || '25mb';

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CLIENT_DIR = path.join(ROOT, 'client');

const FILES = {
  products: path.join(DATA_DIR, 'products.json'),
  cats: path.join(DATA_DIR, 'cats.json'),
  orders: path.join(DATA_DIR, 'orders.json'),
  bank: path.join(DATA_DIR, 'bank.json'),
  users: path.join(DATA_DIR, 'users.json'), // NEW
};

app.use(express.json({ limit: BODY_LIMIT, strict: true }));
app.use(express.urlencoded({ limit: BODY_LIMIT, extended: true }));
app.use(express.static(CLIENT_DIR, { etag: false, lastModified: false, cacheControl: false }));

// ---- FS helpers ----
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
function writeJsonAtomicSync(filePath, obj) { writeFileAtomicSync(filePath, JSON.stringify(obj, null, 2) + '\n'); }
function bad(res, msg) { return res.status(400).json({ error: msg || 'Bad Request' }); }
function isArray(x){ return Array.isArray(x); }

// ---- Bootstrap ----
function bootstrapData() {
  ensureDirSync(DATA_DIR);
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
  if (!fs.existsSync(FILES.users))  writeJsonAtomicSync(FILES.users,  []); // NEW
}
bootstrapData();

// --- ensureAdminUser: гарантия наличия admin (role: 'admin') ---
function ensureAdminUser() {
  try {
    var users = readJsonSync(FILES.users, []);
    if (!Array.isArray(users)) users = [];
    var pwd = process.env.ADMIN_PASSWORD || 'admin123'; // можно переопределить в ENV
    var changed = false;
    var found = false;
    for (var i = 0; i < users.length; i++) {
      var u = users[i] || {};
      var name = (u.nick || u.login || u.username || u.id || u.name || '').toString();
      if (name === 'admin') {
        found = true;
        if (u.role !== 'admin') { u.role = 'admin'; changed = true; }
        if (!u.password) { u.password = pwd; changed = true; }
        users[i] = u;
        break;
      }
    }
    if (!found) {
      users.push({ nick: 'admin', password: pwd, role: 'admin', createdAt: Date.now() });
      changed = true;
    }
    if (changed) writeJsonAtomicSync(FILES.users, users);
  } catch (e) {
    console.error('ensureAdminUser failed:', e);
  }
}


// ---- Routes ----
app.get('/api/catalog', (_req,res) => {
  try { res.json({ cats: readJsonSync(FILES.cats, []), products: readJsonSync(FILES.products, []) }); }
  catch(e){ console.error(e); res.status(500).json({ error: 'Internal Server Error' }); }
});
app.put('/api/catalog', (req,res) => {
  try {
    const b=req.body||{};
    if (!isArray(b.cats) || !isArray(b.products)) return bad(res,'Both "cats" and "products" must be arrays');
    writeJsonAtomicSync(FILES.cats, b.cats);
    writeJsonAtomicSync(FILES.products, b.products);
    res.json({ ok:true });
  } catch(e){ console.error(e); res.status(500).json({ error: 'Internal Server Error' }); }
});

app.get('/api/orders', (_req,res) => {
  try { res.json({ orders: readJsonSync(FILES.orders, []) }); }
  catch(e){ console.error(e); res.status(500).json({ error: 'Internal Server Error' }); }
});
app.put('/api/orders', (req,res) => {
  try {
    const b=req.body||{};
    if (!isArray(b.orders)) return bad(res,'"orders" must be an array');
    writeJsonAtomicSync(FILES.orders, b.orders);
    res.json({ ok:true });
  } catch(e){ console.error(e); res.status(500).json({ error: 'Internal Server Error' }); }
});

app.get('/api/bank', (_req,res) => {
  try { res.json({ log: readJsonSync(FILES.bank, []) }); }
  catch(e){ console.error(e); res.status(500).json({ error: 'Internal Server Error' }); }
});
app.put('/api/bank', (req,res) => {
  try {
    const b=req.body||{};
    if (!isArray(b.log)) return bad(res,'"log" must be an array');
    writeJsonAtomicSync(FILES.bank, b.log);
    res.json({ ok:true });
  } catch(e){ console.error(e); res.status(500).json({ error: 'Internal Server Error' }); }
});

// ---- NEW: users ----
app.get('/api/users', (_req,res) => {
  try { res.json({ users: readJsonSync(FILES.users, []) }); }
  catch(e){ console.error(e); res.status(500).json({ error: 'Internal Server Error' }); }
});
app.put('/api/users', (req,res) => {
  try {
    const b=req.body||{};
    if (!isArray(b.users)) return bad(res,'"users" must be an array');
    writeJsonAtomicSync(FILES.users, b.users);
    res.json({ ok:true });
  } catch(e){ console.error(e); res.status(500).json({ error: 'Internal Server Error' }); }
});

app.listen(PORT, () => console.log('JSON server on http://localhost:'+PORT));
