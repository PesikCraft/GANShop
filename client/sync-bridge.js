/* Sync Bridge v2 (ES5)
 * - Ловит setItem/removeItem И property assignment через фоновый вотчер
 * - Грязный таймаут блокирует входящие pull'ы на 2s после правки
 * - Зеркала: my_orders, products/goods/catalog, shop_*_<nick>
 */
(function () {
  if (!window || !window.localStorage) return;

  var KEY_PRODUCTS = 'shop_catalog';
  var KEY_CATS = 'shop_cats';
  var KEY_ORDERS = 'shop_orders';
  var KEY_BANK = 'mock_bank';

  var SYN_ORDERS_STATIC = ['my_orders'];
  var SYN_CATALOG_STATIC = ['products', 'goods', 'catalog'];

  var PULL_INTERVAL_MS = 5000;
  var PUT_DEBOUNCE_MS = 300;
  var WATCH_INTERVAL_MS = 400; // слежение за изменениями
  var DIRTY_HOLD_MS = 2000;    // блок входящих pull'ов после локального апдейта

  function parseArr(s){ if(!s) return []; try{ var v=JSON.parse(s); return Array.isArray(v)?v:[]; }catch(e){ return []; } }
  function j(v){ try{ return JSON.stringify(v); }catch(e){ return '[]'; } }
  function same(a,b){ return j(a)===j(b); }

  function req(method, url, body){
    if (window.fetch){
      var o={method:method,headers:{'Content-Type':'application/json'}};
      if (body) o.body=JSON.stringify(body);
      return fetch(url,o).then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); });
    }
    return new Promise(function(resolve,reject){
      var x=new XMLHttpRequest(); x.open(method,url,true);
      x.setRequestHeader('Content-Type','application/json');
      x.onreadystatechange=function(){ if(x.readyState===4){ if(x.status>=200&&x.status<300){ try{ resolve(JSON.parse(x.responseText||'{}')); }catch(e){ resolve({}); } } else reject(new Error('HTTP '+x.status)); } };
      x.onerror=function(){ reject(new Error('Network')); };
      x.send(body?JSON.stringify(body):null);
    });
  }

  function keysByPrefix(prefix){
    var r=[]; try{ for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k&&k.indexOf(prefix)===0) r.push(k); } }catch(e){}
    return r;
  }
  function isOrdersSyn(k){ if(!k) return false; if(SYN_ORDERS_STATIC.indexOf(k)!==-1) return true; return k.indexOf('shop_orders_')===0; }
  function isCatalogSyn(k){ if(!k) return false; if(SYN_CATALOG_STATIC.indexOf(k)!==-1) return true; return k.indexOf('shop_catalog_')===0; }

  var silent={};
  function setSilent(k,v){ silent[k]=v?1:0; }
  function isSilent(k){ return !!silent[k]; }

  var _set = localStorage.setItem.bind(localStorage);
  var _rem = localStorage.removeItem.bind(localStorage);
  function setLS(k,v){ setSilent(k,true); try{ _set(k,v); }catch(e){} setSilent(k,false); }
  function remLS(k){ setSilent(k,true); try{ _rem(k); }catch(e){} setSilent(k,false); }

  var timers = { catalog:null, orders:null, bank:null };
  var dirtyUntil = { catalog:0, orders:0, bank:0 };

  function markDirty(group){
    dirtyUntil[group] = Date.now() + DIRTY_HOLD_MS;
  }

  function schedulePush(group){
    if (timers[group]){ clearTimeout(timers[group]); timers[group]=null; }
    markDirty(group);
    timers[group] = setTimeout(function(){
      if (group==='catalog'){
        var products=parseArr(localStorage.getItem(KEY_PRODUCTS));
        var cats=parseArr(localStorage.getItem(KEY_CATS));
        req('PUT','/api/catalog',{products:products,cats:cats})['catch'](function(){});
      } else if (group==='orders'){
        var orders=parseArr(localStorage.getItem(KEY_ORDERS));
        req('PUT','/api/orders',{orders:orders})['catch'](function(){});
      } else if (group==='bank'){
        var log=parseArr(localStorage.getItem(KEY_BANK));
        req('PUT','/api/bank',{log:log})['catch'](function(){});
      }
    }, PUT_DEBOUNCE_MS);
  }

  function mirrorFromPrimary(){
    // orders
    var ordStr = localStorage.getItem(KEY_ORDERS) || '[]';
    setLS('my_orders', ordStr);
    var ordPref = keysByPrefix('shop_orders_'); for (var i=0;i<ordPref.length;i++) setLS(ordPref[i], ordStr);
    // catalog
    var prodStr = localStorage.getItem(KEY_PRODUCTS) || '[]';
    setLS('products', prodStr); setLS('goods', prodStr); setLS('catalog', prodStr);
    var catPref = keysByPrefix('shop_catalog_'); for (var j=0;j<catPref.length;j++) setLS(catPref[j], prodStr);
  }
  function copyToPrimaryIfSynonym(key){
    var v = localStorage.getItem(key);
    if (isOrdersSyn(key)) setLS(KEY_ORDERS, v||'[]');
    if (isCatalogSyn(key)) setLS(KEY_PRODUCTS, v||'[]');
  }

  // Перехват стандартных методов
  localStorage.setItem = function(key, value){
    var r; try{ r=_set(key,value); }catch(e){}
    if (!isSilent(key)){
      if (isOrdersSyn(key) || isCatalogSyn(key)) copyToPrimaryIfSynonym(key);
      if (key===KEY_PRODUCTS || key===KEY_CATS || isCatalogSyn(key)) schedulePush('catalog');
      else if (key===KEY_ORDERS || isOrdersSyn(key)) schedulePush('orders');
      else if (key===KEY_BANK) schedulePush('bank');
    }
    return r;
  };
  localStorage.removeItem = function(key){
    var r; try{ r=_rem(key); }catch(e){}
    if (!isSilent(key)){
      if (key===KEY_PRODUCTS || isCatalogSyn(key)){ setLS(KEY_PRODUCTS,'[]'); schedulePush('catalog'); }
      else if (key===KEY_CATS){ setLS(KEY_CATS,'[]'); schedulePush('catalog'); }
      else if (key===KEY_ORDERS || isOrdersSyn(key)){ setLS(KEY_ORDERS,'[]'); schedulePush('orders'); }
      else if (key===KEY_BANK){ setLS(KEY_BANK,'[]'); schedulePush('bank'); }
    }
    return r;
  };

  // Вотчер изменений (ловит property assignment и прямые мутации)
  var snapshot = {};
  function snapGet(k){ return localStorage.getItem(k); }
  function saveSnap(k,v){ snapshot[k]=v; }
  function checkKeyForChange(k, group){
    var cur = snapGet(k);
    if (snapshot[k] !== cur){
      saveSnap(k, cur);
      if (group==='orders' && isOrdersSyn(k)) copyToPrimaryIfSynonym(k);
      if (group==='catalog' && isCatalogSyn(k)) copyToPrimaryIfSynonym(k);

      if (group) schedulePush(group);
    }
  }
  function initSnapshot(){
    var keys = [KEY_PRODUCTS, KEY_CATS, KEY_ORDERS, KEY_BANK]
      .concat(SYN_ORDERS_STATIC).concat(SYN_CATALOG_STATIC)
      .concat(keysByPrefix('shop_orders_'))
      .concat(keysByPrefix('shop_catalog_'));
    for (var i=0;i<keys.length;i++){ saveSnap(keys[i], snapGet(keys[i])); }
  }
  function startWatch(){
    initSnapshot();
    setInterval(function(){
      checkKeyForChange(KEY_PRODUCTS, 'catalog');
      checkKeyForChange(KEY_CATS, 'catalog');
      checkKeyForChange(KEY_ORDERS, 'orders');
      checkKeyForChange(KEY_BANK, 'bank');

      var i, list;
      list = SYN_ORDERS_STATIC.concat(keysByPrefix('shop_orders_'));
      for (i=0;i<list.length;i++) checkKeyForChange(list[i], 'orders');

      list = SYN_CATALOG_STATIC.concat(keysByPrefix('shop_catalog_'));
      for (i=0;i<list.length;i++) checkKeyForChange(list[i], 'catalog');
    }, WATCH_INTERVAL_MS);
  }

  // Initial pull
  function initialPull(){
    req('GET','/api/catalog').then(function(d){
      var cats = Array.isArray(d&&d.cats)?d.cats:[];
      var prods= Array.isArray(d&&d.products)?d.products:[];
      if (!same(parseArr(localStorage.getItem(KEY_CATS)), cats)) setLS(KEY_CATS, j(cats));
      if (!same(parseArr(localStorage.getItem(KEY_PRODUCTS)), prods)) setLS(KEY_PRODUCTS, j(prods));
      mirrorFromPrimary();
    })['catch'](function(){});
    req('GET','/api/orders').then(function(d){
      var orders = Array.isArray(d&&d.orders)?d.orders:[];
      if (!same(parseArr(localStorage.getItem(KEY_ORDERS)), orders)) setLS(KEY_ORDERS, j(orders));
      mirrorFromPrimary();
    })['catch'](function(){});
    req('GET','/api/bank').then(function(d){
      var log = Array.isArray(d&&d.log)?d.log:[];
      if (!same(parseArr(localStorage.getItem(KEY_BANK)), log)) setLS(KEY_BANK, j(log));
    })['catch'](function(){});
  }

  // Periodic pull (уважает dirty-флаг)
  function startPolling(){
    setInterval(function(){
      var now = Date.now();

      req('GET','/api/catalog').then(function(d){
        if (now < dirtyUntil.catalog) return; // недавно меняли локально — не затираем
        var cats = Array.isArray(d&&d.cats)?d.cats:[]; 
        var prods= Array.isArray(d&&d.products)?d.products:[];
        if (!same(parseArr(localStorage.getItem(KEY_CATS)), cats)) setLS(KEY_CATS, j(cats));
        if (!same(parseArr(localStorage.getItem(KEY_PRODUCTS)), prods)) setLS(KEY_PRODUCTS, j(prods));
        mirrorFromPrimary();
      })['catch'](function(){});

      req('GET','/api/orders').then(function(d){
        if (now < dirtyUntil.orders) return;
        var orders = Array.isArray(d&&d.orders)?d.orders:[];
        if (!same(parseArr(localStorage.getItem(KEY_ORDERS)), orders)) setLS(KEY_ORDERS, j(orders));
        mirrorFromPrimary();
      })['catch'](function(){});

      req('GET','/api/bank').then(function(d){
        if (now < dirtyUntil.bank) return;
        var log = Array.isArray(d&&d.log)?d.log:[];
        if (!same(parseArr(localStorage.getItem(KEY_BANK)), log)) setLS(KEY_BANK, j(log));
      })['catch'](function(){});
    }, PULL_INTERVAL_MS);
  }

  // Boot
  initialPull();
  startWatch();
  startPolling();
})();
