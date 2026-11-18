/* Pachi Monsters — offline play.
 * The page, its code and the core art are stored at install, so the game starts
 * without a connection. Pages are fetched network-first (updates arrive whenever
 * online); code and art are served cache-first by exact versioned URL and older
 * versions are pruned when a new page is stored. Creature art is stored as it is
 * used, or all at once on request. Server and peer traffic is never cached.
 * v21: the page also links the local link code and prefetches its QR code
 * libraries, so battles and trades with a nearby device work offline too.
 * v22: battle items and rhythm; the new code versions are stored on install.
 * v23: the recorded title theme (assets/music, mp3) is stored with the page.
 * v25: condition effects every turn; the new effects code version is stored on install.
 * v26: the special three join link battles and Floravelle has new art; the new
 *   code and image versions are stored on install.
 * v27: Floravelle's art finished in high detail (a new image version).
 * v28: held-key fix, the hidden admin recovery screen and the キラシード name.
 * v29: the hidden recovery screen asks the server for the operator seat explicitly.
 * © 2026 KASAI SOLUTIONS INC. */
'use strict';
const SHELL = 'pachi-shell-v1', ART = 'pachi-art-v1', FONTS = 'pachi-fonts-v1';
const KEEP = [SHELL, ART, FONTS];
const ASSET = /\.(?:js|css|webp|png|svg|json|webmanifest|woff2?|ico|mp3)$/i;
const scope = () => new URL(self.registration?.scope || self.location.href);
const local = path => new URL(path, scope()).href;

// Same-origin files the page links or loads directly: scripts, styles, icons, images.
function shellUrls(html) {
  const urls = new Set(['manifest.webmanifest', 'assets/offline-manifest.json']);
  for (const m of String(html).matchAll(/\b(?:src|href)="([^"#]+)"/g)) {
    const value = m[1];
    if (/^(?:[a-z]+:|\/\/|data:)/i.test(value)) continue;
    const pathname = value.split('?')[0];
    if (ASSET.test(pathname)) urls.add(value);
  }
  return [...urls].map(local);
}
// The cache key for a page: the root and index.html share one entry.
function pageKey(url) {
  const u = new URL(url), base = scope();
  let path = u.pathname;
  if (path.endsWith('/')) path += 'index.html';
  if (u.origin === base.origin && path === new URL('index.html', base).pathname) return local('index.html');
  return u.origin + path;
}
async function store(cacheName, request, response) {
  if (!response || (!response.ok && response.type !== 'opaque')) return response;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  return response;
}
async function addAll(cacheName, urls, progress) {
  const cache = await caches.open(cacheName); let done = 0, failed = 0;
  for (const url of urls) {
    try {
      if (!(await cache.match(url))) {
        const response = await fetch(url, { cache: 'reload' });
        if (!response.ok) throw new Error(String(response.status));
        await cache.put(url, response);
      }
    } catch (_) { failed += 1; }
    done += 1; progress?.(done, failed);
  }
  return { done, failed };
}
async function offlineManifest() {
  const url = local('assets/offline-manifest.json');
  try { const response = await fetch(url, { cache: 'no-cache' }); if (response.ok) { await store(SHELL, url, response.clone()); return await response.json(); } } catch (_) {}
  const cached = await caches.match(url); return cached ? cached.json() : { files: [], core: [] };
}
// Drop older versions (same path, different query) of the files the stored page uses.
async function prune(html) {
  const wanted = new Set(shellUrls(html)), byPath = new Map();
  for (const url of wanted) byPath.set(new URL(url).pathname, url);
  for (const name of [SHELL, ART]) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      const u = new URL(request.url), current = byPath.get(u.pathname);
      if (current && current !== request.url) await cache.delete(request);
    }
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const page = await fetch(local('index.html'), { cache: 'reload' });
    if (!page.ok) throw new Error('index.html unavailable');
    const html = await page.clone().text();
    await (await caches.open(SHELL)).put(local('index.html'), page);
    await addAll(SHELL, shellUrls(html));
    const manifest = await offlineManifest();
    await addAll(ART, (manifest.core || []).map(local));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('pachi-') && !KEEP.includes(name)) await caches.delete(name);
    await self.clients.claim();
  })());
});

async function page(request) {
  const key = pageKey(request.url);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      await store(SHELL, key, response.clone());
      if (key === local('index.html')) response.clone().text().then(prune).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await caches.match(key) || (request.mode === 'navigate' ? await caches.match(local('index.html')) : null);
    if (cached) return cached;
    throw error;
  }
}
async function asset(request) {
  const exact = await caches.match(request);
  if (exact) return exact;
  try {
    const response = await fetch(request);
    const name = /\.(?:webp|png)$/i.test(new URL(request.url).pathname) ? ART : SHELL;
    return await store(name, request, response);
  } catch (error) {
    // Offline and never stored at this version: an older copy is better than nothing.
    const older = await caches.match(request, { ignoreSearch: true });
    if (older) return older;
    throw error;
  }
}
async function font(request) {
  const cached = await caches.match(request);
  const network = fetch(request).then(response => store(FONTS, request, response)).catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === scope().origin) {
    if (request.mode === 'navigate' || /\.html?$/i.test(url.pathname) || url.pathname.endsWith('/')) { event.respondWith(page(request)); return; }
    if (ASSET.test(url.pathname)) { event.respondWith(asset(request)); return; }
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') { event.respondWith(font(request)); return; }
  // Everything else (operator service, exchange server, PeerJS) goes straight to the network.
});

self.addEventListener('message', event => {
  const data = event.data || {}, reply = message => event.source?.postMessage?.(message);
  if (data.type === 'offline-status') {
    event.waitUntil((async () => {
      const manifest = await offlineManifest(), cache = await caches.open(ART);
      let stored = 0, bytes = 0;
      for (const file of manifest.files || []) if (await cache.match(local(file.url))) { stored += 1; bytes += file.bytes; }
      reply({ type: 'offline-status', shell: !!(await caches.match(local('index.html'))), stored, total: (manifest.files || []).length, bytes, totalBytes: manifest.totalBytes || 0 });
    })());
  }
  if (data.type === 'offline-store-all') {
    event.waitUntil((async () => {
      const manifest = await offlineManifest(), urls = (manifest.files || []).map(f => local(f.url));
      const result = await addAll(ART, urls, (done, failed) => reply({ type: 'offline-progress', done, failed, total: urls.length }));
      reply({ type: 'offline-done', ...result, total: urls.length });
    })());
  }
});
