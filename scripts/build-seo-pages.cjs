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
 * Use --only=monsters/floravelle.html,guide/index.html,index.html for targeted updates.
 * Sprites come from scripts/build-dex-sprites.cjs (assets/dex/<id>.webp). */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://www.kasai-solutions-inc.com';
const DATE = process.env.SEO_DATE || new Date().toISOString().slice(0, 10);
const onlyArgument=process.argv.slice(2).find(value=>value.startsWith('--only='));
const selected=onlyArgument?new Set(onlyArgument.slice(7).split(',').filter(Boolean)):null,written=[];
function write(file,contents){
  const relative=path.relative(ROOT,file).split(path.sep).join('/');
  if(selected&&!selected.has(relative))return;
  if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')===contents)return;
  fs.writeFileSync(file,contents);written.push(relative);
}
const dexSprite = id => `assets/dex/${id}.webp?v=20261120-bold-pixels-v66`;

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const context = vm.createContext({ console });
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc=|application\/ld\+json/.test(match[1])) continue;
  vm.runInContext(match[2], context);
  if (context.LT?.Engine) break;
}
const { LT } = context, D = LT.DATA, engine = new LT.Engine(), TYPES = LT.TypeSystem;
const publicTypes = TYPES.order.filter(type => !D.elements[type].hiddenDex);
// Glitch companions exist in saves and battle data, but have no public dex page,
// learner listing, dex number or sitemap entry.
const ids = Object.keys(D.species).filter(id=>!D.species[id].hiddenDex), no = id => ids.indexOf(id) + 1, pad = n => String(n).padStart(3, '0');
if(selected){
  const allowed=new Set(['index.html','monsters/index.html','guide/index.html','moves/index.html','404.html','sitemap.xml',...ids.map(id=>`monsters/${id}.html`),...Object.keys(D.retiredSpecies||{}).map(id=>`monsters/${id}.html`)]);
  if(!selected.size||[...selected].some(file=>!allowed.has(file)))throw Error('Unknown --only page target');
}
const publicMoveCount = Object.values(D.moves).filter(move=>!move.hiddenDex).length;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const typeName = el => el ? (D.elements[el]?.name || el) + 'タイプ' : '無属性';
const typeChip = el => `<span class="chip t-${esc(el || 'none')}">${esc(el ? D.elements[el].name : '無')}</span>`;
const speciesTypeName = value => TYPES.of(value).map(type => D.elements[type].name).join('・') + 'タイプ';
const speciesTypeChips = value => TYPES.of(value).map(typeChip).join(' ');
const typeList = types => types.map(type => D.elements[type].name).join('・') || 'なし';
const offenseList = (type, factor) => publicTypes.filter(defender => TYPES.chart[type][defender] === factor);
const incomingList = (species, test) => publicTypes.map(type => [type, TYPES.effectiveness(type, species)]).filter(([, factor]) => test(factor)).map(([type, factor]) => `${D.elements[type].name}（${factor}倍）`).join('、') || 'なし';
const kindLabel = m => m.kind === 'heal' ? '回復' : m.kind === 'guard' ? '防御' : m.kind === 'boost' ? '強化' : m.category === 'status' ? '変化' : (m.category || (m.element ? 'special' : 'physical')) === 'special' ? '特殊' : '物理';
const movePower = m => m.kind === 'attack' && m.category !== 'status' ? m.power : '—';
const moveAccuracy = m => m.kind === 'attack' ? m.alwaysHits === true ? '必中' : Math.round(m.accuracy) : '—';

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
  if (id === D.mythical?.species) return `謎のトレーナー カサイの専用部屋で本人とのリアルタイム対戦に勝つと、プレイヤーごとに一度だけLv.70を1体受け取れます。報酬の性別は♂・♀からランダムに決まります。手持ちに空きがあっても、ひかえが${D.limits.storage}体以上のときは受け取れません。空きを作った後は「秘密部屋」の「カサイの勝利報酬を確認」から受け取ってください。自動では受け取りません。運営は初期メンバーとしても迎えられます。通常の草むらには出現せず、交換もできません。`;
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
<link rel="stylesheet" href="${up}seo.css?v=20261120-stone-v65">
${jsonld.map(data => `<script type="application/ld+json">${JSON.stringify(data)}</script>`).join('\n')}
</head>
<body>
<a class="skip-link" href="#main-content">本文へ進む</a>
<header class="site-head"><a class="logo" href="${up}">パチモン<small>Pachi Monsters</small></a><nav aria-label="サイト内"><a href="${up}monsters/">パチモン図鑑</a><a href="${up}moves/">技一覧</a><a href="${up}guide/">攻略ガイド</a><a class="play" href="${up}">無料で遊ぶ ▶</a></nav></header>
<main class="wrap" id="main-content">
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
  const ability = LT.Abilities.get(s);
  const chain = lineage(id);
  const evoText = s.evolvesTo ? `Lv.${s.evolveLevel}で${D.species[s.evolvesTo].name}に進化` : preOf[id] ? `${D.species[preOf[id].from].name}からLv.${preOf[id].level}で進化` : '進化しない';
  const description = id===D.mythical?.species?`${s.name}（No.${number}）は${speciesTypeName(s)}の幻のパチモン。カサイ本人とのリアルタイム対戦に勝利すると、プレイヤーごとに一度だけLv.70を1体受け取れます。報酬の性別は♂・♀からランダム。ひかえが満員のときは受け取れません。特性・能力値・技・入手方法を掲載。`:`${s.name}（No.${number}）は${speciesTypeName(s)}のパチモン。${s.description}`.slice(0, 118) + ' 特性・能力値・覚える技・進化・入手方法を掲載。';
  const chainHtml = chain.length > 1 ? `<h2>進化の系譜</h2><ol class="evo">${chain.map((cid, i) => `<li${cid === id ? ' class="current"' : ''}><a href="${cid}.html"><img src="../${dexSprite(cid)}" width="96" height="96" alt="${esc(D.species[cid].name)}" loading="lazy" decoding="async"><span>${esc(D.species[cid].name)}</span></a>${D.species[cid].evolvesTo && i < chain.length - 1 ? `<small>Lv.${D.species[cid].evolveLevel} ▶</small>` : ''}</li>`).join('')}</ol>` : '';
  const prev = ids[index - 1], next = ids[index + 1];
  const body = `${crumbNav([['トップ', '../'], ['パチモン図鑑', './'], [s.name, '']], 1)}
<article class="window">
  <div class="dex-hero">
    <img class="sprite" src="../${dexSprite(id)}" width="192" height="192" alt="${esc(s.name)}のドット絵（正面）">
    <div>
      <p class="dex-no">No.${number}</p>
      <h1>${esc(s.name)}</h1>
      <p>${speciesTypeChips(s)} <span class="chip">${esc(rarityLabel[s.rarity] || '通常')}</span></p>
      <p class="lead">${esc(s.description)}</p>
    </div>
  </div>
  <h2>基本データ</h2>
  <table class="facts"><tbody>
    <tr><th>図鑑番号</th><td>No.${number}</td></tr>
    <tr><th>タイプ</th><td>${esc(speciesTypeName(s))}</td></tr>
    <tr><th>特性</th><td><strong>${esc(ability.name)}</strong><br>${esc(ability.description)}</td></tr>
    <tr><th>進化</th><td>${esc(evoText)}</td></tr>
    <tr><th>入手方法</th><td>${esc(obtain(id))}</td></tr>
  </tbody></table>
  <h2>Lv.50の能力値</h2>
  <table class="stats"><tbody>${STAT_ORDER.map(key => `<tr><th>${esc(D.statLabels[key])}</th><td>${stats[key]}</td><td class="bar"><span style="width:${Math.min(100, Math.round(stats[key] / statMax[key] * 100))}%"></span></td></tr>`).join('')}</tbody></table>
  <p class="note">上の数値は、振り分けポイント・持ち物・戦闘中の特性の補正を含まないLv.50の基礎能力です。冒険中の能力値はレベルに応じて上がります。通信対戦は基礎能力をLv.50にそろえ、選んだ個体の振り分けポイントはすべて加算します。</p>
  <h2>覚える技</h2>
  <div class="table-wrap"><table class="moves"><thead><tr><th>技</th><th>タイプ</th><th>分類</th><th>威力</th><th>命中</th><th>PP</th><th>効果</th></tr></thead><tbody>${moves.map(m => `<tr><th><a href="../moves/#${esc(m.id)}">${esc(m.name)}</a></th><td>${typeChip(m.element)}</td><td>${kindLabel(m)}</td><td>${movePower(m)}</td><td>${moveAccuracy(m)}</td><td>${engine.maxPP(m)}</td><td>${esc(m.description)}</td></tr>`).join('')}</tbody></table></div>
  ${chainHtml}
  <h2>タイプ相性</h2>
  <table class="facts"><tbody><tr><th>弱点となる技</th><td>${esc(incomingList(s, factor => factor > 1))}</td></tr><tr><th>軽減できる技</th><td>${esc(incomingList(s, factor => factor < 1))}</td></tr></tbody></table>
  <p>${TYPES.of(s).length === 2 ? '複合タイプでは、受ける技と2つのタイプの相性を掛け合わせます。' : ''}${esc(typeList(TYPES.of(s)))}の技を使うと、タイプ一致により威力が1.15倍になります。上の相性表には特性や持ち物の補正を含みません。<a href="../guide/#types">全タイプの相性表</a>も確認できます。</p>
  <p class="cta"><a class="button" href="../">${esc(s.name)}に会いに行く — 無料で遊ぶ ▶</a></p>
</article>
<nav class="pager" aria-label="前後のパチモン">${prev ? `<a href="${prev}.html">◀ No.${pad(index)} ${esc(D.species[prev].name)}</a>` : '<span></span>'}<a href="./">図鑑一覧</a>${next ? `<a href="${next}.html">No.${pad(index + 2)} ${esc(D.species[next].name)} ▶</a>` : '<span></span>'}</nav>`;
  write(path.join(ROOT, 'monsters', `${id}.html`), page({ depth: 1, canonical: url, title: `${s.name}（No.${number}）の特性・進化・技・入手方法｜パチモン図鑑`, description, body, image: `${SITE}/${dexSprite(id)}`, imageAlt: `${s.name}のドット絵`,
    jsonld: [crumbs([['トップ', `${SITE}/`], ['パチモン図鑑', `${SITE}/monsters/`], [s.name, url]])] }));
}

