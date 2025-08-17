// server/server.js
// Файловый JSON-сервер (без БД). Раздаёт client/ и хранит JSON в data/.
// Эндпоинты: GET/PUT /api/catalog, /api/orders, /api/bank, /api/users (+ /healthz).
// Запись атомарная, валидация массивов. Защита от старых записей по X-Shop-Ts (409).
// ГАРАНТИЯ admin: сервер создаёт/оставляет пользователя admin (роль admin, пароль по умолчанию 'admin').

const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 7070;
const BODY_LIMIT = process.env.BODY_LIMIT || '25mb';

const ROOT = path.join(__dirname, '..');
const CLIENT_DIR = path.join(ROOT, 'client');
const DATA_DIR = path.join(ROOT, 'data');

const FILES = {
  products: path.join(DATA_DIR, 'products.json'),
  cats:     path.join(DATA_DIR, 'cats.json'),
  orders:   path.join(DATA_DIR, 'orders.json'),
  bank:     path.join(DATA_DIR, 'bank.json'),
  users:    path.join(DATA_DIR, 'users.json'),
  meta:     path.join(DATA_DIR, '.meta.json') // timestamps
};
const META_KEYS = {
  catalog: 'catalog_ts',
  orders:  'orders_ts',
  bank:    'bank_ts',
  users:   'users_ts'
};

// ---------- helpers ----------
function ensureDirSync(dir){ if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function readJsonSync(file, fallback){
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch(e){ if (typeof fallback !== 'undefined') return fallback; throw e; }
}
function writeFileAtomicSync(filePath, dataString){
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, '.' + base + '.tmp-' + process.pid + '-' + Date.now());
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, dataString, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, filePath);
  let dfd; try { dfd = fs.openSync(dir, 'r'); fs.fsyncSync(dfd); } catch(_) {} finally { if (dfd) fs.closeSync(dfd); }
}
function writeJsonAtomicSync(filePath, obj){
  writeFileAtomicSync(filePath, JSON.stringify(obj, null, 2) + '\n');
}
function isArray(x){ return Array.isArray(x); }
function bad(res,msg){ return res.status(400).json({ error: msg || 'Bad Request' }); }
function getClientTs(req){ return parseInt(req.get('x-shop-ts'), 10) || 0; }

// ---------- admin ensure ----------
function uname(u){ return (u && (u.nick||u.login||u.username||u.id||u.name)||'').toString().trim(); }

/** Возвращает массив пользователей, где гарантированно есть единственный admin.
 *  - Если admin уже есть — не ломаем его поля, только дополняем недостающие.
 *  - Если пароля нет — ставим process.env.ADMIN_PASSWORD или 'admin'.
 *  - Если ADMIN_FORCE_RESET=1 — перезаписываем пароль admin.
 */
function ensureAdminInArray(arr){
  arr = Array.isArray(arr) ? arr.slice() : [];
  const pwd = process.env.ADMIN_PASSWORD || 'admin';
  const force = process.env.ADMIN_FORCE_RESET === '1';

  const keep = [];
  const admins = [];
  for (let i=0;i<arr.length;i++){
    const u = arr[i] || {};
    const n = uname(u);
    if (n && n.toLowerCase() === 'admin') admins.push(u);
    else keep.push(u);
  }

  // Сливаем все admin-объекты в один
  const admin = {};
  for (let i=0;i<admins.length;i++){
    const src = admins[i] || {};
    for (const k in src) if (Object.prototype.hasOwnProperty.call(src,k)) admin[k]=src[k];
  }
  // Базовые поля admin
  admin.nick='admin';
  admin.login='admin';
  admin.username='admin';
  admin.role='admin';
  admin.isAdmin=true;
  admin.admin=true;

  if (force || !(admin.password || admin.pass || admin.pwd)) {
    admin.password=pwd; admin.pass=pwd; admin.pwd=pwd;
  }

  admin.updatedAt = Date.now();

  const next = keep.concat([admin]);
  const changed = JSON.stringify(next) !== JSON.stringify(arr);
  return { changed, arr: next };
}

// ---------- bootstrap ----------
function bootstrap(){
  ensureDirSync(DATA_DIR);

  if (!fs.existsSync(FILES.products)){
    writeJsonAtomicSync(FILES.products, [
      { id: 1, title: 'Demo футболка', price: 1990, cat: 'Одежда' },
      { id: 2, title: 'Demo худи',     price: 3990, cat: 'Одежда' },
      { id: 3, title: 'Demo кружка',   price:  990, cat: 'Аксессуары' }
    ]);
  }
  if (!fs.existsSync(FILES.cats))   writeJsonAtomicSync(FILES.cats,   ['Одежда','Аксессуары']);
  if (!fs.existsSync(FILES.orders)) writeJsonAtomicSync(FILES.orders, []);
  if (!fs.existsSync(FILES.bank))   writeJsonAtomicSync(FILES.bank,   []);
  if (!fs.existsSync(FILES.users))  writeJsonAtomicSync(FILES.users,  []); // создадим файл, если нет
  if (!fs.existsSync(FILES.meta))   writeJsonAtomicSync(FILES.meta,   {});

  // Гарантируем, что admin есть даже если файл уже существовал
  const users = readJsonSync(FILES.users, []);
  const { changed, arr } = ensureAdminInArray(users);
  if (changed) writeJsonAtomicSync(FILES.users, arr);
}
bootstrap();

