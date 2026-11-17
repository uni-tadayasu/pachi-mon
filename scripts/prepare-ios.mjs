#!/usr/bin/env node
// Build the offline web payload without copying server code, keys, or build tools.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'ios/PachiMon/Resources/Web');
const allowedFiles = new Set(['index.html', 'privacy.html', 'support.html', 'LICENSES.txt']);
for (const entry of await fs.readdir(root, { withFileTypes: true })) {
  if (entry.isFile() && /\.(?:js|css)$/.test(entry.name)) allowedFiles.add(entry.name);
}
for (const required of allowedFiles) await fs.access(path.join(root, required));
for (const required of ['assets', 'guide', 'monsters']) await fs.access(path.join(root, required));
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
for (const file of [...allowedFiles].sort()) await fs.copyFile(path.join(root, file), path.join(output, file));
for (const directory of ['assets', 'guide', 'monsters']) {
  await fs.cp(path.join(root, directory), path.join(output, directory), {
    recursive: true,
    filter: async source => !(await fs.lstat(source)).isSymbolicLink() && !path.basename(source).startsWith('.'),
  });
}
async function filesUnder(directory) {
  const files = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}
const csp = "default-src 'self' pachimon:; script-src 'self' pachimon: 'unsafe-inline'; style-src 'self' pachimon: 'unsafe-inline'; img-src 'self' pachimon: data: blob:; font-src 'self' pachimon:; media-src 'self' pachimon: blob:; connect-src 'self' pachimon: https://pachi-mon-admin-hub.hisa-0128-1996.chatgpt.site https://*.peerjs.com wss://*.peerjs.com; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'";
for (const file of await filesUnder(output)) {
  if (!file.endsWith('.html')) continue;
  let html = await fs.readFile(file, 'utf8');
  // Use the device's Japanese system fonts; no first-run font download.
  html = html.replace(/<link\b[^>]*href=["']https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/gi, '');
  html = html.replace(/<head>/i, '<head>\n<meta http-equiv="Content-Security-Policy" content="' + csp + '">');
  await fs.writeFile(file, html);
}
const missing = [];
for (const file of await filesUnder(output)) {
  if (!file.endsWith('.html')) continue;
  const html = await fs.readFile(file, 'utf8');
  for (const match of html.matchAll(/<(?:script|img|link)\b[^>]*\b(?:src|href)=["']([^"']+)["'][^>]*>/gi)) {
    const resource = match[1].replace(/&amp;/g, '&');
    if (/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(resource)) continue;
    if (match[0].includes('rel="sitemap"')) continue;
    const relative = decodeURIComponent(resource.split(/[?#]/)[0]);
    const target = path.resolve(path.dirname(file), relative);
    if (!target.startsWith(output + path.sep)) throw new Error('Resource escapes bundle: ' + resource);
    try { await fs.access(target); } catch { missing.push(path.relative(output,file) + ': ' + resource); }
  }
}
if (missing.length) throw new Error('Missing iOS resources:\n' + missing.join('\n'));
const manifest = [];
for (const file of await filesUnder(output)) {
  const bytes = await fs.readFile(file);
  manifest.push({ path: path.relative(output,file).split(path.sep).join('/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await fs.writeFile(path.join(output,'bundle-manifest.json'), JSON.stringify({ format:1, files:manifest },null,2) + '\n');
console.log('Prepared iOS payload: ' + manifest.length + ' files, ' + (manifest.reduce((total,file)=>total+file.bytes,0)/1048576).toFixed(2) + ' MiB at ' + output);
