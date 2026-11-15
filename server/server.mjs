// Pachi Monsters shared ownership and Futo delivery API.
// ADMIN_CLAIM_KEY is a runtime secret. Never place it in client code or source.
const BASE_ORIGIN = 'https://uni-tadayasu.github.io';
const encoder = new TextEncoder();
const DEFAULT_MOVES = ['futo_breaker', 'futo_burst', 'futo_ascend', 'futo_restore'];
const LEGACY_DEFAULT_MOVES = ['supernova', 'atlas_crystal_4', 'starlight', 'shell'];
const BASIC_MOVES = 'sprout vine bloom wave surge mist spark blaze warmth gust storm shelter glint prism shell nudge lifeline evergreen thorn dew riptide ripple frost spring sunburst cinder phoenix heatveil tempest whisper feather sirocco supernova moonbeam facet starlight pulse focus restsong dawnstep'.split(' ');
const MOVE_IDS = new Set([...DEFAULT_MOVES, ...BASIC_MOVES, ...['leaf', 'tide', 'ember', 'wind', 'crystal'].flatMap(type => Array.from({length:12}, (_, i) => `atlas_${type}_${i + 1}`))]);
const STAT_LIMITS = {hp:99999, atk:9999, def:9999, spAtk:9999, spDef:9999, speed:9999, accuracy:300, evasion:300};
export const DEFAULT_CONFIG = Object.freeze({level:100, stats:Object.freeze({hp:500, atk:150, def:150, spAtk:180, spDef:150, speed:160, accuracy:110, evasion:100}), moves:Object.freeze(DEFAULT_MOVES)});

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const tokenValid = token => typeof token === 'string' && /^(?:[A-Za-z0-9_-]{43}|[a-fA-F0-9]{64})$/.test(token);
const playerView = row => ({id:row.id, name:row.name, isAdmin:!!row.is_admin});
const safeName = value => {
  if (typeof value !== 'string') fail(400, 'INVALID_NAME', 'プレイヤー名を入力してください。');
  const name = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  if (!name || [...name].length > 32) fail(400, 'INVALID_NAME', 'プレイヤー名は1〜32文字で入力してください。');
  return name;
};
async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), x => x.toString(16).padStart(2, '0')).join('');
}
async function sameSecret(a, b) {
  const x = await digest(a), y = await digest(b);
  let different = 0;
  for (let i = 0; i < x.length; i++) different |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return different === 0;
}
function encodeURL(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function decodeURL(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('Invalid encoding');
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));
}
async function signingKey(env) {
  if (typeof env.DUEL_SIGNING_KEY !== 'string' || env.DUEL_SIGNING_KEY.length < 32) fail(503, 'DUEL_NOT_CONFIGURED', 'フートの通信対戦を準備中です。');
  return crypto.subtle.importKey('raw', encoder.encode(env.DUEL_SIGNING_KEY), {name:'HMAC', hash:'SHA-256'}, false, ['sign', 'verify']);
}
function sessionId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/i.test(value)) fail(400, 'INVALID_SESSION', '対戦の識別情報が正しくありません。');
  return value.toLowerCase();
}
function sideId(value) {
  if (value !== 0 && value !== 1) fail(400, 'INVALID_SIDE', '対戦側の指定が正しくありません。');
  return value;
}
async function verifyPass(env, body) {
  const expectedSession = sessionId(body.sessionId), expectedSide = sideId(body.side), key = await signingKey(env);
  if (typeof body.pass !== 'string' || body.pass.length > 4096) fail(400, 'INVALID_PASS', 'フートの使用証明が正しくありません。');
  try {
    const parts = body.pass.split('.');
    if (parts.length !== 2) throw new Error('Invalid pass');
    const payload = decodeURL(parts[0]), signature = decodeURL(parts[1]);
    if (signature.length !== 32 || !await crypto.subtle.verify('HMAC', key, signature, payload)) throw new Error('Invalid signature');
    const data = JSON.parse(new TextDecoder().decode(payload));
    if (data.v !== 1 || data.sessionId !== expectedSession || data.side !== expectedSide || !integer(data.expiresAt, Date.now(), Date.now() + 600001) || typeof data.grantId !== 'string') throw new Error('Invalid payload');
    return {grantId:data.grantId, species:'futo', ...validateConfig(data.config), sessionId:data.sessionId, side:data.side, expiresAt:data.expiresAt};
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail(403, 'INVALID_PASS', 'フートの使用証明が無効、または期限切れです。');
  }
}
export function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'INVALID_CONFIG', 'フートの能力設定が必要です。');
  if (!integer(input.level, 1, 100)) fail(400, 'INVALID_LEVEL', 'レベルは1〜100にしてください。');
  const stats = {};
  for (const [key, max] of Object.entries(STAT_LIMITS)) {
    const value = input.stats?.[key];
    if (!integer(value, 1, max)) fail(400, 'INVALID_STATS', `${key}は1〜${max}の整数にしてください。`);
    stats[key] = value;
  }
  if (!Array.isArray(input.moves) || input.moves.length !== 4 || new Set(input.moves).size !== 4 || input.moves.some(id => !MOVE_IDS.has(id))) fail(400, 'INVALID_MOVES', '異なる4つの使用可能な技を選んでください。');
  // Upgrade only the original default loadout. Preserve any chosen order or
  // custom move, and leave persisted snapshots/hashes untouched during reads.
  const moves = input.moves.every((id, index) => id === LEGACY_DEFAULT_MOVES[index]) ? DEFAULT_MOVES : input.moves;
  return {level:input.level, stats, moves:[...moves]};
}
async function bodyJSON(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) fail(415, 'JSON_REQUIRED', 'JSON形式で送信してください。');
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > 16384) fail(413, 'BODY_TOO_LARGE', '送信内容が大きすぎます。');
  const reader = request.body?.getReader();
  let total = 0, chunks = [];
  if (reader) {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 16384) { await reader.cancel(); fail(413, 'BODY_TOO_LARGE', '送信内容が大きすぎます。'); }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { fail(400, 'INVALID_JSON', '送信内容を読み取れませんでした。'); }
}
function paging(url, {max = 100, defaultLimit = 50} = {}) {
  const cursor = Number(url.searchParams.get('cursor') || 0), limit = Number(url.searchParams.get('limit') || defaultLimit);
  if (!integer(cursor, 0, Number.MAX_SAFE_INTEGER) || !integer(limit, 1, max)) fail(400, 'INVALID_PAGE', 'ページ指定が正しくありません。');
  return {cursor, limit};
}
async function consumeLimit(env, request, action, max, milliseconds, global = false) {
  const now = Date.now(), bucket = Math.floor(now / milliseconds);
  const identity = global ? 'global' : await digest(request.headers.get('CF-Connecting-IP') || 'unavailable');
  const key = `${action}:${identity}:${bucket}`;
  const row = await env.DB.prepare('INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count').bind(key, (bucket + 1) * milliseconds, max).first();
  if (!row) fail(429, 'RATE_LIMITED', '操作が多すぎます。少し時間をおいてください。');
  // Bounded cleanup of expired counters; no migration-owned table creation here.
  await env.DB.prepare('DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at < ? LIMIT 20)').bind(now - 86400000).run();
}
async function ownerExists(env) { return !!await env.DB.prepare('SELECT player_id FROM admin_owner WHERE singleton = 1').first(); }
async function playerByToken(env, token) {
  if (!tokenValid(token)) fail(401, 'UNAUTHORIZED', 'プレイヤー登録をやり直してください。');
  const row = await env.DB.prepare('SELECT p.id, p.name, p.row_id, p.created_at, EXISTS (SELECT 1 FROM admin_owner a WHERE a.player_id = p.id) AS is_admin FROM players p WHERE p.token_hash = ?').bind(await digest(token)).first();
  if (!row) fail(401, 'UNAUTHORIZED', 'プレイヤー登録をやり直してください。');
  return row;
}
async function authenticate(env, request) {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(request.headers.get('Authorization') || '');
  return playerByToken(env, match?.[1]);
}
function requireAdmin(player) { if (!player.is_admin) fail(403, 'ADMIN_REQUIRED', '運営専用の操作です。'); }
async function configRecord(env) {
  const row = await env.DB.prepare('SELECT config_json, revision FROM futo_config WHERE singleton = 1').first();
  return row ? {config:validateConfig(JSON.parse(row.config_json)), revision:row.revision} : {config:validateConfig(DEFAULT_CONFIG), revision:0};
}
function grantView(row) { return {grantId:row.grant_id, species:'futo', ...validateConfig(JSON.parse(row.config_json)), createdAt:row.created_at}; }
function sameGrantRequest(row, playerId, target, configJSON) {
  return row?.creator_id === playerId && row.target === target && JSON.stringify(validateConfig(JSON.parse(row.config_json))) === configJSON;
}
async function playerGrants(env, playerId, cursor, limit) {
  const result = await env.DB.prepare('SELECT row_id, grant_id, config_json, created_at FROM grants WHERE player_id = ? AND row_id > ? ORDER BY row_id LIMIT ?').bind(playerId, cursor, limit + 1).all();
  const rows = result.results || [];
  return {grants:rows.slice(0, limit).map(grantView), nextCursor:rows.length > limit ? rows[limit - 1].row_id : null};
}

