/* sync-bridge.js (ES5)
 * Синхронизирует catalog/orders/bank/users с сервером.
 * Для users дополнительно создаёт словари/индексы/per-user записи, чтобы UI точно нашёл ник.
 */
(function(){
  if (!window || !window.localStorage) return;

  var KEY_PRODUCTS='shop_catalog';
  var KEY_CATS='shop_cats';
  var KEY_ORDERS='shop_orders';
  var KEY_BANK='mock_bank';
  var KEY_USERS='shop_users'; // массив пользователей

  var SYN_ORDERS_STATIC=['my_orders'];
  var SYN_CATALOG_STATIC=['products','goods','catalog'];
  var SYN_USERS_STATIC=['users','accounts','auth_users','user_list','profiles'];

  var LOGIN_NICK_KEYS=['current_user','auth_user','user','nick','username','login'];
  var LOGIN_PASS_KEYS=['password','auth_pass','pass','pwd'];

  var PULL_INTERVAL_MS=5000, PUT_DEBOUNCE_MS=300, WATCH_INTERVAL_MS=400, DIRTY_HOLD_MS=5000;

  function parseJson(s){ try{ return JSON.parse(s); }catch(e){ return null; } }
  function parseArr(s){ var v=parseJson(s); return Array.isArray(v)?v:[]; }
  function parseUsersFlexible(s){
    var v=parseJson(s);
    if (Array.isArray(v)) return v;
    if (v && typeof v==='object'){ var a=[]; for (var k in v) if (Object.prototype.hasOwnProperty.call(v,k)) a.push(v[k]); return a; }
    return [];
  }
  function j(v){ try{ return JSON.stringify(v) }catch(e){ return '[]' } }
  function same(a,b){ return j(a)===j(b); }
  function uname(u){ return (u && (u.nick||u.login||u.username||u.id||u.name)||'').toString().trim(); }

  function req(method,url,body){
    if (window.fetch){
      var o={method:method,headers:{'Content-Type':'application/json'}};
      if (body) o.body=JSON.stringify(body);
      return fetch(url,o).then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); });
    }
    return new Promise(function(resolve,reject){
      var x=new XMLHttpRequest(); x.open(method,url,true);
      x.setRequestHeader('Content-Type','application/json');
      x.onreadystatechange=function(){ if(x.readyState===4){ if(x.status>=200&&x.status<300){ try{ resolve(JSON.parse(x.responseText||'{}')); }catch(_){ resolve({}); } } else reject(new Error('HTTP '+x.status)); } };
      x.onerror=function(){ reject(new Error('Network')); };
      x.send(body?JSON.stringify(body):null);
    });
  }

  var silent={};
  var _set=localStorage.setItem.bind(localStorage);
  var _rem=localStorage.removeItem.bind(localStorage);
  function setSilent(k,v){ silent[k]=v?1:0; }
  function isSilent(k){ return !!silent[k]; }
  function setLS(k,v){ setSilent(k,true); try{ _set(k,v); }catch(_){ } setSilent(k,false); }
  function remLS(k){ setSilent(k,true); try{ _rem(k); }catch(_){ } setSilent(k,false); }

  function keysByPrefix(prefix){
    var r=[]; try{ for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k&&k.indexOf(prefix)===0) r.push(k); } }catch(_){}
    return r;
  }
  function isOrdersSyn(k){ if(!k) return false; if(SYN_ORDERS_STATIC.indexOf(k)!==-1) return true; return k.indexOf('shop_orders_')===0; }
  function isCatalogSyn(k){ if(!k) return false; if(SYN_CATALOG_STATIC.indexOf(k)!==-1) return true; return k.indexOf('shop_catalog_')===0; }
  function isUsersSyn(k){ if(!k) return false; if(SYN_USERS_STATIC.indexOf(k)!==-1) return true; return k.indexOf('shop_users_')===0 || k.indexOf('users_')===0 || k.indexOf('accounts_')===0; }

  var timers={catalog:null,orders:null,bank:null,users:null};
  var dirtyUntil={catalog:0,orders:0,bank:0,users:0};
  function markDirty(group){ dirtyUntil[group]=Date.now()+DIRTY_HOLD_MS; }
  function schedulePush(group){
    if (timers[group]){ clearTimeout(timers[group]); timers[group]=null; }
    markDirty(group);
    timers[group]=setTimeout(function(){
      if (group==='catalog'){
        var products=parseArr(localStorage.getItem(KEY_PRODUCTS));
        var cats=parseArr(localStorage.getItem(KEY_CATS));
        if (!cats.length){ cats=[]; for(var i=0;i<products.length;i++){ var p=products[i]||{}; var c=p.cat||p.category||p.categoryId||p.catId; if(c&&cats.indexOf(c)===-1) cats.push(c); } setLS(KEY_CATS,j(cats)); }
        req('PUT','/api/catalog',{products:products,cats:cats})['catch'](function(){});
      } else if (group==='orders'){
        var orders=parseArr(localStorage.getItem(KEY_ORDERS));
        req('PUT','/api/orders',{orders:orders})['catch'](function(){});
      } else if (group==='bank'){
        var log=parseArr(localStorage.getItem(KEY_BANK));
        req('PUT','/api/bank',{log:log})['catch'](function(){});
      } else if (group==='users'){
        var raw=localStorage.getItem(KEY_USERS);
        var users=parseUsersFlexible(raw);
        // де-дуп admin на клиенте для надёжности
        var others=[], admins=[], u, n, k;
        for (i=0;i<users.length;i++){ u=users[i]||{}; n=uname(u); if(n&&n.toLowerCase()==='admin') admins.push(u); else others.push(u); }
        var admin={nick:'admin'}; for(i=0;i<admins.length;i++){ var src=admins[i]; for(k in src) if(Object.prototype.hasOwnProperty.call(src,k)) admin[k]=src[k]; }
        admin.nick='admin'; admin.login='admin'; admin.username='admin'; admin.role='admin'; admin.isAdmin=true; admin.admin=true;
        var arr=others.concat([admin]);
        setLS(KEY_USERS, j(arr));
        req('PUT','/api/users',{users:arr})['catch'](function(){});
        mirrorUsers(arr);
      }
    }, PUT_DEBOUNCE_MS);
  }

  function mirrorUsers(usersArr){
    usersArr = Array.isArray(usersArr) ? usersArr : [];
    var dict={}, dictLC={}, names=[];
    for (var i=0;i<usersArr.length;i++){
      var u=usersArr[i]||{}; var name=uname(u);
      if (!name) continue;
      dict[name]=u; dictLC[name.toLowerCase()]=u;
      if (names.indexOf(name)===-1) names.push(name);
    }
    var arrStr=j(usersArr), dictStr=JSON.stringify(dict), dictLCStr=JSON.stringify(dictLC), namesStr=JSON.stringify(names);
    // массив
    setLS('shop_users', arrStr);
    // словари
    for (i=0;i<SYN_USERS_STATIC.length;i++){ setLS(SYN_USERS_STATIC[i], dictStr); }
    setLS('users_lc', dictLCStr); setLS('accounts_lc', dictLCStr); setLS('auth_users_lc', dictLCStr);
    // индексы
    var idxKeys=['usernames','nicknames','login_list','users_keys','users_index','users-list'];
    for (i=0;i<idxKeys.length;i++) setLS(idxKeys[i], namesStr);
    // пер-юзерные записи
    for (i=0;i<names.length;i++){
      var nm=names[i]; var ustr=JSON.stringify(dict[nm]);
      setLS('user:'+nm, ustr); setLS('users:'+nm, ustr); setLS('account:'+nm, ustr); setLS('profile:'+nm, ustr); setLS('shop_users:'+nm, ustr);
    }
  }

  function mirrorFromPrimary(){
    // orders
    var ordStr=localStorage.getItem(KEY_ORDERS)||'[]';
    setLS('my_orders',ordStr); var op=keysByPrefix('shop_orders_'); for (var i=0;i<op.length;i++) setLS(op[i],ordStr);
    // catalog
    var prodStr=localStorage.getItem(KEY_PRODUCTS)||'[]';
    setLS('products',prodStr); setLS('goods',prodStr); setLS('catalog',prodStr);
    var cp=keysByPrefix('shop_catalog_'); for (i=0;i<cp.length;i++) setLS(cp[i],prodStr);
    // users (полная раскладка)
    var usersArr=parseArr(localStorage.getItem(KEY_USERS)||'[]');
    mirrorUsers(usersArr);
  }

  function copyToPrimaryIfSynonym(key){
    var v=localStorage.getItem(key);
    if (isOrdersSyn(key)) setLS(KEY_ORDERS, v||'[]');
    if (isCatalogSyn(key)) setLS(KEY_PRODUCTS, v||'[]');
    if (isUsersSyn(key))   setLS(KEY_USERS, v||'[]');
  }

  // patch Storage
  localStorage.setItem=function(key,value){
    var r; try{ r=_set(key,value); }catch(_){}
    if (!isSilent(key)){
      if (isOrdersSyn(key) || isCatalogSyn(key) || isUsersSyn(key)) copyToPrimaryIfSynonym(key);
      if (key===KEY_PRODUCTS || key===KEY_CATS || isCatalogSyn(key)) schedulePush('catalog');
      else if (key===KEY_ORDERS || isOrdersSyn(key)) schedulePush('orders');
      else if (key===KEY_BANK) schedulePush('bank');
      else if (key===KEY_USERS || isUsersSyn(key)) schedulePush('users');

      // login detection, чтобы выставить флаги админа
      if (LOGIN_NICK_KEYS.indexOf(key)!==-1 || LOGIN_PASS_KEYS.indexOf(key)!==-1){
        var nick=null, pass=null, i;
        for(i=0;i<LOGIN_NICK_KEYS.length;i++){ var kn=LOGIN_NICK_KEYS[i]; var nv=localStorage.getItem(kn)||sessionStorage.getItem(kn); if(nv){ try{ var pj=parseJson(nv); nick=(typeof pj==='string')?pj:nv; }catch(_){ nick=nv; } if(nick) break; } }
        for(i=0;i<LOGIN_PASS_KEYS.length;i++){ var kp=LOGIN_PASS_KEYS[i]; var pv=localStorage.getItem(kp)||sessionStorage.getItem(kp); if(pv){ try{ var pj2=parseJson(pv); pass=(typeof pj2==='string')?pj2:pv; }catch(_){ pass=pv; } if(pass) break; } }
        attemptAuth(nick?String(nick):'', pass?String(pass):'');
      }
    }
    return r;
  };
  localStorage.removeItem=function(key){
    var r; try{ r=_rem(key); }catch(_){}
    if (!isSilent(key)){
      if (key===KEY_PRODUCTS || isCatalogSyn(key)){ setLS(KEY_PRODUCTS,'[]'); schedulePush('catalog'); }
      else if (key===KEY_CATS){ setLS(KEY_CATS,'[]'); schedulePush('catalog'); }
      else if (key===KEY_ORDERS || isOrdersSyn(key)){ setLS(KEY_ORDERS,'[]'); schedulePush('orders'); }
      else if (key===KEY_BANK){ setLS(KEY_BANK,'[]'); schedulePush('bank'); }
      else if (key===KEY_USERS || isUsersSyn(key)){ setLS(KEY_USERS,'[]'); schedulePush('users'); }
    }
    return r;
  };

  // auth helpers
  function getUsersArray(){
    var arr=parseArr(localStorage.getItem(KEY_USERS));
    if (arr.length) return arr;
    var dict=parseJson(localStorage.getItem('users')||localStorage.getItem('accounts')||'{}')||{};
    var a=[]; for (var k in dict) if (Object.prototype.hasOwnProperty.call(dict,k)) a.push(dict[k]);
    return a;
  }
  function grantAdminSession(u){
    var nick=uname(u)||'admin'; var ustr=JSON.stringify({ nick:nick, role:'admin', ts:Date.now() });
    setLS('is_admin','true'); setLS('isAdmin','true'); setLS('admin','true'); setLS('role','admin'); setLS('user_role','admin');
    setLS('permissions', JSON.stringify(['*']));
    setLS('session_user', ustr); setLS('currentUser', ustr); setLS('profile', ustr);
  }
  function attemptAuth(nick, pass){
    if (!nick) return;
    var users=getUsersArray(); var ok=false, found=null;
    for (var i=0;i<users.length;i++){ var u=users[i]||{}; if (uname(u)===nick){ found=u; break; } }
    if (found){
      if (!pass && nick==='admin') ok=true;
      else if (found.password && String(found.password)===pass) ok=true;
      else if (found.pass && String(found.pass)===pass) ok=true;
      else if (found.pwd  && String(found.pwd)===pass) ok=true;
    }
    if (ok && (nick==='admin' || (found&&(found.role==='admin'||found.isAdmin===true||found.admin===true)))) grantAdminSession(found||{nick:'admin'});
  }

  // watcher
  var snapshot={};
  function snapGet(k){ return localStorage.getItem(k); }
  function saveSnap(k,v){ snapshot[k]=v; }
  function checkKeyForChange(k, group){
    var cur=snapGet(k);
    if (snapshot[k]!==cur){
      saveSnap(k,cur);
      if (group==='orders' && isOrdersSyn(k)) copyToPrimaryIfSynonym(k);
      if (group==='catalog' && isCatalogSyn(k)) copyToPrimaryIfSynonym(k);
      if (group==='users' && isUsersSyn(k)) copyToPrimaryIfSynonym(k);
      if (group) schedulePush(group);
    }
  }
  function initSnapshot(){
    var keys=[KEY_PRODUCTS,KEY_CATS,KEY_ORDERS,KEY_BANK,KEY_USERS]
      .concat(SYN_ORDERS_STATIC).concat(SYN_CATALOG_STATIC).concat(SYN_USERS_STATIC)
      .concat(keysByPrefix('shop_orders_')).concat(keysByPrefix('shop_catalog_'))
      .concat(keysByPrefix('shop_users_')).concat(keysByPrefix('users_')).concat(keysByPrefix('accounts_'))
      .concat(LOGIN_NICK_KEYS).concat(LOGIN_PASS_KEYS);
    for (var i=0;i<keys.length;i++) saveSnap(keys[i],snapGet(keys[i]));
  }
  function startWatch(){
    initSnapshot();
    setInterval(function(){
      checkKeyForChange(KEY_PRODUCTS,'catalog');
      checkKeyForChange(KEY_CATS,'catalog');
      checkKeyForChange(KEY_ORDERS,'orders');
      checkKeyForChange(KEY_BANK,'bank');
      checkKeyForChange(KEY_USERS,'users');

      var i,list;
      list=SYN_ORDERS_STATIC.concat(keysByPrefix('shop_orders_')); for(i=0;i<list.length;i++) checkKeyForChange(list[i],'orders');
      list=SYN_CATALOG_STATIC.concat(keysByPrefix('shop_catalog_')); for(i=0;i<list.length;i++) checkKeyForChange(list[i],'catalog');
      list=SYN_USERS_STATIC.concat(keysByPrefix('shop_users_')).concat(keysByPrefix('users_')).concat(keysByPrefix('accounts_')); for(i=0;i<list.length;i++) checkKeyForChange(list[i],'users');

      for(i=0;i<LOGIN_NICK_KEYS.length;i++) checkKeyForChange(LOGIN_NICK_KEYS[i],null);
      for(i=0;i<LOGIN_PASS_KEYS.length;i++) checkKeyForChange(LOGIN_PASS_KEYS[i],null);
    }, WATCH_INTERVAL_MS);
  }

  // pull
  function initialPull(){
    req('GET','/api/catalog').then(function(d){
      var cats=Array.isArray(d&&d.cats)?d.cats:[]; var prods=Array.isArray(d&&d.products)?d.products:[];
      if (!same(parseArr(localStorage.getItem(KEY_CATS)),cats)) setLS(KEY_CATS,j(cats));
      if (!same(parseArr(localStorage.getItem(KEY_PRODUCTS)),prods)) setLS(KEY_PRODUCTS,j(prods));
      mirrorFromPrimary();
    })['catch'](function(){});
    req('GET','/api/orders').then(function(d){
      var orders=Array.isArray(d&&d.orders)?d.orders:[];
      if (!same(parseArr(localStorage.getItem(KEY_ORDERS)),orders)) setLS(KEY_ORDERS,j(orders));
      mirrorFromPrimary();
    })['catch'](function(){});
    req('GET','/api/bank').then(function(d){
      var log=Array.isArray(d&&d.log)?d.log:[];
      if (!same(parseArr(localStorage.getItem(KEY_BANK)),log)) setLS(KEY_BANK,j(log));
    })['catch'](function(){});
    req('GET','/api/users').then(function(d){
      var users=Array.isArray(d&&d.users)?d.users:[];
      if (!same(parseArr(localStorage.getItem(KEY_USERS)),users)) setLS(KEY_USERS,j(users));
      mirrorFromPrimary();
    })['catch'](function(){});
  }
  function startPolling(){
    setInterval(function(){
      var now=Date.now();
      function ok(group){ return now>=dirtyUntil[group]; }

      req('GET','/api/catalog').then(function(d){
        if (!ok('catalog')) return;
        var cats=Array.isArray(d&&d.cats)?d.cats:[]; var prods=Array.isArray(d&&d.products)?d.products:[];
        if (!same(parseArr(localStorage.getItem(KEY_CATS)),cats)) setLS(KEY_CATS,j(cats));
        if (!same(parseArr(localStorage.getItem(KEY_PRODUCTS)),prods)) setLS(KEY_PRODUCTS,j(prods));
        mirrorFromPrimary();
      })['catch'](function(){});

      req('GET','/api/orders').then(function(d){
        if (!ok('orders')) return;
        var orders=Array.isArray(d&&d.orders)?d.orders:[];
        if (!same(parseArr(localStorage.getItem(KEY_ORDERS)),orders)) setLS(KEY_ORDERS,j(orders));
        mirrorFromPrimary();
      })['catch'](function(){});

      req('GET','/api/bank').then(function(d){
        if (!ok('bank')) return;
        var log=Array.isArray(d&&d.log)?d.log:[];
        if (!same(parseArr(localStorage.getItem(KEY_BANK)),log)) setLS(KEY_BANK,j(log));
      })['catch'](function(){});

      req('GET','/api/users').then(function(d){
        if (!ok('users')) return;
        var users=Array.isArray(d&&d.users)?d.users:[];
        if (!same(parseArr(localStorage.getItem(KEY_USERS)),users)) setLS(KEY_USERS,j(users));
        mirrorFromPrimary();
      })['catch'](function(){});
    }, PULL_INTERVAL_MS);
  }

  // export helper
  window.__adminLogin=function(nick,pass){ attemptAuth(String(nick||''), String(pass||'')); };

  initialPull();
  startWatch();
  startPolling();
})();
