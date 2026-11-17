/* iOS bridge. In ordinary browsers this module does not change networking. */
(() => {
  'use strict';
  const handler = window.webkit?.messageHandlers?.pachiNative;
  const available = location.protocol === 'pachimon:' && location.hostname === 'app' && !!handler?.postMessage;
  const LIMIT = 524288, RESPONSE_LIMIT = 1048576;
  const pending = new Map();
  let game = null, sequence = 0;
  const byteLength = value => new TextEncoder().encode(value).byteLength;
  function post(message) {
    if (!available) throw new Error('この操作はiPhone・iPadアプリで利用できます。');
    handler.postMessage(message);
  }
  function validJSON(json) {
    if (typeof json !== 'string' || byteLength(json) > LIMIT) throw new Error('バックアップは512KB以下にしてください。');
    const data = JSON.parse(json);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('有効なJSONバックアップではありません。');
    return json;
  }
  function exportJSON(json, kind = 'adventure') {
    validJSON(json);
    if (!['adventure', 'playerIdentity'].includes(kind)) throw new Error('未対応のバックアップ形式です。');
    post({ command: 'exportSave', json, kind });
    return true;
  }
  function apiRequest(path, { method = 'GET', body, token, signal } = {}) {
    return new Promise((resolve, reject) => {
      if (!available) { reject(new Error('ネイティブ通信が利用できません。')); return; }
      let decodedPath;
      try { decodedPath = typeof path === 'string' ? decodeURIComponent(path.split('?')[0]) : ''; } catch (_) { decodedPath = ''; }
      if (typeof path !== 'string' || !/^\/[A-Za-z0-9/?=&_%.-]*$/.test(path) || !/^\/[A-Za-z0-9/_-]*$/.test(decodedPath) || decodedPath.startsWith('//') || path.length > 2048) {
        reject(new Error('無効なAPIパスです。')); return;
      }
      if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) { reject(new Error('未対応の通信方式です。')); return; }
      if (pending.size >= 8) { reject(new Error('通信中です。少し待って再試行してください。')); return; }
      if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      const json = body === undefined ? undefined : JSON.stringify(body);
      if (json !== undefined && byteLength(json) > RESPONSE_LIMIT) { reject(new Error('送信データが大きすぎます。')); return; }
      const id = 'native-' + Date.now() + '-' + (++sequence);
      let timer;
      const finish = (error, value) => {
        if (!pending.delete(id)) return;
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(value);
      };
      const abort = () => {
        try { post({ command: 'cancelAPI', id }); } catch (_) {}
        finish(new DOMException('Aborted', 'AbortError'));
      };
      timer = setTimeout(() => {
        try { post({ command: 'cancelAPI', id }); } catch (_) {}
        finish(new DOMException('接続がタイムアウトしました。', 'AbortError'));
      }, 16000);
      pending.set(id, finish);
      signal?.addEventListener('abort', abort, { once: true });
      try { post({ command: 'apiRequest', id, path, method, ...(json === undefined ? {} : { body: json }), ...(token ? { token } : {}) }); }
      catch (error) { finish(error); }
    });
  }
  function receive(message) {
    if (!available || !message || typeof message !== 'object') return;
    if (message.type === 'apiResponse') {
      const finish = pending.get(message.id);
      if (!finish) return;
      if (message.error) { finish(new Error(String(message.error).slice(0, 500))); return; }
      if (!Number.isInteger(message.status) || message.status < 200 || message.status > 599 || typeof message.body !== 'string' || byteLength(message.body) > RESPONSE_LIMIT) {
        finish(new Error('サーバーから有効な応答を受信できませんでした。')); return;
      }
      try { finish(null, new Response([204, 205, 304].includes(message.status) ? null : message.body, { status: message.status, headers: { 'Content-Type': 'application/json' } })); }
      catch (error) { finish(error); }
      return;
    }
    if (!game) return;
    switch (message.type) {
      case 'requestExport': game.exportSave(); break;
      case 'requestSettings': game.openSettings(); break;
      case 'importSave':
        try { validJSON(message.json); void game.importSave(new File([message.json], 'Pachi_Monsters_Save.json', { type: 'application/json' })); }
        catch (error) { game.toast(error.message); }
        break;
      case 'background': game.background(); break;
      case 'foreground': game.foreground(); break;
    }
  }
  window.PachiNative = Object.freeze({
    available, apiRequest, exportJSON, receive,
    requestImport: () => post({ command: 'importSave' }),
    openMenu: () => post({ command: 'menu' }),
    copyCode(code) {
      if (!/^[A-Z0-9]{4,8}$/.test(code)) throw new Error('対戦コードが無効です。');
      post({ command: 'copyCode', code });
    },
    bindGame(callbacks) {
      if (!available) return;
      game = callbacks;
      document.documentElement.classList.add('native-app');
      post({ command: 'ready' });
    },
  });
  if (available) document.documentElement.classList.add('native-app');
})();
