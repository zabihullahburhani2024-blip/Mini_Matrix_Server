/**
 * Mini Matrix — registration & user store (client-side, no server)
 * Users saved in localStorage only on this device/browser.
 */
(function (global) {
  'use strict';

  var USERS_KEY = 'mm_users_v1';
  var SESSION_KEY = 'mm_session_v1';

  function loadUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveUsers(list) {
    localStorage.setItem(USERS_KEY, JSON.stringify(list));
  }

  function hash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return String(h);
  }

  function normalizePhone(phone) {
    return String(phone || '').replace(/\D/g, '');
  }

  function findUser(phone) {
    var p = normalizePhone(phone);
    return loadUsers().find(function (u) { return u.phone === p; }) || null;
  }

  function register(data) {
    var phone = normalizePhone(data.phone);
    var name = (data.name || '').trim();
    var password = data.password || '';
    var recovery = (data.recovery || '').trim();

    if (!name || phone.length < 8 || password.length < 4) {
      return { ok: false, error: 'invalid_input' };
    }
    if (findUser(phone)) {
      return { ok: false, error: 'exists' };
    }

    var users = loadUsers();
    users.push({
      id: 'u_' + Date.now(),
      name: name,
      phone: phone,
      passHash: hash(password),
      recovery: recovery,
      activated: false,
      activatedAt: null,
      expiresAt: null,
      activationCode: null,
      createdAt: Date.now(),
    });
    saveUsers(users);
    return { ok: true, phone: phone, name: name };
  }

  function login(phone, password) {
    var user = findUser(phone);
    if (!user) return { ok: false, error: 'not_found' };
    if (user.passHash !== hash(password)) return { ok: false, error: 'bad_password' };

    if (user.activated && user.expiresAt && global.MM_ACTIVATION &&
        MM_ACTIVATION.isExpired(user.expiresAt)) {
      user.activated = false;
      var users = loadUsers();
      var idx = users.findIndex(function (u) { return u.phone === user.phone; });
      if (idx >= 0) {
        users[idx].activated = false;
        saveUsers(users);
      }
    }

    localStorage.setItem(SESSION_KEY, JSON.stringify({
      phone: user.phone,
      name: user.name,
      activated: !!user.activated,
      expiresAt: user.expiresAt || null,
      at: Date.now(),
    }));
    return { ok: true, user: user };
  }

  function activateWithCode(phone, code) {
    if (!global.MM_ACTIVATION) return { ok: false, error: 'no_module' };
    var p = normalizePhone(phone);
    var users = loadUsers();
    var idx = users.findIndex(function (u) { return u.phone === p; });
    if (idx < 0) return { ok: false, error: 'not_found' };

    var match = MM_ACTIVATION.matchAndConsume(code, p);
    if (!match.ok) return match;

    users[idx].activated = true;
    users[idx].activatedAt = Date.now();
    users[idx].expiresAt = match.expiresAt;
    users[idx].activationCode = String(code).trim().toLowerCase();
    saveUsers(users);

    localStorage.setItem(SESSION_KEY, JSON.stringify({
      phone: p,
      name: users[idx].name,
      activated: true,
      expiresAt: match.expiresAt,
      at: Date.now(),
    }));
    return { ok: true, expiresAt: match.expiresAt, days: match.days };
  }

  function resetPassword(phone, recovery, newPassword) {
    var users = loadUsers();
    var p = normalizePhone(phone);
    var idx = users.findIndex(function (u) { return u.phone === p; });
    if (idx < 0) return { ok: false, error: 'not_found' };
    if (!users[idx].recovery || users[idx].recovery !== recovery) {
      return { ok: false, error: 'bad_recovery' };
    }
    if (!newPassword || newPassword.length < 4) return { ok: false, error: 'weak_password' };
    users[idx].passHash = hash(newPassword);
    saveUsers(users);
    return { ok: true };
  }

  function getSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!s || !s.phone) return null;
      var u = findUser(s.phone);
      if (!u) return null;
      if (u.activated && u.expiresAt && global.MM_ACTIVATION &&
          MM_ACTIVATION.isExpired(u.expiresAt)) {
        u.activated = false;
        var users = loadUsers();
        var idx = users.findIndex(function (x) { return x.phone === u.phone; });
        if (idx >= 0) {
          users[idx].activated = false;
          saveUsers(users);
        }
      }
      s.activated = !!u.activated;
      s.expiresAt = u.expiresAt || null;
      s.name = u.name;
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      return s;
    } catch (e) { return null; }
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
  }

  function isActive(session) {
    if (!session || !session.activated) return false;
    if (session.expiresAt && global.MM_ACTIVATION &&
        MM_ACTIVATION.isExpired(session.expiresAt)) return false;
    return true;
  }

  function remainingDays(session) {
    if (!session || !session.expiresAt || !global.MM_ACTIVATION) return 0;
    return MM_ACTIVATION.remainingDays(session.expiresAt);
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

  // Public API (compatible with previous MM_AUTH name)
  global.MM_REGISTER = {
    register: register,
    login: login,
    activateWithCode: activateWithCode,
    resetPassword: resetPassword,
    getSession: getSession,
    logout: logout,
    isActive: isActive,
    remainingDays: remainingDays,
    findUser: findUser,
    whatsappRequestLink: whatsappRequestLink,
    normalizePhone: normalizePhone,
  };

  // Back-compat alias used by app.js / register.html
  global.MM_AUTH = {
    ACTIVATION_DAYS: (global.MM_ACTIVATION && MM_ACTIVATION.ACTIVATION_DAYS) || 365,
    register: register,
    login: login,
    activate: activateWithCode,
    resetPassword: resetPassword,
    getSession: getSession,
    logout: logout,
    requireLogin: function () { return !!getSession(); },
    requireActivated: function () { return isActive(getSession()); },
    isActive: isActive,
    remainingDays: remainingDays,
    findUser: findUser,
    whatsappRequestLink: whatsappRequestLink,
    normalizePhone: normalizePhone,
    stats: function () {
      return global.MM_ACTIVATION ? MM_ACTIVATION.stats() : { total: 0, used: 0, free: 0 };
    },
  };
})(window);
