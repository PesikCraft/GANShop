/* ES5 sync bridge: перехватывает localStorage и синхронизирует с сервером,
 * не ломая логику фронтенда.
 *
 * Изменения:
 * 1. Триггеры PUT только по четырём ключам:
 *    shop_catalog, shop_cats, shop_orders, mock_bank.
 *    Синонимы (shop_catalog_<nick>, products, goods, catalog, my_orders и т. д.)
 *    обновляются локально, но не вызывают сетевой запрос.
 * 2. Введён флаг pending: пока есть несинхронизированные изменения,
 *    периодический pull с сервера не перезаписывает локальные данные.
 */

(function () {
  if (!window || !window.localStorage) return;

  var KEY_PRODUCTS = 'shop_catalog';
  var KEY_CATS = 'shop_cats';
  var KEY_ORDERS = 'shop_orders';
  var KEY_BANK = 'mock_bank';

  var SYN_ORDERS_STATIC  = ['my_orders'];
  var SYN_CATALOG_STATIC = ['products', 'goods', 'catalog'];

  var PULL_INTERVAL_MS = 5000;
  var PUT_DEBOUNCE_MS  = 300;

  function parseJsonArray(s) {
    if (!s) return [];
    try {
      var v = JSON.parse(s);
      return Array.isArray(v) ? v : [];
    } catch (_) {
      return [];
    }
  }
  function stringify(v) {
    try {
      return JSON.stringify(v);
    } catch (_) {
      return '[]';
    }
  }
  function eqArr(a, b) {
    return stringify(a) === stringify(b);
  }

  // Простая обёртка для fetch/XMLHttpRequest
  function request(method, url, body) {
    if (window.fetch) {
      var opt = { method: method, headers: { 'Content-Type': 'application/json' } };
      if (body) opt.body = JSON.stringify(body);
      return fetch(url, opt).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    }
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open(method, url, true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.onreadystatechange = function () {
        if (x.readyState === 4) {
          if (x.status >= 200 && x.status < 300) {
            try {
              resolve(JSON.parse(x.responseText || '{}'));
            } catch (_) {
              resolve({});
            }
          } else {
            reject(new Error('HTTP ' + x.status));
          }
        }
      };
      x.onerror = function () {
        reject(new Error('Network'));
      };
      x.send(body ? JSON.stringify(body) : null);
    });
  }

  function listKeysByPrefix(prefix) {
    var r = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(prefix) === 0) r.push(k);
      }
    } catch (_) {}
    return r;
  }
  function isOrdersSynonym(k) {
    if (!k) return false;
    if (SYN_ORDERS_STATIC.indexOf(k) !== -1) return true;
    return k.indexOf('shop_orders_') === 0;
  }
  function isCatalogSynonym(k) {
    if (!k) return false;
    if (SYN_CATALOG_STATIC.indexOf(k) !== -1) return true;
    return k.indexOf('shop_catalog_') === 0;
  }

  // Для тихих операций, чтобы не возникала рекурсия
  var silent = {};
  function setSilent(k, v) {
    silent[k] = v ? 1 : 0;
  }
  function isSilent(k) {
    return !!silent[k];
  }

  var _set = localStorage.setItem.bind(localStorage);
  var _rem = localStorage.removeItem.bind(localStorage);

  function setLS(k, v) {
    setSilent(k, true);
    try {
      _set(k, v);
    } catch (_) {}
    setSilent(k, false);
  }

  // Данные о незавершённой синхронизации: пока true, не применяем pull
  var timers  = { catalog: null, orders: null, bank: null };
  var pending = { catalog: false, orders: false, bank: false };

  function schedulePush(group) {
    if (timers[group]) {
      clearTimeout(timers[group]);
      timers[group] = null;
    }
    // Поставим флаг: есть несинхронизированные изменения
    pending[group] = true;
    timers[group] = setTimeout(function () {
      var prom;
      if (group === 'catalog') {
        var products = parseJsonArray(localStorage.getItem(KEY_PRODUCTS));
        var cats     = parseJsonArray(localStorage.getItem(KEY_CATS));
        prom = request('PUT', '/api/catalog', { products: products, cats: cats });
      } else if (group === 'orders') {
        var orders = parseJsonArray(localStorage.getItem(KEY_ORDERS));
        prom = request('PUT', '/api/orders', { orders: orders });
      } else if (group === 'bank') {
        var log = parseJsonArray(localStorage.getItem(KEY_BANK));
        prom = request('PUT', '/api/bank', { log: log });
      } else {
        prom = Promise.resolve();
      }
      (prom || Promise.resolve())['catch'](function () {}).then(function () {
        // после завершения попытки снимаем pending
        pending[group] = false;
      });
    }, PUT_DEBOUNCE_MS);
  }

  // Зеркалирование: из основного значения в синонимы
  function mirrorFromPrimary() {
    var ordStr = localStorage.getItem(KEY_ORDERS) || '[]';
    setLS('my_orders', ordStr);
    var pref = listKeysByPrefix('shop_orders_');
    for (var i = 0; i < pref.length; i++) {
      setLS(pref[i], ordStr);
    }

    var prodStr = localStorage.getItem(KEY_PRODUCTS) || '[]';
    setLS('products', prodStr);
    setLS('goods',    prodStr);
    setLS('catalog',  prodStr);
    var pref2 = listKeysByPrefix('shop_catalog_');
    for (var j = 0; j < pref2.length; j++) {
      setLS(pref2[j], prodStr);
    }
  }

  // Если пишут в синоним, копируем в первичный ключ
  function copyToPrimaryIfSynonym(key) {
    var v = localStorage.getItem(key);
    if (isOrdersSynonym(key)) setLS(KEY_ORDERS, v || '[]');
    if (isCatalogSynonym(key)) setLS(KEY_PRODUCTS, v || '[]');
  }

  // Переопределяем localStorage.setItem
  localStorage.setItem = function (key, value) {
    var r;
    try {
      r = _set(key, value);
    } catch (_) {}
    if (!isSilent(key)) {
      // Обновить primary при изменении синонимов
      if (isOrdersSynonym(key) || isCatalogSynonym(key)) copyToPrimaryIfSynonym(key);
      // Триггерить PUT только по 4 основным ключам
      if (key === KEY_PRODUCTS || key === KEY_CATS) {
        schedulePush('catalog');
      } else if (key === KEY_ORDERS) {
        schedulePush('orders');
      } else if (key === KEY_BANK) {
        schedulePush('bank');
      }
    }
    return r;
  };

  // Переопределяем localStorage.removeItem
  localStorage.removeItem = function (key) {
    var r;
    try {
      r = _rem(key);
    } catch (_) {}
    if (!isSilent(key)) {
      // Для основных ключей отправляем на сервер пустой массив
      if (key === KEY_PRODUCTS || key === KEY_CATS) {
        setLS(KEY_PRODUCTS, '[]');
        if (key === KEY_CATS) setLS(KEY_CATS, '[]');
        schedulePush('catalog');
      } else if (key === KEY_ORDERS) {
        setLS(KEY_ORDERS, '[]');
        schedulePush('orders');
      } else if (key === KEY_BANK) {
        setLS(KEY_BANK, '[]');
        schedulePush('bank');
      } else {
        // Синонимы не триггерят PUT, только очищают основное значение локально
        if (isCatalogSynonym(key)) setLS(KEY_PRODUCTS, '[]');
        if (isOrdersSynonym(key))  setLS(KEY_ORDERS,   '[]');
      }
    }
    return r;
  };

  // Начальное чтение с сервера
  function initialPull() {
    request('GET', '/api/catalog').then(function (d) {
      var cats  = Array.isArray(d && d.cats)     ? d.cats     : [];
      var prods = Array.isArray(d && d.products) ? d.products : [];
      // не перезаписываем, если локальные изменения ещё не отправлены
      if (!pending.catalog) {
        if (!eqArr(parseJsonArray(localStorage.getItem(KEY_CATS)), cats)) {
          setLS(KEY_CATS, stringify(cats));
        }
        if (!eqArr(parseJsonArray(localStorage.getItem(KEY_PRODUCTS)), prods)) {
          setLS(KEY_PRODUCTS, stringify(prods));
        }
        mirrorFromPrimary();
      }
    })['catch'](function () {});
    request('GET', '/api/orders').then(function (d) {
      var orders = Array.isArray(d && d.orders) ? d.orders : [];
      if (!pending.orders) {
        if (!eqArr(parseJsonArray(localStorage.getItem(KEY_ORDERS)), orders)) {
          setLS(KEY_ORDERS, stringify(orders));
        }
        mirrorFromPrimary();
      }
    })['catch'](function () {});
    request('GET', '/api/bank').then(function (d) {
      var log = Array.isArray(d && d.log) ? d.log : [];
      if (!pending.bank) {
        if (!eqArr(parseJsonArray(localStorage.getItem(KEY_BANK)), log)) {
          setLS(KEY_BANK, stringify(log));
        }
      }
    })['catch'](function () {});
  }

  // Периодический pull без перезаписи локальных данных при несинхронизированных изменениях
  function startPolling() {
    setInterval(function () {
      request('GET', '/api/catalog').then(function (d) {
        var cats  = Array.isArray(d && d.cats)     ? d.cats     : [];
        var prods = Array.isArray(d && d.products) ? d.products : [];
        if (!pending.catalog) {
          if (!eqArr(parseJsonArray(localStorage.getItem(KEY_CATS)), cats)) {
            setLS(KEY_CATS, stringify(cats));
          }
          if (!eqArr(parseJsonArray(localStorage.getItem(KEY_PRODUCTS)), prods)) {
            setLS(KEY_PRODUCTS, stringify(prods));
          }
          mirrorFromPrimary();
        }
      })['catch'](function () {});
      request('GET', '/api/orders').then(function (d) {
        var orders = Array.isArray(d && d.orders) ? d.orders : [];
        if (!pending.orders) {
          if (!eqArr(parseJsonArray(localStorage.getItem(KEY_ORDERS)), orders)) {
            setLS(KEY_ORDERS, stringify(orders));
          }
          mirrorFromPrimary();
        }
      })['catch'](function () {});
      request('GET', '/api/bank').then(function (d) {
        var log = Array.isArray(d && d.log) ? d.log : [];
        if (!pending.bank) {
          if (!eqArr(parseJsonArray(localStorage.getItem(KEY_BANK)), log)) {
            setLS(KEY_BANK, stringify(log));
          }
        }
      })['catch'](function () {});
    }, PULL_INTERVAL_MS);
  }

  initialPull();
  startPolling();
})();
