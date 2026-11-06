/* Remember the last-selected YouTube TV profile and auto-select it on the
   "Who's watching?" picker, so the same account is used next time.
   DOM automation only — it replays the user's own click on the profile
   tile. Never touches playback, networking, DRM, the ad filter, or the
   spinner. Fail-open: if there is no recorded profile, the picker does
   not appear, or the recorded profile is not on the picker, do nothing
   and let the picker show normally. */
(function () {
  'use strict';
  try {
    if (JSON.__bishalYtvProfileV1) return;
    var STORE_KEY = 'yt.bishal.lastProfile';
    var EXCLUDED = ['guest', 'watch as guest', 'add account', 'add an account',
      'add a kid', 'add a kid account', 'manage accounts', 'sign in', 'sign out',
      'remove account', 'switch account', 'settings'];
    var autoDone = false;
    var armed = false;
    var ticks = 0;

    function readStored() {
      try {
        var v = window.localStorage && window.localStorage.getItem(STORE_KEY);
        return v ? String(v).replace(/^\s+|\s+$/g, '') : '';
      } catch (ignored) { return ''; }
    }

    function store(name) {
      try {
        if (window.localStorage) window.localStorage.setItem(STORE_KEY, name);
      } catch (ignored) {}
    }

    function isExcluded(name) {
      if (!name) return true;
      var n = name.toLowerCase();
      for (var i = 0; i < EXCLUDED.length; i++) {
        if (n === EXCLUDED[i] || n.indexOf(EXCLUDED[i]) !== -1) return true;
      }
      return false;
    }

    function hasPageClass(cls) {
      try {
        var d = document.documentElement;
        if (d && d.className && d.className.indexOf(cls) !== -1) return true;
        var b = document.body;
        if (b && b.className && b.className.indexOf(cls) !== -1) return true;
      } catch (ignored) {}
      return false;
    }

    function hasPickerTitle() {
      try {
        var b = document.body;
        if (!b || !b.textContent) return false;
        var t = b.textContent;
        return t.indexOf("Who's watching?") !== -1 ||
          t.indexOf('Who is watching?') !== -1;
      } catch (ignored) { return false; }
    }

    /* The startup picker only (the screen that appears on launch). */
    function isStartupPicker() {
      return hasPageClass('WEB_PAGE_TYPE_ACCOUNT_SELECTOR') || hasPickerTitle();
    }

    /* Any account screen (startup picker + the in-app account switcher).
       Recording a manual pick is valid on both; auto-select is only ever
       done on the startup picker. */
    function isAccountScreen() {
      return isStartupPicker() || hasPageClass('WEB_PAGE_TYPE_ACCOUNTS');
    }

    function firstTextLine(text) {
      if (!text) return '';
      var lines = String(text).split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].replace(/^\s+|\s+$/g, '');
        if (line) return line;
      }
      return '';
    }

    function hasImg(el) {
      try {
        return el.getElementsByTagName &&
          el.getElementsByTagName('img').length > 0;
      } catch (ignored) { return false; }
    }

    /* The profile tile around a click: the nearest ancestor that carries
       both an avatar image and text. Its first text line is the name.
       The whole picker container also carries images, so refuse any
       ancestor whose text holds the picker title — that is the screen,
       not a tile. */
    function tileNameFromEvent(ev) {
      try {
        var el = ev && ev.target ? ev.target : null;
        for (var depth = 0; el && depth < 8; depth++, el = el.parentNode) {
          if (hasImg(el)) {
            var text = el.textContent || '';
            if (text.indexOf("Who's watching?") !== -1 ||
                text.indexOf('Who is watching?') !== -1) return '';
            var name = firstTextLine(text);
            if (name && name.length >= 2 && name.length <= 80) return name;
            return '';
          }
        }
        /* No avatar found: fall back to the clicked leaf's own text. */
        if (ev && ev.target && ev.target.textContent) {
          var t = firstTextLine(ev.target.textContent);
          if (t && t.length >= 2 && t.length <= 80) return t;
        }
      } catch (ignored) {}
      return '';
    }

    function recordFromClick(ev) {
      try {
        if (!isAccountScreen()) return;
        var name = tileNameFromEvent(ev);
        if (!name) return;
        if (name === "Who's watching?" || name === 'Who is watching?') return;
        if (isExcluded(name)) return;
        store(name);
      } catch (ignored) {}
    }

    function leafElements(root) {
      var out = [];
      try {
        var all = root.getElementsByTagName('*');
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          if (!el.children || el.children.length === 0) {
            var t = (el.textContent || '').replace(/^\s+|\s+$/g, '');
            if (t) out.push({ el: el, text: t });
          }
        }
      } catch (ignored) {}
      return out;
    }

    function clickableAncestor(el) {
      try {
        var cur = el;
        for (var depth = 0; cur && depth < 8; depth++, cur = cur.parentNode) {
          var tag = (cur.tagName || '').toUpperCase();
          if (tag === 'A' || tag === 'BUTTON') return cur;
          if (cur.getAttribute) {
            if (cur.getAttribute('tabindex') !== null) return cur;
            if (cur.getAttribute('role') === 'button') return cur;
          }
        }
      } catch (ignored) {}
      return el;
    }

    function fireClick(el) {
      try {
        if (typeof el.click === 'function') { el.click(); return true; }
        if (typeof document.createEvent === 'function') {
          var ev = document.createEvent('MouseEvents');
          ev.initEvent('click', true, true);
          el.dispatchEvent(ev);
          return true;
        }
      } catch (ignored) {}
      return false;
    }

    function fireEnter(el) {
      try {
        if (typeof el.focus === 'function') el.focus();
        var ev = null;
        if (typeof document.createEvent === 'function') {
          ev = document.createEvent('Events');
          ev.initEvent('keydown', true, true);
          ev.keyCode = 13;
          ev.which = 13;
          ev.key = 'Enter';
          el.dispatchEvent(ev);
          return true;
        }
      } catch (ignored) {}
      return false;
    }

    function tryAutoSelect() {
      if (autoDone) return false;
      try {
        if (!isStartupPicker()) return false;
        var name = readStored();
        if (!name || isExcluded(name)) return false;
        var root = document.body || document.documentElement;
        if (!root) return false;
        var leaves = leafElements(root);
        var label = null;
        for (var i = 0; i < leaves.length; i++) {
          if (leaves[i].text === name) { label = leaves[i].el; break; }
        }
        if (!label) return false;
        var tile = clickableAncestor(label);
        autoDone = true;
        fireClick(tile);
        /* If the click alone did not move the app off the picker (some
           leanback builds activate on Enter, not click), focus the tile
           and send Enter once, shortly after. */
        setTimeout(function () {
          try {
            if (isStartupPicker()) fireEnter(tile);
          } catch (ignored) {}
        }, 400);
        return true;
      } catch (ignored) { return false; }
    }

    JSON.__bishalYtvProfileV1 = function () {
      if (armed) return;
      armed = true;
      try {
        if (typeof document.addEventListener === 'function') {
          document.addEventListener('click', recordFromClick, true);
        }
        setInterval(function () {
          try {
            ticks++;
            if (ticks > 120) return; /* ~60s max, then stop watching. */
            if (autoDone) return;
            tryAutoSelect();
          } catch (ignored) {}
        }, 500);
      } catch (ignored) {}
    };

    /* The picker can appear at startup before any player response, so arm
       as soon as the document is ready (the response filter also arms it
       on the first API response). */
    try {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
          JSON.__bishalYtvProfileV1();
        });
      } else {
        JSON.__bishalYtvProfileV1();
      }
    } catch (ignored) {}
  } catch (ignored) {}
}());
