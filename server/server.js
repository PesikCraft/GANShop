const path = require('path');
const fs = require('fs');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 7070;

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CLIENT_DIR = path.join(ROOT, 'client');

const FILES = {
  products: path.join(DATA_DIR, 'products.json'),
  cats: path.join(DATA_DIR, 'cats.json'),
  orders: path.join(DATA_DIR, 'orders.json'),
  bank: path.join(DATA_DIR, 'bank.json'),
};

const BODY_LIMIT = process.env.BODY_LIMIT || '25mb'; // можно 50mb, если нужно
app.use(express.json({ limit: BODY_LIMIT, strict: true }));
app.use(express.urlencoded({ limit: BODY_LIMIT, extended: true }));

app.use(express.static(CLIENT_DIR, { etag:false, lastModified:false, cacheControl:false }));

function ensureDirSync(dir){ if(!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive:true}); }
function readJsonSync(p, fb){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); } catch(_){ return fb; } }
function writeFileAtomicSync(filePath, str){
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, '.'+base+'.tmp-'+process.pid+'-'+Date.now());
  const fd = fs.openSync(tmp, 'w');
  try{ fs.writeFileSync(fd, str, 'utf8'); fs.fsyncSync(fd); } finally{ fs.closeSync(fd); }
  fs.renameSync(tmp, filePath);
  try{ const dfd = fs.openSync(dir, 'r'); fs.fsyncSync(dfd); fs.closeSync(dfd); } catch(_){}
}
function writeJsonAtomicSync(p, obj){ writeFileAtomicSync(p, JSON.stringify(obj, null, 2) + '\n'); }

function bootstrap(){
  ensureDirSync(DATA_DIR);
  if(!fs.existsSync(FILES.products)){
    writeJsonAtomicSync(FILES.products, [
      { "id":"t1","title":"Майка Sky","price":9900,"cat":"Футболки","sizes":["S","M","L","XL"],"colors":["Белый","Чёрный"],
        "svg":"<svg viewBox=\"0 0 200 200\" xmlns=\"http://www.w3.org/2000/svg\"><rect width=\"200\" height=\"200\" rx=\"18\" fill=\"#f5f7fb\"/><path d=\"M40 60l30-12 20 14h20l20-14 30 12-16 24v64H56V84z\" fill=\"#dfe7fb\" stroke=\"#bcc9ef\"/><circle cx=\"100\" cy=\"110\" r=\"22\" fill=\"#6aa6ff\"/></svg>" },
      { "id":"h1","title":"Худи Nebula","price":19900,"cat":"Худи","sizes":["XS","S","M","L","XL"],"colors":["Лиловый","Черный"],
        "svg":"<svg viewBox=\"0 0 200 200\" xmlns=\"http://www.w3.org/2000/svg\"><rect width=\"200\" height=\"200\" rx=\"18\" fill=\"#f5f7fb\"/><path d=\"M70 60h60l20 24v64H50V84z\" fill=\"#efe7ff\" stroke=\"#dacfff\"/><rect x=\"82\" y=\"70\" width=\"36\" height=\"22\" rx=\"10\" fill=\"#c8b6ff\"/></svg>" },
      { "id":"s1","title":"Свитшот Stone","price":15900,"cat":"Свитшоты","sizes":["S","M","L","XL"],"colors":["Серый","Чёрный"],
        "svg":"<svg viewBox=\"0 0 200 200\" xmlns=\"http://www.w3.org/2000/svg\"><rect width=\"200\" height=\"200\" rx=\"18\" fill=\"#f5f7fb\"/><rect x=\"50\" y=\"70\" width=\"100\" height=\"80\" rx=\"8\" fill=\"#e8ecf8\"/><path d=\"M50 86h100\" stroke=\"#d7def0\"/></svg>" }
    ]);
  }
  if(!fs.existsSync(FILES.cats)){
    writeJsonAtomicSync(FILES.cats, ["Футболки","Худи","Свитшоты"]);
  }
  if(!fs.existsSync(FILES.orders)) writeJsonAtomicSync(FILES.orders, []);
  if(!fs.existsSync(FILES.bank))   writeJsonAtomicSync(FILES.bank, []);
}
bootstrap();

function bad(res,msg){ return res.status(400).json({error: msg||'Bad Request'}); }
function isArr(x){ return Array.isArray(x); }

app.get('/api/catalog', (_req,res)=>{
  try{
    res.json({ cats: readJsonSync(FILES.cats, []), products: readJsonSync(FILES.products, []) });
  }catch(e){ console.error(e); res.status(500).json({error:'Internal Server Error'}); }
});
app.put('/api/catalog', (req,res)=>{
  try{
    const b = req.body||{};
    if(!isArr(b.cats) || !isArr(b.products)) return bad(res,'Both "cats" and "products" must be arrays');
    writeJsonAtomicSync(FILES.cats, b.cats);
    writeJsonAtomicSync(FILES.products, b.products);
    res.json({ok:true});
  }catch(e){ console.error(e); res.status(500).json({error:'Internal Server Error'}); }
});

app.get('/api/orders', (_req,res)=>{
  try{ res.json({ orders: readJsonSync(FILES.orders, []) }); }
  catch(e){ console.error(e); res.status(500).json({error:'Internal Server Error'}); }
});
app.put('/api/orders', (req,res)=>{
  try{
    const b = req.body||{};
    if(!isArr(b.orders)) return bad(res,'"orders" must be an array');
    writeJsonAtomicSync(FILES.orders, b.orders);
    res.json({ok:true});
  }catch(e){ console.error(e); res.status(500).json({error:'Internal Server Error'}); }
});

app.get('/api/bank', (_req,res)=>{
  try{ res.json({ log: readJsonSync(FILES.bank, []) }); }
  catch(e){ console.error(e); res.status(500).json({error:'Internal Server Error'}); }
});
app.put('/api/bank', (req,res)=>{
  try{
    const b = req.body||{};
    if(!isArr(b.log)) return bad(res,'"log" must be an array');
    writeJsonAtomicSync(FILES.bank, b.log);
    res.json({ok:true});
  }catch(e){ console.error(e); res.status(500).json({error:'Internal Server Error'}); }
});

app.listen(PORT, ()=> console.log('http://localhost:'+PORT));
