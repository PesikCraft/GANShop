/* ===== OFFLINE MODE (без Firebase) =====
   Никаких импортов, никакой инициализации — работаем только с localStorage.
   Функция loadRemoteData заглушена.
*/

// Раньше здесь были импорты firebase-... и конфиг.
// Удаляем их полностью.

const CLOUD = { loaded: true };

// Заглушка: ничего не делаем, данных «из облака» нет и не надо.
async function loadRemoteData() {
  // noop — всё возьмётся из DEFAULT_PRODUCTS и store.*
  return;
}

/* ===== Ключи хранилища ===== */
const LS = {
  users: "shop_users",
  session: "shop_session",
  orders: "shop_orders",
  cartPrefix: "shop_cart_",
  bank: "mock_bank",
  catalog: "shop_catalog",
  cats: "shop_cats",

  // Тема — персонально для каждого ника (или гостя)
  themePrefix: "shop_theme_",       // => shop_theme_<nick|guest>
  legacyTheme: "shop_theme_legacy", // старый глобальный ключ (для миграции)
};

/* ===== Константы / демо ===== */
const DEFAULT_ADMIN = { nick: "admin", pass: "admin123" };
const BANK = { card: "4355 0539 2618 2967", name: "DemoBank", currency: "֏" };

const DEFAULT_PRODUCTS = [
  { id:"t1", title:"Майка Sky",  price:9900,  cat:"Футболки",
    svg:`<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="200" rx="18" fill="#f5f7fb"/><path d="M40 60l30-12 20 14h20l20-14 30 12-16 24v64H56V84z" fill="#dfe7fb" stroke="#bcc9ef"/><circle cx="100" cy="110" r="22" fill="#6aa6ff"/></svg>`,
    sizes:["S","M","L","XL"], colors:["Белый","Чёрный"] },
  { id:"t2", title:"Майка Grid", price:10900, cat:"Футболки",
    svg:`<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="200" rx="18" fill="#f5f7fb"/><rect x="40" y="60" width="120" height="90" fill="#e6ebfa"/><rect x="50" y="72" width="100" height="12" fill="#cfdaf7"/><rect x="50" y="90" width="100" height="8" fill="#cfdaf7"/></svg>`,
    sizes:["S","M","L","XL"], colors:["Белый","Серый"] },
  { id:"h1", title:"Худи Nebula", price:19900, cat:"Худи",
    svg:`<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="200" rx="18" fill="#f5f7fb"/><path d="M70 60h60l20 24v64H50V84z" fill="#efe7ff" stroke="#dacfff"/><rect x="82" y="70" width="36" height="22" rx="10" fill="#c8b6ff"/></svg>`,
    sizes:["XS","S","M","L","XL"], colors:["Лиловый","Черный"] },
  { id:"h2", title:"Худи Deep Blue", price:18500, cat:"Худи",
    svg:`<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="200" rx="18" fill="#f5f7fb"/><rect x="56" y="76" width="88" height="72" fill="#e1e8ff"/><path d="M96 58h8l20 18H76z" fill="#d1dcff"/></svg>`,
    sizes:["S","M","L","XL","XXL"], colors:["Синий","Графит"] },
  { id:"s1", title:"Свитшот Stone", price:15900, cat:"Свитшоты",
    svg:`<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="200" rx="18" fill="#f5f7fb"/><rect x="50" y="70" width="100" height="80" rx="8" fill="#e8ecf8"/><path d="M50 86h100" stroke="#d7def0"/></svg>`,
    sizes:["S","M","L","XL"], colors:["Серый","Чёрный"] },
  { id:"s2", title:"Свитшот Line", price:16500, cat:"Свитшоты",
    svg:`<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="200" rx="18" fill="#f5f7fb"/><rect x="54" y="76" width="92" height="70" rx="8" fill="#e8ecf8"/><rect x="54" y="96" width="92" height="10" fill="#d7def0"/></svg>`,
    sizes:["S","M","L","XL"], colors:["Чёрный","Серый"] },
];

