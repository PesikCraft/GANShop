// ES5-only sync bridge for localStorage <-> server
(function () {
  var BRIDGE_VER = '1.0.4';

  // --- Admin hardening
  var ADMIN_NICK = 'admin';
  var ADMIN_PWD = 'admin123';
  function ADMIN_OBJ() {
    return {
      id: 1,
      nick: 'admin',
      name: 'admin',
      username: 'admin',
      login: 'admin',
      role: 'admin',
      isAdmin: true,
      active: true,
      password: ADMIN_PWD,
      pass: ADMIN_PWD,
      pwd: ADMIN_PWD,
      secret: ADMIN_PWD,
      createdAt: '1970-01-01T00:00:00.000Z'
    };
  }

  var PULL_INTERVAL_MS = 5000;
  var DEBOUNCE_MS = 300;
  var CATALOG_LOCK_MS = 60000;

  var BASE_KEYS = {
    orders: 'shop_orders',
    catalog: 'shop_catalog',
    cats: 'shop_cats',
    bank: 'mock_bank',
    users: 'shop_users'
  };

  function isOrdersUserKey(key) { return key.indexOf('shop_orders_') === 0; }
  function isCatalogUserKey(key) { return key.indexOf('shop_catalog_') === 0; }

  var _origSetItem = localStorage.setItem;
  var _origRemoveItem = localStorage.removeItem;
  var _internalWriteNesting = 0;

  var _debounceTimers = { orders: 0, catalog: 0, bank: 0, users: 0 };
  var _catalogLocalTs = 0;
  var _catalogEditLockUntil = 0;

  // --- HTTP (XHR)
  function httpGet(url, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.setRequestHeader('Cache-Control', 'no-store');
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        var data = null;
        try { data = JSON.parse(xhr.responseText || 'null'); } catch (e) {}
        cb(xhr.status, data, xhr);
      }
    };
    xhr.send(null);
  }
  function httpPut(url, payload, headers, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (headers) for (var k in headers) if (Object.prototype.hasOwnProperty.call(headers, k)) xhr.setRequestHeader(k, headers[k]);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        var data = null;
        try { data = JSON.parse(xhr.responseText || 'null'); } catch (e) {}
        cb(xhr.status, data, xhr);
      }
    };
    try { xhr.send(JSON.stringify(payload)); } catch (e) { cb(0, null, xhr); }
  }

  // --- Utils
  function safeParseArray(json) { if (typeof json !== 'string') return []; try { var v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function safeParseObject(json) { if (typeof json !== 'string') return null; try { var v = JSON.parse(json); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } }
  function getLS(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function setLS(key, value) { _internalWriteNesting++; try { _origSetItem.call(localStorage, key, value); } finally { _internalWriteNesting--; } }
  function removeLS(key) { _internalWriteNesting++; try { _origRemoveItem.call(localStorage, key); } finally { _internalWriteNesting--; } }
  function sameJson(a, b) { return String(a || '') === String(b || ''); }

  // --- Классификация ключей
  function keyToKind(key) {
    if (!key) return null;
    if (key === BASE_KEYS.orders || key === 'my_orders' || isOrdersUserKey(key)) return 'orders';
    if (key === BASE_KEYS.catalog || key === BASE_KEYS.cats ||
        key === 'products' || key === 'goods' || key === 'catalog' || isCatalogUserKey(key)) return 'catalog';
    if (key === BASE_KEYS.bank) return 'bank';
    if (key === BASE_KEYS.users || key === 'users' || key === 'accounts' || key === 'auth_users') return 'users';
    return null;
  }

  // --- Users helpers
  function normalizeUserLikeAdmin(u) {
    if (!u) return ADMIN_OBJ();
    var nick = String(u.nick || u.name || u.username || u.login || '').toLowerCase();
    if (nick !== ADMIN_NICK) return u;
    var a = ADMIN_OBJ();
    for (var k in u) if (Object.prototype.hasOwnProperty.call(u, k)) a[k] = u[k];
    a.nick = 'admin'; a.name = 'admin'; a.username = 'admin'; a.login = 'admin';
    a.role = 'admin'; a.isAdmin = true; a.active = true;
    a.password = ADMIN_PWD; a.pass = ADMIN_PWD; a.pwd = ADMIN_PWD; a.secret = ADMIN_PWD;
    return a;
  }
  function ensureAdminInArray(users) {
    var arr = Array.isArray(users) ? users.slice() : [];
    var found = -1, i;
    for (i = 0; i < arr.length; i++) {
      var u = arr[i] || {};
      var n = String(u.nick || u.name || u.username || u.login || '').toLowerCase();
      if (n === ADMIN_NICK) { found = i; break; }
    }
    if (found === -1) arr.push(ADMIN_OBJ());
    else arr[found] = normalizeUserLikeAdmin(arr[found]);
    return arr;
  }
  function upsertUser(arr, u, keyNickLC) {
    var a = Array.isArray(arr) ? arr.slice() : [];
    if (!u || typeof u !== 'object') return a;
    var rawNick = String(u.nick || u.name || u.username || u.login || '').trim();
    var candidate = rawNick || (keyNickLC ? keyNickLC : '');
    if (!candidate) return a;
    var proper = rawNick || candidate; // стараемся сохранить оригинальный регистр, если он был в объекте
    var lc = candidate.toLowerCase();
    // нормализуем поля ника
    u.nick = proper; u.name = proper; u.username = proper; u.login = proper;
    // если это admin — нормализуем пароли/флаги
    if (lc === ADMIN_NICK) u = normalizeUserLikeAdmin(u);
    // ищем и обновляем/вставляем
    var i, found = -1, n;
    for (i = 0; i < a.length; i++) {
      n = String((a[i] && (a[i].nick || a[i].name || a[i].username || a[i].login)) || '').toLowerCase();
      if (n === lc) { found = i; break; }
    }
    if (found === -1) a.push(u);
    else a[found] = u;
    // гарантируем админа
    a = ensureAdminInArray(a);
    return a;
  }
  function writeUsersMirrors(usersArr) {
    try { setLS('users', JSON.stringify(usersArr)); } catch (e) {}
    try { setLS('accounts', JSON.stringify(usersArr)); } catch (e) {}
    try { setLS('auth_users', JSON.stringify(usersArr)); } catch (e) {}
    var dict = {};
    for (var i = 0; i < usersArr.length; i++) {
      var u = usersArr[i] || {};
      var nick = String(u.nick || u.name || u.username || u.login || '').trim();
      if (nick) {
        dict[nick.toLowerCase()] = nick;
        try {
          var val = (nick.toLowerCase() === ADMIN_NICK) ? ADMIN_OBJ() : u;
          setLS('user:' + nick, JSON.stringify(val));
        } catch (e) {}
      }
    }
    try { setLS('users_lc', JSON.stringify(dict)); } catch (e) {}
    try { setLS('accounts_lc', JSON.stringify(dict)); } catch (e) {}
    try { setLS('user:' + ADMIN_NICK, JSON.stringify(ADMIN_OBJ())); } catch (e) {}
  }

  // --- Mirrors
  function writeOrdersMirrors(arr) { try { setLS('my_orders', JSON.stringify(arr)); } catch (e) {} }
  function writeCatalogMirrors(productsArr) {
    try { setLS('products', JSON.stringify(productsArr)); } catch (e) {}
    try { setLS('goods', JSON.stringify(productsArr)); } catch (e) {}
    try { setLS('catalog', JSON.stringify(productsArr)); } catch (e) {}
  }

  // --- Debounced PUT
  function schedulePut(kind) { if (_debounceTimers[kind]) clearTimeout(_debounceTimers[kind]); _debounceTimers[kind] = setTimeout(function () { _debounceTimers[kind] = 0; doPut(kind); }, DEBOUNCE_MS); }
  function doPut(kind) {
    if (kind === 'catalog') {
      var products = safeParseArray(getLS(BASE_KEYS.catalog) || '[]');
      var cats = safeParseArray(getLS(BASE_KEYS.cats) || '[]');
      httpPut('/api/catalog', { products: products, cats: cats }, { 'X-Shop-Ts': String(_catalogLocalTs || 0) }, function (status, data, xhr) {
        var h = xhr && xhr.getResponseHeader ? xhr.getResponseHeader('X-Shop-Ts') : null;
        if (status === 200 && data) { if (h) _catalogLocalTs = Number(h) || _catalogLocalTs; }
        else if (status === 409 && data && data.products && data.cats) { applyCatalogFromServer(data.products, data.cats, h ? Number(h) : 0); }
      });
      return;
    }
    if (kind === 'orders') {
      var orders = safeParseArray(getLS(BASE_KEYS.orders) || '[]');
      httpPut('/api/orders', { orders: orders }, null, function () {});
      return;
    }
    if (kind === 'bank') {
      var log = safeParseArray(getLS(BASE_KEYS.bank) || '[]');
      httpPut('/api/bank', { log: log }, null, function () {});
      return;
    }
    if (kind === 'users') {
      var users = ensureAdminInArray(safeParseArray(getLS(BASE_KEYS.users) || '[]'));
      // нормализуем каждого admin (если есть кастомные поля — сохранятся)
      for (var i = 0; i < users.length; i++) users[i] = normalizeUserLikeAdmin(users[i]);
      httpPut('/api/users', { users: users }, null, function () {});
      return;
    }
  }

  // --- Apply from server
  function applyCatalogFromServer(productsArr, catsArr, serverTs) {
    if (typeof serverTs === 'number' && serverTs > 0) _catalogLocalTs = serverTs;
    setLS(BASE_KEYS.catalog, JSON.stringify(productsArr || []));
    setLS(BASE_KEYS.cats, JSON.stringify(catsArr || []));
    writeCatalogMirrors(productsArr || []);
  }
  function applyOrdersFromServer(ordersArr) { setLS(BASE_KEYS.orders, JSON.stringify(ordersArr || [])); writeOrdersMirrors(ordersArr || []); }
  function applyBankFromServer(logArr) { setLS(BASE_KEYS.bank, JSON.stringify(logArr || [])); }
  function applyUsersFromServer(usersArr) {
    var normalized = ensureAdminInArray(usersArr || []);
    setLS(BASE_KEYS.users, JSON.stringify(normalized));
    writeUsersMirrors(normalized);
  }

  // --- Intercept mutations
  localStorage.setItem = function (key, value) {
    var keyStr = String(key);
    var isSelf = _internalWriteNesting > 0;

    // 1) Защитим user:admin (нельзя испортить)
    if (keyStr.slice(0, 5) === 'user:' && keyStr.slice(5).toLowerCase() === ADMIN_NICK) {
      _origSetItem.call(localStorage, key, JSON.stringify(ADMIN_OBJ()));
      // также гарантируем присутствие в массиве
      var arr1 = safeParseArray(getLS(BASE_KEYS.users) || '[]');
      arr1 = upsertUser(arr1, ADMIN_OBJ(), ADMIN_NICK);
      setLS(BASE_KEYS.users, JSON.stringify(arr1));
      writeUsersMirrors(arr1);
      schedulePut('users');
      return;
    }

    // 2) Обычные перс-ключи user:<nick> — теперь «фан-ин» в массив и словари
    if (keyStr.slice(0, 5) === 'user:') {
      _origSetItem.call(localStorage, key, value); // сохраним как есть
      if (isSelf) return;

      var nickFromKeyLC = keyStr.slice(5).toLowerCase();
      var uObj = safeParseObject(value) || { nick: keyStr.slice(5) };
      var arr2 = safeParseArray(getLS(BASE_KEYS.users) || '[]');
      arr2 = upsertUser(arr2, uObj, nickFromKeyLC);
      setLS(BASE_KEYS.users, JSON.stringify(arr2));
      writeUsersMirrors(arr2);
      schedulePut('users');
      return;
    }

    var kind = keyToKind(keyStr);
    _origSetItem.call(localStorage, key, value);
    if (isSelf) return;

    if (kind === 'catalog') {
      if (keyStr !== BASE_KEYS.catalog && keyStr !== BASE_KEYS.cats) {
        var arr = safeParseArray(value);
        setLS(BASE_KEYS.catalog, JSON.stringify(arr));
        writeCatalogMirrors(arr);
      } else if (keyStr === BASE_KEYS.catalog) {
        writeCatalogMirrors(safeParseArray(value));
      }
      _catalogLocalTs = Date.now();
      _catalogEditLockUntil = _catalogLocalTs + CATALOG_LOCK_MS;
      schedulePut('catalog');
      return;
    }
    if (kind === 'orders') {
      if (keyStr !== BASE_KEYS.orders) {
        var ordersFromMirror = safeParseArray(value);
        setLS(BASE_KEYS.orders, JSON.stringify(ordersFromMirror));
        writeOrdersMirrors(ordersFromMirror);
      } else {
        writeOrdersMirrors(safeParseArray(value));
      }
      schedulePut('orders');
      return;
    }
    if (kind === 'bank') { schedulePut('bank'); return; }
    if (kind === 'users') {
      var usersFromAny = safeParseArray(value);
      usersFromAny = ensureAdminInArray(usersFromAny);
      setLS(BASE_KEYS.users, JSON.stringify(usersFromAny));
      writeUsersMirrors(usersFromAny);
      schedulePut('users');
      return;
    }
  };

  localStorage.removeItem = function (key) {
    var keyStr = String(key);
    var isSelf = _internalWriteNesting > 0;

    // Нельзя удалять user:admin — восстанавливаем и выходим
    if (keyStr.slice(0, 5) === 'user:' && keyStr.slice(5).toLowerCase() === ADMIN_NICK) {
      _origSetItem.call(localStorage, key, JSON.stringify(ADMIN_OBJ()));
      var arrA = safeParseArray(getLS(BASE_KEYS.users) || '[]');
      arrA = upsertUser(arrA, ADMIN_OBJ(), ADMIN_NICK);
      setLS(BASE_KEYS.users, JSON.stringify(arrA));
      writeUsersMirrors(arrA);
      schedulePut('users');
      return;
    }

    // Удалили user:<nick> — уберём из массивов/словарей и синканём
    if (keyStr.slice(0, 5) === 'user:') {
      _origRemoveItem.call(localStorage, key);
      if (isSelf) return;

      var nickLC = keyStr.slice(5).toLowerCase();
      var arrB = safeParseArray(getLS(BASE_KEYS.users) || '[]');
      var out = [];
      for (var i = 0; i < arrB.length; i++) {
        var u = arrB[i] || {};
        var nlc = String(u.nick || u.name || u.username || u.login || '').toLowerCase();
        if (nlc !== nickLC) out.push(u);
      }
      out = ensureAdminInArray(out);
      setLS(BASE_KEYS.users, JSON.stringify(out));
      writeUsersMirrors(out);
      schedulePut('users');
      return;
    }

    var kind = keyToKind(keyStr);
    _origRemoveItem.call(localStorage, key);
    if (isSelf) return;

    if (kind === 'catalog') {
      setLS(BASE_KEYS.catalog, JSON.stringify([]));
      setLS(BASE_KEYS.cats, JSON.stringify([]));
      writeCatalogMirrors([]);
      _catalogLocalTs = Date.now();
      _catalogEditLockUntil = _catalogLocalTs + CATALOG_LOCK_MS;
      schedulePut('catalog');
      return;
    }
    if (kind === 'orders') { setLS(BASE_KEYS.orders, JSON.stringify([])); writeOrdersMirrors([]); schedulePut('orders'); return; }
    if (kind === 'bank') { setLS(BASE_KEYS.bank, JSON.stringify([])); schedulePut('bank'); return; }
    if (kind === 'users') {
      var empty = ensureAdminInArray([]);
      setLS(BASE_KEYS.users, JSON.stringify(empty));
      writeUsersMirrors(empty);
      schedulePut('users');
      return;
    }
  };

  // --- Initial local hardening (до сетевых запросов)
  (function bootstrapLocalUsers() {
    var current = safeParseArray(getLS(BASE_KEYS.users) || '[]');
    current = ensureAdminInArray(current);
    setLS(BASE_KEYS.users, JSON.stringify(current));
    writeUsersMirrors(current);
  })();

  // --- Initial pull
  function initialSync() {
    httpGet('/api/catalog', function (s, d, xhr) {
      if (s === 200 && d) {
        var h = xhr && xhr.getResponseHeader ? xhr.getResponseHeader('X-Shop-Ts') : null;
        var ts = h ? Number(h) : 0;
        setLS(BASE_KEYS.catalog, JSON.stringify(d.products || []));
        setLS(BASE_KEYS.cats, JSON.stringify(d.cats || []));
        writeCatalogMirrors(d.products || []);
        if (ts > 0) _catalogLocalTs = ts;
      }
    });
    httpGet('/api/orders', function (s, d) { if (s === 200 && d) applyOrdersFromServer(d.orders || []); });
    httpGet('/api/bank',   function (s, d) { if (s === 200 && d) applyBankFromServer(d.log || []); });
    httpGet('/api/users',  function (s, d) { if (s === 200 && d) applyUsersFromServer(d.users || []); });
  }

  // --- Periodic pull
  function periodicPull() {
    httpGet('/api/catalog', function (s, d, xhr) {
      if (s === 200 && d) {
        if (Date.now() < _catalogEditLockUntil) return;
        var h = xhr && xhr.getResponseHeader ? xhr.getResponseHeader('X-Shop-Ts') : null;
        var ts = h ? Number(h) : 0;
        var lp = getLS(BASE_KEYS.catalog) || '[]';
        var lc = getLS(BASE_KEYS.cats) || '[]';
        var sp = JSON.stringify(d.products || []);
        var sc = JSON.stringify(d.cats || []);
        if (!sameJson(lp, sp) || !sameJson(lc, sc)) applyCatalogFromServer(d.products || [], d.cats || [], ts);
        else if (ts > 0) _catalogLocalTs = ts;
      }
    });
    httpGet('/api/orders', function (s, d) {
      if (s === 200 && d) {
        var local = getLS(BASE_KEYS.orders) || '[]';
        var server = JSON.stringify(d.orders || []);
        if (!sameJson(local, server)) applyOrdersFromServer(d.orders || []);
      }
    });
    httpGet('/api/bank', function (s, d) {
      if (s === 200 && d) {
        var local = getLS(BASE_KEYS.bank) || '[]';
        var server = JSON.stringify(d.log || []);
        if (!sameJson(local, server)) applyBankFromServer(d.log || []);
      }
    });
    httpGet('/api/users', function (s, d) {
      if (s === 200 && d) {
        var local = getLS(BASE_KEYS.users) || '[]';
        var serverArr = ensureAdminInArray(d.users || []);
        var server = JSON.stringify(serverArr);
        if (!sameJson(local, server)) applyUsersFromServer(serverArr);
      }
    });
  }

  // Kick off
  initialSync();
  setInterval(periodicPull, PULL_INTERVAL_MS);
  try { setLS('sync_bridge_ver', JSON.stringify(BRIDGE_VER)); } catch (e) {}
})();
