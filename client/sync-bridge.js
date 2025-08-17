// ES5-only sync bridge for localStorage <-> server
(function () {
  var BRIDGE_VER = '1.0.0';

  // --- Config
  var PULL_INTERVAL_MS = 5000;  // лёгкий pull каждые ~5 сек
  var DEBOUNCE_MS = 300;        // дебаунс PUT
  var CATALOG_LOCK_MS = 60000;  // короткий лок после локальной правки каталога

  // --- Keys
  var BASE_KEYS = {
    orders: 'shop_orders',
    catalog: 'shop_catalog',
    cats: 'shop_cats',
    bank: 'mock_bank',
    users: 'shop_users'
  };

  // Mirrors: synonyms (static)
  var MIRRORS = {
    orders: ['my_orders'],
    catalog: ['products', 'goods', 'catalog'],
    users: ['users', 'accounts', 'auth_users']
    // bank: no mirrors by spec
  };

  // dynamic mirrors patterns
  function isOrdersUserKey(key) { return key.indexOf('shop_orders_') === 0; }
  function isCatalogUserKey(key) { return key.indexOf('shop_catalog_') === 0; }
  function isUserEntryKey(key) { return key.indexOf('user:') === 0; }

  // --- State
  var _origSetItem = localStorage.setItem;
  var _origRemoveItem = localStorage.removeItem;
  var _internalWriteNesting = 0;

  var _debounceTimers = { orders: 0, catalog: 0, bank: 0, users: 0 };
  var _catalogLocalTs = 0;       // последняя локальная правка каталога
  var _catalogEditLockUntil = 0; // до какого времени не затирать pull'ом

  // --- HTTP helpers (XHR, ES5)
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
      for (var k in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, k)) {
          xhr.setRequestHeader(k, headers[k]);
        }
      }
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        var data = null;
        try { data = JSON.parse(xhr.responseText || 'null'); } catch (e) {}
        cb(xhr.status, data, xhr);
      }
    };
    try {
      xhr.send(JSON.stringify(payload));
    } catch (e) {
      cb(0, null, xhr);
    }
  }

  // --- Utils
  function safeParseArray(json) {
    if (typeof json !== 'string') return [];
    try {
      var v = JSON.parse(json);
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function getLS(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function setLS(key, value) {
    // guard against recursion
    _internalWriteNesting++;
    try {
      _origSetItem.call(localStorage, key, value);
    } finally {
      _internalWriteNesting--;
    }
  }
  function removeLS(key) {
    _internalWriteNesting++;
    try {
      _origRemoveItem.call(localStorage, key);
    } finally {
      _internalWriteNesting--;
    }
  }
  function sameJson(a, b) { return String(a || '') === String(b || ''); }

  // --- Key classification -> kind
  function keyToKind(key) {
    if (!key) return null;
    if (key === BASE_KEYS.orders || key === 'my_orders' || isOrdersUserKey(key)) return 'orders';
    if (key === BASE_KEYS.catalog || key === BASE_KEYS.cats ||
        key === 'products' || key === 'goods' || key === 'catalog' ||
        isCatalogUserKey(key)) return 'catalog';
    if (key === BASE_KEYS.bank) return 'bank';
    if (key === BASE_KEYS.users || key === 'users' || key === 'accounts' || key === 'auth_users' || isUserEntryKey(key)) return 'users';
    return null;
  }

  // --- Mirror writers (best-effort, non-invasive)
  function writeOrdersMirrors(arr) {
    // base mirror
    try { setLS('my_orders', JSON.stringify(arr)); } catch (e) {}
    // dynamic mirrors are only listened to (we do not fan-out blindly per user)
  }

  function writeCatalogMirrors(productsArr) {
    try { setLS('products', JSON.stringify(productsArr)); } catch (e) {}
    try { setLS('goods', JSON.stringify(productsArr)); } catch (e) {}
    try { setLS('catalog', JSON.stringify(productsArr)); } catch (e) {}
    // dynamic mirrors are only listened to
  }

  function writeUsersMirrors(usersArr) {
    try { setLS('users', JSON.stringify(usersArr)); } catch (e) {}
    try { setLS('accounts', JSON.stringify(usersArr)); } catch (e) {}
    try { setLS('auth_users', JSON.stringify(usersArr)); } catch (e) {}
    // dictionaries: users_lc / accounts_lc map lowercased nick -> original nick
    var dict = {};
    for (var i = 0; i < usersArr.length; i++) {
      var u = usersArr[i] || {};
      var nick = String(u.nick || u.name || '').trim();
      if (nick) dict[nick.toLowerCase()] = nick;
      // user:<nick> -> JSON(user)
      if (nick) {
        try { setLS('user:' + nick, JSON.stringify(u)); } catch (e) {}
      }
    }
    try { setLS('users_lc', JSON.stringify(dict)); } catch (e) {}
    try { setLS('accounts_lc', JSON.stringify(dict)); } catch (e) {}
  }

  // --- Debounced PUT
  function schedulePut(kind) {
    if (_debounceTimers[kind]) {
      clearTimeout(_debounceTimers[kind]);
    }
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
        var serverTsHeader = xhr && xhr.getResponseHeader ? xhr.getResponseHeader('X-Shop-Ts') : null;
        if (status === 200 && data) {
          if (serverTsHeader) _catalogLocalTs = Number(serverTsHeader) || _catalogLocalTs;
        } else if (status === 409 && data && data.products && data.cats) {
          // сервер отверг — принимаем его данные
          applyCatalogFromServer(data.products, data.cats, serverTsHeader ? Number(serverTsHeader) : 0);
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

  // --- Apply from server (guarding recursion)
  function applyCatalogFromServer(productsArr, catsArr, serverTs) {
    if (typeof serverTs === 'number' && serverTs > 0) {
      _catalogLocalTs = serverTs;
    }
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

  // --- Intercept localStorage mutations
  localStorage.setItem = function (key, value) {
    var kind = keyToKind(String(key));
    var isSelf = _internalWriteNesting > 0;

    // Call original first (so app.js sees its own changes immediately)
    _origSetItem.call(localStorage, key, value);

    if (isSelf) return; // ignore bridge's own writes

    if (kind === 'catalog') {
      // любое изменение каталога/категорий/его зеркал — обновляем базовые ключи и планируем PUT
      if (key === BASE_KEYS.cats) {
        // normalize: ensure base 'shop_cats' already updated by original call
      } else if (key !== BASE_KEYS.catalog) {
        // mirrors changed -> fan-in to base
        var arr = safeParseArray(value);
        setLS(BASE_KEYS.catalog, JSON.stringify(arr));
        writeCatalogMirrors(arr);
      } else {
        // base changed by app
        writeCatalogMirrors(safeParseArray(value));
      }
      _catalogLocalTs = Date.now();
      _catalogEditLockUntil = _catalogLocalTs + CATALOG_LOCK_MS;
      schedulePut('catalog');
      return;
    }

    if (kind === 'orders') {
      if (key !== BASE_KEYS.orders) {
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
      // only base exists by spec
      schedulePut('bank');
      return;
    }

    if (kind === 'users') {
      if (key !== BASE_KEYS.users) {
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
    var kind = keyToKind(String(key));
    var isSelf = _internalWriteNesting > 0;

    _origRemoveItem.call(localStorage, key);

    if (isSelf) return;

    // Removing a monitored key => treat as empty array push (to keep server in sync)
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

  // --- Initial pull (blocking nothing; best-effort)
  function initialSync() {
    // catalog
    httpGet('/api/catalog', function (status, data, xhr) {
      if (status === 200 && data) {
        var serverTsHeader = xhr && xhr.getResponseHeader ? xhr.getResponseHeader('X-Shop-Ts') : null;
        var serverTs = serverTsHeader ? Number(serverTsHeader) : 0;

        var newProducts = JSON.stringify(data.products || []);
        var newCats = JSON.stringify(data.cats || []);
        setLS(BASE_KEYS.catalog, newProducts);
        setLS(BASE_KEYS.cats, newCats);
        writeCatalogMirrors(data.products || []);
        if (serverTs > 0) _catalogLocalTs = serverTs;
      }
    });

    // orders
    httpGet('/api/orders', function (status, data) {
      if (status === 200 && data) {
        applyOrdersFromServer(data.orders || []);
      }
    });

    // bank
    httpGet('/api/bank', function (status, data) {
      if (status === 200 && data) {
        applyBankFromServer(data.log || []);
      }
    });

    // users
    httpGet('/api/users', function (status, data) {
      if (status === 200 && data) {
        applyUsersFromServer(data.users || []);
      }
    });
  }

  // --- Periodic light pull
  function periodicPull() {
    // Catalog (respect short edit-lock)
    httpGet('/api/catalog', function (status, data, xhr) {
      if (status === 200 && data) {
        if (Date.now() < _catalogEditLockUntil) {
          return; // недавно редактировали локально — не трогаем
        }
        var serverTsHeader = xhr && xhr.getResponseHeader ? xhr.getResponseHeader('X-Shop-Ts') : null;
        var serverTs = serverTsHeader ? Number(serverTsHeader) : 0;

        var localProducts = getLS(BASE_KEYS.catalog) || '[]';
        var localCats = getLS(BASE_KEYS.cats) || '[]';

        var serverProducts = JSON.stringify(data.products || []);
        var serverCats = JSON.stringify(data.cats || []);

        if (!sameJson(localProducts, serverProducts) || !sameJson(localCats, serverCats)) {
          applyCatalogFromServer(data.products || [], data.cats || [], serverTs);
        } else {
          if (serverTs > 0) _catalogLocalTs = serverTs;
        }
      }
    });

    // Orders
    httpGet('/api/orders', function (status, data) {
      if (status === 200 && data) {
        var local = getLS(BASE_KEYS.orders) || '[]';
        var server = JSON.stringify(data.orders || []);
        if (!sameJson(local, server)) applyOrdersFromServer(data.orders || []);
      }
    });

    // Bank
    httpGet('/api/bank', function (status, data) {
      if (status === 200 && data) {
        var local = getLS(BASE_KEYS.bank) || '[]';
        var server = JSON.stringify(data.log || []);
        if (!sameJson(local, server)) applyBankFromServer(data.log || []);
      }
    });

    // Users
    httpGet('/api/users', function (status, data) {
      if (status === 200 && data) {
        var local = getLS(BASE_KEYS.users) || '[]';
        var server = JSON.stringify(data.users || []);
        if (!sameJson(local, server)) applyUsersFromServer(data.users || []);
      }
    });
  }

  // Kick off
  initialSync();
  setInterval(periodicPull, PULL_INTERVAL_MS);

  // Expose a tiny debug flag (optional, harmless)
  try { setLS('sync_bridge_ver', JSON.stringify(BRIDGE_VER)); } catch (e) {}
})();
