/* sync-bridge.js v3.1 (ES5)
 * Синхронизирует catalog / orders / bank / users.
 * - Защита каталога от «отката»: X-Shop-Ts + 409, edit-lock 60s после правки.
 * - Кросс-девайс аккаунты: ключ shop_users <-> /api/users + зеркала (users, accounts, …).
 * - Чистый ES5, без =>/let/const/for-of.
 */
(function () {
  if (!window || !window.localStorage) return;

  // ---- ключи (основные) ----
  var KEY_PRODUCTS='shop_catalog';
  var KEY_CATS='shop_cats';
  var KEY_ORDERS='shop_orders';
  var KEY_BANK='mock_bank';
  var KEY_USERS='shop_users';

  // ---- синонимы ----
  var SYN_CATALOG_STATIC=['products','goods','catalog'];
  var SYN_ORDERS_STATIC=['my_orders'];
  var SYN_USERS_STATIC=['users','accounts','auth_users','user_list','profiles'];

  // интервалы
  var PULL_INTERVAL_MS=5000, PUT_DEBOUNCE_MS=300, WATCH_INTERVAL_MS=400, DIRTY_HOLD_MS=5000;

  // лок каталога
  var EDIT_LOCK_MS=60000, LS_TS_KEY='sb_cat_last_local_change', LS_LOCK_UNTIL='sb_cat_edit_lock_until';

  // ---- утилы ----
  function now(){ return Date.now(); }
  function parseJson(s){ try{ return JSON.parse(s); }catch(e){ return null; } }
  function parseArr(s){ var v=parseJson(s); return Array.isArray(v)?v:[]; }
  function j(v){ try{ return JSON.stringify(v) }catch(e){ return '[]' } }
  function same(a,b){ return j(a)===j(b); }
  function uname(u){ return (u && (u.nick||u.login||u.username||u.id||u.name)||'').toString().trim(); }

  function req(method,url,body,headers){
    if (window.fetch){
      var h={'Content-Type':'application/json'};
      if (headers){ for (var k in headers) if (Object.prototype.hasOwnProperty.call(headers,k)) h[k]=headers[k]; }
      var o={method:method,headers:h};
      if (body) o.body=JSON.stringify(body);
      return fetch(url,o).then(function(r){
        return r.json()['catch'](function(){ return {}; }).then(function(data){ return { ok:r.ok, status:r.status, data:data }; });
      });
    }
    return new Promise(function(resolve){
      var x=new XMLHttpRequest(); x.open(method,url,true);
      x.setRequestHeader('Content-Type','application/json');
      if (headers){ for (var k in headers) if (Object.prototype.hasOwnProperty.call(headers,k)) x.setRequestHeader(k, headers[k]); }
      x.onreadystatechange=function(){
        if (x.readyState===4){
          var data={}; try{ data=JSON.parse(x.responseText||'{}'); }catch(_){}
          resolve({ ok:x.status>=200&&x.status<300, status:x.status, data:data });
        }
      };
      x.onerror=function(){ resolve({ ok:false, status:0, data:{} }); };
      x.send(body?JSON.stringify(body):null);
    });
  }

  // ---- безопасные setItem/removeItem ----
  var mute={};
  var _set=localStorage.setItem.bind(localStorage);
  var _rem=localStorage.removeItem.bind(localStorage);
  function muteKey(k,v){ mute[k]=v?1:0; }
  function isMuted(k){ return !!mute[k]; }
  function setLS(k,v){ muteKey(k,true); try{ _set(k,v); }catch(_){ } muteKey(k,false); }
  function remLS(k){ muteKey(k,true); try{ _rem(k); }catch(_){ } muteKey(k,false); }

  function keysByPrefix(prefix){
    var r=[]; try{ for (var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if (k && k.indexOf(prefix)===0) r.push(k); } }catch(_){}
    return r;
  }
  function isCatalogSyn(key){ if(!key) return false; if(SYN_CATALOG_STATIC.indexOf(key)!==-1) return true; return key.indexOf('shop_catalog_')===0; }
  function isOrdersSyn(key){ if(!key) return false; if(SYN_ORDERS_STATIC.indexOf(key)!==-1) return true; return key.indexOf('shop_orders_')===0; }
  function isUsersSyn(key){ if(!key) return false; if(SYN_USERS_STATIC.indexOf(key)!==-1) return true; return key.indexOf('shop_users_')===0 || key.indexOf('users_')===0 || key.indexOf('accounts_')===0; }

  // ---- каталог helpers ----
  function recomputeCats(products){
    var cats=[], i, p, c;
    for(i=0;i<products.length;i++){
      p=products[i]||{}; c=p.cat||p.category||p.categoryId||p.catId;
      if (c && cats.indexOf(c)===-1) cats.push(c);
    }
    return cats;
  }
  function getLocalProducts(){ return parseArr(localStorage.getItem(KEY_PRODUCTS)); }
  function setLocalProducts(arr){
    setLS(KEY_PRODUCTS, j(arr||[]));
    var ts=now(); setLS(LS_TS_KEY,String(ts)); setLS(LS_LOCK_UNTIL,String(ts+EDIT_LOCK_MS));
    setLS(KEY_CATS, j(recomputeCats(arr||[])));
    mirrorFromPrimary();
  }
  function isEditLocked(){ return (parseInt(localStorage.getItem(LS_LOCK_UNTIL)||'0',10)||0) > now(); }

  // ---- USERS зеркала ----
  function mirrorUsers(usersArr){
    usersArr = Array.isArray(usersArr) ? usersArr : [];
    // массив
    setLS(KEY_USERS, j(usersArr));
    // словари (по нику/логину/имени)
    var dict={}, dictLC={}, names=[], i, u, name;
    for(i=0;i<usersArr.length;i++){
      u=usersArr[i]||{}; name=uname(u);
      if(!name) continue;
      dict[name]=u; dictLC[name.toLowerCase()]=u;
      if (names.indexOf(name)===-1) names.push(name);
    }
    var dictStr=j(dict), dictLCStr=j(dictLC), namesStr=j(names);
    var iKey;
    for(iKey=0;iKey<SYN_USERS_STATIC.length;iKey++) setLS(SYN_USERS_STATIC[iKey], dictStr);
    setLS('users_lc', dictLCStr); setLS('accounts_lc', dictLCStr); setLS('auth_users_lc', dictLCStr);
    var idx=['usernames','nicknames','login_list','users_keys','users_index','users-list'];
    for(iKey=0;iKey<idx.length;iKey++) setLS(idx[iKey], namesStr);
    for(i=0;i<names.length;i++){ // пер-юзер зеркала
      var nm=names[i], ustr=JSON.stringify(dict[nm]);
      setLS('user:'+nm, ustr); setLS('users:'+nm, ustr); setLS('account:'+nm, ustr); setLS('profile:'+nm, ustr); setLS('shop_users:'+nm, ustr);
    }
  }

  // ---- глобальные зеркала (catalog/orders/users) ----
  function mirrorFromPrimary(){
    var ordStr=localStorage.getItem(KEY_ORDERS)||'[]';
    setLS('my_orders',ordStr); var op=keysByPrefix('shop_orders_'); for (var i=0;i<op.length;i++) setLS(op[i],ordStr);

    var prodStr=localStorage.getItem(KEY_PRODUCTS)||'[]';
    setLS('products',prodStr); setLS('goods',prodStr); setLS('catalog',prodStr);
    var cp=keysByPrefix('shop_catalog_'); for (i=0;i<cp.length;i++) setLS(cp[i],prodStr);

    mirrorUsers(parseArr(localStorage.getItem(KEY_USERS)||'[]'));
  }

  function copyToPrimaryIfSynonym(key){
    var v=localStorage.getItem(key);
    if (isCatalogSyn(key)) setLocalProducts(parseArr(v||'[]'));
    if (isOrdersSyn(key))  setLS(KEY_ORDERS, v||'[]');
    if (isUsersSyn(key))   setLS(KEY_USERS, v||'[]');
  }

  // ---- планировщик PUSH ----
  var timers={catalog:null,orders:null,bank:null,users:null};
  var dirtyUntil={catalog:0,orders:0,bank:0,users:0};
  function markDirty(g){ dirtyUntil[g]=now()+DIRTY_HOLD_MS; }

  function schedulePush(group){
    if (timers[group]){ clearTimeout(timers[group]); timers[group]=null; }
    markDirty(group);
    timers[group]=setTimeout(function(){
      if (group==='catalog'){
        var products=getLocalProducts(), cats=recomputeCats(products);
        var ts=parseInt(localStorage.getItem(LS_TS_KEY)||'0',10)||now();
        setLS(KEY_CATS, j(cats));
        req('PUT','/api/catalog',{products:products,cats:cats},{'X-Shop-Ts': String(ts)}).then(function(r){
          if(!r.ok && r.status===409 && r.data){
            var svProds=Array.isArray(r.data.products)?r.data.products:[]; var svCats=Array.isArray(r.data.cats)?r.data.cats:recomputeCats(svProds);
            setLS(KEY_PRODUCTS, j(svProds)); setLS(KEY_CATS, j(svCats)); mirrorFromPrimary();
          }
        });
      } else if (group==='orders'){
        var orders=parseArr(localStorage.getItem(KEY_ORDERS));
        req('PUT','/api/orders',{orders:orders},{'X-Shop-Ts': String(now())});
      } else if (group==='bank'){
        var log=parseArr(localStorage.getItem(KEY_BANK));
        req('PUT','/api/bank',{log:log},{'X-Shop-Ts': String(now())});
      } else if (group==='users'){
        var users=parseArr(localStorage.getItem(KEY_USERS));
        req('PUT','/api/users',{users:users},{'X-Shop-Ts': String(now())}).then(function(){ mirrorUsers(users); });
      }
    }, PUT_DEBOUNCE_MS);
  }

  // ---- перехват localStorage ----
  localStorage.setItem=function(key,value){
    var r; try{ r=_set(key,value); }catch(_){}
    if (!isMuted(key)){
      if (isCatalogSyn(key)||isOrdersSyn(key)||isUsersSyn(key)) copyToPrimaryIfSynonym(key);
      if (key===KEY_PRODUCTS||key===KEY_CATS||isCatalogSyn(key)) schedulePush('catalog');
      else if (key===KEY_ORDERS||isOrdersSyn(key)) schedulePush('orders');
      else if (key===KEY_BANK) schedulePush('bank');
      else if (key===KEY_USERS||isUsersSyn(key)) schedulePush('users');
    }
    return r;
  };
  localStorage.removeItem=function(key){
    var r; try{ r=_rem(key); }catch(_){}
    if (!isMuted(key)){
      if (key===KEY_PRODUCTS||isCatalogSyn(key)){ setLocalProducts([]); schedulePush('catalog'); }
      else if (key===KEY_CATS){ setLS(KEY_CATS,'[]'); schedulePush('catalog'); }
      else if (key===KEY_ORDERS||isOrdersSyn(key)){ setLS(KEY_ORDERS,'[]'); schedulePush('orders'); }
      else if (key===KEY_BANK){ setLS(KEY_BANK,'[]'); schedulePush('bank'); }
      else if (key===KEY_USERS||isUsersSyn(key)){ setLS(KEY_USERS,'[]'); schedulePush('users'); }
    }
    return r;
  };

  // ---- watcher ----
  var snapshot={};
  function snapGet(k){ return localStorage.getItem(k); }
  function saveSnap(k,v){ snapshot[k]=v; }
  function trackKey(k, group){
    var cur=snapGet(k);
    if (snapshot[k]!==cur){
      saveSnap(k,cur);
      if (group==='catalog' && isCatalogSyn(k)) copyToPrimaryIfSynonym(k);
      if (group==='orders'  && isOrdersSyn(k))  copyToPrimaryIfSynonym(k);
      if (group==='users'   && isUsersSyn(k))   copyToPrimaryIfSynonym(k);
      if (group) schedulePush(group);
    }
  }
  function initSnapshot(){
    var keys=[KEY_PRODUCTS,KEY_CATS,KEY_ORDERS,KEY_BANK,KEY_USERS]
      .concat(SYN_CATALOG_STATIC).concat(SYN_ORDERS_STATIC).concat(SYN_USERS_STATIC)
      .concat(keysByPrefix('shop_catalog_')).concat(keysByPrefix('shop_orders_')).concat(keysByPrefix('shop_users_'))
      .concat(keysByPrefix('users_')).concat(keysByPrefix('accounts_'));
    for (var i=0;i<keys.length;i++) saveSnap(keys[i], snapGet(keys[i]));
  }

  // ---- pull (учитывает edit-lock для каталога) ----
  function applyServerCatalog(products){
    setLS(KEY_PRODUCTS, j(products||[]));
    setLS(KEY_CATS, j(recomputeCats(products||[])));
    mirrorFromPrimary();
  }
  function pullOnce(){
    req('GET','/api/catalog').then(function(r){
      var d=r.data||{}, prods=Array.isArray(d&&d.products)?d.products:[];
      if(!isEditLocked() && !same(parseArr(localStorage.getItem(KEY_PRODUCTS)), prods)) applyServerCatalog(prods);
    });
    req('GET','/api/orders').then(function(r){
      var d=r.data||{}, orders=Array.isArray(d&&d.orders)?d.orders:[];
      if(!same(parseArr(localStorage.getItem(KEY_ORDERS)), orders)) setLS(KEY_ORDERS, j(orders));
      mirrorFromPrimary();
    });
    req('GET','/api/bank').then(function(r){
      var d=r.data||{}, log=Array.isArray(d&&d.log)?d.log:[];
      if(!same(parseArr(localStorage.getItem(KEY_BANK)), log)) setLS(KEY_BANK, j(log));
    });
    req('GET','/api/users').then(function(r){
      var d=r.data||{}, users=Array.isArray(d&&d.users)?d.users:[];
      if(!same(parseArr(localStorage.getItem(KEY_USERS)), users)){ setLS(KEY_USERS, j(users)); mirrorUsers(users); }
    });
  }
  function startPolling(){
    setInterval(function(){
      var t=now(); function ok(g){ return t>=dirtyUntil[g]; }
      if (ok('catalog')||ok('orders')||ok('bank')||ok('users')) pullOnce();
    }, PULL_INTERVAL_MS);
  }

  // ---- старт ----
  (function init(){
    initSnapshot();
    pullOnce();
    setInterval(function(){
      trackKey(KEY_PRODUCTS,'catalog');
      trackKey(KEY_CATS,'catalog');
      trackKey(KEY_ORDERS,'orders');
      trackKey(KEY_BANK,'bank');
      trackKey(KEY_USERS,'users');

      var i, list;
      list=SYN_CATALOG_STATIC.concat(keysByPrefix('shop_catalog_')); for(i=0;i<list.length;i++) trackKey(list[i],'catalog');
      list=SYN_ORDERS_STATIC.concat(keysByPrefix('shop_orders_'));  for(i=0;i<list.length;i++) trackKey(list[i],'orders');
      list=SYN_USERS_STATIC.concat(keysByPrefix('shop_users_')).concat(keysByPrefix('users_')).concat(keysByPrefix('accounts_'));
      for(i=0;i<list.length;i++) trackKey(list[i],'users');
    }, WATCH_INTERVAL_MS);
    startPolling();
  })();
})();
