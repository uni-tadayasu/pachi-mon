#!/usr/bin/env node
'use strict';
/* Local link (battle and trade with a nearby device, without the internet):
 * connection codes are trimmed, compressed and typed; they survive a QR round
 * trip through the bundled libraries; the data channel envelope answers pings,
 * honours "bye", limits sizes and drops malformed peers; and the local trade
 * protocol, run against the real engine and saves, swaps exactly one monster on
 * each side, ignores stale confirmations, refuses receipts that would not apply,
 * and has the second confirmer save before the first can. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const context = vm.createContext({ console });
for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc=|application\/ld\+json/.test(script[1])) continue;
  vm.runInContext(script[2], context); if (context.LT?.Engine) break;
}
const { Engine, DATA: D } = context.LT, copy = value => JSON.parse(JSON.stringify(value));
const { LocalLink, LocalTradeSession, encodeSignal, decodeSignal, trimSdp, LocalNet } = require(path.join(root, 'local-link.js'));
const qrcode = require(path.join(root, 'vendor', 'qrcode-generator.js')), jsQR = require(path.join(root, 'vendor', 'jsQR.js'));

(async () => {
  // ── Connection codes.
  const hex = n => Array.from({ length: n }, (_, i) => ((i * 73 + 41) % 256).toString(16).padStart(2, '0').toUpperCase()).join(':');
  const sdp = ['v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=extmap-allow-mixed', 'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
    'a=candidate:3174540050 1 udp 2113937151 7d3b6c1e-0f0a-4a8e-9b1c-5e4f3d2c1b0a.local 55985 typ host generation 0 network-cost 999',
    'a=candidate:1620934051 1 udp 2113939711 2b1f9c4e-77aa-41c2-b3d5-0e9f8a7b6c5d.local 49152 typ host generation 0 network-id 2 network-cost 10',
    'a=candidate:4233069003 1 tcp 1518280447 192.168.1.23 9 typ host tcptype active generation 0 network-cost 999',
    'a=ice-ufrag:Xk2J', 'a=ice-pwd:9bZp1yQ3m0aT5cR7uV2wX4yZ', 'a=ice-options:trickle', `a=fingerprint:sha-256 ${hex(32)}`,
    'a=setup:actpass', 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', ''].join('\r\n');
  const offer = await encodeSignal({ sdp }, 'offer');
  assert(offer.startsWith('PM1O') && /^[A-Za-z0-9_-]+$/.test(offer.slice(4)), 'typed, URL-safe code');
  const decoded = await decodeSignal(offer, 'offer');
  assert.equal(decoded.type, 'offer'); assert.equal(decoded.sdp, trimSdp(sdp));
  assert(decoded.sdp.startsWith('v=0\r\n') && decoded.sdp.endsWith('\r\n'));
  assert(!/ tcp |extmap-allow-mixed|msid-semantic|generation|network-(?:id|cost)/.test(decoded.sdp), 'unused lines and candidate extensions are trimmed');
  assert.equal((decoded.sdp.match(/^a=candidate:/gm) || []).length, 2, 'both UDP candidates kept');
  for (const line of ['a=ice-ufrag:Xk2J', 'a=ice-pwd:9bZp1yQ3m0aT5cR7uV2wX4yZ', `a=fingerprint:sha-256 ${hex(32)}`, 'a=setup:actpass', 'a=sctp-port:5000', 'a=max-message-size:262144'])
    assert(decoded.sdp.includes(line + '\r\n'), `keeps ${line.slice(0, 16)}`);
  assert(offer.length < 700, `code fits a phone-readable QR (${offer.length} chars)`);
  const answer = await encodeSignal({ sdp: sdp.replace('actpass', 'active') }, 'answer');
  assert(answer.startsWith('PM1A'));
  assert.equal((await decodeSignal(offer.replace(/(.{40})/g, '$1\n  '), 'offer')).sdp, decoded.sdp, 'pasted codes may wrap');
  await assert.rejects(decodeSignal(offer, 'answer'), /参加する人/, 'the host reads only answers');
  await assert.rejects(decodeSignal(answer, 'offer'), /部屋をつくった人/, 'a guest reads only offers');
  await assert.rejects(decodeSignal('hello', 'offer'), /形式/);
  await assert.rejects(decodeSignal('PM1O' + 'A'.repeat(40), 'offer'), /読み取れません/);
  const notSdp = await encodeSignal({ sdp: 'x=1' }, 'offer');
  await assert.rejects(decodeSignal(notSdp, 'offer'), /内容/);

  // ── QR round trip with the bundled libraries (what the camera reader decodes).
  for (const code of [offer, answer]) {
    const qr = qrcode(0, 'L'); qr.addData(code, 'Byte'); qr.make();
    const modules = qr.getModuleCount(), scale = 4, quiet = 4, size = (modules + quiet * 2) * scale, rgba = new Uint8ClampedArray(size * size * 4).fill(255);
    assert(modules <= 89, `QR version stays at 18 or below (${modules} modules)`);
    for (let r = 0; r < modules; r++) for (let c = 0; c < modules; c++) if (qr.isDark(r, c))
      for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) { const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = 0; }
    assert.equal(jsQR(rgba, size, size)?.data, code, 'the reader returns the exact code');
  }

  // ── The transport envelope (no WebRTC in Node: a stand-in data channel).
  assert.equal(LocalLink.supported(), false); await assert.rejects(new LocalLink().host(), /対応していません/);
  function linked() {
    const events = [], sent = [];
    const link = new LocalLink({ onStatus: s => events.push(['status', s.state]), onOpen: info => events.push(['open', info]), onMessage: m => events.push(['message', m]), onClose: info => events.push(['close', info.reason]), onError: e => events.push(['error', e.message]) });
    const channel = { readyState: 'open', listeners: {}, send: text => sent.push(JSON.parse(text)), close() { this.readyState = 'closed'; }, addEventListener(type, fn) { this.listeners[type] = fn; } };
    link.role = 1; link._bind(channel);
    const deliver = value => channel.listeners.message({ data: typeof value === 'string' ? value : JSON.stringify(value) });
    return { link, events, sent, deliver, channel };
  }
  let t = linked();
  assert(t.link.connected); assert.equal(t.link.state, 'connected'); assert.deepEqual(copy(t.events.find(e => e[0] === 'open')[1]), { role: 1, code: 'LOCAL' });
  t.deliver({ pachi: 'L1', kind: 'ping' }); assert.deepEqual(t.sent.at(-1), { pachi: 'L1', kind: 'pong' }, 'pings are answered');
  t.deliver({ pachi: 'L1', kind: 'data', payload: { t: 'hello', v: 1 } }); assert.deepEqual(t.events.at(-1), ['message', { t: 'hello', v: 1 }]);
  assert.equal(t.link.send({ t: 'x' }), true); assert.deepEqual(t.sent.at(-1), { pachi: 'L1', kind: 'data', payload: { t: 'x' } });
  assert.throws(() => t.link.send([1]), /オブジェクト/); assert.throws(() => t.link.send({ big: 'x'.repeat(70000) }), /大きすぎ/);
  for (const bad of ['{', JSON.stringify({ pachi: 'L1', kind: 'data', payload: [1] }), JSON.stringify({ pachi: 'X', kind: 'data', payload: {} }), 'x'.repeat(70000)]) {
    t = linked(); t.deliver(bad);
    assert.equal(t.link.state, 'closed', 'a malformed peer is dropped'); assert.equal(t.link.connected, false); assert.equal(t.link.send({ t: 'x' }), false, 'nothing is sent after closing');
    assert(t.events.some(e => e[0] === 'error' && /正しくない通信/.test(e[1])) && t.events.at(-1)[0] === 'close');
  }
  t = linked(); t.deliver({ pachi: 'L1', kind: 'bye' }); assert.deepEqual(t.events.at(-1), ['close', '相手が退出しました。']);
  t = linked(); t.link.close(); assert.deepEqual(t.sent.at(-1), { pachi: 'L1', kind: 'bye' }, 'leaving says goodbye'); assert.equal(t.link.state, 'closed');
  t.link.close(); assert.equal(t.events.filter(e => e[0] === 'close').length, 1, 'closing twice reports once');

  // ── Local trade with the real engine: two devices, their saves, a message queue.
  const ID = '12345678-1234-4234-8234-123456789abc';
  function device(starter, extra = [], name = '') {
    const e = new Engine(); assert(e.newGame(starter, 'female', name || starter).ok);
    for (const [species, level, patch] of extra) { const mon = Object.assign(e.makeMonster(species, level), patch || {}); e.state.party.push(mon); e.markCaught(species); }
    const d = { engine: e, save: e.serialize(), commits: 0, checks: 0 };
    d.commit = receipt => { const c = new Engine(copy(d.save)), result = c.applyTrade(copy(receipt)); if (result.ok) { d.save = c.serialize(); d.engine.state = c.state; d.commits++; } return result; };
    d.check = receipt => { d.checks++; const result = new Engine(copy(d.save)).applyTrade(copy(receipt)); return result.ok ? { ok: true } : { ok: false, message: result.message }; };
    return d;
  }
  function pair(host, guest, options = {}) {
    const queue = [], log = [];
    const sessions = [host, guest].map((d, role) => new LocalTradeSession({ role, uuid: () => ID,
      send: message => { const m = copy(message); queue.push([role, m]); log.push([role, m.t]); return true; },
      getEngine: () => d.engine, commit: receipt => (options.commit?.[role] || d.commit)(receipt), check: receipt => (options.check?.[role] || d.check)(receipt) }));
    const flush = () => { let n = 0; while (queue.length) { assert(++n < 200); const [from, m] = queue.shift(); sessions[1 - from].receive(m); } };
    sessions[0].start('ホスト'); sessions[1].start('ゲスト'); flush();
    return { sessions, flush, queue, log };
  }
  const echo = (e, mon) => { const { uid, ...rest } = copy(e.wireEcho(e.tradeMonster(mon))); return rest; };

  // Happy path: both choose, both confirm; each side ends with the other's monster, once.
  let A = device('hibana', [['fuwari', 20]]), B = device('shizuku', [['kirari', 22, { nickname: 'きら', shiny: true }]]);
  let p = pair(A, B), [h, g] = p.sessions;
  assert.equal(h.phase, 'choose'); assert.equal(g.phase, 'choose'); assert.equal(g.tradeId, ID); assert.equal(h.partnerName, 'ゲスト'); assert.equal(g.partnerName, 'ホスト');
  const aLead = copy(A.engine.state.party[0]), bSecond = copy(B.engine.state.party[1]);
  assert(h.offer(A.engine.state.party[0]).ok); p.flush(); assert.equal(g.phase, 'choose', 'one offer is not a pair yet');
  assert(g.offer(B.engine.state.party[1]).ok); p.flush(); assert.equal(h.phase, 'review'); assert.equal(g.phase, 'review');
  assert(h.confirm().ok); p.flush(); assert.equal(A.commits + B.commits, 0, 'one confirmation commits nothing');
  assert(g.confirm().ok);
  assert.equal(B.commits, 1, 'the second confirmer saves first'); assert.equal(A.commits, 0, '...before telling the first');
  p.flush(); assert.equal(A.commits, 1); assert.equal(h.phase, 'done'); assert.equal(g.phase, 'done');
  const aGot = A.engine.state.party[0], bGot = B.engine.state.party[1];
  assert.equal(aGot.uid, `tr-${ID}-h`); assert.equal(bGot.uid, `tr-${ID}-g`);
  assert.deepEqual(echo(A.engine, aGot), echo(B.engine, bSecond), 'the host receives exactly what the guest offered');
  assert.deepEqual(echo(B.engine, bGot), echo(A.engine, aLead), 'and the guest what the host offered');
  assert.equal(aGot.nickname, 'きら'); assert.equal(aGot.shiny, true);
  for (const d of [A, B]) { assert.deepEqual(copy(new Engine(copy(d.save)).state.tradeReceipts), [`trade:${ID}`]); assert.equal(d.engine.state.party.length, 2); }
  assert(!A.engine.state.party.some(m => m.uid === aLead.uid) && !B.engine.state.party.some(m => m.uid === bSecond.uid), 'the offered monsters left');
  h.receive({ t: 'cancel' }); assert.equal(h.phase, 'done', 'a late cancel cannot undo a saved trade');
  h.receive({ t: 'offer', revision: 9, monster: copy(A.engine.toTradeWire(aGot)) }); assert.equal(h.phase, 'done');

  // A changed offer withdraws both confirmations; stale confirmations are ignored.
  A = device('hibana', [['fuwari', 20]]); B = device('shizuku', [['kirari', 22]]); p = pair(A, B); [h, g] = p.sessions;
  h.offer(A.engine.state.party[0]); g.offer(B.engine.state.party[0]); p.flush();
  assert(h.confirm().ok); p.flush(); assert(g.theirConfirm);
  assert(g.offer(B.engine.state.party[1]).ok); p.flush();
  assert.equal(h.myConfirm, null, 'the host must look again'); assert.equal(g.theirConfirm, null);
  assert(g.confirm().ok); p.flush(); assert.equal(A.commits + B.commits, 0, 'nothing saved until the host confirms the new pair');
  g.receive({ t: 'confirm', yours: 1, mine: 1 }); assert.equal(g.theirConfirm, null, 'a confirmation of the old pair is ignored');
  assert(h.confirm().ok); assert.equal(A.commits, 1, 'the host confirmed second, so it saved first'); p.flush();
  assert.equal(B.commits, 1); assert.equal(A.engine.state.party[0].species, 'kirari', 'the host got the newly offered monster');

  // The dry run: a receipt that would not apply is never confirmed, so nobody trades.
  A = device('hibana'); B = device('shizuku', [['kirari', 22, { hp: 0 }]]); p = pair(A, B); [h, g] = p.sessions;
  h.offer(A.engine.state.party[0]); g.offer(B.engine.state.party[1]); p.flush(); g.confirm(); p.flush();
  let result = h.confirm();
  assert.equal(result.ok, false); assert.match(result.message, /動ける仲間/, 'trading away the only healthy member for a fainted one is refused');
  p.flush(); assert.equal(A.commits + B.commits, 0); assert.equal(h.myConfirm, null); assert(!p.log.some(([from, type]) => from === 0 && type === 'confirm'));

  // A failed save on the second confirmer: nothing is sent but a cancel, so the first keeps its monster.
  A = device('hibana', [['fuwari', 20]]); B = device('shizuku', [['kirari', 22]]);
  p = pair(A, B, { commit: [null, () => ({ ok: false, message: '端末に保存できません。' })] }); [h, g] = p.sessions;
  h.offer(A.engine.state.party[0]); g.offer(B.engine.state.party[0]); p.flush(); h.confirm(); p.flush();
  result = g.confirm(); assert.equal(result.ok, false); assert.match(result.message, /保存できません/);
  p.flush(); assert.equal(A.commits, 0, 'the first confirmer never saves'); assert.equal(h.phase, 'error'); assert.match(h.message, /やめました/);
  assert.equal(A.engine.state.party[0].species, 'hibana');

  // Invalid or out-of-order partners end the trade without touching either save.
  const wire = species => { const e = new Engine(); e.newGame('hibana'); return copy(e.toTradeWire(e.makeMonster(species, 10))); };
  const bad = [
    [{ t: 'offer', revision: 1, monster: { ...wire('komori'), species: 'futo' } }, /交換の対象/],
    [{ t: 'offer', revision: 1, monster: { ...wire('komori'), heldItem: 'berry' } }, /持ち物/],
    [{ t: 'offer', revision: 1, monster: { ...wire('komori'), level: 0 } }, /能力情報/],
    [{ t: 'hello', v: 2 }, /版が違います/],
    [{ t: 'mystery' }, /正しくない交換データ/],
    [null, /正しくない交換データ/]
  ];
  for (const [message, pattern] of bad) {
    A = device('hibana'); B = device('shizuku'); p = pair(A, B); [h] = p.sessions;
    h.receive(copy(message)); assert.equal(h.phase, 'error', JSON.stringify(message)); assert.match(h.message, pattern);
  }
  A = device('hibana'); B = device('shizuku'); p = pair(A, B); [h, g] = p.sessions;
  g.offer(B.engine.state.party[0]); p.flush(); h.receive({ t: 'offer', revision: 1, monster: wire('komori') });
  assert.equal(h.phase, 'error', 'a replayed revision is refused');
  A = device('hibana'); B = device('shizuku'); p = pair(A, B); [h, g] = p.sessions;
  h.offer(A.engine.state.party[0]); g.cancel(); p.flush();
  assert.equal(h.phase, 'error'); assert.match(h.message, /相手が交換をやめました/); assert.equal(A.commits + B.commits, 0);
  A = device('hibana'); B = device('shizuku'); const guestOnly = new LocalTradeSession({ role: 1, send: () => true, getEngine: () => B.engine, commit: B.commit });
  guestOnly.receive({ t: 'hello', v: 1, name: 'x', tradeId: 'not-a-uuid' }); assert.equal(guestOnly.phase, 'error', 'the trade id must be a UUID');
  assert.equal(new LocalTradeSession({ role: 1, send: () => true, getEngine: () => B.engine, commit: B.commit }).offer(B.engine.state.party[0]).ok, false, 'no offers before the partner says hello');

  // ── Bluetooth only (Bluetooth tethering, no Wi-Fi): the choice is remembered; the status line
  // follows the Network Information API; the camera is asked once, released at once, and
  // never asked again once denied (it only makes this device's code carry its real address).
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } });
  assert.equal(LocalNet.preferred(), 'wifi'); LocalNet.remember('bluetooth'); assert.equal(LocalNet.preferred(), 'bluetooth'); LocalNet.remember('x'); assert.equal(LocalNet.preferred(), 'wifi');
  const tracks = []; let asked = 0;
  const nav = (type, permission, fail) => ({ connection: type ? { type } : undefined, permissions: { query: async () => ({ state: permission }) },
    mediaDevices: { getUserMedia: async constraints => { asked++; assert.deepEqual(constraints, { video: true, audio: false }); if (fail) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
      const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track); return { getTracks: () => [track] }; } } });
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const setNav = value => Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
  setNav(nav('bluetooth', 'prompt')); assert.equal(LocalNet.type(), 'bluetooth'); assert.match(LocalNet.panel(), /この端末の接続：Bluetooth ✓ Bluetoothでつながっています/);
  assert.equal(await LocalNet.reveal(), true); assert.equal(asked, 1); assert(tracks.length === 1 && tracks.every(t => t.stopped), 'the camera is released at once');
  setNav(nav('wifi', 'denied')); assert.match(LocalNet.panel(), /この端末の接続：Wi-Fi/); assert.equal(await LocalNet.reveal(), false); assert.equal(asked, 1, 'a denied camera is not asked again');
  setNav(nav(null, 'prompt', true)); assert.equal(await LocalNet.reveal(), false); assert.equal(LocalNet.type(), null); assert(!/この端末の接続/.test(LocalNet.panel()), 'no status line without the API');
  setNav({}); assert.equal(await LocalNet.reveal(), false, 'no camera API: carry on without it');
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
  assert.match(LocalNet.toggle('bluetooth', 'data-x'), /data-x="wifi" aria-pressed="false">.*data-x="bluetooth" aria-pressed="true"><b>Bluetoothのみ<\/b><small>Wi-Fi不要<\/small>/);
  assert.match(LocalNet.panel(), /Wi-Fiは不要・オフのままで大丈夫/); assert.match(LocalNet.panel(), /Wi-Fiやインターネットは使いません/); assert.match(LocalNet.hint, /入れ替えて/);
  const localSource = fs.readFileSync(path.join(root, 'local-link.js'), 'utf8');
  assert(localSource.includes("if (net === 'bluetooth' && (action === 'host' || action === 'join') && !link)") && localSource.includes('if (!link) net = preferredNet();'), 'the trade dialog prepares Bluetooth and follows the remembered choice');
  for (const needle of ["LT.LocalNet?.toggle?.(netChoice(),'data-link-net')", "case 'link-local-host':await prepareBluetooth();await connect(true);break;", "case 'link-local-join':await prepareBluetooth();await connect(false);break;", 'LT.LocalNet?.hint'])
    assert(html.includes(needle), `index.html: ${needle}`);

  // ── The page wires it up: menu, lobby transport, offline storage of the QR libraries.
  for (const needle of ['<script src="local-link.js?v=', '<link rel="stylesheet" href="local-link.css?v=', '<link rel="prefetch" href="vendor/qrcode-generator.js?v=1.4.4">', '<link rel="prefetch" href="vendor/jsQR.js?v=1.4.0">',
    "['local','link','ローカル通信']", 'data-ui="local-battle"', 'data-ui="local-trade"', 'data-link-transport="local"', "transport:'local'", 'checkTrade', 'LT.localTradeActive', '<symbol id="i-link"'])
    assert(html.includes(needle), `index.html: ${needle}`);
  assert(!html.includes('SPECIAL_ONLINE') && html.includes('const allowed=new Set(LT.OnlineFuto?.rosterIds?.(ids)'), 'Arvelion, Floravelle and Futo join local battles too, by the same roster as online ones');
  assert.equal((html.match(/\(LT\.onlineActive\|\|LT\.localTradeActive\|\|tradeLocked\(\)\)/g) || []).length, 18, 'the adventure pauses during a local trade wherever it pauses for online play');
  const licenses = fs.readFileSync(path.join(root, 'LICENSES.txt'), 'utf8');
  assert(/qrcode-generator/.test(licenses) && /jsQR/.test(licenses) && fs.existsSync(path.join(root, 'vendor', 'jsQR.LICENSE.txt')) && fs.existsSync(path.join(root, 'vendor', 'qrcode-generator.LICENSE.txt')), 'bundled library licenses');
  console.log(JSON.stringify({ ok: true, codeChars: { offer: offer.length, answer: answer.length },
    checks: ['typed compressed codes', 'trimmed SDP', 'wrapped paste', 'wrong-side and corrupt codes', 'QR round trip (bundled libraries)', 'ping/pong', 'size limits', 'malformed peers dropped', 'bye', 'one-time swap with the real engine', 'second confirmer saves first', 'changed offers withdraw confirmations', 'stale confirmations ignored', 'dry run refuses', 'failed save leaves the partner untouched', 'invalid partners', 'cancel', 'Bluetooth-only choice, status and camera permission', 'page wiring and licenses'] }));
})().catch(error => { console.error(error); process.exit(1); });
