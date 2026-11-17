#!/usr/bin/env node
'use strict';
/* SEO: every public page has its title, description, canonical, social cards,
 * language and valid structured data; links and images resolve; the sitemap
 * lists exactly the indexable pages; the FAQ markup mirrors the visible FAQ. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..'), SITE = 'https://www.kasai-solutions-inc.com';
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pages = ['index.html', 'guide/index.html', 'moves/index.html', 'monsters/index.html', '404.html', ...fs.readdirSync(path.join(root, 'monsters')).filter(f => f.endsWith('.html') && f !== 'index.html').map(f => `monsters/${f}`)];
const attr = (html, re) => re.exec(html)?.[1];
const strip = text => String(text).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const canonicals = new Map();
let links = 0, images = 0;
let redirects = 0;
for (const file of pages) {
  const html = read(file), dir = path.dirname(file);
  // Pages of retired species only point to the species that replaced them.
  const refresh = attr(html, /<meta http-equiv="refresh" content="0; url=([^"]+)"/);
  if (refresh) {
    assert(/<meta name="robots" content="noindex/.test(html), `${file}: redirect pages are noindex`);
    const canonical = attr(html, /<link rel="canonical" href="([^"]+)"/);
    assert.equal(canonical, `${SITE}/${path.join(dir, refresh)}`, `${file}: canonical names the new page`);
    assert(fs.existsSync(path.join(root, dir, refresh)), `${file}: redirect target exists`); redirects++; continue;
  }
  assert(/<html lang="ja">/.test(html), `${file}: lang`);
  const title = attr(html, /<title>([^<]+)<\/title>/), description = attr(html, /<meta name="description" content="([^"]+)"/);
  assert(title && title.length <= 80, `${file}: title (${title?.length})`);
  assert(description && description.length >= 40 && description.length <= 200, `${file}: description length ${description?.length}`);
  const canonical = attr(html, /<link rel="canonical" href="([^"]+)"/);
  assert(canonical?.startsWith(SITE + '/'), `${file}: absolute canonical`);
  for (const key of ['og:title', 'og:description', 'og:url', 'og:image']) assert(new RegExp(`<meta property="${key}" content="[^"]+"`).test(html), `${file}: ${key}`);
  assert(/<meta name="twitter:card" content="summary_large_image">/.test(html), `${file}: twitter card`);
  if (file !== 'index.html') for (const key of ['twitter:title', 'twitter:image']) assert(new RegExp(`<meta name="${key}" content="[^"]+"`).test(html), `${file}: ${key}`);
  assert(/<link rel="alternate" hreflang="ja"/.test(html), `${file}: hreflang`);
  assert(/<link rel="manifest" href="[^"]*manifest\.webmanifest">/.test(html), `${file}: app manifest`);
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
  if (file !== 'index.html') assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${file}: one h1`);
  const noindex = /<meta name="robots" content="noindex/.test(html);
  assert.equal(noindex, file === '404.html', `${file}: only the 404 page is noindex`);
  if (!noindex) canonicals.set(canonical, file);
  // Images have alt text and exist; internal links resolve (anchors included).
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0], src = attr(tag, /src="([^"]+)"/);
    assert(/alt="[^"]+"/.test(tag), `${file}: image without alt (${src})`);
    if (src && !/^https?:/.test(src)) { assert(fs.existsSync(path.join(root, dir, src.split('?')[0])), `${file}: missing image ${src}`); images++; }
  }
  if (file === 'index.html') continue;
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:)/.test(href)) continue;
    const [target, anchor] = href.split('#');
    const resolved = target === '' ? file : target.startsWith('/') ? target.slice(1) : path.join(dir, target);
    const filePath = resolved.endsWith('/') || resolved === '' || resolved === '.' ? path.join(resolved, 'index.html') : fs.existsSync(path.join(root, resolved)) && fs.statSync(path.join(root, resolved)).isDirectory() ? path.join(resolved, 'index.html') : resolved;
    assert(fs.existsSync(path.join(root, filePath)), `${file}: broken link ${href}`);
    if (anchor && filePath.endsWith('.html')) assert(new RegExp(`id="${anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(read(filePath)), `${file}: missing anchor ${href}`);
    links++;
  }
}
// ── Sitemap: exactly the indexable pages, with the dex images.
const sitemap = read('sitemap.xml'), locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
assert.deepEqual([...locs].sort(), [...canonicals.keys()].sort(), 'the sitemap lists every indexable page and nothing else');
assert.equal((sitemap.match(/<image:image>/g) || []).length, [...canonicals.keys()].filter(url => /\/monsters\/[^/]+\.html$/.test(url)).length, 'every species page carries its sprite');
const robots = read('robots.txt');
assert(robots.includes(`Sitemap: ${SITE}/sitemap.xml`) && /Disallow: \/scripts\//.test(robots) && /Disallow: \/server\//.test(robots));
// ── The FAQ markup mirrors the visible FAQ.
const home = read('index.html'), start = home.indexOf('<section class="game-info-faq"'), section = home.slice(start, home.indexOf('</section>', start));
const visible = [...section.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map(m => [strip(m[1]), strip(m[2])]);
const faq = JSON.parse(/<script type="application\/ld\+json" id="faq-jsonld">([\s\S]*?)<\/script>/.exec(home)[1]);
assert.equal(faq['@type'], 'FAQPage'); assert.deepEqual(faq.mainEntity.map(q => [q.name, q.acceptedAnswer.text]), visible);
assert(visible.some(([q]) => /オフライン/.test(q)) && visible.some(([q]) => /技/.test(q)), 'FAQ covers offline play and moves');
// ── The move list covers all 96 moves.
const moves = read('moves/index.html');
assert.equal((moves.match(/<tr id="/g) || []).length, 96, 'the move list has all 96 moves');
assert(/<meta name="description" content="[^"]*96種/.test(home), 'the home description mentions 96 moves');
assert.equal(redirects, 6, 'every retired species page redirects');
console.log(JSON.stringify({ ok: true, pages: pages.length, indexable: canonicals.size, redirects, links, images, faq: visible.length }));