// ---------- encyclopedia index ----------
const groups = publicTypes.map(el => [el, ids.filter(id => TYPES.has(id, el))]);
const indexBody = `${crumbNav([['トップ', '../'], ['パチモン図鑑', '']], 1)}
<section class="window">
  <h1>パチモン図鑑（全${ids.length}種）</h1>
  <p class="lead">無料のドット絵RPG「パチモン」に登場する全${ids.length}種のパチモンの一覧です。雷・氷・土を含む8タイプで分類し、複合タイプは両方の一覧に掲載しています。名前を選ぶと、Lv.50の能力値、覚える技、進化の系譜、入手方法を確認できます。</p>
  <p class="jump">${groups.map(([el, list]) => `<a href="#${el}">${typeChip(el)} ${list.length}種</a>`).join(' ')}</p>
</section>
${groups.map(([el, list]) => `<section class="window" id="${el}">
  <h2>${esc(typeName(el))}のパチモン（${list.length}種）</h2>
  <p>${esc(typeName(el))}の技は、${esc(typeList(offenseList(el, 1.5)))}タイプに強い（1.5倍）技です。複合タイプへの倍率は、相手のもう1つのタイプとの相性も掛け合わせます。</p>
  <ul class="dex-grid">${list.map(id => `<li><a href="${id}.html"><img src="../${dexSprite(id)}" width="96" height="96" alt="${esc(D.species[id].name)}" loading="lazy" decoding="async"><span class="dex-no">No.${pad(no(id))}</span><strong>${esc(D.species[id].name)}</strong></a></li>`).join('')}</ul>
