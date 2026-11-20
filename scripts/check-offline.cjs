#!/usr/bin/env node
'use strict';
/* Offline play: the service worker stores the page, code and core art at
 * install; pages are network-first, assets cache-first by exact version, older
 * versions are pruned, server traffic is never cached, and all art can be
 * stored on request. The manifest, icons and offline list match the files. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const BASE = 'https://game.example/';

// ── A small service worker world: caches, network, clients.
class FakeResponse {
  constructor(body, { status = 200, type = 'basic' } = {}) { this.body = body; this.status = status; this.ok = status >= 200 && status < 300; this.type = type; }
  clone() { return new FakeResponse(this.body, { status: this.status, type: this.type }); }
  async text() { return String(this.body); }
  async json() { return JSON.parse(this.body); }
}
const keyOf = request => typeof request === 'string' ? request : request.url;
const cacheWriteFailures = new Set();
class FakeCache {
  constructor() { this.entries = new Map(); }
  async match(request, options = {}) {
    const key = keyOf(request); if (this.entries.has(key)) return this.entries.get(key).clone();
    if (options.ignoreSearch) { const bare = key.split('?')[0]; for (const [k, v] of this.entries) if (k.split('?')[0] === bare) return v.clone(); }
    return undefined;
  }
  async put(request, response) {
    if (cacheWriteFailures.has(keyOf(request))) throw Object.assign(new Error('Storage quota exceeded'), { name: 'QuotaExceededError' });
    this.entries.set(keyOf(request), response.clone());
  }
  async keys() { return [...this.entries.keys()].map(url => ({ url })); }
  async delete(request) { return this.entries.delete(keyOf(request)); }
}
const store = new Map();
const caches = {
  async open(name) { if (!store.has(name)) store.set(name, new FakeCache()); return store.get(name); },
  async keys() { return [...store.keys()]; }, async delete(name) { return store.delete(name); },
  async match(request, options) { for (const cache of store.values()) { const hit = await cache.match(request, options); if (hit) return hit; } return undefined; }
};
let online = true; const requests = [];
const files = new Map();
function serve(url, body, type) { files.set(url, { body, type }); }
async function fetch(request) {
  const url = keyOf(request); requests.push(url);
  if (!online) throw new TypeError('offline');
  const file = files.get(url); if (!file) return new FakeResponse('missing', { status: 404 });
  return new FakeResponse(file.body, { type: file.type || 'basic' });
}
const listeners = {}, messages = [];
const self = {
  registration: { scope: BASE }, location: { href: BASE + 'sw.js' },
  addEventListener: (type, fn) => { listeners[type] = fn; }, skipWaiting: async () => { self.skipped = true; },
  clients: { claim: async () => { self.claimed = true; } }
};
const context = vm.createContext({ self, caches, fetch, URL, console, Promise, Map, Set, JSON, String, Error, TypeError, Response: { error: () => new FakeResponse('', { status: 0, type: 'error' }) } });
vm.runInContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), context);
const waitFor = async event => { await event.done; };
function fire(type, init) {
  let done = Promise.resolve(), responded = null;
  const event = { ...init, waitUntil: p => { done = Promise.resolve(p); }, respondWith: p => { responded = Promise.resolve(p); } };
  listeners[type](event); return { done: (async () => { await done; })(), responded: () => responded };
}

(async () => {
  // Serve the real page, its code and the offline list.
  serve(BASE + 'index.html', html); serve(BASE, html); // the host serves index.html for the root
  const linked = [...html.matchAll(/\b(?:src|href)="([^"#]+)"/g)].map(m => m[1]).filter(v => !/^(?:[a-z]+:|\/\/|data:)/i.test(v) && /\.(?:js|css|webp|png|svg|json|webmanifest|woff2?|ico|mp3)$/i.test(v.split('?')[0]));
  for (const url of linked) serve(BASE + url, 'asset:' + url);
  const offline = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'offline-manifest.json'), 'utf8'));
  serve(BASE + 'manifest.webmanifest', fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  serve(BASE + 'assets/offline-manifest.json', JSON.stringify(offline));
  for (const file of offline.files) serve(BASE + file.url, 'art:' + file.url);
  assert(linked.some(v => v.startsWith('pachi-ui.css?v=')) && linked.some(v => v.startsWith('battle-vfx.js?v=')), 'the page links versioned code');

  // ── Install: page, every linked file and the core art.
  await waitFor(fire('install', {}));
  const shell = store.get('pachi-shell-v1'), art = store.get('pachi-art-v1');
  assert(await shell.match(BASE + 'index.html'), 'the page is stored');
  for (const url of linked) assert(await shell.match(BASE + url), `${url} is stored at install`);
  for (const url of offline.core) assert(await art.match(BASE + url), `core art ${url} is stored at install`);
  assert(offline.files.length > offline.core.length, 'the rest waits for use or a request');
  assert(self.skipped, 'a new worker takes over at once');
  // Existing installs may still hold retired designs and older Futo thumbnails.
  const retired = ['galdoras-front-v65.png','galdoras-back-v65.png','futo.png','futo-front-v2.png','futo-back-v2.png',
    ...['nullmie','nullva','zeroveil'].flatMap(id=>[`${id}-v39.png`,`${id}-v46.png`]),
    ...Array.from({length:6},(_,i)=>`offdex-v54-0${i+1}.png`),'dex/futo.webp?v=20261120-bold-pixels-v66'];
  for (const url of retired) await art.put(BASE+'assets/'+url,new FakeResponse('retired'));
  await shell.put(BASE+'assets/futo-front-v2.png',new FakeResponse('retired-shell-copy'));
  const currentFuto=BASE+'assets/dex/futo.webp?v=20261120-originality-v67';
  await art.put(currentFuto,new FakeResponse('current-futo'));
  await waitFor(fire('activate', {})); assert(self.claimed);
  for (const url of retired) assert.equal(await caches.match(BASE+'assets/'+url),undefined,`retired ${url} must be removed`);
  assert.equal(await (await art.match(currentFuto)).text(),'current-futo','current thumbnail survives cleanup');
  for (const url of offline.core) assert(await art.match(BASE+url),'unrelated cached art survives cleanup');
  const revised=offline.files.filter(f=>/assets\/original-.*-v67\.png$/.test(f.url));
  assert.equal(revised.length,5,'all five revised atlases are available offline');
  assert(revised.every(f=>offline.core.includes(f.url)),'revised designs are installed with core art');
  assert(!offline.files.some(f=>retired.some(url=>f.url.split('?')[0]==='assets/'+url.split('?')[0])),'offline downloads exclude retired portraits');

  // ── Offline launch: the stored page answers, for the root and for start_url.
  online = false;
  for (const url of [BASE, BASE + 'index.html', BASE + '?source=app']) {
    const event = fire('fetch', { request: { url, method: 'GET', mode: 'navigate' } });
    const response = await event.responded(); assert(response, url); assert.equal(await response.text(), html, `${url} works offline`);
  }
  // Code is served from the cache without the network.
  const before = requests.length, cssUrl = BASE + linked.find(v => v.startsWith('pachi-ui.css'));
  assert.equal(await (await fire('fetch', { request: { url: cssUrl, method: 'GET', mode: 'no-cors' } }).responded()).text(), 'asset:' + cssUrl.slice(BASE.length));
  assert.equal(requests.length, before, 'cached code needs no network');
  // Art never seen before is unavailable offline, but an older version is better than nothing.
  await art.put(BASE + 'assets/arvelion.png?v=old', new FakeResponse('old-lion'));
  const lionUrl = BASE + offline.files.find(f => f.url.startsWith('assets/arvelion.png')).url;
  assert.equal(await (await fire('fetch', { request: { url: lionUrl, method: 'GET', mode: 'no-cors' } }).responded()).text(), 'old-lion');

  // ── An update must remain usable if the connection drops after its HTML but
  // before its newly versioned assets. Prune only after replacement is stored.
  online = true;
  await shell.put(BASE + 'pachi-ui.css?v=19990101', new FakeResponse('stale'));
  const updated = html.replace(/pachi-ui\.css\?v=[^"]+/, 'pachi-ui.css?v=29990101');
  serve(BASE + 'index.html', updated); serve(BASE, updated); serve(BASE + 'pachi-ui.css?v=29990101', 'new-css');
  const nav = fire('fetch', { request: { url: BASE, method: 'GET', mode: 'navigate' } });
  assert.equal(await (await nav.responded()).text(), updated, 'online pages come from the network');
  assert.equal(await (await shell.match(BASE + 'index.html')).text(), updated, 'the stored page follows the update');
  assert(await shell.match(cssUrl), 'the prior working version survives before the new URL is cached');
  assert(await shell.match(BASE + 'pachi-ui.css?v=19990101'), 'an HTML update alone cannot discard older variants');
  online = false;
  const interrupted = await fire('fetch', { request: { url: BASE + 'pachi-ui.css?v=29990101', method: 'GET', mode: 'no-cors' } }).responded();
  assert.equal(await interrupted.text(), 'asset:' + cssUrl.slice(BASE.length), 'the new HTML can still obtain its older stylesheet offline');
  online = true;
  const fresh = await fire('fetch', { request: { url: BASE + 'pachi-ui.css?v=29990101', method: 'GET', mode: 'no-cors' } }).responded();
  assert.equal(await fresh.text(), 'new-css'); assert(await shell.match(BASE + 'pachi-ui.css?v=29990101'), 'new versions are stored on first use');
  await fire('fetch', { request: { url: BASE, method: 'GET', mode: 'navigate' } }).responded();
  assert.equal(await shell.match(cssUrl), undefined, 'a secured replacement permits cleanup on the next visit');
  assert.equal(await shell.match(BASE + 'pachi-ui.css?v=19990101'), undefined, 'all older variants are removed once their replacement is safe');

  // ── A full cache is not a failed network connection. Return fresh content,
  // even when an older image exists and the new response cannot be persisted.
  const quotaArt = BASE + 'assets/traveller-hero-v33.png?v=quota-check';
  serve(quotaArt, 'fresh-network-pixels'); cacheWriteFailures.add(quotaArt);
  const uncacheableImage = await fire('fetch', { request: { url: quotaArt, method: 'GET', mode: 'no-cors' } }).responded();
  assert.equal(await uncacheableImage.text(), 'fresh-network-pixels', 'cache quota failure must not discard a successful image response');
  assert.equal(await art.match(quotaArt), undefined, 'the failing write was exercised');
  cacheWriteFailures.delete(quotaArt);
  const storedPage = await (await shell.match(BASE + 'index.html')).text(), livePage = updated + '\n<!-- network-only update -->';
  serve(BASE, livePage); cacheWriteFailures.add(BASE + 'index.html');
  const uncacheablePage = await fire('fetch', { request: { url: BASE, method: 'GET', mode: 'navigate' } }).responded();
  assert.equal(await uncacheablePage.text(), livePage, 'cache quota failure must not replace a fresh page with the older cached page');
  assert.equal(await (await shell.match(BASE + 'index.html')).text(), storedPage, 'the previous offline page remains intact after a failed write');
  // A replacement stylesheet might already be cached (for example by another
  // open tab). That is not permission to prune the old shell's stylesheet when
  // the HTML that refers to the replacement could not itself be committed.
  const speculativeCss = 'pachi-ui.css?v=29990102-quota-check';
  await shell.put(BASE + speculativeCss, new FakeResponse('already-cached-new-css'));
  const speculativePage = updated.replace('pachi-ui.css?v=29990101', speculativeCss);
  assert.notEqual(speculativePage, storedPage); serve(BASE, speculativePage);
  const uncommittedUpdate = await fire('fetch', { request: { url: BASE, method: 'GET', mode: 'navigate' } }).responded();
  assert.equal(await uncommittedUpdate.text(), speculativePage, 'the live network page still wins');
  assert.equal(await (await shell.match(BASE + 'index.html')).text(), storedPage, 'the failed HTML write keeps the old offline page');
  assert(await shell.match(BASE + 'pachi-ui.css?v=29990101'), 'an uncommitted page cannot prune CSS required by the retained offline page');
  cacheWriteFailures.delete(BASE + 'index.html'); serve(BASE, updated);

  // ── Installation has a stricter contract than a live request. A missing or
  // uncacheable required script cannot overwrite the working offline page or
  // force the new worker to take over.
  const installScript = 'traveller-art.js?v=install-failure';
  const installPage = updated.replace(/traveller-art\.js\?v=[^"]+/, installScript);
  assert.notEqual(installPage, updated, 'the install probe must request a new script version');
  serve(BASE + 'index.html', installPage); self.skipped = false;
  await assert.rejects(waitFor(fire('install', {})), /Required offline shell assets unavailable/, 'a missing required script rejects installation');
  assert.equal(self.skipped, false, 'an incomplete shell cannot activate');
  assert.equal(await (await shell.match(BASE + 'index.html')).text(), storedPage, 'a rejected install preserves the working offline page');
  serve(BASE + installScript, 'valid-install-script'); cacheWriteFailures.add(BASE + installScript);
  await assert.rejects(waitFor(fire('install', {})), /Required offline shell assets unavailable/, 'a script that cannot be cached also rejects installation');
  assert.equal(self.skipped, false, 'a failed shell write cannot activate');
  assert.equal(await (await shell.match(BASE + 'index.html')).text(), storedPage, 'a failed shell write preserves the working offline page');
  cacheWriteFailures.delete(BASE + installScript); serve(BASE + 'index.html', updated);

  // ── Server and peer traffic is never intercepted; fonts are kept.
  for (const url of ['https://pachi-mon-admin-hub.example/api/player', 'https://0.peerjs.com/peerjs/id', 'https://trades.example/api/trades']) {
    const event = fire('fetch', { request: { url, method: 'GET', mode: 'cors' } }); assert.equal(event.responded(), null, `${url} goes to the network`);
  }
  assert.equal(fire('fetch', { request: { url: BASE + 'api/x', method: 'POST', mode: 'cors' } }).responded(), null, 'writes are never cached');
  const fontCss = 'https://fonts.googleapis.com/css2?family=DotGothic16&display=swap'; serve(fontCss, '@font-face{}', 'opaque');
  assert.equal(await (await fire('fetch', { request: { url: fontCss, method: 'GET', mode: 'no-cors' } }).responded()).text(), '@font-face{}');
  online = false;
  assert.equal(await (await fire('fetch', { request: { url: fontCss, method: 'GET', mode: 'no-cors' } }).responded()).text(), '@font-face{}', 'fonts work offline');
  online = true;

  // ── Store everything on request, with progress; then report the status.
  const replies = []; const source = { postMessage: message => replies.push(message) };
  await waitFor(fire('message', { data: { type: 'offline-store-all' }, source }));
  const done = replies.find(m => m.type === 'offline-done');
  assert(done && done.total === offline.files.length && done.failed === 0, 'all art stored');
  assert(replies.filter(m => m.type === 'offline-progress').length === offline.files.length, 'progress for every file');
  replies.length = 0; await waitFor(fire('message', { data: { type: 'offline-status' }, source }));
  assert.deepEqual({ ...replies[0], bytes: undefined, totalBytes: undefined }, { type: 'offline-status', shell: true, stored: offline.files.length, total: offline.files.length, bytes: undefined, totalBytes: undefined });

  // ── The page side: manifest, icons, registration, the offline list.
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert(/<link rel="manifest" href="manifest\.webmanifest">/.test(html));
  assert.equal(manifest.display, 'standalone'); assert.equal(manifest.lang, 'ja'); assert(manifest.start_url && manifest.scope);
  for (const icon of manifest.icons) assert(fs.existsSync(path.join(root, icon.src)), icon.src);
  assert(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable') && manifest.icons.some(icon => icon.sizes === '192x192'));
  assert(/register\('sw\.js'\)/.test(html) && /offline-store-all/.test(html), 'the page registers the worker and offers storing everything');
  for (const file of offline.files) assert.equal(fs.statSync(path.join(root, file.url.split('?')[0])).size, file.bytes, `offline list is current for ${file.url}`);
  console.log(JSON.stringify({ ok: true, shellFiles: linked.length + 1, coreArt: offline.core.length, allArt: offline.files.length,
    checks: ['install stores page/code/core art', 'offline launch (root, index, start_url)', 'cache-first code', 'older-version fallback', 'interrupted updates preserve older assets', 'secured replacements allow pruning', 'cache quota preserves network image/page', 'uncommitted HTML cannot prune the working shell', 'failed installs preserve the working shell', 'server/peer traffic bypassed', 'fonts kept', 'store all with progress', 'manifest/icons/registration', 'offline list current'] }));
})().catch(error => { console.error(error); process.exit(1); });
