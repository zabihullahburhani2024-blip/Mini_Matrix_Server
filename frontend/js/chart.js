/**
 * Mini Matrix — lightweight live XAU/USD chart (canvas, no TradingView)
 */
(function (global) {
  'use strict';

  var points = [];
  var canvas, ctx;
  var hidden = false;

  function init(canvasId) {
    canvas = document.getElementById(canvasId);
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    loadVisibility();
  }

  function resize() {
    if (!canvas) return;
    var parent = canvas.parentElement;
    var w = parent ? parent.clientWidth : 320;
    var h = parent ? parent.clientHeight : 220;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function setSeries(series) {
    points = (series || []).map(function (p) {
      return { t: p.t, y: p.close };
    });
    draw();
  }

  function pushPrice(price) {
    if (!isFinite(price)) return;
    var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    points.push({ t: now, y: price });
    if (points.length > 80) points = points.slice(-80);
    draw();
  }

  function draw() {
    if (!ctx || !canvas || hidden) return;
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.width / dpr;
    var h = canvas.height / dpr;
    var isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    var bg = isDark ? '#141210' : '#efe9d8';
    var grid = isDark ? 'rgba(232,197,71,0.08)' : 'rgba(180,145,43,0.12)';
    var line = '#e8c547';
    var text = isDark ? '#b5a98c' : '#7a6f58';

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    if (points.length < 2) {
      ctx.fillStyle = text;
      ctx.font = '13px Vazirmatn, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('XAU/USD — waiting for data…', w / 2, h / 2);
      return;
    }

    var ys = points.map(function (p) { return p.y; });
    var minY = Math.min.apply(null, ys);
    var maxY = Math.max.apply(null, ys);
    var pad = (maxY - minY) * 0.08 || 1;
    minY -= pad;
    maxY += pad;

    var left = 48, right = 12, top = 12, bottom = 28;
    var cw = w - left - right;
    var ch = h - top - bottom;

    // grid
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (var g = 0; g < 4; g++) {
      var gy = top + (ch * g) / 3;
      ctx.beginPath();
      ctx.moveTo(left, gy);
      ctx.lineTo(left + cw, gy);
      ctx.stroke();
    }

    // line
    ctx.beginPath();
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    points.forEach(function (p, i) {
      var x = left + (cw * i) / (points.length - 1);
      var y = top + ch - ((p.y - minY) / (maxY - minY)) * ch;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // fill under
    var last = points[points.length - 1];
    var lastX = left + cw;
    var lastY = top + ch - ((last.y - minY) / (maxY - minY)) * ch;
    ctx.lineTo(lastX, top + ch);
    ctx.lineTo(left, top + ch);
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, top, 0, top + ch);
    grad.addColorStop(0, 'rgba(232,197,71,0.25)');
    grad.addColorStop(1, 'rgba(232,197,71,0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // labels
    ctx.fillStyle = text;
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(maxY.toFixed(2), 4, top + 10);
    ctx.fillText(minY.toFixed(2), 4, top + ch);
    ctx.textAlign = 'right';
    ctx.fillStyle = line;
    ctx.font = 'bold 13px monospace';
    ctx.fillText('$' + last.y.toFixed(2), w - right, top + 14);
  }

  function setHidden(v) {
    hidden = !!v;
    localStorage.setItem('mm_chart_hidden', hidden ? '1' : '0');
    var wrap = document.getElementById('liveChartWrap');
    if (wrap) wrap.style.display = hidden ? 'none' : 'block';
    if (!hidden) {
      resize();
      draw();
    }
  }

  function loadVisibility() {
    hidden = localStorage.getItem('mm_chart_hidden') === '1';
    var wrap = document.getElementById('liveChartWrap');
    var btn = document.getElementById('chartToggleBtn');
    if (wrap) wrap.style.display = hidden ? 'none' : 'block';
    if (btn) btn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
  }

  function toggle() {
    setHidden(!hidden);
    return hidden;
  }

  function isHidden() { return hidden; }

  global.MM_CHART = {
    init: init,
    setSeries: setSeries,
    pushPrice: pushPrice,
    toggle: toggle,
    setHidden: setHidden,
    isHidden: isHidden,
    draw: draw,
  };
})(window);