</section>`).join('\n')}
<p class="cta"><a class="button" href="../">冒険をはじめる — 無料で遊ぶ ▶</a></p>`;
write(path.join(ROOT, 'monsters', 'index.html'), page({ depth: 1, canonical: `${SITE}/monsters/`, title: `パチモン図鑑 全${ids.length}種一覧｜タイプ・進化・技｜パチモン`, description: `パチモン全${ids.length}種の図鑑一覧。芽・潮・灯・風・晶・雷・氷・土の8タイプ別に、各パチモンの能力値・覚える技・進化・入手方法を掲載しています。`, body: indexBody,
  jsonld: [crumbs([['トップ', `${SITE}/`], ['パチモン図鑑', `${SITE}/monsters/`]]), { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'パチモン図鑑', url: `${SITE}/monsters/`, inLanguage: 'ja', numberOfItems: ids.length }] }));

// ---------- guide ----------
const starterLines = D.starters.map(id => lineage(id));
const typeRows = publicTypes.map(type => `<tr><th scope="row">${typeChip(type)}</th>${publicTypes.map(defender => `<td>${TYPES.chart[type][defender]}倍</td>`).join('')}</tr>`).join('');
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
  <p><strong>特性</strong>は、すべてのパチモンが種族ごとに1つ持つ、自動で働く能力です。手持ち・ひかえの仲間にも自動で反映され、覚えるための道具やコインは不要です。進化すると進化先の種族の特性になります。冒険のバトル、通信シングル・ダブルで同じ効果が働きます。特性名と正確な効果は、パチモンの詳細・図鑑・通信のチーム編成・交換の確認画面で読めます。戦闘中は特性名を選ぶと効果を確認できます。</p>
  <p>バトルは「たたかう・バッグ・パチモン・にげる」から行動を選びます。素早さの高いほうが先に動き、防御の技は優先して発動します。技にはPP（使用回数）があり、すべて使い切ると反動を受ける「踏ん張り打ち」になります。宿や休み場では体力とPPを無料で全回復できます。</p>
  <ul><li>物理技は「物理攻撃」と相手の「物理防御」、特殊技は「特殊攻撃」と相手の「特殊防御」でダメージが決まります。</li><li>自分のどちらかのタイプと一致する技は、威力が1回だけ1.15倍になります。</li><li>防御の技は次に受けるダメージを半分にします。「守りを貫く」技は防御を無視します。</li><li>回復の技は最大体力の一定割合を回復し、吸収の技は与えたダメージの25%を回復します。</li></ul>
  <h2 id="types">タイプ相性表</h2>
  <p>公開タイプは${typeList(publicTypes)}の${publicTypes.length}種類です。有利な相手に1.5倍、不利な相手に0.7倍、同じ属性同士に0.8倍、それ以外には1倍のダメージになります。表は行が攻撃技、列が防御側のタイプです。</p>
  <p>2属性の複合タイプは、受ける技と各タイプの倍率を掛け合わせます。両方が弱点なら2.25倍、両方が耐性なら0.49倍、弱点と耐性の組み合わせなら1.05倍です。自分のどちらかのタイプと一致する技は、1回だけ1.15倍になります。「無」は単独タイプで、攻撃・防御とも属性相性は常に1倍です。</p>
  <p>技が当たったときの音でも相性が分かります。弱点を突いたときは鋭く上がる音、効きにくいときは低く沈む音、通常は短い打撃音が鳴ります。ソロ・通信対戦の両方に対応し、急所や防御によるダメージの増減では音の種類は変わりません。</p>
  <div class="table-wrap"><table class="type-chart"><caption>技のタイプ → 防御側のタイプ</caption><thead><tr><th scope="col">攻撃技 ↓</th>${publicTypes.map(type => `<th scope="col">${typeChip(type)}</th>`).join('')}</tr></thead><tbody>${typeRows}</tbody></table></div>
  <h2 id="catch">パチモンの捕まえ方</h2>
  <p>草むらを歩くと野生のパチモンが現れます。体力を減らしてから「バッグ」の「パチカプセル」を使うと捕まえやすくなります。パチカプセルは道具店で買え、勝利後に拾えることもあります。調律士（トレーナー）のパチモンは捕まえられません。仲間は${D.limits.party}体まで連れて歩け、ひかえには最大${D.limits.storage}体を預けられます。手持ち・ひかえが両方とも満員のときは、新しい仲間を迎える前に空きを作ってください。旧バージョンの記録が${D.limits.storage}体を超えていても、保存済みの仲間は保持されます。追加を止めた状態で入れ替えや見送りができ、空きができると新しい仲間を迎えられます。</p>
  <h2 id="evolve">進化と育成</h2>
  <p>ソロのバトルでは、手持ちの全員が経験値をもらえます。その相手との戦いで実際に場に出たパチモンは、もらえる経験値が<strong>1.5倍</strong>になります。途中で交代した個体も対象です。場に出ず待機していた手持ちは従来どおりの経験値をもらい、ひかえには経験値は入りません。相手が次のパチモンを繰り出すと、出場した個体の判定も切り替わります。「学びの帯」を持たせて出場した個体は、効果が重なって<strong>2.25倍</strong>になります。</p>
  <p>レベルの上限は100です。多くのパチモンはLv.8・12・16・22・24・32などで進化し、進化前の特徴を受け継いだ新しい姿になります。各パチモンの進化レベルは<a href="../monsters/">パチモン図鑑</a>で確認できます。</p>
  <h2 id="rare">伝説・幻・色違い</h2>
  <p>伝説の<a href="../monsters/${esc(D.legendary.species)}.html">${esc(D.species[D.legendary.species].name)}</a>は、野生のパチモンが出る草むらだけに現れます。草むらを1歩進むごとに1/${D.legendary.encounterOdds}の確率で出会え（Lv.${D.legendary.minLevel}）、道・街・室内では現れません。体力を減らすほど捕まえやすくなりますが、捕獲率は低めです。野生のパチモンとの遭遇ごとに1/3000の確率で色違いが現れます。色違いは見た目だけが変わる特別な個体です。</p>
  <h3 id="kasai-challenge">カサイに勝利してキラシードを迎える</h3>
  <p>幻の<a href="../monsters/floravelle.html">キラシード</a>は、謎のトレーナー カサイとの<strong>リアルタイム対戦の勝利報酬</strong>で仲間にできます。接続中の運営カサイにフィールドで話しかけて対戦を選ぶと、二人が専用部屋へ移動します。挑戦者は60秒以内に奥のカサイへ話しかけ、運営が対戦を許可すると始まります。時間内に話しかけないと二人ともフィールドへ戻ります。カサイは挑戦者が退出するまで向かいの席から移動できません。双方の保存済みの手持ちを使い、人数・順番・レベル・技・育成は入室時の構成を反映します。戦いの開始時に双方の体力とPPが全回復し、技と交代で戦います。運営カサイ本人は自分への挑戦や勝利報酬の受取はできません。挑戦と報酬の確認にはインターネット接続が必要です。</p>
  <p>報酬は<strong>プレイヤーごとに一度だけ、Lv.70のキラシード1体</strong>です。性別は<strong>♂・♀からランダム</strong>に決まり、受け取りの再確認で変わりません。手持ちに空きがあっても、<strong>ひかえが${D.limits.storage}体以上のときは受け取れません</strong>。挑戦前にひかえの空きを作っておきましょう。満員や通信切断で受け取れなかった場合は、空きを作り、「秘密部屋」の「カサイの勝利報酬を確認」から「報酬を受け取る」を選びます。空きができても自動では受け取りません。勝利はサーバーで記録され、退出した後でも未受取の報酬を確認できます。</p>
  <p>運営は従来どおり初期メンバーとしてもキラシードを迎えられます。通常の草むらには出現せず、進化はせずにLv.100まで育ちます。育てた個体はオンライン・ローカルの通信対戦に編成できますが、交換はできません。</p>
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
  <p>同じタイプを持つパチモンは、副タイプでもそのタイプの状態異常にかかりません。道具「${esc(D.items.remedy.name)}」や宿で治せます。</p>
  <h2 id="held">持ち物（全${Object.keys(D.heldItems).length}種）</h2>
  <p>パチモンに1つ持たせると、バトル中に自動で効果を発揮します。道具屋の「持ち物コーナー」で、集めた旅紋の数に応じて購入できます。</p>
  <div class="table-wrap"><table><thead><tr><th>持ち物</th><th>効果</th><th>入荷</th></tr></thead><tbody>${Object.values(D.heldItems).map(h => `<tr><th>${esc(h.name)}</th><td>${esc(h.description)}</td><td>${h.tier ? `旅紋${h.tier}個〜` : '最初から'}・${h.price}コイン</td></tr>`).join('')}</tbody></table></div>
  <h2 id="growth">性別と振り分けポイント</h2>
  <p>パチモンには性別（♂・♀）があります。伝説やフート、運営の初期メンバーのキラシードは性別なしですが、カサイの勝利報酬のキラシードには♂または♀の性別があります。レベルが上がるたびに振り分けポイントが${D.allocation.pointsPerLevel}もらえ、体力・物理攻撃・物理防御・特殊攻撃・特殊防御・素早さに自由に振り分けられます（1能力${D.allocation.capPerStat}まで、体力は1ポイントで+${D.allocation.hpPerPoint}）。「鍛錬の帯」を持たせると、レベルアップごとに1ポイント多くもらえます。振り分けは仲間の詳細画面で行い、＋・−は画面を移らずに続けて押せるほか、長押しで連続して振り分けられます。「おまかせ」で自動配分、「リセット」でやり直しもできます。</p>
  <h2 id="secrets">16の隠し要素と8つの裏技</h2>
  <p>冒険中のメニュー「冒険の記録 256→1」に、見つけた隠し要素と裏技バグが記録されます。見つける前はヒントだけが表示されます。たとえば「${esc(D.secrets[2].hint)}」「${esc(D.secrets[13].hint)}」——世界のどこかで試してみてください。</p>
  <h2 id="online">オンライン対戦・交換</h2>
  <p>「オンライン対戦」「オンライン交換」は、部屋をつくった人が招待リンクを相手に送ると簡単に参加できます。リンクを開くと対戦・交換の種類と部屋コードを引き継ぐので、コードの手入力は不要です。招待リンクのコピーと、対応する端末での共有を利用できます。6文字のコードを直接入力する方法も残しています。どちらもインターネット接続が必要です。</p>
  <ol><li>メニューから「オンライン対戦」または「オンライン交換」を開き、部屋をつくります。</li><li>接続の準備ができたら、表示された招待リンクをコピーまたは共有して相手に送ります。</li><li>相手はリンクを開き、招待の案内から参加画面へ進んで「参加する」を押します。部屋をつくった人は接続したまま待ちます。</li></ol>
  <p>対戦は1対1のシングル・ダブルバトルです。チームは冒険で仲間にしたパチモン（手持ち・ひかえ）から選び、レベルは50にそろえて戦います。選んだ個体に割り振ったポイントは、鍛錬で得た追加分を含めてすべて反映します（98ポイントへの縮小はありません）。持ち物も反映され、同じ持ち物は1チームに1つまでです。交代を含む行動の確定前には確認画面が出て、「選び直す」で戻ってもターンは進みません。状態異常も冒険と同じルールで起こり、対戦で使った持ち物も冒険では減りません。</p>
  <p>オンライン交換には冒険データが必要です。タイトルで招待を受け取った場合は「つづきから」または「旅をはじめる」で冒険に入り、招待された交換へ進みます。お互いが提示したパチモンを確認してから、両方の確認で交換が成立します。招待リンクを開くだけで冒険データが上書きされたり、交換が確定したりすることはありません。交換部屋は作成から15分で期限が切れます。通信が途切れた交換がある場合は、その結果の確認を先に行います。</p>
  <h2 id="local">ローカル通信（インターネットなしで近くの友だちと）</h2>
  <p>メニューの「ローカル通信」では、近くの端末どうしで、インターネットなしで対戦・交換できます。おすすめは<strong>2台を同じWi-Fiにつなぐ方法</strong>です。端末間の通信が許可されたWi-Fiなら、ルーターがインターネット回線につながっていなくても使え、テザリングも不要です。オフラインになる前に、両方の端末でゲームを一度読み込んでおいてください。Wi-Fiテザリング、または対応端末で設定したBluetoothテザリングも使えます。同じネットワークにつないだ後は次の3操作です。</p>
  <ol><li>部屋をつくる人が「部屋をつくる（QRを表示）」を押します。</li><li>参加する人が「部屋のQRを読み取る」でそのQRコードを読み取ります。参加する人の画面にもQRコードが表示されます。</li><li>部屋をつくる人が「相手のQRを読み取る」でそのQRコードを読み取ると、接続完了です。</li></ol>
  <p>画面には「部屋をつくる人」「参加する人」の役割と現在の手順を表示します。カメラを使えない場合は「カメラを使わずコードで接続」を開き、表示されたコードを互いにコピー・貼り付けできます。公共Wi-Fiなどで端末同士の通信が制限されている場合は、別のWi-Fiを使ってください。</p>
  <p>対戦のルールはオンライン対戦と同じです（アルヴェリオン・キラシード・フートも、持っていれば編成できます）。交換は、お互いが出すパチモンを選んで「この内容で交換する」を押すと成立し、両方の冒険記録に保存されます。通信は2台の間だけで行い、サーバーは使いません。</p>
  <p><strong>Bluetoothテザリングは、対応端末での設定が必要です。</strong>共有する側・接続する側の両方がBluetoothテザリングによるネットワーク接続に対応している必要があり、対応はOS・機種・端末の組み合わせにより異なります。各端末の公式手順でネットワーク接続を確認してから、ゲームの接続画面で「Bluetoothテザリング」を選び、QRコードを読み取ります。ゲーム内の選択だけでOSの接続設定は変わりません。<strong>ブラウザー版は、テザリングなしのBluetooth直接通信には対応していません。</strong>BluetoothのペアリングやQRコードの読み取りだけでは、端末間のネットワークは作られません。</p>
  <h2 id="moves">技（全${publicMoveCount}種）とエフェクト</h2>
  <p>技は8タイプの一般技75種、無属性6種、特別な技15種の全${publicMoveCount}種です。雷・氷・土にも、それぞれ4つの攻撃技があり、物理・特殊の技を使えます。技ごとに、反動・吸収・守りを貫く効果などがあります。芽・潮・灯・風・晶の攻撃技は、タイプの状態異常を起こすことがあります。最初の相棒は二段進化すると、それぞれ特別な技を覚えます（${Object.entries(D.signatureMoves || {}).map(([id, owner]) => `${esc(D.species[owner].name)}「${esc(D.moves[id].name)}」`).join('・')}）。技の演出は全24種類のエフェクトで表現されます。<a href="../moves/">技一覧</a>で威力・命中・PP・覚えるパチモンを確認できます。</p>
  <h2 id="offline">オフラインで遊ぶ</h2>
  <p>一度インターネットにつないで開くと、次からは通信がない場所でも冒険を始められます。設定の「画像をすべて保存」でパチモンの画像もまとめて端末に保存できます。スマホではブラウザーの「ホーム画面に追加」で、アプリのように起動できます。同じネットワークにつないだ近くの友だちとは<a href="#local">ローカル通信</a>でオフラインのまま対戦・交換できます（オンライン対戦・オンライン交換はインターネット接続が必要です）。</p>
  <h2 id="settings">便利な設定</h2>
  <ul><li><strong>画面モード</strong>：カラーとモノクロの2種類です。どちらも細かなドットと豊かな階調で表示し、初期設定はカラーです。本体の「液晶」ボタンでも交互に切り替えられます。ブラウン管風の走査線は最初はOFFです。</li><li><strong>文字と演出の速さ</strong>：ゆっくり・ふつう・はやい・瞬間の4段階。演出中はA・Enterで早送りできます。</li><li><strong>常にダッシュ</strong>：移動を常に早足にします。</li><li><strong>灯渡り</strong>：ワールドマップから、一度訪れた地域へすぐに移動できます。</li></ul>
  <p class="cta"><a class="button" href="../">パチモンを無料で遊ぶ ▶</a></p>
