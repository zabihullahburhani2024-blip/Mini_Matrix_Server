/**
 * Mini Matrix — activation code matching (client-side, no server)
 * Pool: window.MM_CODES (js/codes.js)
 * Used list: localStorage only (same browser/device)
 */
(function (global) {
  'use strict';

  var USED_CODES_KEY = 'mm_used_codes_v1';
  var ACTIVATION_DAYS = 365;

  function loadUsed() {
    try { return JSON.parse(localStorage.getItem(USED_CODES_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveUsed(list) {
    localStorage.setItem(USED_CODES_KEY, JSON.stringify(list));
  }

  function normalize(code) {
    return String(code || '').trim().toLowerCase();
  }

  function isInPool(code) {
    var c = normalize(code);
    var pool = global.MM_CODES || [];
    for (var i = 0; i < pool.length; i++) {
      if (normalize(pool[i]) === c) return true;
    }
    return false;
  }

  function findUsed(code) {
    var c = normalize(code);
    return loadUsed().find(function (u) { return normalize(u.code) === c; }) || null;
  }

  /**
   * Match + consume a code (one-time on this device storage).
   * @returns {{ok:boolean, error?:string, expiresAt?:number, days?:number}}
   */
  function matchAndConsume(code, phone) {
    var c = normalize(code);
    if (c.length < 16) return { ok: false, error: 'bad_code' };
    if (!isInPool(c)) return { ok: false, error: 'not_in_pool' };

    var used = findUsed(c);
    if (used) return { ok: false, error: 'already_used' };

    var now = Date.now();
    var expiresAt = now + ACTIVATION_DAYS * 86400000;
    var list = loadUsed();
    list.push({
      code: c,
      phone: String(phone || ''),
      usedAt: now,
      expiresAt: expiresAt,
    });
    saveUsed(list);
    return { ok: true, expiresAt: expiresAt, days: ACTIVATION_DAYS };
  }

  function remainingDays(expiresAt) {
    if (!expiresAt) return 0;
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / 86400000));
  }

  function isExpired(expiresAt) {
    return !expiresAt || Date.now() > expiresAt;
  }

  function stats() {
    var pool = global.MM_CODES || [];
    var used = loadUsed();
    return {
      total: pool.length,
      used: used.length,
      free: Math.max(0, pool.length - used.length),
    };
  }

  global.MM_ACTIVATION = {
    ACTIVATION_DAYS: ACTIVATION_DAYS,
    isInPool: isInPool,
    findUsed: findUsed,
    matchAndConsume: matchAndConsume,
    remainingDays: remainingDays,
    isExpired: isExpired,
    stats: stats,
    loadUsed: loadUsed,
  };
})(window);
