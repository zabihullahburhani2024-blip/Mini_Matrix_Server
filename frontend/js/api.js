/**
 * Mini Matrix — Market data client
 *
 * Production: connects to Mini Matrix Backend WebSocket (/ws)
 * which holds the single Twelve Data connection.
 *
 * The Twelve Data API key NEVER appears in the frontend.
 *
 * Fallback: if backend is unreachable, last known price from localStorage is kept.
 */
(function (global) {
  'use strict';

  var TOGGLE_KEY = 'mm_api_auto_on';
  var autoOn = false;
  var wsClient = null;
  var remaining = 999999;

  function loadToggle() {
    autoOn = localStorage.getItem(TOGGLE_KEY) !== '0';
    return autoOn;
  }

  function setAutoOn(on) {
    autoOn = !!on;
    localStorage.setItem(TOGGLE_KEY, autoOn ? '1' : '0');
    if (autoOn) start(global.MM_API_onPrice, global.MM_API_onError, global.MM_API_onQuota);
    else stop();
    return autoOn;
  }

  function isAutoOn() { return autoOn; }
  function getRemaining() { return remaining; }

  function start(onPrice, onError, onQuota) {
    stop();
    if (!autoOn) return;
    global.MM_API_onPrice = onPrice;
    global.MM_API_onError = onError;
    global.MM_API_onQuota = onQuota;

    if (!global.MM_WS) {
      if (onError) onError(new Error('WS client not loaded'));
      return;
    }

    wsClient = MM_WS.createClient({
      onPrice: function (price) {
        if (onPrice) onPrice(price);
        if (onQuota) onQuota(remaining);
      },
      onConnection: function (connected) {
        if (!connected && onError) {
          onError(new Error('backend disconnected'));
        }
      }
    });
    wsClient.connect();
  }

  function stop() {
    if (wsClient) {
      wsClient.disconnect();
      wsClient = null;
    }
  }

  function fetchPrice() {
    var base = (global.MM_API_BASE || '').replace(/\/$/, '');
    var url = (base || '') + '/api/price';
    if (!base && location.port !== '8000') {
      url = 'http://' + (location.hostname || '127.0.0.1') + ':8000/api/price';
    }
    return fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var price = data && data.price != null ? parseFloat(data.price) : NaN;
        if (!isFinite(price) || price <= 0) throw new Error('invalid price');
        return price;
      });
  }

  function fetchSeries() {
    return Promise.resolve([]);
  }

  function fetchForexComPrice() {
    var url = 'https://scanner.tradingview.com/symbol?symbol=FOREXCOM%3AXAUUSD&fields=close,bid,ask';
    return fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var mid = null;
        if (data && typeof data.bid === 'number' && typeof data.ask === 'number') {
          mid = (data.bid + data.ask) / 2;
        } else if (data && typeof data.close === 'number') {
          mid = data.close;
        }
        if (!isFinite(mid) || mid <= 0) throw new Error('invalid FOREXCOM price');
        return { price: mid, bid: data.bid, ask: data.ask, close: data.close, source: 'FOREXCOM' };
      });
  }

  loadToggle();

  global.MM_API = {
    REFRESH_MS: 0,
    FREE_QUOTA_TOTAL: 999999,
    loadQuota: function () {},
    getRemaining: getRemaining,
    loadToggle: loadToggle,
    setAutoOn: setAutoOn,
    isAutoOn: isAutoOn,
    start: start,
    stop: stop,
    fetchPrice: fetchPrice,
    fetchSeries: fetchSeries,
    fetchForexComPrice: fetchForexComPrice
  };
})(window);