</article>`;
fs.mkdirSync(path.join(ROOT, 'guide'), { recursive: true });
write(path.join(ROOT, 'guide', 'index.html'), page({ depth: 1, canonical: `${SITE}/guide/`, title: 'パチモン攻略ガイド｜遊び方・操作・タイプ相性・進化のコツ', description: '無料ドット絵RPG「パチモン」の攻略ガイド。カサイ本人とのリアルタイム対戦、Lv.70キラシードの一度限りの勝利報酬と受け取り条件、全128ステージ、32の旅紋、操作、8タイプ・複合タイプの相性、捕獲、進化、状態異常、持ち物、振り分けポイント、オンライン・ローカル対戦を解説します。', body: guideBody,
  jsonld: [crumbs([['トップ', `${SITE}/`], ['攻略ガイド', `${SITE}/guide/`]]), { '@context': 'https://schema.org', '@type': 'Article', headline: 'パチモン攻略ガイド', inLanguage: 'ja', dateModified: DATE, author: { '@type': 'Organization', name: 'KASAI SOLUTIONS INC.' }, publisher: { '@type': 'Organization', name: 'KASAI SOLUTIONS INC.' }, mainEntityOfPage: `${SITE}/guide/` }] }));

// ---------- moves ----------
const learners = {};
for (const id of ids) for (const mid of D.species[id].moves) (learners[mid] ||= []).push(id);
const moveGroups = [...publicTypes.map(el => [typeName(el), m => m.element === el && !['special', 'signature'].includes(m.role)]),
  ['無属性', m => !m.element && !['special', 'signature'].includes(m.role)], ['特別な技', m => ['special', 'signature'].includes(m.role)]];
const moveRow = m => `<tr id="${esc(m.id)}"><th>${esc(m.name)}</th><td>${typeChip(m.element)}</td><td>${kindLabel(m)}</td><td>${movePower(m)}</td><td>${moveAccuracy(m)}</td><td>${engine.maxPP(m)}</td><td>${esc(m.description)}</td><td>${(learners[m.id] || []).slice(0, 8).map(id => `<a href="../monsters/${id}.html">${esc(D.species[id].name)}</a>`).join('、')}${(learners[m.id] || []).length > 8 ? ` ほか${learners[m.id].length - 8}種` : ''}</td></tr>`;
const allMoves = Object.values(D.moves).filter(move=>!move.hiddenDex);
const movesBody = `${crumbNav([['トップ', '../'], ['技一覧', '']], 1)}
<article class="window">
  <h1>パチモン技一覧（全${allMoves.length}種）</h1>
  <p class="lead">8タイプの一般技75種、無属性6種、特別な技15種。雷・氷・土の各4技を含め、威力・命中・PP・効果と、その技を覚えるパチモンをまとめました。芽・潮・灯・風・晶の攻撃技は、タイプの状態異常を起こすことがあります。技の演出は全24種類のエフェクトで表現されます。</p>
  <p>${moveGroups.map(([name]) => `<a href="#g-${esc(name)}">${esc(name)}</a>`).join(' ・ ')}</p>
