/**
 * Mini Matrix — Jewelry (زیورات) page logic
 */
(function () {
  'use strict';

  var G = window.MM_GOLD;
  var ouncePrice = null;
  var usdAfn = 68;
  var wsClient = null;

  function $(id) { return document.getElementById(id); }
  function fmt(n, d) {
    d = d == null ? 2 : d;
    return (typeof n === 'number' && isFinite(n))
      ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
      : '—';
  }
  function fmtMoney(n) {
    return (typeof n === 'number' && isFinite(n)) ? '$' + fmt(n, 2) : '—';
  }
  function fmtAfn(n) {
    return (typeof n === 'number' && isFinite(n))
      ? Math.round(n).toLocaleString('en-US') + ' AFN'
      : '—';
  }

  function getRate() {
    var v = parseFloat($('usdAfnRate').value);
    return isFinite(v) && v > 0 ? v : null;
  }

  function isUsed() {
    var r = document.querySelector('input[name="goldType"]:checked');
    return r && r.value === 'used';
  }

  // ---- Purchase ----
  function recalcPurchase() {
    var w = parseFloat($('pWeight').value);
    var k = parseFloat($('pKarat').value);
    var ded = isUsed() ? parseFloat($('pDeduct').value) : 0;
    var rate = getRate();
    var err = G.validatePurchase(w, k, ded, rate);
    $('pError').textContent = err || '';
    if (err || ouncePrice == null) {
      ['pEqWeight','pPpg','pGross','pDeductUsd','pNet','pAfn'].forEach(function (id) {
        $(id).textContent = '—';
      });
      return;
    }
    var r = G.purchaseValue(w, k, ouncePrice, isUsed() ? ded : 0);
    if (!r) return;
    $('pEqWeight').textContent = fmt(r.equivalentWeight, 4) + ' g';
    $('pPpg').textContent = fmtMoney(r.pricePerGram);
    $('pGross').textContent = fmtMoney(r.grossUsd);
    $('pDeductUsd').textContent = fmtMoney(r.deductionUsd);
    $('pNet').textContent = fmtMoney(r.netUsd);
    var afn = G.convertUsdToAfn(r.netUsd, rate);
    $('pAfn').textContent = fmtAfn(afn);
    $('pDeductRow').style.display = isUsed() ? 'flex' : 'none';
  }

  // ---- Sale ----
  function recalcSale() {
    var w = parseFloat($('sWeight').value);
    var k = parseFloat($('sKarat').value);
    var rate = getRate();
    var err = G.validatePurchase(w, k, 0, rate);
    $('sError').textContent = err || '';
    if (err || ouncePrice == null) {
      ['sEqWeight','sPpg','sUsd','sAfn'].forEach(function (id) { $(id).textContent = '—'; });
      return;
    }
    var r = G.saleValue(w, k, ouncePrice);
    if (!r) return;
    $('sEqWeight').textContent = fmt(r.equivalentWeight, 4) + ' g';
    $('sPpg').textContent = fmtMoney(r.pricePerGram);
    $('sUsd').textContent = fmtMoney(r.netUsd);
    $('sAfn').textContent = fmtAfn(G.convertUsdToAfn(r.netUsd, rate));
  }

  // ---- Mithqal ----
  function recalcMithqal() {
    if (ouncePrice == null) {
      ['mPpg','mUsd','mAfn'].forEach(function (id) { $(id).textContent = '—'; });
      return;
    }
    var r = G.mithqalPrice(ouncePrice);
    var rate = getRate();
    $('mPpg').textContent = fmtMoney(r.pricePerGram);
    $('mUsd').textContent = fmtMoney(r.usd);
    $('mAfn').textContent = fmtAfn(G.convertUsdToAfn(r.usd, rate));
  }

  // ---- Barg ----
  function recalcBarg() {
    var w = parseFloat($('bWeight').value);
    if (ouncePrice == null || !isFinite(w) || w <= 0) {
      ['bPpg','bUsd','bAfn'].forEach(function (id) { $(id).textContent = '—'; });
      return;
    }
    var r = G.unitPrice(w, ouncePrice);
    var rate = getRate();
    $('bPpg').textContent = fmtMoney(r.pricePerGram);
    $('bUsd').textContent = fmtMoney(r.usd);
    $('bAfn').textContent = fmtAfn(G.convertUsdToAfn(r.usd, rate));
  }

  function recalcAll() {
    var ppg = G.pricePerGram23_88(ouncePrice);
    $('liveOunce').textContent = ouncePrice != null ? '$' + fmt(ouncePrice, 2) : '—';
    $('liveGram').textContent = ppg != null ? '$' + fmt(ppg, 4) : '—';
    recalcPurchase();
    recalcSale();
    recalcMithqal();
    recalcBarg();
    updateDebug();
  }

  function onPrice(price) {
    ouncePrice = price;
    if (window.MM_STATE) window.MM_STATE.goldPrice = price;
    recalcAll();
  }

  function onConnection(connected) {
    var dot = $('connDot');
    var lab = $('connLabel');
    if (connected) {
      dot.className = 'conn-dot on';
      lab.textContent = 'متصل';
    } else {
      dot.className = 'conn-dot off';
      lab.textContent = 'قطع';
    }
  }

  function updateDebug() {
    var pre = $('debugPre');
    if (!pre || $('debugPanel').style.display === 'none') return;
    var st = wsClient ? wsClient.getState() : {};
    pre.textContent = JSON.stringify({
      ounce: ouncePrice,
      usdAfn: getRate(),
      ws: st
    }, null, 2);
  }

  // Tabs
  function showPanel(name) {
    ['purchase','sale','mithqal','barg'].forEach(function (p) {
      var el = $('panel-' + p);
      if (el) el.style.display = p === name ? 'block' : 'none';
    });
    document.querySelectorAll('#jTabs button').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-panel') === name);
    });
  }

  function bind() {
    document.querySelectorAll('#jTabs button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showPanel(btn.getAttribute('data-panel'));
      });
    });

    document.querySelectorAll('input[name="goldType"]').forEach(function (r) {
      r.addEventListener('change', function () {
        $('deductRow').style.display = isUsed() ? 'block' : 'none';
        $('pDeductRow').style.display = isUsed() ? 'flex' : 'none';
        recalcPurchase();
      });
    });

    ['pWeight','pKarat','pDeduct','sWeight','sKarat','bWeight','usdAfnRate'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', recalcAll);
    });

    // Theme / lang
    var theme = localStorage.getItem('mm_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    $('themeToggle').onclick = function () {
      var n = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', n);
      localStorage.setItem('mm_theme', n);
    };
    var lang = localStorage.getItem('mm_lang') || 'fa';
    $('langSelect').value = lang;
    $('langSelect').onchange = function () {
      localStorage.setItem('mm_lang', this.value);
    };

    // Saved rate
    var savedRate = localStorage.getItem('mm_usd_afn');
    if (savedRate) $('usdAfnRate').value = savedRate;
    $('usdAfnRate').addEventListener('change', function () {
      localStorage.setItem('mm_usd_afn', this.value);
    });

    if (location.search.indexOf('debug=1') >= 0) {
      $('debugPanel').style.display = 'block';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    bind();
    // Prefer backend WebSocket; fall back to last known price from localStorage
    var last = localStorage.getItem('mm_manual_gold_price');
    if (last) {
      var p = parseFloat(last);
      if (isFinite(p) && p > 0) onPrice(p);
    }

    wsClient = MM_WS.createClient({
      onPrice: function (price) {
        onPrice(price);
        localStorage.setItem('mm_manual_gold_price', String(price));
      },
      onConnection: onConnection,
      onStatus: function () { updateDebug(); }
    });
    wsClient.connect();
    recalcAll();
  });
})();
