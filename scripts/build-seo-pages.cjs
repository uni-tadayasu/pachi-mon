#!/usr/bin/env node
'use strict';
/* Builds the indexable companion pages from the shipped game data:
 *   monsters/index.html       — the full encyclopedia (256 species)
 *   monsters/<id>.html        — one page per species
 *   guide/index.html          — beginner and system guide
 *   moves/index.html          — all 96 moves and who learns them
 *   404.html                  — the not-found page
 *   sitemap.xml               — every public page (with dex images)
 * It also mirrors the home page's visible FAQ into FAQPage structured data.
 * Usage: node scripts/build-seo-pages.cjs   (SEO_DATE=YYYY-MM-DD to pin lastmod)
 * Sprites come from scripts/build-dex-sprites.py (assets/dex/<id>.webp). */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://www.kasai-solutions-inc.com';
const DATE = process.env.SEO_DATE || new Date().toISOString().slice(0, 10);

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const context = vm.createContext({ console });
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc=|application\/ld\+json/.test(match[1])) continue;
  vm.runInContext(match[2], context);
  if (context.LT?.Engine) break;
}
const { LT } = context, D = LT.DATA, engine = new LT.Engine();
const ids = Object.keys(D.species), no = id => ids.indexOf(id) + 1, pad = n => String(n).padStart(3, '0');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const typeName = el => el ? (D.elements[el]?.name || el) + 'タイプ' : '無属性';
const typeChip = el => `<span class="chip t-${esc(el || 'none')}">${esc(el ? D.elements[el].name : '無')}</span>`;
const kindLabel = m => m.kind === 'heal' ? '回復' : m.kind === 'guard' ? '防御' : m.kind === 'boost' ? '強化' : (m.category || (m.element ? 'special' : 'physical')) === 'special' ? '特殊' : '物理';

const preOf = {};
for (const s of Object.values(D.species)) if (s.evolvesTo) preOf[s.evolvesTo] = { from: s.id, level: s.evolveLevel };
function lineage(id) {
  let root = id; const guard = new Set();
  while (preOf[root] && !guard.has(root)) { guard.add(root); root = preOf[root].from; }
  const out = []; const seen = new Set(); let cur = root;
  while (cur && !seen.has(cur) && D.species[cur]) { seen.add(cur); out.push(cur); cur = D.species[cur].evolvesTo; }
  return out;
}
const habitats = {};
for (const m of Object.values(D.maps)) for (const sid of m.encounters || []) (habitats[sid] ||= new Map()).set(m.name, m.level);
function obtain(id) {
  const s = D.species[id];
  if (id === D.legendary?.species) return `野生のパチモンが出る草むらだけに現れ、草むらを1歩進むごとに1/${D.legendary.encounterOdds}の確率で出現する伝説のパチモン（野生Lv.${D.legendary.minLevel}）。`;
  if (s.adminOnly) return '運営専用の幻のパチモン。一般の冒険で入手する方法はありません。';
  if (s.specialOnly) return '運営からの配布で受け取れる特別なパチモン。';
  if (D.starters.includes(id)) return '冒険の最初に選べる相棒の1体（野生には出現しません）。';
  const found = habitats[id];
  if (found?.size) return [...found].map(([name, lv]) => `${name}（Lv.${lv[0]}〜${lv[1]}）`).join('、') + 'の草むらに出現。';
  if (preOf[id]) return `${D.species[preOf[id].from].name}がLv.${preOf[id].level}で進化すると出会えます。`;
  return '冒険の各地で出会えます。';
}
const rarityLabel = { common: '通常', evolved: '進化形', rare: '希少', legendary: '伝説', mythical: '幻', gift: '配布限定' };

