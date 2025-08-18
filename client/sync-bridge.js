/* ES5-мост синхронизации localStorage ↔ /api
 * Подключать ПЕРЕД вашим app.js:
 * <script src="sync-bridge.js"></script>
 * <script src="app.js"></script>
 *
 * - Триггеры PUT только по ключам:
 *     shop_catalog, shop_cats, shop_orders, mock_bank
 * - Синонимы (shop_catalog_<nick>, products, goods, catalog, shop_orders_<nick>, my_orders) зеркалятся локально, без сетевых запросов.
 * - Периодический "лёгкий pull" каждые ~5 сек.
 */
(function () {
  'use strict';

  // Ключи
  var KEY_PRODUCTS = 'shop_catalog';
  var KEY_CATS     = 'shop_cats';
  var KEY_ORDERS   = 'shop_orders';
  var KEY_BANK     = 'mock_bank';

  var WATCH = {};
  WATCH[KEY_PRODUCTS] = true;
  WATCH[KEY_CATS]     = true;
  WATCH[KEY_ORDERS]   = true;
  WATCH[KEY_BANK]     = true;

  var PUT_DEBOUNCE_MS  = 300;
  var PULL_INTERVAL_MS = 5000;

  // Оригинальные методы localStorage
  var _setItem    = localStorage.setItem.bind(localStorage);
  var _removeItem = localStorage.removeItem.bind(localStorage);
  var _getItem    = localStorage.getItem.bind(localStorage);

  // Тихая запись
  function setLS_silent(key, jsonString) {
    try { _setItem(key, jsonString); } catch (e) {}
  }

  // Безопасно парсит массив или возвращает []
  function safeParse(s) {
    if (!s) return [];
    try {
      var v = JSON.parse(s);
      if (Object.prototype.toString.call(v) === '[object Array]') {
        return v;
      }
    } catch (e) {}
    return [];
  }

  function getArray(key) { return safeParse(_getItem(key)); }

  // Сравнение массивов через JSON
  function arraysEqual(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
  }

  // HTTP helpers
  function httpGet(path) {
    return fetch(path, { method: 'GET', cache: 'no-store' }).then(function (r) { return r.json(); });
  }
  function httpPut(path, body) {
    return fetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(body)
    })["catch"](function () { /* noop */ });
  }

  // Дебаунс PUSH'ей
  var timers = { catalog: null, orders: null, bank: null };

  function debouncePush(which) {
    if (timers[which]) clearTimeout(timers[which]);
    timers[which] = setTimeout(function () {
      timers[which] = null;
      if (which === 'catalog') pushCatalog();
      else if (which === 'orders') pushOrders();
      else if (which === 'bank') pushBank();
    }, PUT_DEBOUNCE_MS);
  }

  function pushCatalog() {
    httpPut('/api/catalog', {
      products: getArray(KEY_PRODUCTS),
      cats:     getArray(KEY_CATS)
    });
  }
  function pushOrders() {
    httpPut('/api/orders', {
      orders: getArray(KEY_ORDERS)
    });
  }
  function pushBank() {
    httpPut('/api/bank', {
      log: getArray(KEY_BANK)
    });
  }

  // Зеркала / синонимы (без push)
  function detectNick() {
    var cands = ['nick', 'username', 'user', 'login', 'account', 'profile_name'];
    for (var i = 0; i < cands.length; i++) {
      var v = _getItem(cands[i]);
      if (v && typeof v === 'string') {
        var cleaned = v.replace(/["']/g, '');
        if (cleaned) return cleaned;
      }
    }
    return null;
  }

  function writeCatalogMirrors(arr) {
    try {
      var s = JSON.stringify(arr);
      var nick = detectNick();
      if (nick) setLS_silent('shop_catalog_' + nick, s);
      setLS_silent('products', s);
      setLS_silent('goods', s);
      setLS_silent('catalog', s);
    } catch (e) {}
  }

  function writeOrdersMirrors(arr) {
    try {
      var s = JSON.stringify(arr);
      var nick = detectNick();
      if (nick) setLS_silent('shop_orders_' + nick, s);
      setLS_silent('my_orders', s);
    } catch (e) {}
  }

  // Подхватывает данные из альтернативных ключей (один раз при загрузке)
  function adoptFromAlternatesOnce() {
    try {
      if (_getItem(KEY_PRODUCTS) == null) {
        var p = safeParse(_getItem('products'));
        if (p.length) setLS_silent(KEY_PRODUCTS, JSON.stringify(p));
        var nick = detectNick();
        if (_getItem(KEY_PRODUCTS) == null && nick) {
          var pUser = safeParse(_getItem('shop_catalog_' + nick));
          if (pUser.length) setLS_silent(KEY_PRODUCTS, JSON.stringify(pUser));
        }
      }
      if (_getItem(KEY_ORDERS) == null) {
        var o = safeParse(_getItem('my_orders'));
        if (o.length) setLS_silent(KEY_ORDERS, JSON.stringify(o));
        var nick2 = detectNick();
        if (_getItem(KEY_ORDERS) == null && nick2) {
          var oUser = safeParse(_getItem('shop_orders_' + nick2));
          if (oUser.length) setLS_silent(KEY_ORDERS, JSON.stringify(oUser));
        }
      }
    } catch (e) {}
  }

  // Перехват localStorage.setItem/removeItem только для ключей из WATCH
  localStorage.setItem = function (key, value) {
    var r; try { r = _setItem(key, value); } catch (_) {}
    if (!WATCH[key]) {
      // Зеркала для синонимов без push
      if (key === 'products' || key === 'goods' || key === 'catalog') {
        try { setLS_silent(KEY_PRODUCTS, value); } catch (e) {}
      } else if (key === 'my_orders' || /^shop_orders_.+/.test(key)) {
        try { setLS_silent(KEY_ORDERS, value); } catch (e) {}
      }
      return r;
    }
    if (key === KEY_PRODUCTS || key === KEY_CATS) {
      debouncePush('catalog');
    } else if (key === KEY_ORDERS) {
      debouncePush('orders');
    } else if (key === KEY_BANK) {
      debouncePush('bank');
    }
    return r;
  };

  localStorage.removeItem = function (key) {
    var r; try { r = _removeItem(key); } catch (_) {}
    if (!WATCH[key]) return r;
    // При удалении отправляем пустой массив (не подменяем в localStorage)
    if (key === KEY_PRODUCTS || key === KEY_CATS) {
      debouncePush('catalog');
    } else if (key === KEY_ORDERS) {
      debouncePush('orders');
    } else if (key === KEY_BANK) {
      debouncePush('bank');
    }
    return r;
  };

  // Pull: раз в 5 сек сравнивает данные и обновляет localStorage
  function pullOnce() {
    // каталог
    httpGet('/api/catalog').then(function (j) {
      var svProducts = (j && j.products) || [];
      var svCats     = (j && j.cats)     || [];
      var curProd    = getArray(KEY_PRODUCTS);
      var curCats    = getArray(KEY_CATS);
      if (!arraysEqual(curProd, svProducts)) setLS_silent(KEY_PRODUCTS, JSON.stringify(svProducts));
      if (!arraysEqual(curCats, svCats))     setLS_silent(KEY_CATS, JSON.stringify(svCats));
      writeCatalogMirrors(svProducts);
    })["catch"](function () {});
    // заказы
    httpGet('/api/orders').then(function (j) {
      var svOrders  = (j && j.orders) || [];
      var curOrders = getArray(KEY_ORDERS);
      if (!arraysEqual(curOrders, svOrders)) setLS_silent(KEY_ORDERS, JSON.stringify(svOrders));
      writeOrdersMirrors(svOrders);
    })["catch"](function () {});
    // банк
    httpGet('/api/bank').then(function (j) {
      var svLog  = (j && j.log) || [];
      var curLog = getArray(KEY_BANK);
      if (!arraysEqual(curLog, svLog)) setLS_silent(KEY_BANK, JSON.stringify(svLog));
    })["catch"](function () {});
  }

  // Первичная инициализация
  adoptFromAlternatesOnce();
  pullOnce();
  setInterval(pullOnce, PULL_INTERVAL_MS);
})();
