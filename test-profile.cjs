/* Test patches/profile-remember.js in Node vm with a fake DOM that mimics
   the YouTube TV "Who's watching?" picker: profile tiles (avatar + name +
   byline), a Guest tile, and an Add account tile. Runs on the Mac mini.
   Each section gets a fresh vm context (fresh patch state). */
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const profileSrc = fs.readFileSync('/Users/bishalmistri/ytv-patch/patches/profile-remember.js', 'utf8');

function createHarness() {
  const documentListeners = { click: [], DOMContentLoaded: [] };
  const storage = new Map();
  const timeouts = [];
  let intervalFn = null;
  let intervalMs = 0;

  function makeEl(tag, ownText) {
    const el = {
      tagName: (tag || 'div').toUpperCase(),
      style: {},
      children: [],
      parentNode: null,
      ownText: ownText || '',
      className: '',
      attributes: {},
      listeners: {},
      clicked: false,
      focused: false,
      appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
      removeChild(child) {
        const i = el.children.indexOf(child);
        if (i >= 0) { el.children.splice(i, 1); child.parentNode = null; }
        return child;
      },
      getElementsByTagName(t) {
        const out = [];
        const walk = (n) => {
          for (const c of n.children) {
            if (t === '*' || c.tagName === t.toUpperCase()) out.push(c);
            walk(c);
          }
        };
        walk(el);
        return out;
      },
      getAttribute(name) { return name in el.attributes ? el.attributes[name] : null; },
      setAttribute(name, value) { el.attributes[name] = String(value); },
      addEventListener(ev, fn) { (el.listeners[ev] = el.listeners[ev] || []).push(fn); },
      fire(ev, event) { (el.listeners[ev] || []).forEach((fn) => fn(event || {})); },
      click() {
        el.clicked = true;
        // A real click bubbles to document; the patch listens on document (capture).
        documentListeners.click.forEach((fn) => fn({ target: el, type: 'click' }));
        el.fire('click', { target: el, type: 'click' });
      },
      focus() { el.focused = true; },
      dispatchEvent(ev) { el.fire(ev.type, ev); return true; },
    };
    Object.defineProperty(el, 'textContent', {
      get() {
        if (el.children.length === 0) return el.ownText;
        return el.children.map((c) => c.textContent).join('\n');
      },
      set(v) { el.ownText = v; },
    });
    return el;
  }

  const head = makeEl('head');
  const body = makeEl('body');
  const html = makeEl('html');
  html.appendChild(head);
  html.appendChild(body);

  const sandbox = {
    /* A fresh JSON registry per harness: the patch guards on
       JSON.__bishalYtvProfileV1, and the real shared JSON would make the
       second harness return early without arming. */
    JSON: {},
    console: console,
    Date: Date,
    window: {
      localStorage: {
        getItem: (k) => (storage.has(k) ? storage.get(k) : null),
        setItem: (k, v) => storage.set(k, String(v)),
        removeItem: (k) => storage.delete(k),
      },
    },
    document: {
      documentElement: html,
      head: head,
      body: body,
      readyState: 'complete',
      createElement: (tag) => makeEl(tag),
      getElementsByTagName: (tag) => html.getElementsByTagName(tag),
      addEventListener: (ev, fn) => { (documentListeners[ev] = documentListeners[ev] || []).push(fn); },
      createEvent: () => ({
        type: '', keyCode: 0, which: 0, key: '',
        initEvent(type) { this.type = type; },
      }),
    },
    location: { hash: '', protocol: 'https:', hostname: 'www.youtube.com' },
    setInterval: (fn, ms) => { intervalFn = fn; intervalMs = ms; return 1; },
    clearInterval: () => {},
    setTimeout: (fn) => { timeouts.push(fn); return timeouts.length; },
    clearTimeout: () => {},
  };

  vm.createContext(sandbox);
  vm.runInContext(profileSrc, sandbox);
  assert.strictEqual(typeof sandbox.JSON.__bishalYtvProfileV1, 'function', 'profile helper not registered');
  sandbox.JSON.__bishalYtvProfileV1();
  assert.ok(intervalFn, 'setInterval was not called');
  assert.strictEqual(intervalMs, 500, 'watch interval must be 500ms');
  // Arming twice must not create a second interval.
  const firstInterval = intervalFn;
  sandbox.JSON.__bishalYtvProfileV1();
  assert.strictEqual(intervalFn, firstInterval, 'arming must be idempotent');

  /* Build the picker DOM: title + two profile tiles + Guest + Add account. */
  function buildPicker() {
    body.className = 'WEB_PAGE_TYPE_ACCOUNT_SELECTOR';
    body.appendChild(makeEl('div', "Who's watching?"));
    const mkTile = (name, byline) => {
      const tile = makeEl('div');
      tile.setAttribute('tabindex', '0');
      const img = makeEl('img');
      const nameEl = makeEl('span', name);
      tile.appendChild(img);
      tile.appendChild(nameEl);
      if (byline) tile.appendChild(makeEl('span', byline));
      body.appendChild(tile);
      return { tile, img, nameEl };
    };
    const t1 = mkTile('Bishal Mistri', 'bishal@example.com');
    const t2 = mkTile('Asha Mistri', 'asha@example.com');
    const guest = mkTile('Guest', '');
    const add = makeEl('div');
    add.appendChild(makeEl('span', 'Add account'));
    body.appendChild(add);
    const watchGuest = makeEl('button', 'Watch as guest');
    body.appendChild(watchGuest);
    return { t1, t2, guest, add, watchGuest };
  }

  return {
    sandbox, body, html, storage, makeEl,
    interval: () => intervalFn(),
    fireTimeouts: () => timeouts.forEach((fn) => fn()),
    buildPicker,
  };
}