const fontLinks = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DotGothic16&display=swap">`;
function page({ depth, canonical, title, description, body, jsonld = [], image = `${SITE}/assets/ogp-handheld.png`, imageAlt = 'パチモンのタイトル画面', noindex = false, root = false }) {
  const up = root ? '/' : depth ? '../'.repeat(depth) : './';
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'}">
<link rel="alternate" hreflang="ja" href="${canonical}">
<link rel="alternate" hreflang="x-default" href="${canonical}">
<meta name="theme-color" content="#1a2a78">
<meta property="og:type" content="website">
<meta property="og:locale" content="ja_JP">
<meta property="og:site_name" content="パチモン｜Pachi Monsters">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${image}">
<meta property="og:image:alt" content="${esc(imageAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${image}">
<meta name="twitter:image:alt" content="${esc(imageAlt)}">
<link rel="manifest" href="${up}manifest.webmanifest">
<link rel="icon" type="image/svg+xml" href="${up}assets/favicon-pixel.svg">
<link rel="apple-touch-icon" href="${up}assets/apple-touch-pixel.png">
${fontLinks}
<link rel="stylesheet" href="${up}seo.css?v=20261117-moves">
${jsonld.map(data => `<script type="application/ld+json">${JSON.stringify(data)}</script>`).join('\n')}
</head>
<body>
<header class="site-head"><a class="logo" href="${up}">パチモン<small>Pachi Monsters</small></a><nav aria-label="サイト内"><a href="${up}monsters/">パチモン図鑑</a><a href="${up}moves/">技一覧</a><a href="${up}guide/">攻略ガイド</a><a class="play" href="${up}">無料で遊ぶ ▶</a></nav></header>
<main class="wrap">
${body}
</main>
<footer class="site-foot"><p><a href="${up}">パチモン｜無料のドット絵モンスター育成RPG</a> ・ <a href="${up}monsters/">図鑑</a> ・ <a href="${up}moves/">技一覧</a> ・ <a href="${up}guide/">攻略ガイド</a> ・ <a href="${up}LICENSES.txt">ライセンス</a></p><p>© 2026 KASAI SOLUTIONS INC. 本ページの内容はゲーム内データから生成しています。</p></footer>
</body>
</html>
`;
}
const crumbs = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url })) });
const crumbNav = (items, depth) => `<nav class="crumbs" aria-label="パンくずリスト">${items.map(([name, href], i) => i === items.length - 1 ? `<span aria-current="page">${esc(name)}</span>` : `<a href="${href}">${esc(name)}</a>`).join(' › ')}</nav>`;

// ---------- species pages ----------
fs.mkdirSync(path.join(ROOT, 'monsters'), { recursive: true });
const STAT_ORDER = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed', 'accuracy', 'evasion'];
const statMax = { hp: 600, atk: 420, def: 420, spAtk: 420, spDef: 420, speed: 420, accuracy: 130, evasion: 130 };
for (const [index, id] of ids.entries()) {
  const s = D.species[id], number = pad(index + 1), url = `${SITE}/monsters/${id}.html`;
  const stats = engine.stats({ species: id, level: 50 });
  const moves = engine.moves({ species: id }).filter(Boolean);
  const chain = lineage(id), el = D.elements[s.element];
  const strong = el?.strongAgainst ? D.elements[el.strongAgainst].name : '', weakTo = Object.entries(D.elements).filter(([, e]) => e.strongAgainst === s.element).map(([, e]) => e.name);
  const evoText = s.evolvesTo ? `Lv.${s.evolveLevel}で${D.species[s.evolvesTo].name}に進化` : preOf[id] ? `${D.species[preOf[id].from].name}からLv.${preOf[id].level}で進化` : '進化しない';
  const description = `${s.name}（No.${number}）は${typeName(s.element)}のパチモン。${s.description}`.slice(0, 118) + ' 能力値・覚える技・進化・入手方法を掲載。';
  const chainHtml = chain.length > 1 ? `<h2>進化の系譜</h2><ol class="evo">${chain.map((cid, i) => `<li${cid === id ? ' class="current"' : ''}><a href="${cid}.html"><img src="../assets/dex/${cid}.webp" width="96" height="96" alt="${esc(D.species[cid].name)}" loading="lazy"><span>${esc(D.species[cid].name)}</span></a>${D.species[cid].evolvesTo && i < chain.length - 1 ? `<small>Lv.${D.species[cid].evolveLevel} ▶</small>` : ''}</li>`).join('')}</ol>` : '';
  const prev = ids[index - 1], next = ids[index + 1];
  const body = `${crumbNav([['トップ', '../'], ['パチモン図鑑', './'], [s.name, '']], 1)}
<article class="window">
  <div class="dex-hero">
    <img class="sprite" src="../assets/dex/${id}.webp" width="192" height="192" alt="${esc(s.name)}のドット絵（正面）">
    <div>
      <p class="dex-no">No.${number}</p>
      <h1>${esc(s.name)}</h1>
      <p>${typeChip(s.element)} <span class="chip">${esc(rarityLabel[s.rarity] || '通常')}</span></p>
      <p class="lead">${esc(s.description)}</p>
    </div>
  </div>
  <h2>基本データ</h2>
  <table class="facts"><tbody>
    <tr><th>図鑑番号</th><td>No.${number}</td></tr>
    <tr><th>タイプ</th><td>${esc(typeName(s.element))}</td></tr>
    <tr><th>進化</th><td>${esc(evoText)}</td></tr>
    <tr><th>入手方法</th><td>${esc(obtain(id))}</td></tr>
  </tbody></table>
  <h2>Lv.50の能力値</h2>
  <table class="stats"><tbody>${STAT_ORDER.map(key => `<tr><th>${esc(D.statLabels[key])}</th><td>${stats[key]}</td><td class="bar"><span style="width:${Math.min(100, Math.round(stats[key] / statMax[key] * 100))}%"></span></td></tr>`).join('')}</tbody></table>
  <p class="note">冒険中の能力値はレベルに応じて上がります。オンライン対戦の通常レンタルはLv.50で統一されます。</p>
  <h2>覚える技</h2>
  <div class="table-wrap"><table class="moves"><thead><tr><th>技</th><th>タイプ</th><th>分類</th><th>威力</th><th>命中</th><th>PP</th><th>効果</th></tr></thead><tbody>${moves.map(m => `<tr><th><a href="../moves/#${esc(m.id)}">${esc(m.name)}</a></th><td>${typeChip(m.element)}</td><td>${kindLabel(m)}</td><td>${m.kind === 'attack' ? m.power : '—'}</td><td>${m.kind === 'attack' ? Math.round(m.accuracy) : '—'}</td><td>${engine.maxPP(m)}</td><td>${esc(m.description)}</td></tr>`).join('')}</tbody></table></div>
  ${chainHtml}
  <h2>タイプ相性</h2>
  <p>${esc(typeName(s.element))}の技は${strong ? `${esc(strong)}タイプに強く（1.5倍）` : '相性の影響を受けにくく'}、${weakTo.length ? `${esc(weakTo.join('・'))}タイプの技を受けると効果が大きくなります` : '弱点の少ないタイプです'}。同じタイプの技を使うと威力が1.15倍になります。</p>
  <p class="cta"><a class="button" href="../">${esc(s.name)}に会いに行く — 無料で遊ぶ ▶</a></p>
</article>
<nav class="pager" aria-label="前後のパチモン">${prev ? `<a href="${prev}.html">◀ No.${pad(index)} ${esc(D.species[prev].name)}</a>` : '<span></span>'}<a href="./">図鑑一覧</a>${next ? `<a href="${next}.html">No.${pad(index + 2)} ${esc(D.species[next].name)} ▶</a>` : '<span></span>'}</nav>`;
  fs.writeFileSync(path.join(ROOT, 'monsters', `${id}.html`), page({ depth: 1, canonical: url, title: `${s.name}（No.${number}）の進化・技・入手方法｜パチモン図鑑`, description, body, image: `${SITE}/assets/dex/${id}.webp`, imageAlt: `${s.name}のドット絵`,
    jsonld: [crumbs([['トップ', `${SITE}/`], ['パチモン図鑑', `${SITE}/monsters/`], [s.name, url]])] }));
}

// ---------- encyclopedia index ----------
const groups = Object.keys(D.elements).map(el => [el, ids.filter(id => D.species[id].element === el)]);
const indexBody = `${crumbNav([['トップ', '../'], ['パチモン図鑑', '']], 1)}
<section class="window">
  <h1>パチモン図鑑（全${ids.length}種）</h1>
  <p class="lead">無料のドット絵RPG「パチモン」に登場する全${ids.length}種のパチモンの一覧です。タイプ別に並べています。名前を選ぶと、Lv.50の能力値、覚える技、進化の系譜、入手方法を確認できます。</p>
  <p class="jump">${groups.map(([el, list]) => `<a href="#${el}">${typeChip(el)} ${list.length}種</a>`).join(' ')}</p>
</section>
${groups.map(([el, list]) => `<section class="window" id="${el}">
  <h2>${esc(typeName(el))}のパチモン（${list.length}種）</h2>
  <p>${esc(typeName(el))}は${D.elements[el].strongAgainst ? `${esc(D.elements[el].name)}の技が${esc(D.elements[D.elements[el].strongAgainst].name)}タイプに強い` : ''}タイプです。</p>
  <ul class="dex-grid">${list.map(id => `<li><a href="${id}.html"><img src="../assets/dex/${id}.webp" width="96" height="96" alt="${esc(D.species[id].name)}" loading="lazy"><span class="dex-no">No.${pad(no(id))}</span><strong>${esc(D.species[id].name)}</strong></a></li>`).join('')}</ul>
</section>`).join('\n')}
<p class="cta"><a class="button" href="../">冒険をはじめる — 無料で遊ぶ ▶</a></p>`;
fs.writeFileSync(path.join(ROOT, 'monsters', 'index.html'), page({ depth: 1, canonical: `${SITE}/monsters/`, title: `パチモン図鑑 全${ids.length}種一覧｜タイプ・進化・技｜パチモン`, description: `パチモン全${ids.length}種の図鑑一覧。芽・潮・灯・風・晶の5タイプ別に、各パチモンの能力値・覚える技・進化・入手方法を掲載しています。`, body: indexBody,
  jsonld: [crumbs([['トップ', `${SITE}/`], ['パチモン図鑑', `${SITE}/monsters/`]]), { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'パチモン図鑑', url: `${SITE}/monsters/`, inLanguage: 'ja', numberOfItems: ids.length }] }));

// ---------- guide ----------
const starterLines = D.starters.map(id => lineage(id));
const typeRows = Object.entries(D.elements).map(([id, e]) => `<tr><th>${typeChip(id)} ${esc(e.name)}</th><td>${esc(D.elements[e.strongAgainst]?.name || '—')}</td><td>${esc(Object.values(D.elements).filter(x => x.strongAgainst === id).map(x => x.name).join('・') || '—')}</td></tr>`).join('');
const guideBody = `${crumbNav([['トップ', '../'], ['攻略ガイド', '']], 1)}
<article class="window guide">
  <h1>パチモン攻略ガイド｜遊び方・バトル・進化のコツ</h1>
  <p class="lead">「パチモン」はブラウザで遊べる無料のドット絵モンスター育成RPGです。登録やインストールは不要で、PC・スマートフォン・ゲームパッドで遊べます。このページでは、はじめての冒険に役立つ基本とコツをまとめています。</p>
  <nav class="toc" aria-label="目次"><ol><li><a href="#start">冒険のはじめかた</a></li><li><a href="#controls">操作方法</a></li><li><a href="#battle">バトルの基本</a></li><li><a href="#types">タイプ相性表</a></li><li><a href="#catch">パチモンの捕まえ方</a></li><li><a href="#evolve">進化と育成</a></li><li><a href="#rare">伝説・幻・色違い</a></li><li><a href="#journey">128ステージと2人のチャンピオン</a></li><li><a href="#stages">全128ステージ一覧</a></li><li><a href="#conditions">状態異常</a></li><li><a href="#held">持ち物48種</a></li><li><a href="#growth">性別と振り分けポイント</a></li><li><a href="#secrets">隠し要素と裏技</a></li><li><a href="#moves">技とエフェクト</a></li><li><a href="#offline">オフラインで遊ぶ</a></li><li><a href="#online">オンライン対戦・交換</a></li><li><a href="#local">ローカル通信（近くの友だちと）</a></li><li><a href="#settings">便利な設定</a></li></ol></nav>
  <h2 id="start">冒険のはじめかた</h2>
  <p>トップページの「旅をはじめる」から主人公（男性・女性）と名前を決め、最初の相棒を3体から選びます。相棒は2回進化し、最後まで一緒に戦えます。</p>
  <ul>${starterLines.map(line => `<li>${line.map((id, i) => `<a href="../monsters/${id}.html">${esc(D.species[id].name)}</a>${i < line.length - 1 ? `（Lv.${D.species[id].evolveLevel}）→ ` : ''}`).join('')}（${esc(typeName(D.species[line[0]].element))}）</li>`).join('')}</ul>
  <p>冒険は端末のブラウザーに自動で保存されます。別の端末で続けるときは、メニューの「記録を書き出す」と「記録を読み込む」を使います。</p>
  <h2 id="controls">操作方法</h2>
  <p>画面の携帯ゲーム機風のボタンは、クリック・タップでもそのまま操作できます。</p>
  <div class="table-wrap"><table><thead><tr><th>ボタン</th><th>はたらき</th><th>キーボード</th></tr></thead><tbody>
    <tr><th>十字キー</th><td>移動・項目選択</td><td>矢印キー / W・A・S・D</td></tr>
    <tr><th>A</th><td>話す・調べる・決定。演出中は早送り</td><td>E / Enter / スペース</td></tr>
    <tr><th>B</th><td>もどる。押し続けるとダッシュ</td><td>Shift（ダッシュ）</td></tr>
    <tr><th>START</th><td>メニュー</td><td>Esc</td></tr>
    <tr><th>SELECT</th><td>道具袋</td><td>B</td></tr>
    <tr><th>L / R</th><td>ワールドマップ / モンスター図鑑</td><td>M / J</td></tr>
  </tbody></table></div>
  <p>標準マッピングのゲームパッドにも対応しています。左スティック・十字キーで移動、下側のボタンで決定、右側のボタンで戻ります。</p>
  <h2 id="battle">バトルの基本</h2>
  <p>バトルは「たたかう・バッグ・パチモン・にげる」から行動を選びます。素早さの高いほうが先に動き、防御の技は優先して発動します。技にはPP（使用回数）があり、すべて使い切ると反動を受ける「踏ん張り打ち」になります。宿や休み場では体力とPPを無料で全回復できます。</p>
  <ul><li>物理技は「物理攻撃」と相手の「物理防御」、特殊技は「特殊攻撃」と相手の「特殊防御」でダメージが決まります。</li><li>自分と同じタイプの技は威力が1.15倍になります。</li><li>防御の技は次に受けるダメージを半分にします。「守りを貫く」技は防御を無視します。</li><li>回復の技は最大体力の一定割合を回復し、吸収の技は与えたダメージの25%を回復します。</li></ul>
  <h2 id="types">タイプ相性表</h2>
  <p>パチモンのタイプは芽・潮・灯・風・晶の5種類です。有利な相手には1.5倍、不利な相手には0.7倍、同じタイプ同士には0.8倍のダメージになります。</p>
  <div class="table-wrap"><table><thead><tr><th>攻撃する技のタイプ</th><th>強い相手（1.5倍）</th><th>この技に強い相手</th></tr></thead><tbody>${typeRows}</tbody></table></div>
  <h2 id="catch">パチモンの捕まえ方</h2>
  <p>草むらを歩くと野生のパチモンが現れます。体力を減らしてから「バッグ」の「パチカプセル」を使うと捕まえやすくなります。パチカプセルは道具店で買え、勝利後に拾えることもあります。調律士（トレーナー）のパチモンは捕まえられません。仲間は6体まで連れて歩け、残りは「ひかえ」に預けられます。</p>
  <h2 id="evolve">進化と育成</h2>
  <p>バトルの経験値はパーティー全員で分け合います。レベルの上限は100です。多くのパチモンはLv.8・12・16・22・24・32などで進化し、進化前の特徴を受け継いだ新しい姿になります。各パチモンの進化レベルは<a href="../monsters/">パチモン図鑑</a>で確認できます。</p>
  <h2 id="rare">伝説・幻・色違い</h2>
  <p>伝説の<a href="../monsters/${esc(D.legendary.species)}.html">${esc(D.species[D.legendary.species].name)}</a>は、野生のパチモンが出る草むらだけに現れます。草むらを1歩進むごとに1/${D.legendary.encounterOdds}の確率で出会え（Lv.${D.legendary.minLevel}）、道・街・室内では現れません。体力を減らすほど捕まえやすくなりますが、捕獲率は低めです。野生のパチモンとの遭遇ごとに1/3000の確率で色違いが現れます。色違いは見た目だけが変わる特別な個体です。</p>
  <h2 id="journey">128ステージ・32の旅紋・2人のチャンピオン</h2>
  <p>パチモンの世界は「2の累乗」でできています。<strong>256種</strong>のパチモン、<strong>128</strong>のステージ、<strong>64曲</strong>のBGM、<strong>32</strong>の旅紋、<strong>16</strong>の隠し要素、<strong>8つ</strong>の裏技バグ、<strong>4人</strong>の四境の守護者、<strong>2人</strong>のチャンピオン。</p>
  <ul><li>4つのステージ（町・道・名所・深部）で1つの地方になり、各地方の町にある紋章館の紋章守に勝つと旅紋がもらえます。深部からは自分の町へ戻る近道があります。</li>
  <li>子午線（第1〜64ステージ）の16旅紋を集めると、第64ステージ「${esc(D.maps.meridianleague.name)}」で四境の守護者4人と、1人目のチャンピオン「${esc(D.champion.name)}」に挑めます。</li>
  <li>勝つと評議院の東門から卯酉線（第65〜128ステージ）へ。さらに16旅紋（合計32）を集めると、第128ステージ「${esc(D.maps.zenithcrossing.name)}」で2人目のチャンピオン「${esc(D.champion2.name)}」（Lv.100）が待っています。</li>
  <li>旅紋を手に入れた紋章守には何度でも再戦できます。50階の星詠みの塔や旅の依頼など、クリア後の遊びもあります。</li></ul>
  <h2 id="stages">全128ステージ一覧</h2>
  <div class="table-wrap"><table><thead><tr><th>地方</th><th>旅紋</th><th>町</th><th>道</th><th>名所</th><th>深部</th></tr></thead><tbody>${Array.from({ length: 32 }, (_, d) => { const ms = D.regionIds.slice(d * 4, d * 4 + 4).map(id => D.maps[id]), g = Object.values(D.guardians)[d]; return `<tr><th>${d < 16 ? '子午線' : '卯酉線'} 第${d + 1}地方<br><small>${esc(ms[0].region)}</small></th><td>${esc(g.seal)}<br><small>${esc(g.name)}</small></td>${ms.map(m => `<td>${String(m.stage).padStart(3, '0')} ${esc(m.name)}${m.encounters.length ? `<br><small>Lv.${m.level[0]}〜${m.level[1]}</small>` : ''}</td>`).join('')}</tr>`; }).join('')}</tbody></table></div>
  <h2 id="conditions">状態異常（タイプ別の5種類）</h2>
  <div class="table-wrap"><table><thead><tr><th>状態異常</th><th>原因</th><th>効果</th></tr></thead><tbody>${Object.values(D.statuses).map(c => `<tr><th>${esc(c.name)}<br><small>${esc(c.reading)}</small></th><td>${esc(D.elements[c.element].name)}タイプの攻撃技（${Math.round(c.chance * 100)}%）</td><td>${esc(c.description)}</td></tr>`).join('')}</tbody></table></div>
  <p>同じタイプのパチモンは、そのタイプの状態異常にかかりません。道具「${esc(D.items.remedy.name)}」や宿で治せます。</p>
  <h2 id="held">持ち物（全${Object.keys(D.heldItems).length}種）</h2>
  <p>パチモンに1つ持たせると、バトル中に自動で効果を発揮します。道具屋の「持ち物コーナー」で、集めた旅紋の数に応じて購入できます。</p>
  <div class="table-wrap"><table><thead><tr><th>持ち物</th><th>効果</th><th>入荷</th></tr></thead><tbody>${Object.values(D.heldItems).map(h => `<tr><th>${esc(h.name)}</th><td>${esc(h.description)}</td><td>${h.tier ? `旅紋${h.tier}個〜` : '最初から'}・${h.price}コイン</td></tr>`).join('')}</tbody></table></div>
  <h2 id="growth">性別と振り分けポイント</h2>
  <p>パチモンには性別（♂・♀）があります（伝説・幻・配布限定は性別なし）。レベルが上がるたびに振り分けポイントが${D.allocation.pointsPerLevel}もらえ、体力・物理攻撃・物理防御・特殊攻撃・特殊防御・素早さに自由に振り分けられます（1能力${D.allocation.capPerStat}まで、体力は1ポイントで+${D.allocation.hpPerPoint}）。「鍛錬の帯」を持たせると、レベルアップごとに1ポイント多くもらえます。振り分けは仲間の詳細画面で行い、＋・−は画面を移らずに続けて押せるほか、長押しで連続して振り分けられます。「おまかせ」で自動配分、「リセット」でやり直しもできます。</p>
  <h2 id="secrets">16の隠し要素と8つの裏技</h2>
  <p>冒険中のメニュー「冒険の記録 256→1」に、見つけた隠し要素と裏技バグが記録されます。見つける前はヒントだけが表示されます。たとえば「${esc(D.secrets[2].hint)}」「${esc(D.secrets[13].hint)}」——世界のどこかで試してみてください。</p>
  <h2 id="online">オンライン対戦・交換</h2>
  <p>メニューの「オンライン対戦」では、6文字のルームコードで友だちと1対1のシングル・ダブルバトルができます。通常のパチモンはLv.50のレンタルで公平に戦えます。「オンライン交換」では、コードで参加した相手と育てたパチモンを交換できます。</p>
  <h2 id="local">ローカル通信（インターネットなしで近くの友だちと）</h2>
  <p>メニューの「ローカル通信」では、同じWi-Fi（またはスマホのテザリング）につないだ近くの端末どうしで、インターネットなしで対戦・交換できます。つなぎ方は3ステップです。</p>
  <ol><li>片方が「部屋をつくる」を押して、画面にQRコードを表示します。</li><li>もう片方が「カメラで読み取って参加」でそのQRコードを読み取ると、参加する側の画面に別のQRコードが出ます。</li><li>部屋をつくった人がそのQRコードを読み取ると接続完了です。カメラがない端末は、表示されたコードを貼り付けても接続できます。</li></ol>
  <p>対戦のルールはオンライン対戦と同じです（運営の確認が必要なフート・幻は編成できません）。交換は、お互いが出すパチモンを選んで「この内容で交換する」を押すと成立し、両方の冒険記録に保存されます。通信は2台の間だけで行い、サーバーは使いません。</p>
  <h2 id="moves">技（全${Object.keys(D.moves).length}種）とエフェクト</h2>
  <p>技は5タイプ×15種、無属性6種、特別な技15種の全${Object.keys(D.moves).length}種です。各タイプには、物理・特殊の弱い技から大技、捨て身の技（反動あり）、相手の体力を吸う技、守りを貫く技、回復、守りまでそろっています。攻撃技はタイプの状態異常を起こすことがあります。最初の相棒は二段進化すると、それぞれ特別な技を覚えます（${Object.entries(D.signatureMoves || {}).map(([id, owner]) => `${esc(D.species[owner].name)}「${esc(D.moves[id].name)}」`).join('・')}）。技の演出は全24種類のエフェクトで表現されます。<a href="../moves/">技一覧</a>で威力・命中・PP・覚えるパチモンを確認できます。</p>
  <h2 id="offline">オフラインで遊ぶ</h2>
  <p>一度インターネットにつないで開くと、次からは通信がない場所でも冒険を始められます。設定の「画像をすべて保存」でパチモンの画像（約44MB）もまとめて端末に保存できます。スマホではブラウザーの「ホーム画面に追加」で、アプリのように起動できます。近くの友だちとは<a href="#local">ローカル通信</a>でオフラインのまま対戦・交換できます（オンライン対戦・オンライン交換はインターネット接続が必要です）。</p>
  <h2 id="settings">便利な設定</h2>
  <ul><li><strong>画面モード</strong>：携帯機風の240ドット表示（標準）、16ビット風、4階調の液晶（若葉・セピア・月夜・モノクロ）、高精細フルカラーから選べます。本体の「液晶」ボタンでも切り替えられます。</li><li><strong>文字と演出の速さ</strong>：ゆっくり・ふつう・はやい・瞬間の4段階。演出中はA・Enterで早送りできます。</li><li><strong>常にダッシュ</strong>：移動を常に早足にします。</li><li><strong>灯渡り</strong>：ワールドマップから、一度訪れた地域へすぐに移動できます。</li></ul>
  <p class="cta"><a class="button" href="../">パチモンを無料で遊ぶ ▶</a></p>
</article>`;
fs.mkdirSync(path.join(ROOT, 'guide'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'guide', 'index.html'), page({ depth: 1, canonical: `${SITE}/guide/`, title: 'パチモン攻略ガイド｜遊び方・操作・タイプ相性・進化のコツ', description: '無料ドット絵RPG「パチモン」の攻略ガイド。全128ステージ一覧、32の旅紋と2人のチャンピオン、状態異常、持ち物48種、振り分けポイント、操作方法、バトルの基本、5タイプの相性表、捕まえ方、進化、伝説・色違い、隠し要素、オンライン対戦をまとめています。', body: guideBody,
  jsonld: [crumbs([['トップ', `${SITE}/`], ['攻略ガイド', `${SITE}/guide/`]]), { '@context': 'https://schema.org', '@type': 'Article', headline: 'パチモン攻略ガイド', inLanguage: 'ja', dateModified: DATE, author: { '@type': 'Organization', name: 'KASAI SOLUTIONS INC.' }, publisher: { '@type': 'Organization', name: 'KASAI SOLUTIONS INC.' }, mainEntityOfPage: `${SITE}/guide/` }] }));

// ---------- moves ----------
const learners = {};
for (const id of ids) for (const mid of D.species[id].moves) (learners[mid] ||= []).push(id);
const moveGroups = [...['leaf', 'tide', 'ember', 'wind', 'crystal'].map(el => [typeName(el), m => m.element === el && !['special', 'signature'].includes(m.role)]),
  ['無属性', m => !m.element && !['special', 'signature'].includes(m.role)], ['特別な技', m => ['special', 'signature'].includes(m.role)]];
const moveRow = m => `<tr id="${esc(m.id)}"><th>${esc(m.name)}</th><td>${typeChip(m.element)}</td><td>${kindLabel(m)}</td><td>${m.kind === 'attack' ? m.power : '—'}</td><td>${m.kind === 'attack' ? Math.round(m.accuracy) : '—'}</td><td>${engine.maxPP(m)}</td><td>${esc(m.description)}</td><td>${(learners[m.id] || []).slice(0, 8).map(id => `<a href="../monsters/${id}.html">${esc(D.species[id].name)}</a>`).join('、')}${(learners[m.id] || []).length > 8 ? ` ほか${learners[m.id].length - 8}種` : ''}</td></tr>`;
const allMoves = Object.values(D.moves);
const movesBody = `${crumbNav([['トップ', '../'], ['技一覧', '']], 1)}
<article class="window">
  <h1>パチモン技一覧（全${allMoves.length}種）</h1>
  <p class="lead">5タイプ×15種、無属性6種、特別な技15種。威力・命中・PP・効果と、その技を覚えるパチモンをまとめました。攻撃技はタイプの状態異常を起こすことがあります。技の演出は全24種類のエフェクトで表現されます。</p>
  <p>${moveGroups.map(([name]) => `<a href="#g-${esc(name)}">${esc(name)}</a>`).join(' ・ ')}</p>
${moveGroups.map(([name, test]) => `  <h2 id="g-${esc(name)}">${esc(name)}の技（${allMoves.filter(test).length}種）</h2>
  <div class="table-wrap"><table class="moves"><thead><tr><th>技</th><th>タイプ</th><th>分類</th><th>威力</th><th>命中</th><th>PP</th><th>効果</th><th>覚えるパチモン</th></tr></thead><tbody>${allMoves.filter(test).map(moveRow).join('')}</tbody></table></div>`).join('\n')}
  <p class="cta"><a class="button" href="../">パチモンを無料で遊ぶ ▶</a></p>
</article>`;
fs.mkdirSync(path.join(ROOT, 'moves'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'moves', 'index.html'), page({ depth: 1, canonical: `${SITE}/moves/`, title: `パチモン技一覧 全${allMoves.length}種｜タイプ・威力・命中・効果・覚えるパチモン`,
  description: `パチモンの技全${allMoves.length}種の一覧。芽・潮・灯・風・晶の各15種、無属性6種、最初の相棒の特別な技を含む特別な技15種の威力・命中・PP・効果と、覚えるパチモンを掲載。`, body: movesBody,
  jsonld: [crumbs([['トップ', `${SITE}/`], ['技一覧', `${SITE}/moves/`]]), { '@context': 'https://schema.org', '@type': 'ItemList', name: 'パチモン技一覧', numberOfItems: allMoves.length,
    itemListElement: allMoves.map((m, i) => ({ '@type': 'ListItem', position: i + 1, name: m.name, url: `${SITE}/moves/#${m.id}` })) }] }));

// ---------- retired species: their old pages point to the species that replaced them ----------
for (const [oldId, newId] of Object.entries(D.retiredSpecies || {})) {
  const target = D.species[newId]; if (!target) continue;
  fs.writeFileSync(path.join(ROOT, 'monsters', `${oldId}.html`), `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${esc(target.name)}のページへ移動しました｜パチモン図鑑</title>
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="${SITE}/monsters/${newId}.html">
<meta http-equiv="refresh" content="0; url=${newId}.html">
</head>
<body><p>このパチモンは図鑑の整理により${esc(target.name)}になりました。<a href="${newId}.html">${esc(target.name)}のページへ移動</a></p></body>
</html>
`);
}

// ---------- 404 ----------
fs.writeFileSync(path.join(ROOT, '404.html'), page({ depth: 0, root: true, canonical: `${SITE}/404.html`, noindex: true, title: 'ページが見つかりません｜パチモン',
  description: 'お探しのページは見つかりませんでした。パチモンのトップ、図鑑、技一覧、攻略ガイドからお探しください。',
  body: `<article class="window"><h1>ページが見つかりません</h1><p class="lead">お探しのページは移動したか、削除された可能性があります。</p><ul><li><a href="/">パチモンを無料で遊ぶ（トップ）</a></li><li><a href="/monsters/">パチモン図鑑</a></li><li><a href="/moves/">技一覧</a></li><li><a href="/guide/">攻略ガイド</a></li></ul></article>` }));

// ---------- sitemap (with the dex images) ----------
const urls = [[`${SITE}/`, '1.0', 'weekly'], [`${SITE}/guide/`, '0.8', 'monthly'], [`${SITE}/monsters/`, '0.8', 'monthly'], [`${SITE}/moves/`, '0.7', 'monthly'], ...ids.map(id => [`${SITE}/monsters/${id}.html`, '0.5', 'monthly', id])];
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map(([loc, priority, freq, id]) => `  <url><loc>${loc}</loc><lastmod>${DATE}</lastmod><changefreq>${freq}</changefreq><priority>${priority}</priority>${id ? `<image:image><image:loc>${SITE}/assets/dex/${id}.webp</image:loc></image:image>` : ''}</url>`).join('\n')}
</urlset>
`);

// ---------- home page FAQ structured data (mirrors the visible FAQ) ----------
{
  const strip = text => String(text).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  const start = html.indexOf('<section class="game-info-faq"'), section = html.slice(start, html.indexOf('</section>', start));
  const questions = [...section.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map(m => ({ '@type': 'Question', name: strip(m[1]), acceptedAnswer: { '@type': 'Answer', text: strip(m[2]) } }));
  if (!questions.length) throw new Error('The home page FAQ was not found');
  const block = `<script type="application/ld+json" id="faq-jsonld">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: questions })}</script>`;
  const next = html.includes('id="faq-jsonld"') ? html.replace(/<script type="application\/ld\+json" id="faq-jsonld">[\s\S]*?<\/script>/, block) : html.replace('</head>', `  ${block}\n</head>`);
  if (next !== html) fs.writeFileSync(path.join(ROOT, 'index.html'), next);
}
console.log(`Built ${ids.length} species pages, the encyclopedia, the guide, the move list, the 404 page and a sitemap with ${urls.length} URLs (${DATE}).`);
