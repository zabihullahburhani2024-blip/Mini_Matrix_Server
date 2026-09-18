/**
 * Mini Matrix — wholesale app (auth-gated, live chart, Twelve Data 8/min)
 */
(function () {
  'use strict';

  // Gate: must be logged in (activation unlocks features)
  if (!window.MM_AUTH || !MM_AUTH.requireLogin()) {
    location.href = 'register.html';
    return;
  }

  var DIVISOR = 2.56;
  var GRAMS_PER_TOLA = 12.15;
  var GRAMS_PER_TROY_OUNCE = 31.10345;
  var LANG_KEY = 'mm_lang';
  var THEME_KEY = 'mm_theme';

  window.MM_STATE = { lang: localStorage.getItem(LANG_KEY) || 'fa', goldPrice: null, forexComPrice: null };

  var el = {};
  var _syncingWeight = false;

  function isUnlocked() {
    return MM_AUTH.requireActivated();
  }

  function applyAccessControl() {
    var on = isUnlocked();
    var sess = MM_AUTH.getSession();
    var badge = document.getElementById('statusBadge');
    var daysLabel = document.getElementById('daysLeftLabel');
    var daysVal = document.getElementById('daysLeftValue');
    var goAct = document.getElementById('btnGoActivate');
    var lockedHint = document.getElementById('lockedHint');

    if (badge) {
      badge.className = 'activation-status ' + (on ? 'active' : 'inactive');
      badge.textContent = on ? t('statusActive') : t('statusInactive');
    }
    if (daysLabel) daysLabel.textContent = t('daysLeft');
    if (daysVal) {
      if (on && sess) {
        var left = MM_AUTH.remainingDays(sess);
        var total = (window.MM_ACTIVATION && MM_ACTIVATION.ACTIVATION_DAYS) || 365;
        daysVal.textContent = String(left) + ' / ' + String(total);
      } else {
        daysVal.textContent = '0 / 365';
      }
    }
    if (goAct) {
      goAct.style.display = on ? 'none' : 'inline-block';
      goAct.textContent = t('btnActivate');
      goAct.onclick = function () { location.href = 'register.html'; };
    }
    if (lockedHint) {
      lockedHint.style.display = on ? 'none' : 'block';
      lockedHint.textContent = t('lockedHint');
    }

    // Lock live price + API + kabul buy + calc inputs when inactive
    var lockIds = ['top', 'kabulSection', 'kgSection'];
    // More precise: lock price box, api controls, kabul input, weight inputs
    [
      'manualGoldPrice', 'apiAutoToggle', 'kabulPriceInput',
      'gramInput', 'kgInput', 'tolaInput', 'ounceInput'
    ].forEach(function (id) {
      var node = document.getElementById(id);
      if (!node) return;
      node.disabled = !on;
    });

    var priceBox = document.querySelector('.manual-price-box');
    var apiBox = document.querySelector('.api-controls');
    var chartPanel = document.getElementById('chartPanel');
    [priceBox, apiBox, chartPanel].forEach(function (n) {
      if (!n) return;
      if (on) n.classList.remove('feature-locked');
      else n.classList.add('feature-locked');
    });
    var kabulSec = document.getElementById('kabulSection');
    var kgSec = document.getElementById('kgSection');
    [kabulSec, kgSec].forEach(function (n) {
      if (!n) return;
      if (on) n.classList.remove('feature-locked');
      else n.classList.add('feature-locked');
    });

    // Stop API if locked
    if (!on && window.MM_API) {
      MM_API.stop();
      if (el.apiAutoToggle) el.apiAutoToggle.checked = false;
      MM_API.setAutoOn(false);
    }
  }


  function $(id) { return document.getElementById(id); }
  function t(key, vars) { return window.MM_t(key, vars); }
  function fmt2(n) {
    return (typeof n === 'number' && isFinite(n))
      ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  }

  function bindElements() {
    [
      'equivPrice','kabulPriceInput','diffCard','diffSign','diffValue','diffPercent','themeToggle',
      'kgInput','kgToTola','kgToOunce','kgToGram','pricePerTola','pricePerGram','totalLivePrice',
      'kgDiffCard','kgDiffSign','kgDiffValue','kgDiffPercent','divisorLabel','tolaInput','ounceInput',
      'gramInput','manualGoldPrice','priceStatus','apiAutoToggle','apiToggleLabel','remainingRequests',
      'quotaDaysInfo','langSelect','appSubtitle','chartTitle','priceHint','sectionKabul','equivTolaTitle',
      'equivNote','kabulBuyLabel','diffTitle','sectionCalc','labelGram','labelKg','labelTola','labelOunce',
      'pricePerTolaTitle','pricePerGramTitle','totalLiveTitle','navHome','navPrices','navCalc','navActivate',
      'chartToggleBtn','btnLogout'
    ].forEach(function (id) { el[id] = $(id); });
  }

  function applyI18n() {
    var lang = window.MM_STATE.lang;
    var dict = MM_I18N[lang] || MM_I18N.fa;
    document.documentElement.setAttribute('lang', dict.lang);
    document.documentElement.setAttribute('dir', dict.dir);
    document.body.setAttribute('dir', dict.dir);
    var map = {
      appSubtitle: 'menuWholesale', chartTitle: 'chartTitle', priceHint: 'priceHint',
      sectionKabul: 'sectionKabul', equivTolaTitle: 'equivTola', kabulBuyLabel: 'kabulBuy',
      diffTitle: 'diff', sectionCalc: 'sectionCalc', labelGram: 'gram', labelKg: 'kg',
      labelTola: 'tola', labelOunce: 'ounce', pricePerTolaTitle: 'pricePerTola',
      pricePerGramTitle: 'pricePerGram', totalLiveTitle: 'totalLive',
      navHome: 'navHome', navPrices: 'navPrices', navCalc: 'navCalc', navActivate: 'navActivate',
      btnLogout: 'btnLogout'
    };
    Object.keys(map).forEach(function (id) {
      if (el[id]) el[id].textContent = t(map[id]);
    });
    if (el.manualGoldPrice) el.manualGoldPrice.placeholder = t('pricePlaceholder');
    var on = MM_API.isAutoOn();
    if (el.apiToggleLabel) el.apiToggleLabel.textContent = on ? t('apiOn') : t('apiOffLabel');
    if (el.chartToggleBtn) {
      el.chartToggleBtn.textContent = MM_CHART.isHidden() ? t('showChart') : t('hideChart');
    }
    if (!on && el.priceStatus) {
      el.priceStatus.textContent = t('apiOff');
      el.priceStatus.style.color = 'var(--text-soft)';
    }
    updateQuotaUI();
    applyAccessControl();
  }

  function setLang(lang) {
    if (!MM_I18N[lang]) lang = 'fa';
    window.MM_STATE.lang = lang;
    localStorage.setItem(LANG_KEY, lang);
    if (el.langSelect) el.langSelect.value = lang;
    applyI18n();
  }

  function loadTheme() {
    var s = localStorage.getItem(THEME_KEY);
    document.documentElement.setAttribute('data-theme', (s === 'light' || s === 'dark') ? s : 'dark');
  }
  function toggleTheme() {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
    MM_CHART.draw();
    if (_chartSrc === 'tv') {
      _tvInited = false;
      initTradingViewEmbed();
    }
  }

  function setPriceStatus(msg, isError) {
    if (!el.priceStatus) return;
    el.priceStatus.textContent = msg;
    el.priceStatus.style.color = isError ? 'var(--red)' : 'var(--text-soft)';
  }

  function applyGoldPrice(price) {
    if (!isFinite(price) || price <= 0) return;
    window.MM_STATE.goldPrice = price; // Twelve Data — used in all calculations
    if (el.manualGoldPrice) el.manualGoldPrice.value = price.toFixed(3);
    localStorage.setItem('mm_manual_gold_price', String(price));
    var tl = document.getElementById('twelvePriceLabel');
    if (tl) tl.textContent = '$' + price.toFixed(2);
    MM_CHART.pushPrice(price);
    recalcKabul();
    recalcKg(null);
  }

  /** FOREX.com rate — stored only for display/compare, NEVER used in calculations */
  function applyForexComPrice(info) {
    var price = info && typeof info === 'object' ? info.price : info;
    if (!isFinite(price) || price <= 0) return;
    window.MM_STATE.forexComPrice = price;
    var elF = document.getElementById('forexComPriceLabel');
    if (elF) elF.textContent = '$' + Number(price).toFixed(2);
  }

  function refreshForexComPrice() {
    if (!window.MM_API || !MM_API.fetchForexComPrice) return;
    MM_API.fetchForexComPrice()
      .then(function (info) { applyForexComPrice(info); })
      .catch(function () {
        var elF = document.getElementById('forexComPriceLabel');
        if (elF && window.MM_STATE.forexComPrice == null) elF.textContent = '—';
      });
  }

  function onManualPriceInput() {
    var p = parseFloat(el.manualGoldPrice.value);
    if (isFinite(p) && p > 0) {
      window.MM_STATE.goldPrice = p;
      localStorage.setItem('mm_manual_gold_price', el.manualGoldPrice.value || '');
      recalcKabul();
      recalcKg(null);
      setPriceStatus(t('manualSaved'), false);
    } else {
      window.MM_STATE.goldPrice = null;
      localStorage.setItem('mm_manual_gold_price', '');
      if (el.equivPrice) el.equivPrice.textContent = '—';
      clearKgOutputs();
    }
  }

  function loadManualGoldPrice() {
    var s = localStorage.getItem('mm_manual_gold_price');
    if (s && el.manualGoldPrice) {
      el.manualGoldPrice.value = s;
      var p = parseFloat(s);
      if (isFinite(p) && p > 0) window.MM_STATE.goldPrice = p;
    }
  }
  function loadKabulPrice() {
    var s = localStorage.getItem('mm_kabul_price');
    if (s && el.kabulPriceInput) el.kabulPriceInput.value = s;
  }
  function saveKabulPrice() {
    if (el.kabulPriceInput) localStorage.setItem('mm_kabul_price', el.kabulPriceInput.value || '');
  }

  function recalcKabul() {
    if (!window.MM_STATE.goldPrice) return;
    var equiv = window.MM_STATE.goldPrice / DIVISOR;
    if (el.equivPrice) el.equivPrice.textContent = fmt2(equiv);
    var kabul = parseFloat(el.kabulPriceInput && el.kabulPriceInput.value);
    if (isFinite(kabul)) {
      var diff = equiv - kabul;
      var pct = kabul !== 0 ? (diff / kabul) * 100 : 0;
      if (el.diffSign) el.diffSign.textContent = diff >= 0 ? '+' : '−';
      if (el.diffValue) el.diffValue.textContent = fmt2(Math.abs(diff));
      if (el.diffPercent) el.diffPercent.textContent = (diff >= 0 ? '+' : '') + fmt2(pct) + '%';
      if (el.diffCard) el.diffCard.className = 'card calc-card calc-card-diff ' + (diff >= 0 ? 'diff-positive' : 'diff-negative');
    } else {
      if (el.diffSign) el.diffSign.textContent = '±';
      if (el.diffValue) el.diffValue.textContent = '—';
      if (el.diffPercent) el.diffPercent.textContent = '—';
      if (el.diffCard) el.diffCard.className = 'card calc-card calc-card-diff';
    }
  }

  function clearKgOutputs() {
    ['kgToTola','kgToOunce','kgToGram','pricePerTola','pricePerGram','totalLivePrice'].forEach(function (id) {
      if (el[id]) el[id].textContent = '—';
    });
  }

  function recalcKg(source) {
    var gram = parseFloat(el.gramInput && el.gramInput.value);
    var kg = parseFloat(el.kgInput && el.kgInput.value);
    var tolaV = parseFloat(el.tolaInput && el.tolaInput.value);
    var ounce = parseFloat(el.ounceInput && el.ounceInput.value);
    _syncingWeight = true;
    if (source === 'gram' && isFinite(gram)) {
      if (el.kgInput) el.kgInput.value = (gram / 1000).toFixed(6);
      if (el.tolaInput) el.tolaInput.value = (gram / GRAMS_PER_TOLA).toFixed(6);
      if (el.ounceInput) el.ounceInput.value = (gram / GRAMS_PER_TROY_OUNCE).toFixed(6);
    } else if (source === 'kg' && isFinite(kg)) {
      gram = kg * 1000;
      if (el.gramInput) el.gramInput.value = gram.toFixed(3);
      if (el.tolaInput) el.tolaInput.value = (gram / GRAMS_PER_TOLA).toFixed(6);
      if (el.ounceInput) el.ounceInput.value = (gram / GRAMS_PER_TROY_OUNCE).toFixed(6);
    } else if (source === 'tola' && isFinite(tolaV)) {
      gram = tolaV * GRAMS_PER_TOLA;
      if (el.gramInput) el.gramInput.value = gram.toFixed(3);
      if (el.kgInput) el.kgInput.value = (gram / 1000).toFixed(6);
      if (el.ounceInput) el.ounceInput.value = (gram / GRAMS_PER_TROY_OUNCE).toFixed(6);
    } else if (source === 'ounce' && isFinite(ounce)) {
      gram = ounce * GRAMS_PER_TROY_OUNCE;
      if (el.gramInput) el.gramInput.value = gram.toFixed(3);
      if (el.kgInput) el.kgInput.value = (gram / 1000).toFixed(6);
      if (el.tolaInput) el.tolaInput.value = (gram / GRAMS_PER_TOLA).toFixed(6);
    }
    _syncingWeight = false;
    gram = parseFloat(el.gramInput && el.gramInput.value);
    if (!isFinite(gram) || gram < 0) { clearKgOutputs(); return; }
    if (el.kgToGram) el.kgToGram.textContent = fmt2(gram);
    if (el.kgToTola) el.kgToTola.textContent = fmt2(gram / GRAMS_PER_TOLA);
    if (el.kgToOunce) el.kgToOunce.textContent = fmt2(gram / GRAMS_PER_TROY_OUNCE);
    if (!window.MM_STATE.goldPrice) {
      if (el.pricePerTola) el.pricePerTola.textContent = '—';
      if (el.pricePerGram) el.pricePerGram.textContent = '—';
      if (el.totalLivePrice) el.totalLivePrice.textContent = '—';
      return;
    }
    var pricePerGram = window.MM_STATE.goldPrice / GRAMS_PER_TROY_OUNCE;
    var pricePerTola = window.MM_STATE.goldPrice / DIVISOR;
    if (el.pricePerGram) el.pricePerGram.textContent = '$' + fmt2(pricePerGram);
    if (el.pricePerTola) el.pricePerTola.textContent = '$' + fmt2(pricePerTola);
    if (el.totalLivePrice) el.totalLivePrice.textContent = '$' + fmt2(pricePerGram * gram);
    var kabul = parseFloat(el.kabulPriceInput && el.kabulPriceInput.value);
    if (isFinite(kabul) && el.kgDiffCard) {
      var tolaAmount = gram / GRAMS_PER_TOLA;
      var live = pricePerTola * tolaAmount;
      var kabulTotal = kabul * tolaAmount;
      var diff = live - kabulTotal;
      var pct = kabulTotal !== 0 ? (diff / kabulTotal) * 100 : 0;
      if (el.kgDiffSign) el.kgDiffSign.textContent = diff >= 0 ? '+' : '−';
      if (el.kgDiffValue) el.kgDiffValue.textContent = fmt2(Math.abs(diff));
      if (el.kgDiffPercent) el.kgDiffPercent.textContent = (diff >= 0 ? '+' : '') + fmt2(pct) + '% ' + t('vsKabul');
      el.kgDiffCard.className = 'card calc-card calc-card-diff ' + (diff >= 0 ? 'diff-positive' : 'diff-negative');
    } else if (el.kgDiffCard) {
      if (el.kgDiffSign) el.kgDiffSign.textContent = '±';
      if (el.kgDiffValue) el.kgDiffValue.textContent = '—';
      if (el.kgDiffPercent) el.kgDiffPercent.textContent = t('enterKabul');
      el.kgDiffCard.className = 'card calc-card calc-card-diff';
    }
  }

  function updateQuotaUI() {
    var rem = MM_API.getRemaining();
    var total = MM_API.FREE_QUOTA_TOTAL;
    var totEl = document.getElementById('quotaTotal');
    if (totEl) totEl.textContent = String(total);
    if (el.remainingRequests) {
      el.remainingRequests.textContent = String(rem);
      el.remainingRequests.className = rem <= 50 ? 'quota-warn' : '';
    }
  }

  function onApiPrice(price) {
    applyGoldPrice(price);
    refreshForexComPrice();
    if (el.priceStatus) el.priceStatus.textContent = '';
    updateQuotaUI();
    if (el.apiToggleLabel) el.apiToggleLabel.textContent = t('apiOn');
  }
  function onApiError(err) {
    var msg = (err && err.message) ? err.message : String(err);
    var fallback = window.MM_STATE.goldPrice;
    setPriceStatus(
      t('errorPrefix') + ': ' + msg + (isFinite(fallback) ? ' · ' + t('usingPrev') : ''),
      true
    );
    updateQuotaUI();
  }
  function onApiQuota(rem) {
    updateQuotaUI();
    if (rem <= 0) {
      setPriceStatus(t('quotaEmpty'), true);
      if (el.apiAutoToggle) el.apiAutoToggle.checked = false;
      if (el.apiToggleLabel) el.apiToggleLabel.textContent = t('apiOffLabel');
    }
  }

  function bindApiToggle() {
    var on = MM_API.loadToggle();
    if (el.apiAutoToggle) {
      el.apiAutoToggle.checked = on;
      el.apiAutoToggle.addEventListener('change', function () {
        var nowOn = MM_API.setAutoOn(el.apiAutoToggle.checked);
        if (el.apiToggleLabel) el.apiToggleLabel.textContent = nowOn ? t('apiOn') : t('apiOffLabel');
        if (nowOn && isUnlocked()) {
          setPriceStatus(t('fetching'), false);
          MM_API.start(onApiPrice, onApiError, onApiQuota);
        } else if (nowOn && !isUnlocked()) {
          el.apiAutoToggle.checked = false;
          MM_API.setAutoOn(false);
          setPriceStatus(t('lockedHint'), true);
        } else {
          MM_API.stop();
          setPriceStatus(t('apiOff'), false);
        }
      });
    }
    if (el.apiToggleLabel) el.apiToggleLabel.textContent = on ? t('apiOn') : t('apiOffLabel');
    if (on && isUnlocked()) {
      setPriceStatus(t('fetching'), false);
      MM_API.start(onApiPrice, onApiError, onApiQuota);
    } else {
      if (!isUnlocked()) setPriceStatus(t('lockedHint'), false);
      else setPriceStatus(t('apiOff'), false);
    }
    updateQuotaUI();
  }

  function loadInitialSeries() {
    MM_API.fetchSeries().then(function (series) {
      MM_CHART.setSeries(series);
    }).catch(function () { /* ignore */ });
  }

  var _chartSrc = localStorage.getItem('mm_chart_src') || 'live';
  var _tvInited = false;

  var _tvStyle = localStorage.getItem('mm_tv_style') || '1'; // 1=candle, 3=line

  function initTradingViewEmbed() {
    var wrap = document.getElementById('tvChartWrap');
    if (!wrap) return;
    wrap.innerHTML = '';
    var isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    var iframe = document.createElement('iframe');
    iframe.title = 'TradingView XAUUSD';
    iframe.setAttribute('allowtransparency', 'true');
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('frameborder', '0');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    var theme = isDark ? 'dark' : 'light';
    var style = (_tvStyle === '3') ? '3' : '1';
    // hidelegend + no details → without OHLC panel
    iframe.src = 'https://s.tradingview.com/widgetembed/?frameElementId=tv_xau&symbol=OANDA%3AXAUUSD&interval=60&hidesidetoolbar=1&hidetoptoolbar=0&symboledit=0&saveimage=0&toolbarbg=0b0a09&theme=' + theme + '&style=' + style + '&timezone=Asia%2FKabul&withdateranges=0&hideideas=1&hidevolume=1&hidelegend=1&disabled_features=%5B%22header_widget%22%2C%22left_toolbar%22%2C%22create_volume_indicator_by_default%22%2C%22legend_widget%22%2C%22timeframes_toolbar%22%5D&locale=' + (window.MM_STATE.lang === 'en' ? 'en' : 'fa_IR');
    wrap.appendChild(iframe);
    _tvInited = true;
    var bC = document.getElementById('btnTvCandle');
    var bL = document.getElementById('btnTvLine');
    if (bC) { bC.style.display = 'inline-block'; bC.classList.toggle('active', style === '1'); }
    if (bL) { bL.style.display = 'inline-block'; bL.classList.toggle('active', style === '3'); }
  }

  function setChartSource(src) {
    if (src !== 'live' && src !== 'tv') src = 'live';
    _chartSrc = src;
    localStorage.setItem('mm_chart_src', src);
    var live = document.getElementById('liveChartWrap');
    var tv = document.getElementById('tvChartWrap');
    var bLive = document.getElementById('btnChartLive');
    var bTv = document.getElementById('btnChartTv');
    if (live) live.style.display = src === 'live' ? 'block' : 'none';
    if (tv) tv.style.display = src === 'tv' ? 'block' : 'none';
    if (bLive) bLive.classList.toggle('active', src === 'live');
    if (bTv) bTv.classList.toggle('active', src === 'tv');
    var bC = document.getElementById('btnTvCandle');
    var bL = document.getElementById('btnTvLine');
    if (src === 'tv') {
      _tvInited = false;
      initTradingViewEmbed();
      if (bC) bC.style.display = 'inline-block';
      if (bL) bL.style.display = 'inline-block';
    } else {
      if (bC) bC.style.display = 'none';
      if (bL) bL.style.display = 'none';
      MM_CHART.draw();
    }
  }

  function bindChartSourceTabs() {
    var bLive = document.getElementById('btnChartLive');
    var bTv = document.getElementById('btnChartTv');
    var bC = document.getElementById('btnTvCandle');
    var bL = document.getElementById('btnTvLine');
    if (bLive) bLive.addEventListener('click', function () { setChartSource('live'); });
    if (bTv) bTv.addEventListener('click', function () { setChartSource('tv'); });
    if (bC) bC.addEventListener('click', function () {
      _tvStyle = '1';
      localStorage.setItem('mm_tv_style', '1');
      _tvInited = false;
      if (_chartSrc === 'tv') initTradingViewEmbed();
    });
    if (bL) bL.addEventListener('click', function () {
      _tvStyle = '3';
      localStorage.setItem('mm_tv_style', '3');
      _tvInited = false;
      if (_chartSrc === 'tv') initTradingViewEmbed();
    });
    setChartSource(_chartSrc);
  }


  function bindNav() {
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.nav-item').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var target = btn.getAttribute('data-target');
        if (target === 'account') {
          if (confirm(t('btnLogout') + '?')) {
            MM_AUTH.logout();
            location.href = 'register.html';
          }
          return;
        }
        if (target === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
        else {
          var sec = $(target);
          if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    bindElements();
    loadTheme();
    if (el.langSelect) {
      el.langSelect.value = window.MM_STATE.lang;
      el.langSelect.addEventListener('change', function () {
        setLang(el.langSelect.value);
      });
    }
    loadKabulPrice();
    loadManualGoldPrice();
    applyI18n();
    applyAccessControl();

    MM_CHART.init('liveChart');
    bindChartSourceTabs();
    if (el.chartToggleBtn) {
      el.chartToggleBtn.addEventListener('click', function () {
        var panel = document.getElementById('chartPanel');
        var hidden = panel && panel.style.display === 'none';
        if (panel) panel.style.display = hidden ? 'block' : 'none';
        localStorage.setItem('mm_chart_hidden', hidden ? '0' : '1');
        el.chartToggleBtn.textContent = (!hidden) ? t('showChart') : t('hideChart');
        if (hidden && _chartSrc === 'live') MM_CHART.draw();
      });
      if (localStorage.getItem('mm_chart_hidden') === '1') {
        var panel0 = document.getElementById('chartPanel');
        if (panel0) panel0.style.display = 'none';
        el.chartToggleBtn.textContent = t('showChart');
      }
    }

    if (el.themeToggle) el.themeToggle.addEventListener('click', toggleTheme);
    if (el.btnLogout) {
      el.btnLogout.addEventListener('click', function () {
        MM_AUTH.logout();
        location.href = 'register.html';
      });
    }
    if (el.kabulPriceInput) {
      el.kabulPriceInput.addEventListener('input', function () {
        saveKabulPrice(); recalcKabul(); recalcKg(null);
      });
    }
    if (el.manualGoldPrice) {
      el.manualGoldPrice.addEventListener('input', onManualPriceInput);
      el.manualGoldPrice.addEventListener('change', onManualPriceInput);
    }
    if (el.gramInput) el.gramInput.addEventListener('input', function () { if (!_syncingWeight) recalcKg('gram'); });
    if (el.kgInput) el.kgInput.addEventListener('input', function () { if (!_syncingWeight) recalcKg('kg'); });
    if (el.tolaInput) el.tolaInput.addEventListener('input', function () { if (!_syncingWeight) recalcKg('tola'); });
    if (el.ounceInput) el.ounceInput.addEventListener('input', function () { if (!_syncingWeight) recalcKg('ounce'); });

    bindNav();
    bindApiToggle();
    if (isUnlocked()) {
      loadInitialSeries();
      refreshForexComPrice();
    }

    if (window.MM_STATE.goldPrice) { recalcKabul(); recalcKg('gram'); }
    else recalcKg('gram');
  });
})();
