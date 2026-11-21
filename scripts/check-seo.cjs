#!/usr/bin/env node
'use strict';
/* SEO: every public page has its title, description, canonical, social cards,
 * language and valid structured data; links and images resolve; the sitemap
 * lists exactly the indexable pages; visible facts agree with the game data. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const root = path.join(__dirname, '..'), SITE = 'https://uni-tadayasu.github.io/pachi-mon';
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pages = ['index.html', 'guide/index.html', 'moves/index.html', 'monsters/index.html', '404.html', ...fs.readdirSync(path.join(root, 'monsters')).filter(f => f.endsWith('.html') && f !== 'index.html').map(f => `monsters/${f}`)];
const attr = (html, re) => re.exec(html)?.[1];
const strip = text => String(text).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const canonicals = new Map(), pageCanonicals = new Set();
const titles = new Set(), descriptions = new Set(), metadataDates = new Map();
const today = new Date().toISOString().slice(0, 10);
const contentHash = contents => crypto.createHash('sha256').update(contents.replace(/<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g, block => block.replace(/("dateModified"\s*:\s*")[^"]+("\s*)/g, '$1__SEO_LASTMOD__$2')).replace(/<time data-content-updated datetime="[^"]+">[^<]+<\/time>/g, '<time data-content-updated datetime="__SEO_LASTMOD__">__SEO_LASTMOD__</time>')).digest('hex');
let links = 0, images = 0;
let redirects = 0;
for (const file of pages) {
  const html = read(file), dir = path.dirname(file);
  assert(!/https?:\/\/(?:www\.)?kasai-solutions-inc\.com(?:[/?#"\s]|$)/i.test(html.slice(0, html.indexOf('</head>'))), `${file}: metadata is detached from the Sengoku VS domain`);
  assert.equal(attr(html, /<meta name="robots" content="([^"]+)"/), 'noindex, follow', `${file}: the archived page is excluded from search`);
  const viewport = attr(html, /<meta name="viewport" content="([^"]+)"/);
  assert(viewport?.includes('width=device-width') && viewport.includes('initial-scale=1'), `${file}: responsive viewport`);
  assert(!/user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:\D|$)/.test(viewport), `${file}: page zoom remains available`);
  assert.equal((html.match(/<link rel="canonical" /g) || []).length, 1, `${file}: one canonical`);
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
  assert(!titles.has(title), `${file}: distinct title`); titles.add(title);
  assert(!descriptions.has(description), `${file}: distinct description`); descriptions.add(description);
  const canonical = attr(html, /<link rel="canonical" href="([^"]+)"/);
  assert(canonical?.startsWith(SITE + '/'), `${file}: absolute canonical`);
  assert.equal(canonical, `${SITE}/${file.replace(/index\.html$/, '')}`, `${file}: canonical matches its public path`);
  for (const key of ['og:title', 'og:description', 'og:url', 'og:image']) assert(new RegExp(`<meta property="${key}" content="[^"]+"`).test(html), `${file}: ${key}`);
  assert.equal(attr(html, /<meta property="og:url" content="([^"]+)"/), canonical, `${file}: social URL matches canonical`);
  assert.equal(attr(html, /<meta property="og:image" content="([^"]+)"/), `${SITE}/assets/ogp-handheld.png`, `${file}: large social card uses the actual share artwork`);
  assert.equal(attr(html, /<meta property="og:image:width" content="([^"]+)"/), '1200', `${file}: social width`);
  assert.equal(attr(html, /<meta property="og:image:height" content="([^"]+)"/), '630', `${file}: social height`);
  assert.equal(attr(html, /<meta property="og:image:type" content="([^"]+)"/), 'image/png', `${file}: social image MIME type`);
  assert(/<meta name="twitter:card" content="summary_large_image">/.test(html), `${file}: twitter card`);
  for (const key of ['twitter:title', 'twitter:description', 'twitter:image']) assert(new RegExp(`<meta name="${key}" content="[^"]+"`).test(html), `${file}: ${key}`);
  assert.equal(attr(html, /<meta name="twitter:image" content="([^"]+)"/), attr(html, /<meta property="og:image" content="([^"]+)"/), `${file}: social image URLs agree`);
  assert(/<link rel="alternate" hreflang="ja"/.test(html), `${file}: hreflang`);
  for (const lang of ['ja', 'x-default']) assert.equal(attr(html, new RegExp(`<link rel="alternate" hreflang="${lang}" href="([^"]+)"`)), canonical, `${file}: ${lang} alternate matches canonical`);
  assert(/<link rel="manifest" href="[^"]*manifest\.webmanifest">/.test(html), `${file}: app manifest`);
  const entities = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap(m => { const value = JSON.parse(m[1]); return value['@graph'] || [value]; });
  const pageEntity = entities.find(entity => [].concat(entity['@type']).includes('WebPage'));
  assert(pageEntity, `${file}: WebPage structured data`);
  assert.equal(pageEntity.url, canonical, `${file}: structured URL matches canonical`);
  assert.equal(pageEntity.name, strip(title), `${file}: structured title matches visible title`);
  assert.equal(pageEntity.description, strip(description), `${file}: structured description matches metadata`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(pageEntity.dateModified) && pageEntity.dateModified <= today, `${file}: valid, non-future modification date`);
  metadataDates.set(file, pageEntity.dateModified);
  assert(html.includes(`<time data-content-updated datetime="${pageEntity.dateModified}">${pageEntity.dateModified}</time>`), `${file}: visible update date agrees with structured data`);
  for (const entity of entities) {
    assert(!entity.aggregateRating && !entity.review, `${file}: no unverified review claims`);
    assert.notEqual(entity['@type'], 'FAQPage', `${file}: retired FAQ rich-result markup is not generated`);
    if (entity['@type'] === 'CollectionPage') assert.equal(entity.mainEntity?.['@type'], 'ItemList', `${file}: collection count belongs to an ItemList`);
  }
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  assert.equal((markup.match(/<h1[\s>]/g) || []).length, 1, `${file}: one h1`);
  const noindex = /<meta name="robots" content="noindex/.test(html);
  assert.equal(noindex, true, `${file}: every archived page is noindex`);
  assert(!pageCanonicals.has(canonical), `${file}: canonical is unique`); pageCanonicals.add(canonical);
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
// ── The archived site has no indexable pages; content-date checks still apply.
const sitemap = read('sitemap.xml'), locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
assert.deepEqual([...locs].sort(), [...canonicals.keys()].sort(), 'the sitemap lists every indexable page and nothing else');
assert.equal((sitemap.match(/<image:image>/g) || []).length, [...canonicals.keys()].filter(url => /\/monsters\/[^/]+\.html$/.test(url)).length, 'every species page carries its sprite');
const state = JSON.parse(read('scripts/seo-page-state.json'));
for (const [file, date] of metadataDates) {
  assert.equal(state[file]?.lastmod, date, `${file}: date state matches the page`);
  assert.equal(state[file]?.hash, contentHash(read(file)), `${file}: regenerate SEO after a meaningful page change`);
}
for (const match of sitemap.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)) {
  const file = canonicals.get(match[1]);
  assert.equal(match[2], metadataDates.get(file), `${file}: sitemap date matches page date`);
  assert.equal(state[file]?.lastmod, match[2], `${file}: date state matches sitemap`);
  assert.equal(state[file]?.hash, contentHash(read(file)), `${file}: regenerate SEO after a meaningful page change`);
}
assert.equal((sitemap.match(/<lastmod>/g) || []).length, locs.length, 'every public URL has its content modification date');
assert(!sitemap.includes('<priority>') && !sitemap.includes('<changefreq>'), 'sitemap avoids unsupported frequency and priority hints');
const socialImage = fs.readFileSync(path.join(root, 'assets/ogp-handheld.png'));
assert.equal(socialImage.readUInt32BE(16), 1200, 'share image width matches metadata');
assert.equal(socialImage.readUInt32BE(20), 630, 'share image height matches metadata');
const robots = read('robots.txt');
assert(!/^Sitemap:/mi.test(robots), 'the archived sitemap is not advertised');
assert(/^Allow: \/\s*$/m.test(robots) && !/^Disallow: \/\s*$/m.test(robots), 'crawlers can read the noindex directives');
assert(/Disallow: \/scripts\//.test(robots) && /Disallow: \/server\//.test(robots));
assert(/<meta name="robots" content="noindex, follow">/.test(read('tools/viewport-check.html')), 'the public viewport helper is also noindex');
// ── FAQ remains useful visible content after retirement of FAQ rich results.
const home = read('index.html'), start = home.indexOf('<section class="game-info-faq"'), section = home.slice(start, home.indexOf('</section>', start));
const visible = [...section.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map(m => [strip(m[1]), strip(m[2])]);
assert(!home.includes('id="faq-jsonld"'), 'obsolete FAQ schema is not kept in the head');
assert(visible.some(([q]) => /オフライン/.test(q)) && visible.some(([q]) => /技/.test(q)), 'FAQ covers offline play and moves');
// ── Public moves are checked against data below.
const moves = read('moves/index.html');
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
const publicMoves=Object.values(data.moves).filter(move=>!move.hiddenDex), totalSpecies=Object.keys(data.species).length, totalMoves=Object.keys(data.moves).length;
assert.equal(publicSpecies.length, 256);
assert.equal(data.regionIds.length, 128);
assert.equal(Object.keys(data.guardians).length, 32);
assert.equal(data.limits.storage, 192);
assert(publicHome.includes(`公開${publicSpecies.length}種の一覧へ`), 'the home dex count is explicitly the public species count');
const homeDescription = attr(home, /<meta name="description" content="([^"]+)"/);
assert(homeDescription.includes(`公開図鑑${publicSpecies.length}種`) && homeDescription.includes(`図鑑外${totalSpecies-publicSpecies.length}種を含む全${totalSpecies}種`), 'home metadata distinguishes all species from the public dex');
assert(homeDescription.includes(`公開${publicMoves.length}種の技`), 'home metadata gives the public move count');
assert(publicHome.includes(`全<strong>${totalSpecies}種</strong>`), 'visible overview states the total species count');
assert.equal((moves.match(/<tr id="/g) || []).length, publicMoves.length, 'the move list includes each public move');
assert(moves.includes(`ゲーム全体では全${totalMoves}種`), 'the move list distinguishes the total move count');
assert(visible.some(([q,a])=>/技は何種類/.test(q)&&a.includes(`${publicMoves.length}種`)&&a.includes(`全${totalMoves}種`)), 'FAQ distinguishes public and total moves');
assert(visible.some(([q,a])=>/キラシード/.test(q)&&a.includes('本人とのリアルタイム対戦')&&a.includes('カサイの勝利報酬を確認')), 'FAQ describes the current live challenge and reward flow');
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
assert.equal(typeIds.length,9);
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
assert.equal((guide.match(/scope="col"/g)||[]).length,10,'the guide shows all nine defending types plus its row heading');
for(const move of Object.values(data.moves).filter(move=>move.hiddenDex)){
 for(const file of ['monsters/index.html','moves/index.html','guide/index.html','sitemap.xml']){
  assert(!read(file).includes(move.id)&&!read(file).includes(move.name),`${file} does not publish hidden dedicated moves`);
 }
}
assert(!/全262種|64のエリア|64の探索エリア|16の証を集め/.test(publicHome), 'stale home counts were removed');
assert(!read('monsters/komori.html').includes('通常レンタル'), 'dex pages no longer describe retired rental battles');
console.log(JSON.stringify({ ok: true, pages: pages.length, indexable: canonicals.size, redirects, links, images, faq: visible.length, publicFactsMatchEngine: true }));