/* ===== Утилиты ===== */
const $  = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const fmt = n => n.toLocaleString("ru-RU")+" ֏";
const uid = () => Math.random().toString(36).slice(2,10);
const esc = s => (s||"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
function safeParse(str, fallback){ try{ const v = JSON.parse(str); return v ?? fallback; }catch(_){ return fallback; } }

/* ===== Toasts + баннер над модалкой ===== */
(function(){
  function ensureWrap(){
    let wrap = document.getElementById('toastWrap');
    if (!wrap){
      wrap = document.createElement('div');
      wrap.id='toastWrap';
      wrap.className='toast-wrap';
      wrap.setAttribute('aria-live','polite');
      document.body.appendChild(wrap);
    }
    return wrap;
  }

  // Плавающая плашка-ошибка над модалкой
  window.showModalBanner = function(dlgSelector, msg, type='error', timeout=6000){
    const dlg = document.querySelector(dlgSelector);
    if(!dlg) return;
    document.querySelectorAll('.modal-float-alert').forEach(n=>n.remove());
    const el = document.createElement('div');
    el.className = `modal-float-alert ${type}`;
    el.innerHTML = `<span>${msg}</span><button class="mfa-x" aria-label="Закрыть">✖</button>`;
    document.body.appendChild(el);
    const r = dlg.getBoundingClientRect();
    const h = el.getBoundingClientRect().height;
    el.style.top = (r.top - h - 25) + 'px';
    el.style.left = (r.left + r.width/2) + 'px';
    el.style.transform = 'translateX(-50%)';
    const close = ()=>{ el.classList.add('out'); setTimeout(()=> el.remove(), 160); };
    el.querySelector('.mfa-x').onclick = close;
    if (timeout) setTimeout(close, timeout);
  };

  // Тосты
  window.toast = function(text, type='info', timeout=3200){
    const wrap = ensureWrap();
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<div class="t-msg">${text}</div><button class="t-close" aria-label="Закрыть">✖</button>`;
    wrap.appendChild(el);
    let to = setTimeout(close, timeout);
    function close(){ el.classList.add('out'); setTimeout(()=> el.remove(), 160); clearTimeout(to); }
    el.querySelector('.t-close').onclick = close;
    return { close };
  };
  window.alert = function(text){ toast(String(text),'info'); };
})();

/* ===== Хранилище ===== */
const store = {
  getUsers(){ return safeParse(localStorage.getItem(LS.users), []); },
  setUsers(x){ localStorage.setItem(LS.users, JSON.stringify(x)); },

  getSession(){ return safeParse(localStorage.getItem(LS.session), null); },
  setSession(s){ s ? localStorage.setItem(LS.session, JSON.stringify(s)) : localStorage.removeItem(LS.session); },

  getOrders(){ return safeParse(localStorage.getItem(LS.orders), []); },
  setOrders(x){ localStorage.setItem(LS.orders, JSON.stringify(x)); },

  getCart(nick){ const key = LS.cartPrefix + (nick || "guest"); return safeParse(localStorage.getItem(key), []); },
  setCart(nick, cart){ const key = LS.cartPrefix + (nick || "guest"); localStorage.setItem(key, JSON.stringify(cart)); },

  bankLog(){ return safeParse(localStorage.getItem(LS.bank), []); },
  bankPush(entry){ const log = store.bankLog(); log.unshift(entry); localStorage.setItem(LS.bank, JSON.stringify(log)); },

  getCatalog(){ return safeParse(localStorage.getItem(LS.catalog), []); },
  setCatalog(x){ localStorage.setItem(LS.catalog, JSON.stringify(x)); },

  getCats(){ return safeParse(localStorage.getItem(LS.cats), []); },
  setCats(x){ localStorage.setItem(LS.cats, JSON.stringify(x)); }
};

/* ===== Нормализация SVG ===== */
function normalizeSvgMarkup(s){
  if (!s) return s;
  s = s.replace(/<svg([^>]*)\swidth="[^"]*"([^>]*)>/i, '<svg$1$2>');
  s = s.replace(/<svg([^>]*)\sheight="[^"]*"([^>]*)>/i, '<svg$1$2>');
  if (!/viewBox=/i.test(s)) s = s.replace(/<svg\b/i, '<svg viewBox="0 0 200 200"');
  if (!/preserveAspectRatio=/i.test(s)) s = s.replace(/<svg\b/i, '<svg preserveAspectRatio="xMidYMid meet"');
  return s;
}

/* ===== Инициализация данных (админ + каталог + категории) ===== */
function healAndInit(){
  // Users + admin
  let users = store.getUsers();
  if (!Array.isArray(users)) users = [];
  if (!users.some(u => (u.nick||"").toLowerCase() === DEFAULT_ADMIN.nick)){
    users.push({ nick: DEFAULT_ADMIN.nick, pass: DEFAULT_ADMIN.pass, isAdmin:true, createdAt: Date.now() });
  }
  store.setUsers(users);

  // Catalog
  let catalog = store.getCatalog();
  if (!Array.isArray(catalog) || catalog.length === 0){
    catalog = DEFAULT_PRODUCTS;
  }
  catalog = catalog.map(p => p.svg ? {...p, svg: normalizeSvgMarkup(p.svg)} : p);
  store.setCatalog(catalog);

  // Cats
  let cats = store.getCats();
  if (!Array.isArray(cats) || cats.length === 0){
    cats = Array.from(new Set(catalog.map(p=>p.cat)));
  }
  store.setCats(cats);
}

/* ===== Тема ===== */
function themeKeyForNick(nick){ return LS.themePrefix + (nick || "guest"); }
function getThemeForNick(nick){ return localStorage.getItem(themeKeyForNick(nick)) || "light"; }
function saveThemeForNick(nick, theme){ localStorage.setItem(themeKeyForNick(nick), theme); }
function applyTheme(theme){
  document.documentElement.classList.toggle("theme-dark", theme === "dark");
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = (theme === "dark") ? "☀️ Светлая" : "🌙 Тёмная";
}
function toggleTheme(){
  const nick = currentUser()?.nick || null;
  const now  = getThemeForNick(nick);
  const next = (now === "dark") ? "light" : "dark";
  saveThemeForNick(nick, next);
  applyTheme(next);
}
/* Миграция со старого ключа */
(function migrateLegacyTheme(){
  const old = localStorage.getItem(LS.legacyTheme);
  if (old && !localStorage.getItem(themeKeyForNick(null))){
    localStorage.setItem(themeKeyForNick(null), old); // гостю
  }
  localStorage.removeItem(LS.legacyTheme);
})();

/* ===== Состояние фильтров ===== */
const state = { q:"", cat:"Все", sort:"pop" };

/* ===== Категории (сайдбар) ===== */
function renderCats(){
  const cats = ["Все", ...store.getCats()];
  const ul = $("#cats"); if (!ul) return;
  ul.innerHTML = "";
  cats.forEach(c => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "cat-btn" + (state.cat===c ? " active":"");
    btn.textContent = c;
    btn.onclick = ()=>{ state.cat=c; renderCats(); renderGrid(); };
    li.appendChild(btn); ul.appendChild(li);
  });
}

/* ===== Каталог / карточки ===== */
function allProducts(){ return store.getCatalog(); }
function productImageHTML(p){
  if (p.svg) return normalizeSvgMarkup(p.svg);
  if (p.img) return `<img src="${p.img}" width="320" height="320" loading="lazy" decoding="async" alt="">`;
  return `<div style="width:64px;height:64px;background:#eef;border:1px solid #dde;border-radius:8px"></div>`;
}
function adminInlineEditHTML(p){
  if (!isAdmin()) return "";
  const catOpts = store.getCats().map(c=>`<option ${p.cat===c?'selected':''}>${c}</option>`).join("");
  return `
  <div class="adm-tools"><button class="btn btn-ghost xs toggleEdit">✏️ Ред.</button></div>
  <div class="adm-edit" hidden>
    <label>Название <input class="ae-title" value="${esc(p.title)}"></label>
    <label>Цена (֏) <input class="ae-price" type="number" min="0" value="${p.price}"></label>
    <label>Категория <select class="ae-cat">${catOpts}</select></label>
    <div class="row" style="justify-content:flex-end">
      <button class="btn xs ae-save primary">Сохранить</button>
      <button class="btn xs ae-cancel">Отмена</button>
      <button class="btn xs ae-del">Удалить</button>
    </div>
  </div>`;
}
function cardHTML(p){
  const sizeOpts  = (p.sizes||[]).map(s=>`<option${s==="M"?" selected":""}>${s}</option>`).join("");
  const colorOpts = (p.colors||[]).map(c=>`<option>${c}</option>`).join("");
  return `
  <article class="card" data-id="${p.id}">
    <div class="img">${productImageHTML(p)}</div>
    <div class="body">
      <h3>${p.title}</h3>
      <div class="muted">${p.cat}</div>
      <div class="price">${fmt(p.price)}</div>

      ${adminInlineEditHTML(p)}

      <div class="opts">
        <label>Размер <select class="opt-size">${sizeOpts}</select></label>
        <label>Цвет <select class="opt-color">${colorOpts}</select></label>
        <label>Кол-во <input class="opt-qty" type="number" min="1" value="1" /></label>
      </div>
      <div class="actions">
        <button class="btn primary add">Добавить в корзину</button>
      </div>
    </div>
  </article>`;
}
function renderGrid(){
  let items = [...allProducts()];
  if (state.q.trim()){ const q = state.q.trim().toLowerCase(); items = items.filter(p => (p.title+p.cat).toLowerCase().includes(q)); }
  if (state.cat !== "Все"){ items = items.filter(p => p.cat === state.cat); }
  if (state.sort === "priceAsc") items.sort((a,b)=>a.price-b.price);
  if (state.sort === "priceDesc") items.sort((a,b)=>b.price-a.price);

  $("#grid").innerHTML = items.map(cardHTML).join("");

  // обработчики карточек
  $$("#grid .card").forEach(card=>{
    // добавить в корзину
    card.querySelector(".add").onclick = ()=>{
      const id = card.dataset.id;
      const size = card.querySelector(".opt-size")?.value || "";
      const color = card.querySelector(".opt-color")?.value || "";
      const qty = Math.max(1, parseInt(card.querySelector(".opt-qty").value||"1",10));
      addToCart({id,size,color,qty});
      const dot = $("#cartCount"); dot.classList.remove("bump"); void dot.offsetWidth; dot.classList.add("bump");
    };

    // открыть полноэкранную карточку
    const id = card.dataset.id;
    card.querySelector(".img")?.addEventListener("click", ()=> openProduct(id));
    card.querySelector("h3")?.addEventListener("click",  ()=> openProduct(id));

    // inline-edit только для админа
    if (isAdmin()){
      const editBox = card.querySelector(".adm-edit");
      const toggleBtn = card.querySelector(".toggleEdit");
      const saveBtn = card.querySelector(".ae-save");
      const cancelBtn = card.querySelector(".ae-cancel");
      const delBtn = card.querySelector(".ae-del");

      toggleBtn.onclick = ()=>{ editBox.hidden = !editBox.hidden; };
      cancelBtn.onclick = ()=>{ editBox.hidden = true; };

      saveBtn.onclick = ()=>{
        const id = card.dataset.id;
        const P = allProducts();
        const idx = P.findIndex(x=>x.id===id);
        if (idx<0) return;
        const title = card.querySelector(".ae-title").value.trim();
        const price = parseInt(card.querySelector(".ae-price").value,10) || 0;
        const cat   = card.querySelector(".ae-cat").value;
        P[idx] = { ...P[idx], title, price, cat };
        store.setCatalog(P);
        toast("Товар обновлён","success");
        renderCats(); renderGrid();
      };

      delBtn.onclick = ()=>{
        const id = card.dataset.id;
        if (!confirm("Удалить товар?")) return;
        const P = allProducts().filter(x=>x.id!==id);
        store.setCatalog(P);
        toast("Товар удалён","warn");
        renderCats(); renderGrid();
      };
    }
  });
}

/* ===== Полноэкранная карточка товара ===== */
function ensureProductModalStyles(){
  if (document.getElementById("productModalStyles")) return;
  const css = document.createElement("style");
  css.id = "productModalStyles";
  css.textContent = `
  .product-card{ animation: product-in .22s ease both; }
  @keyframes product-in{ from{opacity:0; transform:translateY(8px) scale(.98)} to{opacity:1; transform:none} }
  .product-body{ display:grid; grid-template-columns: 1fr 1fr; gap:16px; }
  .p-left{ display:grid; place-items:center; }
  .p-img{ width:100%; aspect-ratio:1/1; display:grid; place-items:center;
          background:var(--imgbg); border:1px solid var(--line); border-radius:14px; overflow:hidden; }
  .p-img img, .p-img svg{ width:100%; height:100%; object-fit:contain; }
  .p-right{ display:grid; gap:12px; align-content:start; }
  .p-title{ font-weight:900; }
  .p-price{ font-size:22px; font-weight:900; }
  .opt-row{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .opt-label{ width:84px; color:var(--muted); }
  .chip-group{ display:flex; gap:8px; flex-wrap:wrap; }
  .chip{ border:1px solid var(--line); background:var(--panel); padding:8px 12px;
         border-radius:12px; cursor:pointer; font-weight:700;
         transition:transform .12s ease, box-shadow .12s ease, background .12s ease; }
  .chip:hover{ transform:translateY(-1px); }
  .chip.active{ border-color:#bdd0ff; background:var(--soft-active); box-shadow:0 0 0 2px #bdd0ff; }
  .p-actions{ display:flex; gap:10px; }
  .qty-ctrl{ display:flex; align-items:center; gap:8px; }
  .qty-ctrl input{ width:80px; text-align:center; }
  @media (max-width:900px){ .product-body{ grid-template-columns: 1fr; } }
  `;
  document.head.appendChild(css);
}
function ensureProductModal(){
  if (document.getElementById("productModal")) return;
  const html = `
    <div class="modal-card wide product-card">
      <div class="modal-head">
        <div class="p-title"></div>
        <button class="icon-btn" aria-label="Закрыть" id="pClose">✖</button>
      </div>
      <div class="modal-body product-body">
        <div class="p-left">
          <div class="p-img"></div>
        </div>
        <div class="p-right">
          <div class="p-meta"><div class="p-price"></div></div>
          <div class="p-opts">
            <div class="opt-row" id="rowSizes" hidden>
              <div class="opt-label">Размер</div>
              <div class="chip-group" id="pSizes"></div>
            </div>
            <div class="opt-row" id="rowColors" hidden>
              <div class="opt-label">Цвет</div>
              <div class="chip-group" id="pColors"></div>
            </div>
            <div class="opt-row">
              <div class="opt-label">Кол-во</div>
              <div class="qty-ctrl">
                <button class="qty-dec" type="button" aria-label="Меньше">−</button>
                <input id="pQty" type="number" min="1" value="1">
                <button class="qty-inc" type="button" aria-label="Больше">+</button>
              </div>
            </div>
          </div>
          <div class="p-actions">
            <button class="btn primary" id="pAdd">Добавить в корзину</button>
          </div>
        </div>
      </div>
    </div>`;
  const dlg = document.createElement("dialog");
  dlg.id = "productModal";
  dlg.className = "modal";
  dlg.innerHTML = html;
  document.body.appendChild(dlg);
  dlg.querySelector("#pClose").onclick = ()=> dlg.close();
}
function openProduct(id){
  ensureProductModalStyles();
  ensureProductModal();

  const p = allProducts().find(x=>x.id===id);
  if (!p) return;

  const dlg = $("#productModal");
  dlg.dataset.id = id;

  dlg.querySelector(".p-title").textContent = p.title;
  dlg.querySelector(".p-img").innerHTML = productImageHTML(p);
  dlg.querySelector(".p-price").textContent = fmt(p.price);

  // размеры
  const sizes = p.sizes || [];
  const sizeWrap = dlg.querySelector("#pSizes");
  const rowSizes = dlg.querySelector("#rowSizes");
  sizeWrap.innerHTML = sizes.map(s=>`<button class="chip" data-val="${esc(s)}">${esc(s)}</button>`).join("");
  rowSizes.hidden = sizes.length === 0;

  // цвета
  const colors = p.colors || [];
  const colorWrap = dlg.querySelector("#pColors");
  const rowColors = dlg.querySelector("#rowColors");
  colorWrap.innerHTML = colors.map(c=>`<button class="chip" data-val="${esc(c)}">${esc(c)}</button>`).join("");
  rowColors.hidden = colors.length === 0;

  // выбрать первые
  sizeWrap.querySelector(".chip")?.classList.add("active");
  colorWrap.querySelector(".chip")?.classList.add("active");

  // одиночный выбор
  const solo = (wrap)=> wrap.querySelectorAll(".chip").forEach(ch=>{
    ch.onclick = ()=>{ wrap.querySelectorAll(".chip").forEach(x=>x.classList.remove("active")); ch.classList.add("active"); };
  });
  solo(sizeWrap); solo(colorWrap);

  // количество
  const qtyInp = dlg.querySelector("#pQty");
  qtyInp.value = 1;
  dlg.querySelector(".qty-inc").onclick = ()=> qtyInp.value = Math.max(1, (parseInt(qtyInp.value)||1)+1);
  dlg.querySelector(".qty-dec").onclick = ()=> qtyInp.value = Math.max(1, (parseInt(qtyInp.value)||1)-1);

  // действие
  dlg.querySelector("#pAdd").onclick = ()=>{
    const size  = sizeWrap.querySelector(".chip.active")?.dataset.val || "";
    const color = colorWrap.querySelector(".chip.active")?.dataset.val || "";
    const qty   = Math.max(1, parseInt(qtyInp.value||"1",10));
    addToCart({id:p.id, size, color, qty});
    dlg.close();
  };

  dlg.showModal();
}

/* ===== Сессия / аккаунт ===== */
function currentUser(){ const s = store.getSession(); return s ? store.getUsers().find(u=>u.nick===s.nick) : null; }
function isAdmin(){ const u = currentUser(); return !!u?.isAdmin; }
function setWelcome(){
  const u = currentUser();
  $("#welcome").textContent = u ? u.nick : "Гость";
  const lb = $("#loginBtn"); if (lb) lb.textContent = u ? "Аккаунт" : "Войти";
  const mo = $("#myOrdersBtn"); if (mo) mo.hidden = !u;
}
function logout(){
  store.setSession(null);
  setWelcome();
  moveGuestCartToUser(false);
  updateCartBadge();
  applyTheme(getThemeForNick(null)); // тема гостя
  route();
}

/* ===== Корзина ===== */
function addToCart({id,size,color,qty}){
  const u = currentUser();
  const cart = store.getCart(u?.nick);
  const f = cart.find(i=>i.id===id && i.size===size && i.color===color);
  if (f) f.qty += qty; else cart.push({id,size,color,qty});
  store.setCart(u?.nick, cart);
  updateCartBadge();
  openCart();
}
function updateCartBadge(){
  const u = currentUser(); const cart = store.getCart(u?.nick);
  const c = cart.reduce((s,i)=>s+i.qty,0); $("#cartCount").textContent = c;
}
function renderCart(){
  const u = currentUser();
  const cart = store.getCart(u?.nick);
  const list = $("#cartList"); list.innerHTML = "";
  $("#cartEmpty").style.display = cart.length ? "none" : "block";
  let sum = 0;
  cart.forEach((it, idx)=>{
    const p = allProducts().find(x=>x.id===it.id) || {title:"Товар удалён", price:0};
    const row = document.createElement("li"); row.className = "cart-item";
    const line = p.price * it.qty; sum += line;
    row.innerHTML = `
      <div class="ph"></div>
      <div><div class="title">${p.title}</div><div class="muted">${esc(it.size)} · ${esc(it.color)}</div></div>
      <div>${fmt(p.price)}</div>
      <div class="qty"><input type="number" min="1" value="${it.qty}" /></div>
      <button class="remove" title="Удалить">✖</button>`;
    row.querySelector("input").onchange = (e)=>{ it.qty = Math.max(1, parseInt(e.target.value||"1",10)); store.setCart(u?.nick, cart); renderCart(); updateCartBadge(); };
    row.querySelector(".remove").onclick = ()=>{ cart.splice(idx,1); store.setCart(u?.nick, cart); renderCart(); updateCartBadge(); };
    list.appendChild(row);
  });
  $("#sumItems").textContent = fmt(sum);
  $("#sumShip").textContent = fmt(0);
  $("#sumTotal").textContent = fmt(sum);
}
function openCart(){ renderCart(); $("#cartModal").showModal(); }
function openCheckout(){ const u = currentUser(); $("#checkoutAuthWarn").hidden = !!u; $("#checkoutModal").showModal(); }

/* ===== Оформление + «оплата» (демо) ===== */
const paymentWatch = {};
function placeOrder(){
  const u = currentUser();
  if (!u){ $("#checkoutAuthWarn").hidden = false; return; }
  const cart = store.getCart(u.nick);
  if (!cart.length){ toast("Корзина пуста","warn"); return; }

  const fio = $("#fio").value.trim();
  const contact = $("#contact").value.trim();
  const address = $("#address").value.trim();
  const payment = $("#payment").value;
  if (!fio || !contact){ toast("Заполните ФИО и контакт","warn"); return; }

  let total = 0;
  const items = cart.map(it=>{
    const p = allProducts().find(x=>x.id===it.id) || {title:"Товар", price:0};
    const sum = p.price * it.qty; total += sum;
    return { id: it.id, title: p.title, price: p.price, size: it.size, color: it.color, qty: it.qty, sum };
  });

  const order = { id: uid(), user: u.nick, createdAt: Date.now(), items, total, payment, contact:{fio,contact,address}, status: "pending" };
  const orders = store.getOrders(); orders.unshift(order); store.setOrders(orders);
  store.setCart(u.nick, []); updateCartBadge();

  $("#checkoutModal").close(); $("#cartModal").close();
  openPayment(order);
  toast("Заказ создан. Перейдите к оплате.","success");
}
function openPayment(order){
  $("#payOrderId").textContent = order.id;
  $("#payAmount").textContent = fmt(order.total);
  $("#payCard").textContent = BANK.card;
  const dlg = $("#payModal"); dlg.dataset.orderId = order.id; dlg.showModal();
  $("#copyCard").onclick = (e)=>{ e.preventDefault(); navigator.clipboard.writeText(BANK.card); toast("Номер карты скопирован","success"); };
  $("#markPaid").onclick = (e)=>{ e.preventDefault(); startPaymentCheck(order.id, order.total); };
}
function startPaymentCheck(orderId, amount){
  toast("Проверяем поступление перевода… Подождите пожалуйста!","info");
  if (paymentWatch[orderId]) clearInterval(paymentWatch[orderId]);
  let tries = 0;
  paymentWatch[orderId] = setInterval(()=>{
    tries++;
    const orders = store.getOrders();
    const o = orders.find(x=>x.id===orderId);
    if (!o){ clearInterval(paymentWatch[orderId]); delete paymentWatch[orderId]; const dlg=$("#payModal"); if(dlg.open) dlg.close(); toast("Заказ закрыт администратором.","warn"); return; }
    if (o.status === "canceled"){ clearInterval(paymentWatch[orderId]); delete paymentWatch[orderId]; const dlg=$("#payModal"); if(dlg.open) dlg.close(); toast("Заказ отменён администратором.","error"); return; }
    if (o.status === "paid"){ clearInterval(paymentWatch[orderId]); delete paymentWatch[orderId]; const dlg=$("#payModal"); if(dlg.open) dlg.close(); toast("Платёж уже подтверждён. Заказ принят.","success"); return; }
    const hit = store.bankLog().find(t => t.orderId === orderId && t.amount === amount);
    if (hit){ clearInterval(paymentWatch[orderId]); delete paymentWatch[orderId]; updateOrderStatus(orderId, "paid"); const dlg=$("#payModal"); if(dlg.open) dlg.close(); toast("Платёж подтверждён! Заказ принят. Ожидайте несколько дней.","success"); route(); return; }
    if (tries >= 15){ clearInterval(paymentWatch[orderId]); delete paymentWatch[orderId]; toast("Платёж пока не найден. Проверьте позже или свяжитесь с админом.","warn"); }
  }, 2000);
}
function updateOrderStatus(orderId, status){
  const orders = store.getOrders();
  const o = orders.find(x=>x.id===orderId);
  if (o){ o.status = status; store.setOrders(orders); }
}

/* ===== «Мои заказы» ===== */
function orderStatusBadge(st){
  const map = { pending:"badge-pending", paid:"badge-paid", done:"badge-done", canceled:"badge-canceled" };
  const label = { pending:"Ожидает оплаты", paid:"Оплачен", done:"Выполнен", canceled:"Отменён" }[st] || st;
  return `<span class="badge-status ${map[st]||''}">${label}</span>`;
}
function deleteOwnOrder(id){
  const u = currentUser(); if (!u) return;
  const orders = store.getOrders();
  const idx = orders.findIndex(o=>o.id===id);
  if (idx < 0) return;
  const o = orders[idx];
  if (o.user !== u.nick){ toast("Можно удалять только свои заказы","error"); return; }
  if (!["canceled","done"].includes(o.status)){
    toast("Удалять можно только отменённые или выполненные заказы","warn"); return;
  }
  orders.splice(idx, 1);
  store.setOrders(orders);
  toast("Заказ удалён из истории","success");
  renderMyOrders();
}
function renderMyOrders(){
  const u = currentUser(); const wrap = $("#myOrdersBody");
  const list = store.getOrders().filter(o=>o.user===u?.nick).sort((a,b)=>b.createdAt-a.createdAt);
  if (!u || !list.length){ wrap.innerHTML = `<div class="help">Заказов пока нет.</div>`; return; }

  wrap.innerHTML = list.map(o=>{
    const dt = new Date(o.createdAt).toLocaleString("ru-RU");
    const items = o.items.map(i=>`${esc(i.title)} (${esc(i.size)}/${esc(i.color)}) × ${i.qty} — ${fmt(i.sum)}`).join("<br>");
    const canRemove = (o.status === "canceled" || o.status === "done");
    const removeBtn = canRemove ? `<button class="ord-x" title="Удалить из истории" data-id="${o.id}">✖</button>` : "";
    const payBtn = (o.status==="pending") ? `<button class="btn primary btn-pay" data-id="${o.id}">Оплатить</button>` : "";
    return `<div class="card" style="padding:12px">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div><b>${o.id}</b><br><span class="small">${dt}</span></div>
        <div class="row" style="gap:8px;align-items:center">
          ${orderStatusBadge(o.status)} ${removeBtn}
        </div>
      </div>
      <div class="items" style="margin-top:8px">${items}</div>
      <div class="row" style="justify-content:flex-end;margin-top:8px">
        <div style="font-weight:800;margin-right:auto">Итого: ${fmt(o.total)}</div>
        ${payBtn}
      </div>
    </div>`;
  }).join("");

  $$("#myOrdersBody .btn-pay").forEach(b=>{
    b.onclick = ()=>{
      const id = b.dataset.id;
      const o = store.getOrders().find(x=>x.id===id);
      if (o) { $("#myOrdersModal").close(); openPayment(o); }
    };
  });
  $$("#myOrdersBody .ord-x").forEach(b=>{
    b.onclick = ()=> deleteOwnOrder(b.dataset.id);
  });
}
function openMyOrders(){
  const u = currentUser();
  if (!u){ $("#authModal").showModal(); setAuthTab("login"); return; }
  renderMyOrders();
  $("#myOrdersModal").showModal();
}

/* ===== Админка ===== */
function renderAdmin(){
  $$(".adm-tab").forEach(btn=>{
    btn.onclick = ()=>{
      const tab = btn.dataset.tab;
      $$(".adm-tab").forEach(b=>b.classList.toggle("active", b===btn));
      $$(".admin-pane").forEach(p=>p.classList.toggle("active", p.dataset.pane===tab));
      if (tab==="orders")  renderAdminOrders();
      if (tab==="catalog") renderAdminProducts();
      if (tab==="cats")    renderAdminCats();
    };
  });
  const rdb = $("#resetDemoBtn"); if (rdb) rdb.onclick = resetDemo;
  renderAdminOrders();
}
function badgeClass(st){ return st==="pending"?"badge-pending" : st==="paid"?"badge-paid" : st==="done"?"badge-done" : "badge-canceled"; }
function statusLabel(st){ return st==="pending"?"Ожидает оплаты" : st==="paid"?"Оплачен" : st==="done"?"Выполнен" : "Отменён"; }

function renderAdminOrders(){
  const tbody = $("#ordersTbody"); if (!tbody) return;
  const orders = store.getOrders();
  const f = $("#statusFilter").value;
  const list = (f==="all") ? orders : orders.filter(o=>o.status===f);
  tbody.innerHTML = list.map(o=>{
    const items = o.items.map(i=>`${i.title} (${esc(i.size)}/${esc(i.color)}) × ${i.qty} — ${fmt(i.sum)}`).join("<br>");
    const dt = new Date(o.createdAt).toLocaleString("ru-RU");
    return `<tr data-id="${o.id}">
      <td><b>${o.id}</b></td>
      <td>${dt}</td>
      <td>${o.user}<br><span class="items">ФИО: ${esc(o.contact.fio)}; ${esc(o.contact.contact)}; ${esc(o.contact.address||"")}</span></td>
      <td class="items">${items}</td>
      <td>${o.payment==="cash"?"Наличные":"Перевод"}</td>
      <td>${fmt(o.total)}</td>
      <td>
        <span class="badge-status ${badgeClass(o.status)}">${statusLabel(o.status)}</span><br>
        <select class="statusSel">
          <option value="pending"${o.status==="pending"?" selected":""}>Ожидает оплаты</option>
          <option value="paid"${o.status==="paid"?" selected":""}>Оплачен</option>
          <option value="done"${o.status==="done"?" selected":""}>Выполнен</option>
          <option value="canceled"${o.status==="canceled"?" selected":""}>Отменён</option>
        </select>
      </td>
      <td>
        <button class="btn saveStatus">Сохранить</button>
        <button class="btn btn-ghost simulatePay">Имит. платёж</button>
      </td>
    </tr>`;
  }).join("");

  $("#statusFilter").onchange = renderAdminOrders;

  $$("#ordersTbody .saveStatus").forEach(btn=>{
    btn.onclick = ()=>{
      const tr = btn.closest("tr");
      const id = tr.dataset.id;
      const sel = tr.querySelector(".statusSel").value;
      const orders = store.getOrders();
      const idx = orders.findIndex(x=>x.id===id);
      if (idx>-1){
        if (sel === "done"){ orders.splice(idx,1); } else { orders[idx].status = sel; }
        store.setOrders(orders);
        renderAdminOrders();
        const label = {pending:"Ожидает оплаты", paid:"Оплачен", done:"Выполнен", canceled:"Отменён"}[sel];
        toast(sel==="done" ? "Заказ помечён как выполнен и удалён" : `Статус обновлён: ${label}`, sel==="canceled" ? "warn" : "success");
      }
    };
  });
  $$("#ordersTbody .simulatePay").forEach(btn=>{
    btn.onclick = ()=>{
      const tr = btn.closest("tr");
      const id = tr.dataset.id;
      const o = store.getOrders().find(x=>x.id===id);
      if (o){ store.bankPush({ orderId:o.id, amount:o.total, at: Date.now() }); toast("Имитация: платёж зачислен","success"); }
    };
  });
}

/* ===== Админка: КАТАЛОГ ===== */
function renderCatSelect(){
  const sel = $("#prodCatSel"); if (!sel) return;
  const cats = store.getCats();
  sel.innerHTML = cats.length
    ? cats.map(c=>`<option value="${c}">${c}</option>`).join("")
    : `<option value="" disabled selected>Сначала добавьте категорию</option>`;
}
function renderAdminProducts(){
  const P = allProducts();
  const tbody = $("#prodTable tbody"); if (!tbody) return;
  tbody.innerHTML = P.map(p=>`
    <tr data-id="${p.id}">
      <td>${p.id}</td>
      <td>${esc(p.title)}</td>
      <td>${esc(p.cat)}</td>
      <td>${fmt(p.price)}</td>
      <td class="items">${(p.sizes||[]).join(", ")}</td>
      <td class="items">${(p.colors||[]).join(", ")}</td>
      <td>
        <button class="btn btn-ghost prodEdit">Редакт.</button>
        <button class="btn prodDel">Удалить</button>
      </td>
    </tr>
  `).join("");

  $$("#prodTable .prodEdit").forEach(b=> b.onclick = ()=> loadProductToForm(b.closest("tr").dataset.id));
  $$("#prodTable .prodDel").forEach(b=> b.onclick = ()=> deleteProduct(b.closest("tr").dataset.id));

  const form = $("#prodForm");
  if (form){
    form.onsubmit = async (e)=>{ e.preventDefault(); await saveProductFromForm(); };
    $("#prodReset").onclick = ()=> resetProdForm();
  }

  renderCatSelect();

  const ex = $("#exportCatalogBtn");
  if (ex) ex.onclick = exportCatalog;
}
function loadProductToForm(id){
  const p = allProducts().find(x=>x.id===id); if (!p) return;
  $("#prodId").value = p.id;
  $("#prodTitle").value = p.title;
  $("#prodPrice").value = p.price;

  let cats = store.getCats();
  if (p.cat && !cats.includes(p.cat)) { cats = [...cats, p.cat]; store.setCats(cats); }
  renderCatSelect();
  if (p.cat) $("#prodCatSel").value = p.cat;

  $("#prodSizes").value  = (p.sizes||[]).join(", ");
  $("#prodColors").value = (p.colors||[]).join(", ");
  $("#prodSvg").value = p.svg || "";
  $("#prodImg").value = "";
  window.scrollTo({top:0, behavior:"smooth"});
}
function resetProdForm(){
  $("#prodId").value = "";
  $("#prodTitle").value = "";
  $("#prodPrice").value = "";
  $("#prodSizes").value = "";
  $("#prodColors").value = "";
  $("#prodSvg").value = "";
  $("#prodImg").value = "";
  renderCatSelect();
}
function splitCSV(s){ return (s||"").split(",").map(x=>x.trim()).filter(Boolean); }
function fileToDataUrl(file){
  return new Promise((res,rej)=>{ const r = new FileReader(); r.onload = ()=> res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
async function saveProductFromForm(){
  const id = $("#prodId").value.trim() || ("u"+uid());
  const title = $("#prodTitle").value.trim();
  const price = parseInt($("#prodPrice").value,10) || 0;
  const cat = $("#prodCatSel")?.value || "";
  if (!cat){ toast("Сначала добавьте категорию","warn"); return; }

  const sizes = splitCSV($("#prodSizes").value);
  const colors = splitCSV($("#prodColors").value);
  let svg = $("#prodSvg").value.trim();
  if (svg) svg = normalizeSvgMarkup(svg);
  let img = "";
  const file = $("#prodImg").files[0];
  if (!svg && file){ img = await fileToDataUrl(file); }

  if (!title){ toast("Введите название","warn"); return; }
  const P = allProducts();
  const idx = P.findIndex(x=>x.id===id);
  const payload = { id, title, price, cat, sizes, colors };
  if (svg) payload.svg = svg; else delete payload.svg;
  if (img) payload.img = img;

  if (idx>-1){
    payload.svg = payload.svg ?? P[idx].svg;
    payload.img = img || P[idx].img || "";
    P[idx] = payload;
  } else {
    if (!payload.svg && !img){ toast("Добавьте SVG или файл изображения","warn"); return; }
    if (!payload.img) payload.img = img;
    P.push(payload);
  }

  store.setCatalog(P);
  renderAdminProducts(); renderCats(); renderGrid();
  resetProdForm();
  toast("Товар сохранён","success");
}
function deleteProduct(id){
  if (!confirm("Удалить товар?")) return;
  const P = allProducts().filter(x=>x.id!==id);
  store.setCatalog(P);
  renderAdminProducts(); renderCats(); renderGrid();
  toast("Товар удалён","warn");
}

/* ===== Категории (админ) ===== */
function renderAdminCats(){
  const list = $("#catList"); if (!list) return;
  const cats = store.getCats();
  list.innerHTML = cats.map(c=>`
    <li>
      <div class="row" style="justify-content:space-between;align-items:center">
        <button class="cat-btn" type="button" disabled>${c}</button>
        <button class="btn btn-ghost catDel" data-name="${c}">Удалить</button>
      </div>
    </li>`).join("");

  $$("#catList .catDel").forEach(btn=>{
    btn.onclick = ()=>{
      const name = btn.dataset.name;
      let cats = store.getCats().filter(x=>x!==name);
      if (!cats.length) return toast("Нельзя удалить последнюю категорию","warn");
      if (!confirm(`Удалить категорию «${name}»? Товары будут перенесены в «${cats[0]}».`)) return;

      const P = store.getCatalog().map(p => p.cat===name ? {...p, cat: cats[0]} : p);
      store.setCatalog(P); store.setCats(cats);

      renderAdminCats(); renderCatSelect(); renderAdminProducts();
      renderCats(); renderGrid();
      if (state.cat===name) { state.cat="Все"; renderCats(); }
      toast("Категория удалена, товары перенесены","success");
    };
  });

  const form = $("#catForm");
  if (form){
    form.onsubmit = (e)=>{
      e.preventDefault();
      const inp = $("#newCatName");
      const name = inp.value.trim();
      if (!name) return;
      const cats = store.getCats();
      if (cats.includes(name)) { toast("Такая категория уже есть","warn"); return; }
      cats.push(name); store.setCats(cats);
      inp.value = "";
      renderAdminCats(); renderCatSelect(); renderCats();
      toast("Категория добавлена","success");
    };
  }
}

/* ===== Экспорт / Импорт каталога ===== */
function exportCatalog(){
  const data = { cats: store.getCats(), products: store.getCatalog() };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  a.href = url; a.download = `catalog-export-${ts}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 1000);
  toast("Экспорт выполнен","success");
}
function importCatalogFile(file){
  const r = new FileReader();
  r.onload = () => {
    try{
      const data = JSON.parse(r.result);
      if (data && Array.isArray(data.products)){
        const P = data.products.map(p => p.svg ? {...p, svg: normalizeSvgMarkup(p.svg)} : p);
        store.setCatalog(P);
      }
      if (data && Array.isArray(data.cats)) store.setCats(data.cats);
      toast("Импорт выполнен","success");
      renderAdminProducts(); renderCats(); renderGrid();
    }catch(e){
      toast("Неверный файл импорта","error");
    }
  };
  r.readAsText(file);
}

/* ===== Сброс демо ===== */
function resetDemo(){
  if (!confirm("Сбросить демо-данные (товары, категории, заказы)?")) return;
  Object.keys(localStorage).forEach(k => { if (k.startsWith(LS.cartPrefix)) localStorage.removeItem(k); });
  localStorage.removeItem(LS.orders);
  localStorage.removeItem(LS.bank);
  localStorage.removeItem(LS.session);
  localStorage.removeItem(LS.catalog);
  localStorage.removeItem(LS.cats);
  store.setUsers([{ nick: DEFAULT_ADMIN.nick, pass: DEFAULT_ADMIN.pass, isAdmin:true, createdAt: Date.now() }]);
  healAndInit();
  renderCats(); renderGrid();
  if (!$("#admin").hidden){
    const active = document.querySelector(".adm-tab.active")?.dataset.tab || "orders";
    if (active==="orders") renderAdminOrders();
    if (active==="catalog") renderAdminProducts();
    if (active==="cats") renderAdminCats();
  }
  toast("Демо сброшено. Данные восстановлены.","success");
}

/* ===== Навигация / биндинги ===== */
function route(){
  const isAdm = location.hash === "#admin";
  const showAdmin = isAdm && isAdmin();

  const payDlg = $("#payModal");
  if (payDlg?.open) payDlg.close();

  $("#admin").hidden = !showAdmin;
  document.querySelector(".layout").style.display = showAdmin ? "none" : "grid";
  document.querySelector(".site-footer").style.display = showAdmin ? "none" : "flex";
  if (showAdmin){ renderAdmin(); }
}
function bindUI(){
  const logo = $("#logoHome");
  if (logo) logo.onclick = (e)=>{ e.preventDefault(); location.hash=""; route(); window.scrollTo({top:0,behavior:"smooth"}); };

  $("#searchBtn")?.addEventListener("click", ()=>{ state.q=$("#q").value; renderGrid(); });
  $("#q")?.addEventListener("keydown", e=>{ if(e.key==="Enter"){ state.q=$("#q").value; renderGrid(); } });
  $("#sortSelect")?.addEventListener("change", (e)=>{ state.sort = e.target.value; renderGrid(); });
  $("#clearFilters")?.addEventListener("click", ()=>{ state.q=""; $("#q").value=""; state.cat="Все"; renderCats(); renderGrid(); });

  $("#loginBtn")?.addEventListener("click", ()=>{
    const u = currentUser();
    if (u){
      if (confirm(`Выйти из аккаунта ${u.nick}?`)) logout();
    } else { $("#authModal").showModal(); setAuthTab("login"); }
  });

  $("#myOrdersBtn")?.addEventListener("click", openMyOrders);
  $("#themeToggle")?.addEventListener("click", toggleTheme);

  $("#adminBtn")?.addEventListener("click", ()=>{ location.hash = "#admin"; route(); });
  $("#goShop")?.addEventListener("click",   ()=>{ location.hash = ""; route(); });
  $("#resetDemoBtn")?.addEventListener("click", resetDemo);

  $("#cartOpenBtn")?.addEventListener("click", openCart);
  $("#checkoutBtn")?.addEventListener("click", openCheckout);

  // Табы в модалке auth
  $$(".tab").forEach(t=> t.onclick = (e)=>{ e.preventDefault(); setAuthTab(t.dataset.tab); });

  // Вход
  $("#doLogin")?.addEventListener("click", (e)=>{
    e.preventDefault();
    const res = login($("#loginNick").value.trim(), $("#loginPass").value);
    if(!res.ok){ showModalBanner("#authModal", res.msg, "error", 6000); return; }
    $("#authModal").close();
  });

  // Регистрация
  $("#doRegister")?.addEventListener("click", (e)=>{
    e.preventDefault();
    const res = register($("#regNick").value.trim(), $("#regPass").value, $("#regPass2").value);
    if(!res.ok){ showModalBanner("#authModal", res.msg, "error", 6000); return; }
    $("#authModal").close();
  });

  $("#placeOrder")?.addEventListener("click", (e)=>{ e.preventDefault(); placeOrder(); });
  $("#logoutBtn")?.addEventListener("click", ()=> logout());

  window.addEventListener("hashchange", route);

  // закрытие dialog крестиком (вспомогательные икон-кнопки внутри .modal)
  document.querySelectorAll('.modal .icon-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const dlg = e.currentTarget.closest('dialog');
      if (dlg && typeof dlg.close === 'function') dlg.close();
    });
  });

  // Экспорт/импорт (если есть кнопки)
  const ex = $("#exportCatalogBtn");
  if (ex) ex.onclick = exportCatalog;
  const impBtn  = $("#importCatalogBtn");
  const impFile = $("#importCatalogFile");
  if (impBtn && impFile){
    impBtn.onclick = () => impFile.click();
    impFile.onchange = (e)=>{
      const f = e.target.files?.[0];
      if (f) importCatalogFile(f);
      e.target.value = "";
    };
  }
}

/* ===== Аккаунт (auth) ===== */
function setAuthTab(tab){ $$(".tab").forEach(t=>t.classList.toggle("active", t.dataset.tab===tab)); $$(".tab-pane").forEach(p=>p.classList.toggle("active", p.dataset.pane===tab)); }
function login(nick, pass){
  const u = store.getUsers().find(x=>x.nick.toLowerCase()===nick.toLowerCase());
  if(!u) return {ok:false,msg:"Ник не найден"};
  if(u.pass!==pass) return {ok:false,msg:"Неверный пароль"};
  store.setSession({nick:u.nick});
  applyTheme(getThemeForNick(u.nick));
  setWelcome(); moveGuestCartToUser(true); updateCartBadge();
  return {ok:true};
}
function register(nick,pass,pass2){
  nick=nick.trim(); if(nick.length<2) return {ok:false,msg:"Ник слишком короткий"};
  if(pass.length<4) return {ok:false,msg:"Пароль минимум 4 символа"};
  if(pass!==pass2) return {ok:false,msg:"Пароли не совпадают"};
  const users = store.getUsers();
  if (users.some(u=>u.nick.toLowerCase()===nick.toLowerCase())) return {ok:false,msg:"Ник уже занят"};
  users.push({nick, pass, isAdmin:false, createdAt:Date.now()}); store.setUsers(users); store.setSession({nick});
  applyTheme(getThemeForNick(nick)); setWelcome(); moveGuestCartToUser(true); updateCartBadge();
  return {ok:true};
}
function moveGuestCartToUser(merge){
  const guest = store.getCart(null); const u = currentUser(); if(!u) return;
  const userCart = store.getCart(u.nick); const cart = merge ? mergeCarts(userCart, guest) : userCart;
  store.setCart(u.nick, cart); store.setCart(null, []);
}
function mergeCarts(a,b){ const res=[...a]; b.forEach(it=>{ const f=res.find(x=>x.id===it.id && x.size===it.size && x.color===it.color); if(f) f.qty+=it.qty; else res.push({...it}); }); return res; }

/* ===== Кросс-вкладочная синхронизация ===== */
function handleExternalOrderChange(){
  if (!$("#admin").hidden) {
    const active = document.querySelector(".adm-tab.active")?.dataset.tab || "orders";
    if (active === "orders")  renderAdminOrders();
    if (active === "catalog") renderAdminProducts();
    if (active === "cats")    renderAdminCats();
  }
  const dlg = $("#payModal");
  const currentId = dlg?.dataset?.orderId;
  if (!currentId) return;
  const orders = store.getOrders();
  const o = orders.find(x=>x.id===currentId);
  if (!o){ if (dlg.open) dlg.close(); toast("Заказ закрыт администратором.","warn"); return; }
  if (o.status === "canceled"){ if (dlg.open) dlg.close(); toast("Заказ отменён администратором.","error"); return; }
  if (o.status === "paid"){ if (dlg.open) dlg.close(); toast("Платёж подтверждён! Заказ принят.","success"); return; }
}
window.addEventListener("storage", (e)=>{
  if (e.key === LS.orders || e.key === LS.bank) handleExternalOrderChange();
  if (e.key === LS.catalog){ renderCats(); renderGrid(); if (!$("#admin").hidden && document.querySelector(".adm-tab.active")?.dataset.tab === "catalog") renderAdminProducts(); }
  if (e.key === LS.cats){ renderCats(); renderCatSelect(); if (!$("#admin").hidden && document.querySelector(".adm-tab.active")?.dataset.tab === "cats") renderAdminCats(); }
});

/* ===== Обёртка таблиц для мобильных (если есть) ===== */
function wrapAdminTables(){
  const wrap = (el)=>{
    if (!el || el.parentElement?.classList.contains("table-wrap")) return;
    const w = document.createElement("div");
    w.className = "table-wrap";
    el.parentNode.insertBefore(w, el);
    w.appendChild(el);
  };
  wrap(document.querySelector(".orders"));
  wrap(document.getElementById("prodTable"));
}

/* ===== Старт ===== */
async function main(){
  healAndInit(); // локальные дефолты (на случай офлайна)
  applyTheme(getThemeForNick(currentUser()?.nick || null));
  setWelcome();

  // Подтянуть Firestore и заменить локальные данные
  await loadRemoteData();

  renderCats();
  renderGrid();

  bindUI();
  updateCartBadge();
  route();
  wrapAdminTables();

  // Модалка товара — подготовка
  ensureProductModalStyles();
  ensureProductModal();
}
document.addEventListener("DOMContentLoaded", main);
