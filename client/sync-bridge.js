// ES5-only sync bridge for localStorage <-> server
(function () {
  var BRIDGE_VER = '1.0.2';

  // --- Admin hardening (всегда держим локального admin/admin123)
  var ADMIN_NICK = 'admin';
  var ADMIN_OBJ = { nick: 'admin', password: 'admin123', role: 'admin' };

  var PULL_INTERVAL_MS = 5000;  // лёгкий pull каждые ~5 сек
  var DEBOUNCE_MS = 300;        // дебаунс PUT
  var CATALOG_LOCK_MS = 60000;  // короткий лок после локальной правки каталога

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

  // --- HTTP (XHR, ES5)
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
  function safeParseArray(json) {
    if (typeof json !== 'string') return [];
    try {
      var v = JSON.parse(json);
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
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
    // user:<nick> не триггерит 'users', чтобы не затирать массив
    if (key === BASE_KEYS.users || key === 'users' || key === 'accounts' || key === 'auth_users') return 'users';
    return null;
  }

  // --- Admin helpers (локальная нормализация)
  function ensureAdminInArray(users) {
    var arr = Array.isArray(users) ? users.slice() : [];
    var found = -1, i, u, n;
    for (i = 0; i < arr.length; i++) {
      u = arr[i] || {};
      n = String(u.nick || u.name || '').toLowerCase();
      if (n === ADMIN_NICK) { found = i; break; }
    }
    if (found === -1) arr.push(ADMIN_OBJ);
    else arr[found] = { nick: ADMIN_OBJ.nick, password: ADMIN_OBJ.password, role: ADMIN_OBJ.role };
    return arr;
  }
  function writeUsersMirrors(usersArr) {
    try { setLS('users', JSON.stringify(usersArr)); } catch (e) {}
    try { setLS('accounts', JSON.stringify(usersArr)); } catch (e) {}
    try { setLS('auth_users', JSON.stringify(usersArr)); } catch (e) {}
    // Словари и персональные записи — только top-down из массива
    var dict = {};
    for (var i = 0; i < usersArr.length; i++) {
      var u = usersArr[i] || {};
      var nick = String(u.nick || u.name || '').trim();
      if (nick) {
        dict[nick.toLowerCase()] = nick;
        try { setLS('user:' + nick, JSON.stringify(u)); } catch (e) {}
      }
    }
    try { setLS('users_lc', JSON.stringify(dict)); } catch (e) {}
    try { setLS('accounts_lc', JSON.stringify(dict)); } catch (e) {}
    // Жёстко дублируем корректный user:admin (на случай, если фронт портит)
    try { setLS('user:' + ADMIN_NICK, JSON.stringify(ADMIN_OBJ)); } catch (e) {}
  }

  // --- Mirrors
  function writeOrdersMirrors(arr) {
    try { setLS('my_orders', JSON.stringify(arr)); } catch (e) {}
  }
  function writeCatalogMirrors(productsArr) {
    try { setLS('products', JSON.stringify(productsArr)); } catch (e) {}
    try { setLS('goods', JSON.stringify(productsArr)); } catch (e) {}
    try { setLS('catalog', JSON.stringify(productsArr)); } catch (e) {}
  }

  // --- Debounced PUT
  function schedulePut(kind) {
    if (_debounceTimers[kind]) clearTimeout(_debounceTimers[kind]);
    _debounceTimers[kind] = setTimeout(function () {
      _debounceTimers[kind] = 0;
      doPut(kind);
    }, DEBOUNCE_MS);
  }
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
  function applyOrdersFromServer(ordersArr) {
    setLS(BASE_KEYS.orders, JSON.stringify(ordersArr || []));
    writeOrdersMirrors(ordersArr || []);
  }
  function applyBankFromServer(logArr) {
    setLS(BASE_KEYS.bank, JSON.stringify(logArr || []));
  }
  function applyUsersFromServer(usersArr) {
    var normalized = ensureAdminInArray(usersArr || []);
    setLS(BASE_KEYS.users, JSON.stringify(normalized));
    writeUsersMirrors(normalized);
  }

  // --- Intercept mutations
  localStorage.setItem = function (key, value) {
    var keyStr = String(key);
    var isSelf = _internalWriteNesting > 0;

    // «Защита админа»: любые попытки писать user:admin переписываем корректным объектом
    if (keyStr.slice(0, 5) === 'user:' && keyStr.slice(5).toLowerCase() === ADMIN_NICK) {
      _origSetItem.call(localStorage, key, JSON.stringify(ADMIN_OBJ));
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
    if (kind === 'bank') {
      schedulePut('bank');
      return;
    }
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

    // Не позволяем удалять user:admin; сразу восстанавливаем
    if (keyStr.slice(0, 5) === 'user:' && keyStr.slice(5).toLowerCase() === ADMIN_NICK) {
      _origSetItem.call(localStorage, key, JSON.stringify(ADMIN_OBJ));
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
    if (kind === 'orders') {
      setLS(BASE_KEYS.orders, JSON.stringify([]));
      writeOrdersMirrors([]);
      schedulePut('orders');
      return;
    }
    if (kind === 'bank') {
      setLS(BASE_KEYS.bank, JSON.stringify([]));
      schedulePut('bank');
      return;
    }
    if (kind === 'users') {
      var empty = ensureAdminInArray([]);
      setLS(BASE_KEYS.users, JSON.stringify(empty));
      writeUsersMirrors(empty);
      schedulePut('users');
      return;
    }
  };

  // --- Initial local hardening (до сетевых запросов)
  (function bootstrapLocalAdmin() {
    // Приводим локальный массив пользователей к норме
    var current = safeParseArray(getLS(BASE_KEYS.users) || '[]');
    var normalized = ensureAdminInArray(current);
    setLS(BASE_KEYS.users, JSON.stringify(normalized));
    writeUsersMirrors(normalized); // создаст user:admin и словари
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
        var server = JSON.stringify(ensureAdminInArray(d.users || []));
        if (!sameJson(local, server)) applyUsersFromServer(JSON.parse(server));
      }
    });
  }

  // Kick off
  initialSync();
  setInterval(periodicPull, PULL_INTERVAL_MS);
  try { setLS('sync_bridge_ver', JSON.stringify(BRIDGE_VER)); } catch (e) {}
})();