${moveGroups.map(([name, test]) => `  <h2 id="g-${esc(name)}">${esc(name)}の技（${allMoves.filter(test).length}種）</h2>
  <div class="table-wrap"><table class="moves"><thead><tr><th>技</th><th>タイプ</th><th>分類</th><th>威力</th><th>命中</th><th>PP</th><th>効果</th><th>覚えるパチモン</th></tr></thead><tbody>${allMoves.filter(test).map(moveRow).join('')}</tbody></table></div>`).join('\n')}
  <p class="cta"><a class="button" href="../">パチモンを無料で遊ぶ ▶</a></p>
</article>`;
fs.mkdirSync(path.join(ROOT, 'moves'), { recursive: true });
write(path.join(ROOT, 'moves', 'index.html'), page({ depth: 1, canonical: `${SITE}/moves/`, title: `パチモン技一覧 全${allMoves.length}種｜タイプ・威力・命中・効果・覚えるパチモン`,
  description: `パチモンの技全${allMoves.length}種の一覧。芽・潮・灯・風・晶・雷・氷・土の一般技75種、無属性6種、特別な技15種の威力・命中・PP・効果と、覚えるパチモンを掲載。`, body: movesBody,
  jsonld: [crumbs([['トップ', `${SITE}/`], ['技一覧', `${SITE}/moves/`]]), { '@context': 'https://schema.org', '@type': 'ItemList', name: 'パチモン技一覧', numberOfItems: allMoves.length,
    itemListElement: allMoves.map((m, i) => ({ '@type': 'ListItem', position: i + 1, name: m.name, url: `${SITE}/moves/#${m.id}` })) }] }));

