/* Test our response-filter.js in Node vm: ad fields stripped, content kept,
   reviver and SyntaxError behaviour preserved, install idempotent. */
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const filterSrc = fs.readFileSync('/Users/bishalmistri/ytv-patch/patches/response-filter.js', 'utf8');
const loadingSrc = fs.readFileSync('/Users/bishalmistri/ytv-patch/patches/loading-indicator.js', 'utf8');

// Fake browser-ish globals the payload touches.
const logs = [];
const sandbox = {
  console: { log: (m) => logs.push(String(m)) },
  JSON: JSON,
  document: { body: null, createElement: () => ({ style: {} }), getElementsByTagName: () => [] },
  location: { hash: '#/watch', protocol: 'https:', hostname: 'www.youtube.com' },
  setInterval: () => 1,
  clearTimeout: () => {},
  setTimeout: (fn) => 0,
  Date: Date,
};
vm.createContext(sandbox);
// Load loading-indicator first (it registers on JSON), then the filter.
vm.runInContext(loadingSrc, sandbox);
vm.runInContext(filterSrc, sandbox);
assert.ok(logs.some((l) => l.includes('BISHAL_YTV_FILTER installed')), 'filter install log missing');
const parse = sandbox.JSON.parse;

// 1. Player response: ad fields stripped, content kept.
const player = parse(JSON.stringify({
  responseContext: { serviceTrackingParams: [] },
  streamingData: { formats: [{ itag: 18 }] },
  videoDetails: { videoId: 'dQw4w9WgXcQ', title: 'Test' },
  playabilityStatus: { status: 'OK' },
  adPlacements: [{ adPlacementRenderer: {} }],
  adSlots: [{ adSlotRenderer: {} }],
  playerAds: true,
}));
assert.ok(Array.isArray(player.adPlacements) && player.adPlacements.length === 0);
assert.ok(Array.isArray(player.adSlots) && player.adSlots.length === 0);
assert.strictEqual(player.playerAds, false);
assert.strictEqual(player.streamingData.formats[0].itag, 18);
assert.strictEqual(player.videoDetails.videoId, 'dQw4w9WgXcQ');
assert.strictEqual(player.playabilityStatus.status, 'OK');

// 2. Browse response: adSlotRenderer entries dropped at section + shelf level.
const browse = parse(JSON.stringify({
  responseContext: {},
  contents: { tvBrowseRenderer: { content: { tvSurfaceContentRenderer: { content: {
    sectionListRenderer: { contents: [
      { shelfRenderer: { content: { horizontalListRenderer: { items: [
        { videoRenderer: { videoId: 'a' } },
        { adSlotRenderer: {} },
        { videoRenderer: { videoId: 'b' } },
      ] } } } },
      { adSlotRenderer: {} },
      { shelfRenderer: { content: { horizontalListRenderer: { items: [
        { videoRenderer: { videoId: 'c' } },
      ] } } } },
    ] } } } } } },
}));
const sections = browse.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents;
assert.strictEqual(sections.length, 2, 'ad section should be dropped');
assert.strictEqual(sections[0].shelfRenderer.content.horizontalListRenderer.items.length, 2, 'ad item should be dropped');
assert.strictEqual(sections[0].shelfRenderer.content.horizontalListRenderer.items[0].videoRenderer.videoId, 'a');
assert.strictEqual(sections[1].shelfRenderer.content.horizontalListRenderer.items[0].videoRenderer.videoId, 'c');

// 3. Nested playerResponse wrapper.
const wrapped = parse(JSON.stringify({
  responseContext: {},
  playerResponse: { adPlacements: [1, 2], streamingData: { formats: [] } },
}));
assert.ok(Array.isArray(wrapped.playerResponse.adPlacements) && wrapped.playerResponse.adPlacements.length === 0);
assert.strictEqual(wrapped.playerResponse.streamingData.formats.length, 0);

// 4. Clean responses pass through untouched; arrays and scalars untouched.
assert.strictEqual(JSON.stringify(parse('[1,2,3]')), '[1,2,3]');
assert.strictEqual(parse('"hello"'), 'hello');
assert.strictEqual(parse('42'), 42);
const clean = parse(JSON.stringify({ a: 1, b: { c: [1, 2] } }));
assert.strictEqual(JSON.stringify(clean), JSON.stringify({ a: 1, b: { c: [1, 2] } }));

// 5. Reviver still works.
const revived = parse('{"x":1}', (k, v) => (k === 'x' ? v + 1 : v));
assert.strictEqual(revived.x, 2);

// 6. SyntaxError still propagates.
assert.throws(() => parse('{bad json'), SyntaxError);

// 7. Idempotent: re-running the filter source is a no-op (same parse function).
const parseBefore = sandbox.JSON.parse;
vm.runInContext(filterSrc, sandbox);
assert.strictEqual(sandbox.JSON.parse, parseBefore, 're-install must be a no-op');

// 8. Loading indicator registered on JSON.
assert.strictEqual(typeof sandbox.JSON.__bishalYtvLoadingV1, 'function');

console.log('ALL JS FILTER TESTS PASSED');
console.log('logs:', logs.join(' | '));
