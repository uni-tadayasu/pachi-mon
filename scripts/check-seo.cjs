#!/usr/bin/env node
'use strict';
/* SEO: every public page has its title, description, canonical, social cards,
 * language and valid structured data; links and images resolve; the sitemap
 * lists exactly the indexable pages; the FAQ markup mirrors the visible FAQ. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
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
  assert.equal(canonical, `${SITE}/${file.replace(/index\.html$/, '')}`, `${file}: canonical matches its public path`);
  for (const key of ['og:title', 'og:description', 'og:url', 'og:image']) assert(new RegExp(`<meta property="${key}" content="[^"]+"`).test(html), `${file}: ${key}`);
  assert.equal(attr(html, /<meta property="og:url" content="([^"]+)"/), canonical, `${file}: social URL matches canonical`);
  assert(/<meta name="twitter:card" content="summary_large_image">/.test(html), `${file}: twitter card`);
  for (const key of ['twitter:title', 'twitter:description', 'twitter:image']) assert(new RegExp(`<meta name="${key}" content="[^"]+"`).test(html), `${file}: ${key}`);
  assert(/<link rel="alternate" hreflang="ja"/.test(html), `${file}: hreflang`);
  for (const lang of ['ja', 'x-default']) assert.equal(attr(html, new RegExp(`<link rel="alternate" hreflang="${lang}" href="([^"]+)"`)), canonical, `${file}: ${lang} alternate matches canonical`);
  assert(/<link rel="manifest" href="[^"]*manifest\.webmanifest">/.test(html), `${file}: app manifest`);
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  assert.equal((markup.match(/<h1[\s>]/g) || []).length, 1, `${file}: one h1`);
  const noindex = /<meta name="robots" content="noindex/.test(html);
  assert.equal(noindex, file === '404.html', `${file}: only the 404 page is noindex`);
  if (!noindex) { assert(!canonicals.has(canonical), `${file}: canonical is unique`); canonicals.set(canonical, file); }
  // Images have alt text and exist; internal links resolve (anchors included).
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0], src = attr(tag, /src="([^"]+)"/);
    assert(/alt="[^"]+"/.test(tag), `${file}: image without alt (${src})`);
    if (src && !/^https?:/.test(src)) { assert(fs.existsSync(path.join(root, dir, src.split('?')[0])), `${file}: missing image ${src}`); images++; }
  }
  for (const m of markup.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
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
// Published facts are checked against the same engine data used by the game.
// This catches stale marketing counts even when metadata itself remains valid.
const dataContext = vm.createContext({ console });
for (const match of home.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc=|application\/ld\+json/.test(match[1])) continue;
  vm.runInContext(match[2], dataContext);
  if (dataContext.LT?.Engine) break;
}
const data = dataContext.LT.DATA, publicHome = home.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), guide = read('guide/index.html');
const publicSpecies=Object.values(data.species).filter(s=>!s.hiddenDex);
assert.equal(publicSpecies.length, 256);
assert.equal(data.regionIds.length, 128);
assert.equal(Object.keys(data.guardians).length, 32);
assert.equal(data.limits.storage, 192);
assert(publicHome.includes(`全${publicSpecies.length}種の一覧へ`), 'the home dex count matches the public species data');
for(const s of Object.values(data.species).filter(s=>s.hiddenDex)){
  assert(!fs.existsSync(path.join(root,'monsters',s.id+'.html')), 'hidden companions have no dex page');
  for(const file of ['monsters/index.html','moves/index.html','sitemap.xml']){
    assert(!read(file).includes(s.name)&&!read(file).includes(s.id), `${file} does not list hidden companions`);
  }
}
assert(publicHome.includes(`${data.regionIds.length}のステージ。`), 'the home stage count matches the map data');
assert(publicHome.includes(`${Object.keys(data.guardians).length}の旅紋を集め`), 'the home crest count matches the guardian data');
assert(guide.includes(`ひかえには最大${data.limits.storage}体`), 'the guide storage limit matches the engine');
assert(visible.some(([q,a])=>/ひかえ/.test(q)&&a.includes(`${data.limits.storage}体`)), 'the FAQ explains the storage limit');
assert(guide.includes('初期設定はカラーです')&&guide.includes('カラーとモノクロの2種類'), 'the guide explains the two equally detailed modes');
const types=dataContext.LT.TypeSystem, typeIds=Array.from(types.order).filter(type=>!data.elements[type].hiddenDex), dex=read('monsters/index.html');
assert.equal(typeIds.length,8);
for(const type of typeIds){
 assert(dex.includes(`id="${type}"`),`${type} has a public dex group`);
 assert(moves.includes(`id="g-${data.elements[type].name}タイプ"`),`${type} has a move group`);
 const group=dex.split(`<section class="window" id="${type}">`)[1]?.split('</section>')[0]||'';
 for(const s of publicSpecies)assert.equal(group.includes(`href="${s.id}.html"`),types.has(s,type),`${s.id} appears under every declared type, including its secondary`);
}
let dualPages=0;
for(const s of publicSpecies){
 const declared=Array.from(types.of(s)),page=read(`monsters/${s.id}.html`),name=declared.map(type=>data.elements[type].name).join('・')+'タイプ';
 assert(page.includes(`<tr><th>タイプ</th><td>${name}</td></tr>`),`${s.id}: both types in facts`);
 if(declared.length===2)dualPages++;
 for(const attack of typeIds){const factor=types.effectiveness(attack,s);if(factor!==1)assert(page.includes(`${data.elements[attack].name}（${factor}倍）`),`${s.id}: published ${attack} matchup agrees with combat`);}
}
assert(dualPages>0&&dualPages<publicSpecies.length,'a subset of existing species are dual types');
assert.equal((guide.match(/scope="col"/g)||[]).length,9,'the guide shows all eight defending types');
assert(!/全262種|64のエリア|64の探索エリア|16の証を集め/.test(publicHome), 'stale home counts were removed');
assert(!read('monsters/komori.html').includes('通常レンタル'), 'dex pages no longer describe retired rental battles');
console.log(JSON.stringify({ ok: true, pages: pages.length, indexable: canonicals.size, redirects, links, images, faq: visible.length, publicFactsMatchEngine: true }));