// meta (timestamps)
function readMeta(){ return readJsonSync(FILES.meta, {}); }
function writeMetaPatch(patch){
  const meta = readMeta();
  for (const k in patch) if (Object.prototype.hasOwnProperty.call(patch,k)) meta[k]=patch[k];
  writeJsonAtomicSync(FILES.meta, meta);
}
function getTs(name){ return parseInt(readMeta()[name], 10) || 0; }
function setTs(name, ts){ writeMetaPatch({ [name]: parseInt(ts,10) || Date.now() }); }

// ---------- middlewares ----------
const app = express();
app.use(express.json({ limit: BODY_LIMIT, strict: true }));
app.use(express.urlencoded({ limit: BODY_LIMIT, extended: true }));
app.use(express.static(CLIENT_DIR, { etag:false, lastModified:false, cacheControl:false }));

// ---------- routes: catalog ----------
app.get('/api/catalog', (_req,res)=>{
  try {
    const cats = readJsonSync(FILES.cats, []);
    const products = readJsonSync(FILES.products, []);
    res.json({ cats, products });
  } catch(e){ console.error(e); res.status(500).json({ error:'Internal Server Error' }); }
});
app.put('/api/catalog', (req,res)=>{
  try {
    const b = req.body || {};
    if (!isArray(b.cats) || !isArray(b.products)) return bad(res,'Both "cats" and "products" must be arrays');
    const clientTs = getClientTs(req), serverTs = getTs(META_KEYS.catalog);
    if (clientTs && serverTs && clientTs < serverTs){
      const cats = readJsonSync(FILES.cats, []);
      const products = readJsonSync(FILES.products, []);
      return res.status(409).json({ stale:true, ts:serverTs, cats, products });
    }
    writeJsonAtomicSync(FILES.cats, b.cats);
    writeJsonAtomicSync(FILES.products, b.products);
    setTs(META_KEYS.catalog, clientTs || Date.now());
    res.json({ ok:true });
  } catch(e){ console.error(e); res.status(500).json({ error:'Internal Server Error' }); }
});

// ---------- routes: orders ----------
app.get('/api/orders', (_req,res)=>{
  try { res.json({ orders: readJsonSync(FILES.orders, []) }); }
  catch(e){ console.error(e); res.status(500).json({ error:'Internal Server Error' }); }
});
app.put('/api/orders', (req,res)=>{
  try {
    const b=req.body||{};
    if(!isArray(b.orders)) return bad(res,'"orders" must be an array');
    const clientTs = getClientTs(req), serverTs = getTs(META_KEYS.orders);
    if (clientTs && serverTs && clientTs < serverTs){
      return res.status(409).json({ stale:true, ts:serverTs, orders: readJsonSync(FILES.orders, []) });
    }
    writeJsonAtomicSync(FILES.orders, b.orders);
    setTs(META_KEYS.orders, clientTs || Date.now());
    res.json({ ok:true });
  } catch(e){ console.error(e); res.status(500).json({ error:'Internal Server Error' }); }
});

// ---------- routes: bank ----------
app.get('/api/bank', (_req,res)=>{
  try { res.json({ log: readJsonSync(FILES.bank, []) }); }
  catch(e){ console.error(e); res.status(500).json({ error:'Internal Server Error' }); }
});
app.put('/api/bank', (req,res)=>{
  try {
    const b=req.body||{};
    if(!isArray(b.log)) return bad(res,'"log" must be an array');
    const clientTs = getClientTs(req), serverTs = getTs(META_KEYS.bank);
    if (clientTs && serverTs && clientTs < serverTs){
      return res.status(409).json({ stale:true, ts:serverTs, log: readJsonSync(FILES.bank, []) });
    }
    writeJsonAtomicSync(FILES.bank, b.log);
    setTs(META_KEYS.bank, clientTs || Date.now());
    res.json({ ok:true });
  } catch(e){ console.error(e); res.status(500).json({ error:'Internal Server Error' }); }
});

// ---------- routes: users (кросс-девайс логины) ----------
app.get('/api/users', (_req,res)=>{
  try {
    // доп. гарантия: даже если кто-то удалил admin — восстановим на лету
    const users = readJsonSync(FILES.users, []);
    const fixed = ensureAdminInArray(users);
    if (fixed.changed) writeJsonAtomicSync(FILES.users, fixed.arr);
    res.json({ users: fixed.arr });
  } catch(e){ console.error(e); res.status(500).json({ error:'Internal Server Error' }); }
});
app.put('/api/users', (req,res)=>{
  try {
    const b=req.body||{};
    if(!isArray(b.users)) return bad(res,'"users" must be an array');
    // не позволяем потерять admin — добавим/обновим перед сохранением
    const fixed = ensureAdminInArray(b.users);

    const clientTs = getClientTs(req), serverTs = getTs(META_KEYS.users);
    if (clientTs && serverTs && clientTs < serverTs){
      const current = readJsonSync(FILES.users, []);
      const fixedCur = ensureAdminInArray(current).arr;
      return res.status(409).json({ stale:true, ts:serverTs, users: fixedCur });
    }

    writeJsonAtomicSync(FILES.users, fixed.arr);
    setTs(META_KEYS.users, clientTs || Date.now());
    res.json({ ok:true });
  } catch(e){ console.error(e); res.status(500).json({ error:'Internal Server Error' }); }
});

// ---------- health ----------
app.get('/healthz', (_req,res)=>{ res.json({ ok:true, mode:'files' }); });

// ---------- start ----------
app.listen(PORT, ()=>{ console.log('JSON file server on http://localhost:'+PORT); });
