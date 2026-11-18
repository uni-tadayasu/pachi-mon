/* Pachi Monsters — local link: battle and trade with a nearby device, without the internet.
 * Two devices on the same Wi-Fi (or one phone's hotspot) open a WebRTC data
 * channel to each other. Setting it up takes two codes, shown as QR codes
 * (read with the camera) or copied as text: the room's code, then the
 * guest's answer. No server takes part and nothing leaves the two devices.
 * QR codes: qrcode-generator (MIT, Kazuhiko Arase) and jsQR (Apache-2.0),
 * bundled in vendor/ and loaded only when needed. © 2026 KASAI SOLUTIONS INC. */
(() => {
  'use strict';
  const LT = globalThis.LT = globalThis.LT || {};
  if (LT.LocalLink) return;
  const PREFIX = 'PM1', LABEL = 'pachi-local-v1', MAX_BYTES = 65536, HEARTBEAT_MS = 4000, SILENCE_MS = 20000, GATHER_MS = 4000, GATHER_IDLE_MS = 600;
  const VENDOR = { qr: 'vendor/qrcode-generator.js?v=1.4.4', scan: 'vendor/jsQR.js?v=1.4.0' };
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ── Connection codes: the session description, trimmed, deflated, base64url.
  async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
  const toBase64url = bytes => { let text = ''; for (const b of bytes) text += String.fromCharCode(b); return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const fromBase64url = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)), c => c.charCodeAt(0));
  // Smaller codes make easier QR codes: TCP candidates (never used between two
  // nearby devices), unused session attributes and the optional candidate extensions go.
  function trimSdp(sdp) {
    return String(sdp).split(/\r?\n/).filter(line => line && !/^a=candidate:\S+ \d+ tcp /i.test(line) && !/^a=(?:extmap-allow-mixed|msid-semantic)/.test(line))
      .map(line => line.startsWith('a=candidate:') ? line.replace(/ (?:generation|network-id|network-cost|ufrag) \S+/g, '') : line).join('\r\n') + '\r\n';
  }
  async function encodeSignal(description, type) {
    const body = encoder.encode(JSON.stringify({ s: trimSdp(description.sdp) }));
    return PREFIX + (type === 'offer' ? 'O' : 'A') + toBase64url(await pipe(body, new CompressionStream('deflate-raw')));
  }
  async function decodeSignal(code, expected) {
    const text = String(code || '').replace(/\s+/g, '');
    if (!text.startsWith(PREFIX) || text.length < 24) throw new Error('接続コードの形式が違います。表示されたコードをそのまま読み取ってください。');
    const kind = text[PREFIX.length];
    if (kind !== (expected === 'offer' ? 'O' : 'A')) throw new Error(expected === 'offer' ? '部屋をつくった人のコードを読み取ってください。' : '参加する人が表示したコードを読み取ってください。');
    let data;
    try { data = JSON.parse(decoder.decode(await pipe(fromBase64url(text.slice(PREFIX.length + 1)), new DecompressionStream('deflate-raw')))); }
    catch (_) { throw new Error('接続コードを読み取れませんでした。もう一度読み取るか、コードをそのまま貼り付けてください。'); }
    if (!data || typeof data.s !== 'string' || !/^v=0/.test(data.s)) throw new Error('接続コードの内容が正しくありません。');
    return { type: expected, sdp: data.s };
  }

  // ── The transport, with the same interface as the online PeerLink.
  class LocalLink {
    static supported() {
      if (typeof globalThis.RTCPeerConnection !== 'function' || typeof globalThis.CompressionStream !== 'function' || typeof globalThis.DecompressionStream !== 'function') return false;
      try { new CompressionStream('deflate-raw'); new DecompressionStream('deflate-raw'); return true; } catch (_) { return false; } // older browsers lack deflate-raw
    }
    constructor(callbacks = {}) { Object.assign(this, { callbacks, role: null, code: '', connected: false, state: 'idle', _active: true, _pc: null, _channel: null, _heartbeat: null, _deadline: null, _lastSeen: 0 }); }
    _emit(name, value) { try { this.callbacks[name]?.(value); } catch (error) { console.error('LocalLink callback:', error); } }
    _status(state, message) { this.state = state; this._emit('onStatus', { state, message }); }
    _peer() {
      if (!LocalLink.supported()) throw new Error('この端末・ブラウザーはローカル通信に対応していません。新しいChrome・Edge・Safari・Firefoxをお使いください。');
      // Local only: host candidates on the shared network, no relay servers.
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed') this._fail(new Error('相手の端末とつながりませんでした。2台を同じWi-Fi（またはテザリング）につないで、もう一度お試しください。')); });
      return pc;
    }
    // Waits for the local addresses. Listening starts before setLocalDescription so no
    // candidate is missed; host candidates arrive together, so a short pause after
    // the last one ends the wait (some browsers report "complete" only much later).
    _gather(pc) {
      return new Promise(resolve => {
        let idle = 0;
        const limit = setTimeout(done, GATHER_MS);
        function done() { clearTimeout(limit); clearTimeout(idle); pc.removeEventListener('icegatheringstatechange', check); pc.removeEventListener('icecandidate', candidate); resolve(); }
        function check() { if (pc.iceGatheringState === 'complete') done(); }
        function candidate(event) { if (!event.candidate) { done(); return; } clearTimeout(idle); idle = setTimeout(done, GATHER_IDLE_MS); }
        pc.addEventListener('icegatheringstatechange', check); pc.addEventListener('icecandidate', candidate);
      });
    }
    async _describe(pc, type) {
      const gathered = this._gather(pc);
      await pc.setLocalDescription(type === 'offer' ? await pc.createOffer() : await pc.createAnswer()); await gathered;
      if (!this._active) throw new Error('接続を中止しました。');
      if (!/^a=candidate:/m.test(pc.localDescription.sdp)) throw new Error('この端末がネットワークにつながっていません。Wi-Fi（またはテザリング）をオンにして、もう一度お試しください。');
      return encodeSignal(pc.localDescription, type);
    }
    _arm(ms, message) { clearTimeout(this._deadline); this._deadline = setTimeout(() => { if (!this.connected) this._fail(new Error(message)); }, ms); }
    async host() {
      this.role = 0; const pc = this._pc = this._peer();
      this._bind(pc.createDataChannel(LABEL, { ordered: true }));
      this.code = await this._describe(pc, 'offer');
      this._status('offer', 'このコードを相手に読み取ってもらい、相手に表示されたコードを読み取ってください。');
      return this.code;
    }
    async accept(answer) {
      if (this.role !== 0 || !this._pc) throw new Error('先に部屋をつくってください。');
      const description = await decodeSignal(answer, 'answer');
      await this._pc.setRemoteDescription(description);
      this._status('connecting', '接続しています…');
      this._arm(20000, '相手の端末とつながりませんでした。2台を同じWi-Fi（またはテザリング）につないで、もう一度お試しください。');
    }
    async join(offer) {
      this.role = 1; const description = await decodeSignal(offer, 'offer'); const pc = this._pc = this._peer();
      pc.addEventListener('datachannel', event => { if (event.channel.label === LABEL) this._bind(event.channel); });
      await pc.setRemoteDescription(description);
      this.code = await this._describe(pc, 'answer');
      this._status('answer', '部屋をつくった人に、このコードを読み取ってもらってください。');
      this._arm(180000, '相手の読み取りを待ちましたが、つながりませんでした。最初からやり直してください。');
      return this.code;
    }
    _bind(channel) {
      this._channel = channel;
      channel.addEventListener('open', () => this._opened());
      channel.addEventListener('message', event => this._receive(event.data));
      channel.addEventListener('close', () => this._finish('相手との接続が切れました。'));
      if (channel.readyState === 'open') this._opened();
    }
    _opened() {
      if (this.connected || !this._active) return;
      clearTimeout(this._deadline); this.connected = true; this._lastSeen = Date.now();
      this._status('connected', '近くの端末とつながりました。');
      this._heartbeat = setInterval(() => {
        if (Date.now() - this._lastSeen > SILENCE_MS) this._finish('相手からの応答が途絶えました。');
        else this._raw({ pachi: 'L1', kind: 'ping' });
      }, HEARTBEAT_MS);
      this._emit('onOpen', { role: this.role, code: 'LOCAL' });
    }
    _receive(data) {
      try {
        if (typeof data !== 'string' || data.length > MAX_BYTES) throw new Error('size');
        const envelope = JSON.parse(data); this._lastSeen = Date.now();
        if (!envelope || envelope.pachi !== 'L1') throw new Error('format');
        if (envelope.kind === 'ping') { this._raw({ pachi: 'L1', kind: 'pong' }); return; }
        if (envelope.kind === 'pong') return;
        if (envelope.kind === 'bye') { this._finish('相手が退出しました。'); return; }
        if (envelope.kind !== 'data' || !envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) throw new Error('payload');
        this._emit('onMessage', envelope.payload);
      } catch (_) { this._fail(new Error('相手から正しくない通信を受信したため、接続を終了しました。')); }
    }
    _raw(envelope) {
      const channel = this._channel; if (!channel || channel.readyState !== 'open') return false;
      try { channel.send(JSON.stringify(envelope)); return true; } catch (_) { this._fail(new Error('送信に失敗しました。')); return false; }
    }
    send(payload) {
      if (!this.connected) return false;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('送信データはオブジェクトで指定してください。');
      const text = JSON.stringify({ pachi: 'L1', kind: 'data', payload });
      if (text.length > MAX_BYTES) throw new Error('送信データが大きすぎます。');
      return this._raw(JSON.parse(text));
    }
    _fail(error) { if (!this._active) return; this._emit('onError', error); this._finish(error.message); }
    _finish(reason) {
      if (!this._active) return;
      this._active = false; this.connected = false; clearTimeout(this._deadline); clearInterval(this._heartbeat);
      try { this._channel?.close(); } catch (_) {}
      try { this._pc?.close(); } catch (_) {}
      this._status('closed', reason); this._emit('onClose', { reason });
    }
    close(reason = '退出しました。') { if (this.connected) this._raw({ pachi: 'L1', kind: 'bye' }); this._finish(reason); }
  }

  // ── How to put two devices on one network. This browser implementation uses
  // WebRTC over IP, not a direct Bluetooth transport. Bluetooth tethering works
  // only when the devices and their operating systems support that network setup.
  const GUIDE = `<details class="local-howto"><summary>つなぎ方：Wi-Fi・テザリング・Bluetoothテザリング</summary>
    <p><strong>Wi-Fi</strong>：2台を同じWi-Fiにつなぎます（インターネットにつながっていなくてもかまいません）。</p>
    <p><strong>テザリング</strong>：片方のスマホの「インターネット共有（テザリング）」に、もう片方をWi-Fiでつなぎます。</p>
    <p><strong>Bluetoothテザリング</strong>：対応端末で設定したBluetoothネットワークを利用します。利用可否は端末・OS・接続相手の組み合わせによって異なります。</p>
    <ol><li>Bluetoothテザリングに対応する端末どうしで、Bluetoothをオンにしてペアリングします。</li>
      <li>共有する側で「Bluetoothテザリング」をオンにします。Androidの例：設定 →「ネットワークとインターネット」→「アクセスポイントとテザリング」→「Bluetoothテザリング」（設定名や場所は端末によって異なります）。</li>
      <li>接続する側がBluetoothのネットワーク接続に対応している場合は、Bluetooth設定から、ペアリングした端末の「インターネット接続（ネットワークアクセス）」をオンにします。</li>
      <li>あとは、いつもどおりQRコードを読み取って接続します。</li></ol>
    <p class="local-note">テザリングなしのBluetooth直接通信は、このブラウザー版では利用できません。ペアリングだけでは接続できず、両端末がBluetoothテザリングによるネットワーク接続に対応している必要があります。公共・会社のWi-Fiでは、端末どうしの通信が禁止されていてつながらないことがあります。</p></details>`;
  // ── Bluetooth tethering is an OS-level network setup. Selecting the option
  // changes guidance; it does not create that network or force a Bluetooth route.
  // Camera permission (also needed to read the codes) lets the browser put this device's
  // real local address in its code instead of a hidden name; on tethered links the name
  // lookups often do not travel, so this keeps the connection working.
  const NET_KEY = 'pachi-local-net';
  const NET_LABEL = { bluetooth: 'Bluetooth', wifi: 'Wi-Fi', cellular: 'モバイル回線', ethernet: '有線LAN', none: 'つながっていません', wimax: 'WiMAX', other: 'その他', unknown: '不明' };
  function networkType() { const type = globalThis.navigator?.connection?.type; return typeof type === 'string' ? type : null; }
  function preferredNet() { try { return globalThis.localStorage?.getItem(NET_KEY) === 'bluetooth' ? 'bluetooth' : 'wifi'; } catch (_) { return 'wifi'; } }
  function rememberNet(net) { try { globalThis.localStorage?.setItem(NET_KEY, net === 'bluetooth' ? 'bluetooth' : 'wifi'); } catch (_) {} }
  async function revealLocalAddress() {
    try {
      const devices = globalThis.navigator?.mediaDevices; if (!devices?.getUserMedia) return false;
      const state = await globalThis.navigator.permissions?.query?.({ name: 'camera' }).then(result => result.state, () => null);
      if (state === 'denied') return false;
      const stream = await devices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach(track => track.stop()); // nothing is recorded or shown
      return true;
    } catch (_) { return false; }
  }
  function netToggle(net, attr) {
    return `<div class="link-modes local-net-toggle" role="group" aria-label="つなぎ方"><button type="button" ${attr}="wifi" aria-pressed="${net !== 'bluetooth'}"><b>同じWi-Fi</b><small>おすすめ・テザリング不要</small></button><button type="button" ${attr}="bluetooth" aria-pressed="${net === 'bluetooth'}"><b>Bluetoothテザリング</b><small>対応端末で設定が必要</small></button></div>`;
  }
  function setupSteps(stage, net = 'wifi') {
    const current = stage === 'host' ? 1 : stage === 'guest' ? 2 : 0;
    const labels = [net === 'bluetooth' ? '対応端末でテザリングを設定' : '2台を同じWi-Fiへ', '参加する人が部屋のQRを読む', '部屋の人が相手のQRを読む'];
    return `<ol class="local-setup-steps" aria-label="つなぎ方の3ステップ">${labels.map((label, i) => `<li${i === current ? ' class="is-current" aria-current="step"' : ''}><span class="local-step-number" aria-hidden="true">${i + 1}</span><span class="local-step-copy">${esc(label)}${i === current ? '<small>いまの手順</small>' : ''}</span></li>`).join('')}</ol>`;
  }
  function bluetoothPanel() {
    const type = networkType();
    const status = type ? `<p class="local-net-status">この端末の接続種別：${esc(NET_LABEL[type] || type)}</p>` : '';
    return `<div class="local-bt">
      <p class="local-bt-title">Bluetoothテザリングでつなぐ</p>
      <p class="local-note"><strong>テザリングなしのBluetooth直接通信は、このブラウザー版では利用できません。</strong></p>
      <ol><li>Bluetoothテザリングに対応する端末どうしで、Bluetoothをオンにしてペアリングします。</li>
        <li>共有する側で「Bluetoothテザリング」をオンにします。<br>Androidの例：設定 →「ネットワークとインターネット」→「アクセスポイントとテザリング」→「Bluetoothテザリング」（設定名や場所は端末によって異なります）</li>
        <li>接続する側がBluetoothのネットワーク接続に対応している場合は、Bluetooth設定から、ペアリングした端末の「インターネット接続（ネットワークアクセス）」をオンにします。</li>
        <li>ネットワーク接続を設定した後、部屋をつくり、QRコードを読み取り合って接続します。カメラの使用を許可すると、接続情報を取得しやすくなります（この準備でカメラの映像は使いません）。</li></ol>${status}
      <p class="local-note">利用可否は端末・OS・接続相手の組み合わせによって異なります。この画面でBluetoothテザリングを選んでも、端末のネットワーク設定は変更されません。接続種別の表示は、対戦相手との接続成功やBluetooth専用経路を示すものではありません。</p></div>`;
  }
  const BLUETOOTH_HINT = 'Bluetoothテザリングを使う場合は、2台の組み合わせが対応しているか、共有する側のBluetoothテザリングと接続する側の「インターネット接続（ネットワークアクセス）」がオンかを確認してください。設定後もつながらない場合は、部屋をつくる側と参加する側を入れ替えて試してください。';

  // ── QR codes: draw them, and read them with the camera.
  const scripts = new Map();
  function loadScript(src) {
    if (!scripts.has(src)) scripts.set(src, new Promise((resolve, reject) => {
      const tag = document.createElement('script'); tag.src = src; tag.async = true;
      tag.onload = resolve; tag.onerror = () => { scripts.delete(src); reject(new Error('QRコードの部品を読み込めませんでした。')); };
      document.head.appendChild(tag);
    }));
    return scripts.get(src);
  }
  const svgCache = new Map();
  async function qrSvg(text) {
    if (svgCache.has(text)) return svgCache.get(text);
    await loadScript(VENDOR.qr);
    const qr = globalThis.qrcode(0, 'L'); qr.addData(text, 'Byte'); qr.make();
    const svg = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true }).replace('<svg ', '<svg role="img" aria-label="接続用のQRコード" ');
    svgCache.set(text, svg); return svg;
  }
  // Fill every [data-local-qr] element inside root (renderers re-create markup freely).
  function hydrate(root) {
    for (const element of root?.querySelectorAll?.('[data-local-qr]') || []) {
      const text = element.dataset.localQr; if (!text || element.dataset.drawn === text) continue;
      element.dataset.drawn = text;
      qrSvg(text).then(svg => { if (element.dataset.localQr === text) element.innerHTML = svg; }).catch(error => { element.textContent = error.message; });
    }
  }
  // A camera overlay inside `container`; resolves with the first connection code it sees.
  function scan(container, { title = 'QRコードを読み取る' } = {}) {
    return new Promise((resolve, reject) => {
      if (!globalThis.navigator?.mediaDevices?.getUserMedia) { reject(new Error('この端末ではカメラを使えません。コードを貼り付けてください。')); return; }
      const overlay = document.createElement('div'); overlay.className = 'local-scan';
      overlay.innerHTML = `<div class="local-scan-box" role="dialog" aria-label="${esc(title)}"><p>${esc(title)}</p><video playsinline muted></video><p class="local-scan-note">相手の画面のQRコードを枠に入れてください。</p><button type="button" class="btn">やめる</button></div>`;
      container.appendChild(overlay);
      const video = overlay.querySelector('video'); let stream = null, timer = 0, finished = false;
      const stop = () => { finished = true; clearTimeout(timer); stream?.getTracks?.().forEach(track => track.stop()); overlay.remove(); };
      overlay.querySelector('button').onclick = () => { stop(); reject(Object.assign(new Error('読み取りをやめました。'), { cancelled: true })); };
      (async () => {
        let detector = null;
        try { if ('BarcodeDetector' in globalThis && (await globalThis.BarcodeDetector.getSupportedFormats?.())?.includes('qr_code')) detector = new globalThis.BarcodeDetector({ formats: ['qr_code'] }); } catch (_) {}
        if (!detector) await loadScript(VENDOR.scan);
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (finished) { stream.getTracks().forEach(track => track.stop()); return; }
        video.srcObject = stream; await video.play();
        const canvas = document.createElement('canvas'), context = canvas.getContext('2d', { willReadFrequently: true });
        const tick = async () => {
          if (finished) return;
          try {
            let text = null;
            if (video.readyState >= 2) {
              if (detector) text = (await detector.detect(video)).find(code => code.rawValue?.startsWith(PREFIX))?.rawValue || null;
              else {
                const w = video.videoWidth, h = video.videoHeight, scale = Math.min(1, 800 / Math.max(w, h));
                canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale); context.drawImage(video, 0, 0, canvas.width, canvas.height);
                const image = context.getImageData(0, 0, canvas.width, canvas.height), found = globalThis.jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
                if (found?.data?.startsWith(PREFIX)) text = found.data;
              }
            }
            if (text) { stop(); resolve(text); return; }
          } catch (_) {}
          timer = setTimeout(tick, 160);
        };
        tick();
      })().catch(error => { stop(); reject(new Error(error?.name === 'NotAllowedError' ? 'カメラの使用が許可されませんでした。コードを貼り付けてください。' : error?.message || 'カメラを起動できませんでした。')); });
    });
  }

  // ── Local trade: two offers, two confirmations, then each side applies the
  // other's monster with the same receipt checks as server trades. Each side
  // confirms only after a dry run of the receipt on its own save. The side that
  // confirms second saves first and only then sends its confirmation, so a failed
  // save there never leaves the other side traded alone.
  const stable = value => JSON.stringify(value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(stable(value[key]))])) : value);
  class LocalTradeSession {
    constructor({ role, send, getEngine, commit, check = null, onChange = () => {}, uuid = () => globalThis.crypto.randomUUID() }) {
      Object.assign(this, { role, sendRaw: send, getEngine, commit, check, onChange, tradeId: role === 0 ? uuid() : null, mine: null, theirs: null, myRevision: 0, theirRevision: 0,
        myConfirm: null, theirConfirm: null, phase: 'hello', message: '', result: null, partnerName: '' });
    }
    send(message) { if (this.sendRaw(message) === false) this.fail('送信できませんでした。'); }
    start(name) { this.send({ t: 'hello', v: 1, name: String(name || '').slice(0, 16), ...(this.role === 0 ? { tradeId: this.tradeId } : {}) }); if (this.role === 1 && this.tradeId) this.phase = 'choose'; this.onChange(); }
    fail(message) { if (this.phase === 'done') return; this.phase = 'error'; this.message = message; this.onChange(); }
    ready() { return this.phase === 'review' && !!this.myConfirm && !!this.theirConfirm && this.myConfirm.mine === this.myRevision && this.myConfirm.theirs === this.theirRevision && this.theirConfirm.mine === this.theirRevision && this.theirConfirm.theirs === this.myRevision; }
    apply() {
      this.phase = 'committing'; this.onChange();
      let result;
      try { result = this.commit(this.receipt()); } catch (error) { result = { ok: false, message: error?.message }; }
      if (!result?.ok) { this.send({ t: 'cancel' }); this.phase = 'review'; this.fail(result?.message || '交換結果を保存できませんでした。'); return false; }
      this.result = result; this.phase = 'done'; this.onChange(); return true;
    }
    offer(mon) {
      if (!['choose', 'review'].includes(this.phase)) return { ok: false, message: 'いまは選べません。' };
      let wire;
      try { wire = this.getEngine().toTradeWire(mon); } catch (error) { return { ok: false, message: error.message || 'このパチモンは交換できません。' }; }
      this.mine = wire; this.myRevision += 1; this.myConfirm = null; this.theirConfirm = null; this.phase = this.theirs ? 'review' : 'choose';
      this.send({ t: 'offer', revision: this.myRevision, monster: wire }); this.onChange(); return { ok: true };
    }
    confirm() {
      if (this.phase !== 'review' || !this.mine || !this.theirs) return { ok: false, message: 'お互いのパチモンが決まってから確認してください。' };
      // Both sides confirm only when the receipt would apply to their own save, so neither commits alone.
      const preflight = this.check?.(this.receipt());
      if (preflight && !preflight.ok) return { ok: false, message: preflight.message || 'この内容では交換できません。' };
      this.myConfirm = { mine: this.myRevision, theirs: this.theirRevision };
      const confirmation = { t: 'confirm', yours: this.theirRevision, mine: this.myRevision };
      if (this.ready()) { // The partner already confirmed this pair: save here first.
        if (!this.apply()) return { ok: false, message: this.message };
        this.send(confirmation); return { ok: true };
      }
      this.send(confirmation); this.onChange(); return { ok: true };
    }
    receive(message) {
      try {
        if (!message || typeof message !== 'object' || typeof message.t !== 'string') throw new Error('format');
        if (message.t === 'hello') {
          if (message.v !== 1) throw new Error('相手の版が違います。両方の端末でページを更新してください。');
          this.partnerName = String(message.name || '').slice(0, 16);
          if (this.role === 1) { if (typeof message.tradeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(message.tradeId)) throw new Error('format'); this.tradeId = message.tradeId; }
          if (this.phase === 'hello') this.phase = 'choose';
        } else if (message.t === 'offer') {
          if (this.phase === 'done' || this.phase === 'error') return;
          if (!['choose', 'review'].includes(this.phase) || !Number.isSafeInteger(message.revision) || message.revision <= this.theirRevision) throw new Error('revision');
          const engine = this.getEngine(); engine.tradeMonster(engine.fromTradeWire(message.monster)); // validates
          this.theirs = message.monster; this.theirRevision = message.revision; this.myConfirm = null; this.theirConfirm = null;
          if (this.mine) this.phase = 'review';
        } else if (message.t === 'confirm') {
          if (this.phase !== 'review' || message.yours !== this.myRevision || message.mine !== this.theirRevision) return; // a confirmation for an older pair
          this.theirConfirm = { mine: this.theirRevision, theirs: this.myRevision };
          if (this.ready()) { if (this.apply()) this.send({ t: 'done' }); return; }
        } else if (message.t === 'done') { this.partnerDone = true; }
        else if (message.t === 'cancel') { if (this.phase !== 'done') this.fail('相手が交換をやめました。'); return; }
        else throw new Error('format');
        this.onChange();
      } catch (error) { this.fail(error?.message && error.message.length > 8 ? error.message : '相手から正しくない交換データを受信しました。'); }
    }
    receipt() {
      const incoming = { ...this.theirs, uid: `tr-${this.tradeId}-${this.role === 0 ? 'h' : 'g'}` };
      return { id: `trade:${this.tradeId}`, revision: 1, outgoingUid: this.mine.uid, outgoing: this.mine, incoming };
    }
    cancel() { if (!['done', 'error'].includes(this.phase)) this.send({ t: 'cancel' }); this.fail('交換をやめました。'); }
  }

  // ── Local trade dialog.
  const Trade = (() => {
    let dialog = null, link = null, session = null, code = '', status = '', error = '', connecting = false, generation = 0, pasted = '', role = null, selected = '', net = preferredNet();
    const bridge = () => LT.adminBridge;
    function inventory() { const state = bridge()?.getEngine?.()?.state; return [...(state?.party || []).map(mon => ({ mon, where: '手持ち' })), ...(state?.storage || []).map(mon => ({ mon, where: 'ひかえ' }))]; }
    function eligible(mon) { try { bridge().getEngine().toTradeWire(mon); return true; } catch (_) { return false; } }
    function label(mon) { const s = LT.DATA.species[mon.species]; return `${mon.shiny ? '✦ ' : ''}${mon.nickname || s?.name || mon.species}${mon.nickname ? `（${s?.name}）` : ''} Lv.${mon.level}`; }
    function connectHtml() {
      if (!link) return `<p class="local-lead">おすすめは、2台を同じWi-FiにつないでQRコードを読み取る方法です。インターネット回線は不要です。オフラインで遊ぶ前に、両方の端末で一度ゲームを読み込んでください。</p>${netToggle(net, 'data-local-net')}
        ${net === 'bluetooth' ? '<p class="local-note">テザリングなしのBluetooth直接通信は、このブラウザー版では利用できません。</p>' : ''}${setupSteps('prepare', net)}
        <div class="local-role-grid">
          <section class="local-role-card" aria-labelledby="local-trade-host-title"><h3 class="local-role-title" id="local-trade-host-title">部屋をつくる人</h3><p class="local-role-help">自分のQRを表示して、参加する人に見せます。</p><button type="button" class="btn btn-primary" data-local="host" ${connecting ? 'disabled' : ''}>部屋をつくる（QRを表示）</button></section>
          <section class="local-role-card" aria-labelledby="local-trade-guest-title"><h3 class="local-role-title" id="local-trade-guest-title">参加する人</h3><p class="local-role-help">部屋をつくった人が表示したQRを読み取ります。</p><button type="button" class="btn" data-local="scan-offer" ${connecting ? 'disabled' : ''}>部屋のQRを読み取る</button></section>
        </div>
        <details class="local-manual-code"${pasted.trim() ? ' open' : ''}><summary>カメラを使わずコードで接続</summary>
          <label class="link-field">部屋のコードを貼り付け<textarea id="local-trade-code" rows="3" placeholder="PM1O…" spellcheck="false" autocomplete="off">${esc(pasted)}</textarea></label>
          <div class="local-actions"><button type="button" class="btn" data-local="join" ${connecting ? 'disabled' : ''}>このコードで参加</button></div>
        </details>
        ${net === 'bluetooth' ? `<details class="local-howto"><summary>Bluetoothテザリングの設定と対応条件</summary>${bluetoothPanel()}</details>` : GUIDE}`;
      if (!link.connected) return `${setupSteps(role === 0 ? 'host' : 'guest', net)}${code ? `<h3 class="local-role-title">${role === 0 ? 'このQRを参加する人に見せてください' : 'このQRを部屋をつくった人に見せてください'}</h3><div class="local-qr" data-local-qr="${esc(code)}"></div>` : ''}
        ${role === 0 && code ? `<p class="local-role-help">相手の画面にQRが表示されたら、下のボタンで読み取ります。つながると自動で交換画面へ進みます。</p><div class="local-actions"><button type="button" class="btn btn-primary" data-local="scan-answer">相手のQRを読み取る</button></div>
          <details class="local-manual-code"${pasted.trim() ? ' open' : ''}><summary>カメラを使わずコードで接続</summary>
            <div class="local-actions"><button type="button" class="btn btn-small" data-local="copy">自分のコードをコピー</button></div>
            <label class="link-field">相手のコードを貼り付け<textarea id="local-trade-code" rows="3" placeholder="PM1A…" spellcheck="false" autocomplete="off">${esc(pasted)}</textarea></label><div class="local-actions"><button type="button" class="btn" data-local="accept">接続する</button></div>
          </details>` : ''}
        ${role === 1 && code ? '<p class="local-role-help">部屋をつくった人がこのQRを読み取ると、自動で交換画面へ進みます。この画面でお待ちください。</p><details class="local-manual-code"><summary>カメラを使わずコードで接続</summary><p class="local-role-help">自分のコードをコピーして部屋をつくった人に渡し、貼り付けてもらってください。</p><div class="local-actions"><button type="button" class="btn btn-small" data-local="copy">自分のコードをコピー</button></div></details>' : ''}`;
      return '';
    }
    function tradeHtml() {
      if (!session || !link?.connected) return '';
      const engine = bridge().getEngine(), species = id => LT.DATA.species[id];
      const card = (wire, title) => wire ? `<div class="local-offer"><span class="local-offer-title">${esc(title)}</span>${LT.portraitHTML ? LT.portraitHTML(wire, 72) : ''}<strong>${esc(label(wire))}</strong><small>${esc(LT.DATA.elements[species(wire.species).element].name)}タイプ · 体力 ${wire.hp}</small></div>` : `<div class="local-offer empty"><span class="local-offer-title">${esc(title)}</span><small>まだ選ばれていません</small></div>`;
      if (session.phase === 'done') return `<p class="local-done">${esc(session.result?.message || '交換が完了しました。')}</p><div class="local-actions"><button type="button" class="btn btn-primary" data-local="close">閉じる</button></div>`;
      if (session.phase === 'error') return '';
      if (session.phase === 'hello') return '<p class="local-lead">相手の準備を待っています…</p>';
      const list = inventory().filter(({ mon }) => eligible(mon));
      return `<div class="local-offers">${card(session.mine, 'あなたが出す')}${card(session.theirs, `${session.partnerName || '相手'}が出す`)}</div>
        <label class="link-field">交換に出すパチモン<select id="local-trade-select">${list.length ? list.map(({ mon, where }) => `<option value="${esc(mon.uid)}" ${mon.uid === (selected || session.mine?.uid) ? 'selected' : ''}>${esc(label(mon))} · ${where}</option>`).join('') : '<option value="">交換できるパチモンがいません</option>'}</select></label>
        <div class="local-actions"><button type="button" class="btn" data-local="offer" ${list.length ? '' : 'disabled'}>これを出す</button>
        <button type="button" class="btn btn-primary" data-local="confirm" ${session.phase === 'review' && !session.myConfirm ? '' : 'disabled'}>${session.myConfirm ? '相手の確認を待っています…' : 'この内容で交換する'}</button></div>
        <p class="local-note">呪縛中・持ち物を持たせているパチモン・運営専用・配布限定のパチモンは交換できません。お互いに「この内容で交換する」を押すと成立します。</p>`;
    }
    function hint() {
      if (!session || !link?.connected) return '';
      if (session.phase === 'choose') return session.mine ? `${session.partnerName || '相手'}が選ぶのを待っています…` : 'お互いに、交換に出すパチモンを選んでください。';
      if (session.phase === 'review') return session.myConfirm ? '相手の確認を待っています…' : '内容を確かめて「この内容で交換する」を押してください。';
      return '';
    }
    function render() {
      if (!dialog) return;
      const body = dialog.querySelector('.local-body'), focus = document.activeElement?.id || document.activeElement?.dataset?.local;
      const failed = !!error || session?.phase === 'error';
      body.innerHTML = `<p class="local-status${failed ? ' is-error' : ''}" role="status" aria-live="polite">${esc(error || session?.message || hint() || status || '近くの端末とパチモンを交換します。')}</p>${connectHtml()}${tradeHtml()}
        ${link ? '<div class="local-actions"><button type="button" class="link-text-button" data-local="reset">最初からやり直す</button></div>' : ''}`;
      if (focus) (body.querySelector(`#${CSS.escape(focus)}`) || body.querySelector(`[data-local="${CSS.escape(focus)}"]:not(:disabled)`))?.focus({ preventScroll: true });
      hydrate(body); LT.paintPortraits?.(body);
    }
    function reset() { generation++; session?.cancel?.(); link?.close('交換をやめました。'); link = null; session = null; code = ''; status = ''; error = ''; connecting = false; role = null; selected = ''; render(); }
    async function connect(host, offer) {
      if (connecting || link) return;
      error = ''; connecting = true; const g = ++generation; role = host ? 0 : 1; status = '接続用のコードを作っています…'; render();
      try {
        link = new LocalLink({
          onStatus: s => { if (g === generation) { status = s.message; render(); } },
          onOpen: info => {
            if (g !== generation) return; connecting = false;
            session = new LocalTradeSession({ role: info.role, send: payload => link?.send(payload), getEngine: () => bridge().getEngine(), commit: receipt => bridge().commitTrade(receipt), check: receipt => bridge().checkTrade?.(receipt), onChange: render });
            session.start(bridge()?.getPlayerName?.()); render();
          },
          onMessage: message => { if (g === generation) session?.receive(message); },
          onClose: info => { if (g !== generation) return; connecting = false; if (session?.phase !== 'done') { error = info.reason || '接続が切れました。'; } render(); },
          onError: err => { if (g === generation) { error = err.message + (net === 'bluetooth' ? ' ' + BLUETOOTH_HINT : ''); render(); } }
        });
        code = host ? await link.host() : await link.join(offer);
        if (g !== generation) return; connecting = false; render();
      } catch (err) { if (g !== generation) return; const old = link; link = null; connecting = false; old?.close(); error = err.message || '接続できませんでした。'; render(); }
    }
    async function readCode(kind) {
      try { const text = await scan(dialog, { title: kind === 'offer' ? '部屋のQRコードを読み取る' : '相手のQRコードを読み取る' }); pasted = text; if (kind === 'offer') await connect(false, text); else await link.accept(text); }
      catch (err) { if (!err.cancelled) { error = err.message; render(); } }
    }
    function build() {
      dialog = document.createElement('dialog'); dialog.id = 'local-trade-dialog'; dialog.className = 'pachi-trade local-trade'; dialog.setAttribute('aria-labelledby', 'local-trade-title');
      dialog.innerHTML = '<header class="pachi-trade-head"><h2 id="local-trade-title">ローカル交換</h2><button type="button" class="btn btn-small" data-local="close">閉じる</button></header><div class="local-body"></div>';
      document.body.appendChild(dialog);
      dialog.addEventListener('input', event => { if (event.target.id === 'local-trade-code') pasted = event.target.value; if (event.target.id === 'local-trade-select') selected = event.target.value; });
      dialog.addEventListener('change', event => { if (event.target.id === 'local-trade-select') selected = event.target.value; });
      dialog.addEventListener('close', () => { if (session?.phase !== 'done') reset(); else { link?.close('交換が完了しました。'); link = null; session = null; code = ''; } LT.localTradeActive = false; });
      dialog.addEventListener('click', async event => {
        const choice = event.target.closest('[data-local-net]');
        if (choice && !link && !connecting) { net = choice.dataset.localNet === 'bluetooth' ? 'bluetooth' : 'wifi'; rememberNet(net); error = ''; render(); return; }
        const button = event.target.closest('[data-local]'); if (!button || button.disabled) return;
        const action = button.dataset.local;
        // Bluetooth: camera permission first, so this device's code carries its real address.
        if (net === 'bluetooth' && (action === 'host' || action === 'join') && !link) { status = 'Bluetoothテザリングの接続準備のため、カメラの使用を確認しています…'; render(); await revealLocalAddress(); status = ''; }
        if (action === 'close') { dialog.close(); return; }
        if (action === 'reset') { reset(); return; }
        if (action === 'host') await connect(true);
        if (action === 'join') { if (!pasted.trim()) { error = '相手の部屋のコードを貼り付けてください。'; render(); return; } await connect(false, pasted); }
        if (action === 'scan-offer') await readCode('offer');
        if (action === 'scan-answer') await readCode('answer');
        if (action === 'accept') { try { await link.accept(pasted); } catch (err) { error = err.message; render(); } }
        if (action === 'copy') { try { await navigator.clipboard.writeText(code); status = 'コードをコピーしました。'; } catch (_) { status = 'コピーできませんでした。QRコードを読み取ってもらってください。'; } render(); }
        if (action === 'offer') { const uid = selected || dialog.querySelector('#local-trade-select')?.value; const mon = inventory().find(item => item.mon.uid === uid)?.mon; error = ''; const result = mon ? session.offer(mon) : { ok: false, message: '交換に出すパチモンを選んでください。' }; if (!result.ok) error = result.message; render(); }
        if (action === 'confirm') { const result = session.confirm(); if (!result.ok) { error = result.message; render(); } else if (error) { error = ''; render(); } }
      });
    }
    function open() {
      const b = bridge();
      if (!b?.isPlaying?.()) { b?.toast?.('冒険を始めてからローカル交換を開いてください。'); return; }
      if (b.isBusy?.()) { b.toast?.('冒険中の移動できるときに交換できます。'); return; }
      if (!LocalLink.supported()) { b.toast?.('この端末・ブラウザーはローカル通信に対応していません。'); return; }
      if (!dialog) build();
      if (!link) net = preferredNet(); // the choice made last time (lobby or trade)
      b.saveNow?.(); LT.localTradeActive = true; dialog.showModal(); render();
    }
    function close() { if (dialog?.open) dialog.close(); }
    return { open, close, reset };
  })();

  LT.LocalLink = LocalLink;
  LT.LocalSignal = Object.freeze({ encode: encodeSignal, decode: decodeSignal, trim: trimSdp, prefix: PREFIX });
  LT.LocalQR = Object.freeze({ svg: qrSvg, hydrate, scan, vendor: VENDOR, guide: GUIDE, setupSteps });
  LT.LocalNet = Object.freeze({ type: networkType, preferred: preferredNet, remember: rememberNet, reveal: revealLocalAddress, toggle: netToggle, panel: bluetoothPanel, hint: BLUETOOTH_HINT });
  LT.LocalTradeSession = LocalTradeSession;
  LT.LocalTrade = Trade;
  if (typeof module !== 'undefined' && module.exports) module.exports = { LocalLink, LocalTradeSession, encodeSignal, decodeSignal, trimSdp, stable, LocalNet: LT.LocalNet };
})();