// ---------- retired species: their old pages point to the species that replaced them ----------
for (const [oldId, newId] of Object.entries(D.retiredSpecies || {})) {
  const target = D.species[newId]; if (!target) continue;
  write(path.join(ROOT, 'monsters', `${oldId}.html`), `<!doctype html>
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
write(path.join(ROOT, '404.html'), page({ depth: 0, root: true, canonical: `${SITE}/404.html`, noindex: true, title: 'ページが見つかりません｜パチモン',
  description: 'お探しのページは見つかりませんでした。パチモンのトップ、図鑑、技一覧、攻略ガイドからお探しください。',
  body: `<article class="window"><h1>ページが見つかりません</h1><p class="lead">お探しのページは移動したか、削除された可能性があります。</p><ul><li><a href="/">パチモンを無料で遊ぶ（トップ）</a></li><li><a href="/monsters/">パチモン図鑑</a></li><li><a href="/moves/">技一覧</a></li><li><a href="/guide/">攻略ガイド</a></li></ul></article>` }));

// ---------- sitemap (with the dex images) ----------
const urls = [[`${SITE}/`, '1.0', 'weekly'], [`${SITE}/guide/`, '0.8', 'monthly'], [`${SITE}/monsters/`, '0.8', 'monthly'], [`${SITE}/moves/`, '0.7', 'monthly'], ...ids.map(id => [`${SITE}/monsters/${id}.html`, '0.5', 'monthly', id])];
write(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map(([loc, priority, freq, id]) => `  <url><loc>${loc}</loc><lastmod>${DATE}</lastmod><changefreq>${freq}</changefreq><priority>${priority}</priority>${id ? `<image:image><image:loc>${SITE}/${dexSprite(id)}</image:loc></image:image>` : ''}</url>`).join('\n')}
</urlset>
`);

// ---------- home page FAQ structured data (mirrors the visible FAQ) ----------
{
  // Read again immediately before the small FAQ update so a simultaneous UI edit
  // is not overwritten with the generator's earlier data snapshot.
  const home=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const strip = text => String(text).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  const start = home.indexOf('<section class="game-info-faq"'), section = home.slice(start, home.indexOf('</section>', start));
  const questions = [...section.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map(m => ({ '@type': 'Question', name: strip(m[1]), acceptedAnswer: { '@type': 'Answer', text: strip(m[2]) } }));
  if (!questions.length) throw new Error('The home page FAQ was not found');
  const block = `<script type="application/ld+json" id="faq-jsonld">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: questions })}</script>`;
  const next = home.includes('id="faq-jsonld"') ? home.replace(/<script type="application\/ld\+json" id="faq-jsonld">[\s\S]*?<\/script>/, block) : home.replace('</head>', `  ${block}\n</head>`);
  if (next !== home) write(path.join(ROOT, 'index.html'), next);
}
console.log(selected?`Generated only ${[...selected].join(', ')} (${written.length} files changed).`:`Built ${ids.length} species pages, the encyclopedia, the guide, the move list, the 404 page and a sitemap with ${urls.length} URLs (${DATE}; ${written.length} files changed).`);
