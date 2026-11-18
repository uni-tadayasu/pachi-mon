#!/usr/bin/env node
'use strict';
/* Lists the art the game requests (exact URLs, version queries included) for the
 * service worker: the core set is stored at install, the rest on request. */
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..');
// Art provenance describes old reference sheets too; those are not runtime
// dependencies and must not silently enlarge the player's offline download.
const provenance = new Set(['offline-manifest.json','traveller-female-manifest.json','world-art-v33-manifest.json']);
const sources = ['index.html', ...fs.readdirSync(root).filter(f => f.endsWith('.js')), 'assets/creatures-individual-catalog.js',
  ...fs.readdirSync(path.join(root, 'assets')).filter(f => f.endsWith('.json') && !provenance.has(f)).map(f => `assets/${f}`)];
const urls = new Set();
for (const file of sources) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  for (const m of text.matchAll(/assets\/[A-Za-z0-9_\-/]+\.(?:webp|png|json|js)(?:\?v=[A-Za-z0-9_.-]+)?/g)) urls.add(m[0]);
  // Some loaders join 'assets/' with a bare file name.
  for (const m of text.matchAll(/['"`]([A-Za-z0-9_-]+\.(?:webp|png))['"`]/g)) if (fs.existsSync(path.join(root, 'assets', m[1]))) urls.add(`assets/${m[1]}`);
  // Manifests list sheet files relative to assets/.
  if (file.endsWith('.json')) for (const m of text.matchAll(/"([A-Za-z0-9_-]+\.(?:webp|png))"/g)) urls.add(`assets/${m[1]}`);
}
const skip = /^assets\/(dex\/|ogp-|apple-touch|favicon|icon-|cover-pixel|offline-manifest\.json)/; // the list never lists itself
const files = [...urls].filter(url => !skip.test(url)).filter(url => fs.existsSync(path.join(root, url.split('?')[0]))).sort()
  .map(url => ({ url, bytes: fs.statSync(path.join(root, url.split('?')[0])).size }));
const core = files.filter(f => /^assets\/(traveller-|environment-|battle-landscapes|cover-handheld|creatures-(individual-)?(catalog|manifest|designs)|creatures-evolution-manifest|creatures-manifest)/.test(f.url)).map(f => f.url);
const manifest = { version: process.env.OFFLINE_VERSION || new Date().toISOString().slice(0, 10), files, core,
  totalBytes: files.reduce((sum, f) => sum + f.bytes, 0), coreBytes: files.filter(f => core.includes(f.url)).reduce((sum, f) => sum + f.bytes, 0) };
fs.writeFileSync(path.join(root, 'assets', 'offline-manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log(`Offline manifest: ${files.length} files, ${(manifest.totalBytes / 1048576).toFixed(1)} MB (core ${core.length}, ${(manifest.coreBytes / 1048576).toFixed(1)} MB)`);
