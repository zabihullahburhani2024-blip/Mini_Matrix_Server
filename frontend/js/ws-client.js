/**
 * Mini Matrix — Backend WebSocket client
 * Connects to our FastAPI /ws endpoint (NOT directly to Twelve Data).
 * Updates window.MM_STATE.goldPrice on every market_update.
 */
(function (global) {
  'use strict';

  var DEFAULT_WS_URL = (function () {
    // Auto-detect: same host, port 8000 in dev, or configured
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var host = location.hostname || '127.0.0.1';
    // If frontend is served from backend static or same origin
    if (location.port && location.port !== '8000') {
      return proto + '//' + host + ':8000/ws';
    }
    return proto + '//' + host + (location.port ? ':' + location.port : '') + '/ws';
  })();

  var RECONNECT_BASE_MS = 1000;
  var RECONNECT_MAX_MS = 30000;
  var PING_INTERVAL_MS = 25000;

  function createClient(options) {
    options = options || {};
    var url = options.url || global.MM_WS_URL || DEFAULT_WS_URL;
    var token = options.token || global.MM_CLIENT_TOKEN || '';
    var onPrice = options.onPrice || null;
    var onStatus = options.onStatus || null;
    var onConnection = options.onConnection || null;

    var ws = null;
    var reconnectAttempt = 0;
    var closedByUser = false;
    var pingTimer = null;
    var state = {
      connected: false,
      lastPrice: null,
      lastUpdate: null,
      tdConnected: false,
      clientCount: 0,
      updateCount: 0
    };

    function fullUrl() {
      if (!token) return url;
      var sep = url.indexOf('?') >= 0 ? '&' : '?';
      return url + sep + 'token=' + encodeURIComponent(token);
    }

    function setConnected(v) {
      state.connected = v;
      if (onConnection) onConnection(v, state);
    }

    function scheduleReconnect() {
      if (closedByUser) return;
      var delay = Math.min(RECONNECT_BASE_MS * Math.pow(1.6, reconnectAttempt), RECONNECT_MAX_MS);
      reconnectAttempt += 1;
      setTimeout(connect, delay);
    }

    function startPing() {
      stopPing();
      pingTimer = setInterval(function () {
        if (ws && ws.readyState === 1) {
          try { ws.send(JSON.stringify({ type: 'ping' })); } catch (e) {}
        }
      }, PING_INTERVAL_MS);
    }

    function stopPing() {
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    }

    function handleMessage(raw) {
      var msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }

      if (msg.type === 'market_update') {
        var price = parseFloat(msg.price);
        if (isFinite(price) && price > 0) {
          state.lastPrice = price;
          state.lastUpdate = msg.received_at || Date.now() / 1000;
          state.updateCount = msg.update_count || state.updateCount;
          if (onPrice) onPrice(price, msg);
        }
      } else if (msg.type === 'status') {
        state.tdConnected = !!msg.td_connected;
        state.clientCount = msg.client_count || 0;
        state.updateCount = msg.update_count || 0;
        if (msg.last_price != null) {
          var p = parseFloat(msg.last_price);
          if (isFinite(p) && p > 0) {
            state.lastPrice = p;
            state.lastUpdate = msg.last_received_at;
            if (onPrice) onPrice(p, msg);
          }
        }
        if (onStatus) onStatus(msg, state);
      } else if (msg.type === 'pong') {
        // ok
      } else if (msg.type === 'error') {
        console.warn('[MM_WS] server error:', msg.message);
      }
    }

    function connect() {
      if (closedByUser) return;
      try {
        ws = new WebSocket(fullUrl());
      } catch (e) {
        scheduleReconnect();
        return;
      }

      ws.onopen = function () {
        reconnectAttempt = 0;
        setConnected(true);
        startPing();
      };

      ws.onmessage = function (ev) {
        handleMessage(ev.data);
      };

      ws.onclose = function () {
        stopPing();
        setConnected(false);
        scheduleReconnect();
      };

      ws.onerror = function () {
        // onclose will fire
      };
    }

    function disconnect() {
      closedByUser = true;
      stopPing();
      if (ws) {
        try { ws.close(); } catch (e) {}
        ws = null;
      }
      setConnected(false);
    }

    function getState() { return state; }

    return {
      connect: connect,
      disconnect: disconnect,
      getState: getState
    };
  }

  global.MM_WS = {
    createClient: createClient,
    DEFAULT_WS_URL: DEFAULT_WS_URL
  };
})(window);