/* --- 1. Auto-select clicks the recorded profile tile. --- */
{
  const h = createHarness();
  const p = h.buildPicker();
  h.storage.set('yt.bishal.lastProfile', 'Bishal Mistri');
  h.interval();
  assert.ok(p.t1.tile.clicked, 'recorded profile tile must be clicked');
  assert.ok(!p.t2.tile.clicked, 'other profile tile must NOT be clicked');
  assert.ok(!p.guest.tile.clicked, 'Guest tile must NOT be clicked');
  assert.ok(!p.add.clicked, 'Add account tile must NOT be clicked');
  // The Enter fallback fires only if the picker is still showing after the
  // click; here the click "worked", so the app navigates away and the
  // picker DOM is gone. Simulate that and confirm no Enter is sent.
  h.body.children.length = 0;
  h.body.className = 'WEB_PAGE_TYPE_BROWSE';
  h.fireTimeouts();
  assert.ok(!p.t1.tile.focused, 'no Enter fallback when the picker is already gone');
}

/* --- 2. No stored profile: nothing is clicked. --- */
{
  const h = createHarness();
  const p = h.buildPicker();
  h.interval();
  assert.ok(!p.t1.tile.clicked && !p.t2.tile.clicked, 'no click without a stored profile');
}

/* --- 3. Stored profile not on the picker: nothing is clicked. --- */
{
  const h = createHarness();
  const p = h.buildPicker();
  h.storage.set('yt.bishal.lastProfile', 'Someone Else');
  h.interval();
  assert.ok(!p.t1.tile.clicked && !p.t2.tile.clicked && !p.guest.tile.clicked, 'no click for an unknown profile');
}

/* --- 4. Recording: clicking a profile tile stores its name. --- */
{
  const h = createHarness();
  const p = h.buildPicker();
  p.t2.img.click(); // click the avatar of the second profile
  assert.strictEqual(h.storage.get('yt.bishal.lastProfile'), 'Asha Mistri', 'click must record the tile profile name');
}

/* --- 5. Recording ignores Guest and Add account. --- */
{
  const h = createHarness();
  const p = h.buildPicker();
  p.guest.img.click();
  assert.strictEqual(h.storage.get('yt.bishal.lastProfile'), undefined, 'Guest must not be recorded');
  p.add.children[0].click();
  assert.strictEqual(h.storage.get('yt.bishal.lastProfile'), undefined, 'Add account must not be recorded');
  p.watchGuest.click();
  assert.strictEqual(h.storage.get('yt.bishal.lastProfile'), undefined, 'Watch as guest must not be recorded');
}

/* --- 6. No picker (normal home screen): nothing happens. --- */
{
  const h = createHarness();
  h.body.className = 'WEB_PAGE_TYPE_BROWSE';
  h.body.appendChild(h.makeEl('div', 'Home'));
  h.storage.set('yt.bishal.lastProfile', 'Bishal Mistri');
  h.interval();
  assert.ok(!h.body.children.some((c) => c.clicked), 'no click when the picker is not showing');
}

/* --- 7. Picker detected by title text alone (no page class). --- */
{
  const h = createHarness();
  h.body.className = '';
  h.body.appendChild(h.makeEl('div', "Who's watching?"));
  const solo = h.makeEl('div');
  solo.setAttribute('tabindex', '0');
  solo.appendChild(h.makeEl('img'));
  solo.appendChild(h.makeEl('span', 'Bishal Mistri'));
  h.body.appendChild(solo);
  h.storage.set('yt.bishal.lastProfile', 'Bishal Mistri');
  h.interval();
  assert.ok(solo.clicked, 'title-text detection must also trigger auto-select');
}

/* --- 8. Click on empty picker background records nothing. --- */
{
  const h = createHarness();
  h.buildPicker();
  const bg = h.makeEl('div', '');
  h.body.appendChild(bg);
  bg.click();
  assert.strictEqual(h.storage.get('yt.bishal.lastProfile'), undefined, 'background click must record nothing');
}

console.log('ALL PROFILE TESTS PASSED');
