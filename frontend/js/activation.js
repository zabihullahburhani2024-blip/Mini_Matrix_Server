/**
 * Mini Matrix — activation helpers (server is source of truth)
 */
(function (global) {
  'use strict';

  var ACTIVATION_DAYS = 365;

  function remainingDays(expiresAt) {
    if (!expiresAt) return 0;
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / 86400000));
  }

  function isExpired(expiresAt) {
    return !expiresAt || Date.now() > expiresAt;
  }

  global.MM_ACTIVATION = {
    ACTIVATION_DAYS: ACTIVATION_DAYS,
    remainingDays: remainingDays,
    isExpired: isExpired,
    // pool matching is server-side only
    matchAndConsume: function () {
      return { ok: false, error: 'server_only' };
    },
    stats: function () {
      return { total: 0, used: 0, free: 0 };
    },
  };
})(window);
