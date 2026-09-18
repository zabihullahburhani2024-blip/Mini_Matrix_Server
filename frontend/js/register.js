/**
 * Mini Matrix — registration & auth (server-side)
 * All sensitive data lives on the backend. Browser only keeps session token.
 */
(function (global) {
  'use strict';

  var SESSION_KEY = 'mm_session_v1';
  var TOKEN_KEY = 'mm_token_v1';

  function apiBase() {
    if (global.MM_API_BASE) return String(global.MM_API_BASE).replace(/\/$/, '');
    if (location.port === '5500' || location.port === '3000' || location.protocol === 'file:') {
      return 'http://' + (location.hostname || '127.0.0.1') + ':8000';
    }
    return '';
  }

  function api(path, opts) {
    var url = apiBase() + path;
    var headers = Object.assign({ 'Content-Type': 'application/json' }, (opts && opts.headers) || {});
    var token = localStorage.getItem(TOKEN_KEY);
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch(url, Object.assign({}, opts, {
      headers: headers,
      body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
    })).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = (data && data.detail) || 'error';
          if (typeof err === 'object') err = JSON.stringify(err);
          return { ok: false, error: err, status: res.status };
        }
        return Object.assign({ ok: true }, data);
      }).catch(function () {
        return { ok: false, error: 'network', status: res.status };
      });
    }).catch(function () {
      return { ok: false, error: 'network' };
    });
  }

  function normalizePhone(phone) {
    return String(phone || '').replace(/\D/g, '');
  }

  function saveSession(user, token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      phone: user.phone,
      name: user.name,
      activated: !!user.activated,
      expiresAt: user.expires_at || null,
      at: Date.now(),
    }));
  }

  function register(data) {
    return api('/api/auth/register', {
      method: 'POST',
      body: {
        name: (data.name || '').trim(),
        phone: data.phone,
        password: data.password || '',
        recovery: (data.recovery || '').trim(),
      },
    }).then(function (res) {
      if (!res.ok) return res;
      return { ok: true, phone: res.phone, name: res.name };
    });
  }

  function login(phone, password) {
    return api('/api/auth/login', {
      method: 'POST',
      body: { phone: phone, password: password },
    }).then(function (res) {
      if (!res.ok) return res;
      saveSession(res.user, res.token);
      return { ok: true, user: res.user };
    });
  }

  function activateWithCode(phone, code) {
    return api('/api/auth/activate', {
      method: 'POST',
      body: { phone: phone, code: code },
    }).then(function (res) {
      if (!res.ok) return res;
      if (res.user) saveSession(res.user, res.token);
      return {
        ok: true,
        expiresAt: res.expires_at,
        days: res.days,
      };
    });
  }

  function resetPassword(phone, recovery, newPassword) {
    return api('/api/auth/reset-password', {
      method: 'POST',
      body: {
        phone: phone,
        recovery: recovery,
        new_password: newPassword,
      },
    });
  }

  function getSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!s || !s.phone) return null;
      if (s.activated && s.expiresAt && Date.now() > s.expiresAt) {
        s.activated = false;
        localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      }
      return s;
    } catch (e) {
      return null;
    }
  }

  function refreshMe() {
    return api('/api/auth/me', { method: 'GET' }).then(function (res) {
      if (!res.ok || !res.user) {
        logout();
        return null;
      }
      saveSession(res.user, localStorage.getItem(TOKEN_KEY));
      return getSession();
    });
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(TOKEN_KEY);
  }

  function isActive(session) {
    if (!session || !session.activated) return false;
    if (session.expiresAt && Date.now() > session.expiresAt) return false;
    return true;
  }

  function remainingDays(session) {
    if (!session || !session.expiresAt) return 0;
    return Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 86400000));
  }

  function whatsappRequestLink(phone, name) {
    var text = encodeURIComponent(
      'Mini Matrix — Activation request\n' +
      'Name: ' + (name || '') + '\n' +
      'Phone: ' + (phone || '') + '\n' +
      'Please send my 32-character activation code.'
    );
    return 'https://wa.me/?text=' + text;
  }

  function findUser(phone) {
    var s = getSession();
    if (s && normalizePhone(s.phone) === normalizePhone(phone)) {
      return { phone: s.phone, name: s.name, activated: s.activated, expiresAt: s.expiresAt };
    }
    return null;
  }

  global.MM_REGISTER = {
    register: register,
    login: login,
    activateWithCode: activateWithCode,
    resetPassword: resetPassword,
    getSession: getSession,
    refreshMe: refreshMe,
    logout: logout,
    isActive: isActive,
    remainingDays: remainingDays,
    findUser: findUser,
    whatsappRequestLink: whatsappRequestLink,
    normalizePhone: normalizePhone,
  };

  global.MM_AUTH = {
    ACTIVATION_DAYS: 365,
    register: register,
    login: login,
    activate: activateWithCode,
    resetPassword: resetPassword,
    getSession: getSession,
    refreshMe: refreshMe,
    logout: logout,
    requireLogin: function () { return !!getSession(); },
    requireActivated: function () { return isActive(getSession()); },
    isActive: isActive,
    remainingDays: remainingDays,
    findUser: findUser,
    whatsappRequestLink: whatsappRequestLink,
    normalizePhone: normalizePhone,
    stats: function () {
      return { total: 0, used: 0, free: 0 };
    },
  };
})(window);
