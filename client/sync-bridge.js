// ES5-only sync bridge for localStorage <-> server
(function () {
  var BRIDGE_VER = '1.0.1';

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
    if (headers) {
      for (var k in headers) if (Object.prototype.hasOwnProperty.call(headers, k)) xhr.setRequestHeader(k, headers[k]);
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        var data = null;
        try { data = JSON.parse(xhr.responseText || 'null'); } catch (e) {}
        cb(xhr.status, data, xhr);
      }
    };
    try { xhr.send(JSON.stringify(payload)); } catch (e) { cb(0, null, xhr); }
  }

  function safeParseArray(json) {
    if (typeof json !== 'string') return [];
    try {
      var v = JSON.parse(json);
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function getLS(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function setLS(key, value) {
    _internalWriteNesting++;
    try { _origSetItem.call(localStorage, key, value); } finally { _internalWriteNesting--; }
  }
  function removeLS(key) {
    _internalWriteNesting++;
    try { _origRemoveItem.call(localStorage, key); } finally { _internalWriteNesting--; }
  }
  function sameJson(a, b) { return String(a || '') === String(b || ''); }

  // Классификация ключей
  function keyToKind(key) {
    if (!key) return null;
    if (key === BASE_KEYS.orders || key === 'my_orders' || isOrdersUserKey(key)) return 'orders';
    if (key === BASE_KEYS.catalog || key === BASE_KEYS.cats ||
        key === 'products' || key === 'goods' || key === 'catalog' || isCatalogUserKey(key)) return 'catalog';
    if (key === BASE_KEYS.bank) return 'bank';
    // ВАЖНО: user:<nick> — не считаем триггером 'users' (чтобы не затирать массив пользователей)
    if (key === BASE_KEYS.users || key === 'users' || key === 'accounts' || key === 'auth_users') return 'users';
    return null;
  }

  function writeOrdersMirrors(arr) {
    try { setLS('my_orders', JSON.stringify(arr)); } catch (e) {}
  }
  function writeCatalogMirrors(productsArr) {
    try { setLS('products', JSON.stringify(productsArr)); } catch (e) {}
    try { setLS('goods', JSON.stringify(productsArr)); } catch (e) {}
    try { setLS('catalog', JSON.stringify(productsArr)); } catch (e) {}
  }
  function writeUsersMirrors(usersArr) {
    try { setLS('users', JSON.stringify(usersArr)); } catch (e) {}
    try { setLS('accounts', JSON.stringify(usersArr)); } catch (e) {}
    try { setLS('auth_users', JSON.stringify(usersArr)); } catch (e) {}
    // Словари и user:<nick> публикуем только из общего массива (top-down)
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
  }

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
        if (status === 200 && data) {
          if (h) _catalogLocalTs = Number(h) || _catalogLocalTs;
        } else if (status === 409 && data && data.products && data.cats) {
          applyCatalogFromServer(data.products, data.cats, h ? Number(h) : 0);
        }
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
      var users = safeParseArray(getLS(BASE_KEYS.users) || '[]');
      httpPut('/api/users', { users: users }, null, function () {});
      return;
    }
  }

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
    setLS(BASE_KEYS.users, JSON.stringify(usersArr || []));
    writeUsersMirrors(usersArr || []);
  }

  localStorage.setItem = function (key, value) {
    var isSelf = _internalWriteNesting > 0;
    var keyStr = String(key);
    var kind = keyToKind(keyStr);

    _origSetItem.call(localStorage, key, value);
    if (isSelf) return;

    // Специально игнорируем per-user записи
    if (keyStr.slice(0, 5) === 'user:') return;

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
      if (keyStr !== BASE_KEYS.users) {
        var usersFromMirror = safeParseArray(value);
        setLS(BASE_KEYS.users, JSON.stringify(usersFromMirror));
        writeUsersMirrors(usersFromMirror);
      } else {
        writeUsersMirrors(safeParseArray(value));
      }
      schedulePut('users');
      return;
    }
  };

  localStorage.removeItem = function (key) {
    var isSelf = _internalWriteNesting > 0;
    var keyStr = String(key);
    var kind = keyToKind(keyStr);

    _origRemoveItem.call(localStorage, key);
    if (isSelf) return;

    // Игнор per-user удалений
    if (keyStr.slice(0, 5) === 'user:') return;

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
      setLS(BASE_KEYS.users, JSON.stringify([]));
      writeUsersMirrors([]);
      schedulePut('users');
      return;
    }
  };

  function initialSync() {
    httpGet('/api/catalog', function (status, data, xhr) {
      if (status === 200 && data) {
        var h = xhr && xhr.getResponseHeader ? xhr.getResponseHeader('X-Shop-Ts') : null;
        var ts = h ? Number(h) : 0;
        setLS(BASE_KEYS.catalog, JSON.stringify(data.products || []));
        setLS(BASE_KEYS.cats, JSON.stringify(data.cats || []));
        writeCatalogMirrors(data.products || []);
        if (ts > 0) _catalogLocalTs = ts;
      }
    });
    httpGet('/api/orders', function (s, d) { if (s === 200 && d) applyOrdersFromServer(d.orders || []); });
    httpGet('/api/bank',   function (s, d) { if (s === 200 && d) applyBankFromServer(d.log || []); });
    httpGet('/api/users',  function (s, d) { if (s === 200 && d) applyUsersFromServer(d.users || []); });
  }

  function periodicPull() {
    httpGet('/api/catalog', function (status, data, xhr) {
      if (status === 200 && data) {
        if (Date.now() < _catalogEditLockUntil) return;
        var h = xhr && xhr.getResponseHeader ? xhr.getResponseHeader('X-Shop-Ts') : null;
        var ts = h ? Number(h) : 0;

        var lp = getLS(BASE_KEYS.catalog) || '[]';
        var lc = getLS(BASE_KEYS.cats) || '[]';
        var sp = JSON.stringify(data.products || []);
        var sc = JSON.stringify(data.cats || []);

        if (!sameJson(lp, sp) || !sameJson(lc, sc)) {
          applyCatalogFromServer(data.products || [], data.cats || [], ts);
        } else {
          if (ts > 0) _catalogLocalTs = ts;
        }
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
        var server = JSON.stringify(d.users || []);
        if (!sameJson(local, server)) applyUsersFromServer(d.users || []);
      }
    });
  }

  initialSync();
  setInterval(periodicPull, PULL_INTERVAL_MS);
  try { setLS('sync_bridge_ver', JSON.stringify(BRIDGE_VER)); } catch (e) {}
})();