async function route(request, env, url) {
  const path = url.pathname.replace(/\/$/, '') || '/', method = request.method;
  if (path === '/api/status' && method === 'GET') return {adminExists:await ownerExists(env)};
  if (path === '/api/register' && method === 'POST') {
    const body = await bodyJSON(request), name = safeName(body.name), token = body.token;
    if (!tokenValid(token)) fail(400, 'INVALID_TOKEN', '安全なプレイヤー識別情報を生成できませんでした。');
    const hash = await digest(token);
    const existing = await env.DB.prepare('SELECT id FROM players WHERE token_hash = ?').bind(hash).first();
    if (!existing) {
      await consumeLimit(env, request, 'register', 30, 3600000);
      const id = `P${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`, now = Date.now();
      await env.DB.prepare('INSERT OR IGNORE INTO players (id, token_hash, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(id, hash, name, now, now).run();
    }
    return {player:playerView(await playerByToken(env, token)), adminExists:await ownerExists(env)};
  }
  if (path === '/api/duel-pass/verify' && method === 'POST') {
    await consumeLimit(env, request, 'duel-verify', 120, 60000);
    return verifyPass(env, await bodyJSON(request));
  }
  const player = await authenticate(env, request);
  if (path === '/api/me' && method === 'GET') {
    const {cursor, limit} = paging(url);
    return {player:playerView(player), adminExists:await ownerExists(env), ...await playerGrants(env, player.id, cursor, limit)};
  }
  if (path === '/api/me' && method === 'PATCH') {
    const name = safeName((await bodyJSON(request)).name);
    await consumeLimit(env, request, `rename:${player.id}`, 30, 60000, true);
    await env.DB.prepare('UPDATE players SET name = ?, updated_at = ? WHERE id = ?').bind(name, Date.now(), player.id).run();
    return {player:{...playerView(player), name}};
  }
  if (path === '/api/duel-pass' && method === 'POST') {
    const body = await bodyJSON(request), session = sessionId(body.sessionId), side = sideId(body.side);
    if (typeof body.grantId !== 'string' || body.grantId.length > 100) fail(400, 'INVALID_GRANT', 'フートの受取記録を指定してください。');
    await consumeLimit(env, request, `duel-issue:${player.id}`, 30, 60000, true);
    const grant = await env.DB.prepare('SELECT grant_id, config_json FROM grants WHERE player_id = ? AND grant_id = ?').bind(player.id, body.grantId).first();
    if (!grant) fail(403, 'GRANT_NOT_OWNED', 'このフートの受取記録を確認できません。');
    const expiresAt = Date.now() + 600000;
    const payload = encoder.encode(JSON.stringify({v:1, sessionId:session, side, grantId:grant.grant_id, config:validateConfig(JSON.parse(grant.config_json)), expiresAt}));
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(env), payload));
    return {pass:`${encodeURL(payload)}.${encodeURL(signature)}`, expiresAt};
  }
  if (path === '/api/admin/claim' && method === 'POST') {
    if (player.is_admin) return {player:playerView(player), adminExists:true, ...await playerGrants(env, player.id, 0, 100)};
    if (await ownerExists(env)) fail(409, 'ADMIN_ALREADY_EXISTS', '運営はすでに登録されています。');
    if (typeof env.ADMIN_CLAIM_KEY !== 'string' || env.ADMIN_CLAIM_KEY.length < 12) fail(503, 'ADMIN_NOT_CONFIGURED', '運営登録は準備中です。');
    await consumeLimit(env, request, 'claim-ip', 8, 900000);
    await consumeLimit(env, request, 'claim-global', 100, 900000, true);
    const body = await bodyJSON(request);
    if (typeof body.key !== 'string' || body.key.length > 256 || !await sameSecret(body.key, env.ADMIN_CLAIM_KEY)) fail(403, 'INVALID_ADMIN_KEY', '運営キーが正しくありません。');
    const now = Date.now(), config = JSON.stringify(validateConfig(DEFAULT_CONFIG));
    const batchId = 'admin-initial', payloadHash = await digest(config);
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO admin_owner (singleton, player_id, claimed_at) VALUES (1, ?, ?)').bind(player.id, now),
      env.DB.prepare('INSERT OR IGNORE INTO futo_config (singleton, config_json, revision, updated_at) SELECT 1, ?, 1, ? WHERE EXISTS (SELECT 1 FROM admin_owner WHERE player_id = ?)').bind(config, now, player.id),
      env.DB.prepare('INSERT OR IGNORE INTO grant_batches (id, creator_id, target, payload_hash, config_json, max_player_row, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_owner WHERE player_id = ?)').bind(batchId, player.id, player.id, payloadHash, config, player.row_id, now, player.id),
      env.DB.prepare('INSERT OR IGNORE INTO grants (grant_id, batch_id, player_id, config_json, created_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_owner WHERE player_id = ?)').bind(`${batchId}:${player.id}`, batchId, player.id, config, now, player.id)
    ]);
    const owner = await env.DB.prepare('SELECT player_id FROM admin_owner WHERE singleton = 1').first();
    if (owner?.player_id !== player.id) fail(409, 'ADMIN_ALREADY_EXISTS', '運営はすでに登録されています。');
    return {player:{...playerView(player), isAdmin:true}, adminExists:true, ...await playerGrants(env, player.id, 0, 100)};
  }
  requireAdmin(player);
  if (path === '/api/admin/config' && method === 'GET') return configRecord(env);
  if (path === '/api/admin/config' && method === 'PUT') {
    const body = await bodyJSON(request), config = validateConfig(body.config), current = await configRecord(env);
    if (body.expectedRevision !== undefined && body.expectedRevision !== current.revision) fail(409, 'CONFIG_CHANGED', '設定が変更されています。再読み込みしてください。');
    const results = await env.DB.batch([
      env.DB.prepare('UPDATE futo_config SET config_json = ?, revision = revision + 1, updated_at = ? WHERE singleton = 1 AND revision = ? RETURNING revision').bind(JSON.stringify(config), Date.now(), current.revision),
      env.DB.prepare("UPDATE grants SET config_json = (SELECT config_json FROM futo_config WHERE singleton = 1) WHERE grant_id = ? AND player_id = ?").bind(`admin-initial:${player.id}`, player.id)
    ]);
    const result = results[0]?.results?.[0];
    if (!result) fail(409, 'CONFIG_CHANGED', '設定が変更されています。再読み込みしてください。');
    return {config, revision:result.revision};
  }
  if (path === '/api/admin/players' && method === 'GET') {
    const {cursor, limit} = paging(url);
    const result = await env.DB.prepare('SELECT p.row_id, p.id, p.name, p.created_at, EXISTS (SELECT 1 FROM admin_owner a WHERE a.player_id = p.id) AS is_admin FROM players p WHERE p.row_id > ? ORDER BY p.row_id LIMIT ?').bind(cursor, limit + 1).all();
    const rows = result.results || [];
    return {players:rows.slice(0, limit).map(row => ({...playerView(row), createdAt:row.created_at})), nextCursor:rows.length > limit ? rows[limit - 1].row_id : null};
  }
  if (path === '/api/admin/grants' && method === 'POST') {
    const body = await bodyJSON(request);
    if (typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) fail(400, 'INVALID_REQUEST_ID', '配布操作の識別情報が正しくありません。');
    let target = body.target === 'self' ? player.id : body.target;
    if (target !== 'all' && (typeof target !== 'string' || !/^P[0-9a-f]{16}$/.test(target))) fail(400, 'INVALID_TARGET', '配布先を選択してください。');
    if (target !== 'all' && !await env.DB.prepare('SELECT id FROM players WHERE id = ?').bind(target).first()) fail(404, 'PLAYER_NOT_FOUND', '配布先のプレイヤーが見つかりません。');
    const batchId = body.requestId.toLowerCase();
    const existing = await env.DB.prepare('SELECT payload_hash, creator_id, target, config_json FROM grant_batches WHERE id = ?').bind(batchId).first();
    // A retry that omitted config still means its original stored snapshot,
    // even if the administrator has changed the current defaults since then.
    const config = validateConfig(body.config || (existing ? JSON.parse(existing.config_json) : (await configRecord(env)).config)), configJSON = JSON.stringify(config);
    const payloadHash = await digest(JSON.stringify({target, config}));
    if (existing && !sameGrantRequest(existing, player.id, target, configJSON)) fail(409, 'REQUEST_ID_REUSED', '配布識別情報が別の操作に使われています。');
    // A legacy batch may have an older hash for the same effective loadout.
    // Retain that hash and its recipient cutoff so retries neither conflict nor
    // distribute a second gift to players who registered after first issuance.
    const storedHash = existing?.payload_hash || payloadHash;
    if (!existing) await consumeLimit(env, request, 'grant-global', 60, 60000, true);
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO grant_batches (id, creator_id, target, payload_hash, config_json, max_player_row, created_at) VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(row_id), 0) FROM players), ?)').bind(batchId, player.id, target, payloadHash, configJSON, Date.now()),
      env.DB.prepare("INSERT OR IGNORE INTO grants (grant_id, batch_id, player_id, config_json, created_at) SELECT b.id || ':' || p.id, b.id, p.id, b.config_json, b.created_at FROM grant_batches b JOIN players p ON p.row_id <= b.max_player_row AND (b.target = 'all' OR b.target = p.id) WHERE b.id = ? AND b.payload_hash = ? AND b.creator_id = ?").bind(batchId, storedHash, player.id)
    ]);
    const actual = await env.DB.prepare('SELECT payload_hash, creator_id, target, config_json FROM grant_batches WHERE id = ?').bind(batchId).first();
    if (!sameGrantRequest(actual, player.id, target, configJSON)) fail(409, 'REQUEST_ID_REUSED', '配布識別情報が別の操作に使われています。');
    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM grants WHERE batch_id = ?').bind(batchId).first();
    return {batchId, recipientCount:count.total, replayed:!!existing};
  }
  fail(404, 'NOT_FOUND', 'この操作はありません。');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), origin = request.headers.get('Origin');
    const allowed = new Set([BASE_ORIGIN, url.origin, ...(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)]);
    const headers = new Headers({'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'Vary':'Origin'});
    const json = (payload, status = 200) => new Response(JSON.stringify(payload), {status, headers});
    if (origin && !allowed.has(origin)) return json({ok:false, error:{code:'ORIGIN_DENIED', message:'この送信元は許可されていません。'}}, 403);
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      headers.set('Access-Control-Max-Age', '600');
      return new Response(null, {status:204, headers});
    }
    if (url.pathname === '/' && request.method === 'GET') {
      headers.set('Content-Type', 'text/html; charset=utf-8');
      headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
      return new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>パチモン通信サービス</title><style>body{font:18px system-ui;max-width:40rem;margin:12vh auto;padding:2rem;color:#17283e;background:#fffdf8}a{color:#238978}</style><h1>パチモン通信サービス</h1><p>運営登録とフートの配布を同期するサービスです。</p><a href="https://uni-tadayasu.github.io/pachi-mon/">パチモンを開く</a></html>', {headers});
    }
    try {
      if (!env.DB) fail(503, 'DATABASE_UNAVAILABLE', '通信サービスを準備中です。');
      return json({ok:true, ...await route(request, env, url)});
    } catch (error) {
      if (error instanceof ApiError) return json({ok:false, error:{code:error.code, message:error.message}}, error.status);
      console.error('Pachi API request failed', error?.name || 'Error');
      return json({ok:false, error:{code:'INTERNAL_ERROR', message:'通信処理に失敗しました。時間をおいて再試行してください。'}}, 500);
    }
  }
};
