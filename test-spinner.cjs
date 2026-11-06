/* Test the loading-indicator.js spinner in Node vm with a fake DOM:
   a stalled video shows a centered ring spinner with NO text, and the
   spinner clears on playing. Runs on the Mac mini. */
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const loadingSrc = fs.readFileSync('/Users/bishalmistri/ytv-patch/patches/loading-indicator.js', 'utf8');

function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    style: {},
    children: [],
    parentNode: null,
    textContent: '',
    className: '',
    listeners: {},
    appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
    removeChild(child) {
      const i = el.children.indexOf(child);
      if (i >= 0) { el.children.splice(i, 1); child.parentNode = null; }
      return child;
    },
    addEventListener(ev, fn) { (el.listeners[ev] = el.listeners[ev] || []).push(fn); },
    fire(ev) { (el.listeners[ev] || []).forEach((fn) => fn()); },
  };
  return el;
}

const head = makeEl('head');
const body = makeEl('body');
const video = makeEl('video');
video.readyState = 0;
video.currentTime = 0;

let intervalFn = null;
let timeoutFn = null;
const sandbox = {
  JSON: JSON,
  console: console,
  Date: Date,
  document: {
    head: head,
    body: body,
    createElement: (tag) => makeEl(tag),
    getElementsByTagName: (tag) => (tag === 'video' ? [video] : tag === 'head' ? [head] : []),
  },
  location: { hash: '#/watch', protocol: 'https:', hostname: 'www.youtube.com' },
  setInterval: (fn) => { intervalFn = fn; return 1; },
  clearTimeout: () => {},
  setTimeout: (fn) => { timeoutFn = fn; return 1; },
};
vm.createContext(sandbox);
vm.runInContext(loadingSrc, sandbox);
assert.strictEqual(typeof sandbox.JSON.__bishalYtvLoadingV1, 'function', 'loading helper not registered');

// Arm the helper, then run one interval tick with a stalled video.
sandbox.JSON.__bishalYtvLoadingV1();
assert.ok(intervalFn, 'setInterval was not called');
intervalFn();
assert.ok(timeoutFn, 'stall timer was not armed for a stalled video');

// Fire the 600ms stall timer: the spinner must appear.
timeoutFn();
const overlays = body.children.filter((c) => c.tagName === 'DIV');
assert.strictEqual(overlays.length, 1, 'exactly one overlay expected, got ' + overlays.length);
const overlay = overlays[0];
assert.strictEqual(overlay.textContent, '', 'overlay must have NO text');
assert.ok(overlay.style.cssText.includes('position:fixed'), 'overlay must be position:fixed');
assert.ok(overlay.style.cssText.includes('top:50%'), 'overlay must be top:50%');
assert.ok(overlay.style.cssText.includes('left:50%'), 'overlay must be left:50%');
assert.ok(overlay.style.cssText.includes('translate(-50%,-50%)'), 'overlay must be centered with translate');
assert.ok(overlay.style.cssText.includes('pointer-events:none'), 'overlay must ignore pointer events');
assert.strictEqual(overlay.children.length, 1, 'overlay must hold exactly the ring');
assert.strictEqual(overlay.children[0].className, '__bishalYtvSpinRing', 'ring class missing');

// A <style> with the spin keyframes must have been injected exactly once.
const styles = head.children.filter((c) => c.tagName === 'STYLE');
assert.strictEqual(styles.length, 1, 'exactly one style element expected');
assert.ok(styles[0].textContent.includes('@keyframes __bishalYtvSpin'), 'spin keyframes missing');
assert.ok(styles[0].textContent.includes('border-top-color:#fff'), 'solid white top border missing');
assert.ok(styles[0].textContent.includes('rgba(255,255,255,0.25)'), 'semi-transparent track border missing');

// Playing clears the spinner.
video.fire('playing');
assert.strictEqual(body.children.length, 0, 'overlay must be removed on playing');

// Second stall re-shows the same spinner but does not inject a second <style>.
intervalFn();
timeoutFn();
assert.strictEqual(head.children.filter((c) => c.tagName === 'STYLE').length, 1, 'style must be injected once only');
assert.strictEqual(body.children.length, 1, 'spinner must re-appear on a second stall');

console.log('ALL SPINNER TESTS PASSED');
