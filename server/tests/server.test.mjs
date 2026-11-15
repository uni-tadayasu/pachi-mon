import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker, {DEFAULT_CONFIG} from '../server.mjs';

class LocalD1 {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec('PRAGMA foreign_keys=ON;'); this.sqlite.exec(readFileSync(new URL('../drizzle/0000_admin.sql', import.meta.url), 'utf8')); }
  prepare(sql) {
    const database = this;
    return {
      values:[],
      bind(...values) { this.values = values; return this; },
      execute() {
        const query = database.sqlite.prepare(sql);
        const results = query.all(...this.values).map(row => ({...row}));
        const changes = database.sqlite.prepare('SELECT changes() AS n').get().n;
        return {results, success:true, meta:{changes}};
      },
      async first(column) { const row = this.execute().results[0] || null; return column && row ? row[column] : row; },
      async all() { return this.execute(); },
      async run() { return this.execute(); }
    };
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE;');
    try { const results = statements.map(statement => statement.execute()); this.sqlite.exec('COMMIT;'); return results; }
    catch (error) { this.sqlite.exec('ROLLBACK;'); throw error; }
  }
}
const ORIGIN = 'https://uni-tadayasu.github.io';
const SECRET = 'test-only-not-production-admin-password';
function setup() {
  const env = {DB:new LocalD1(), ADMIN_CLAIM_KEY:SECRET, DUEL_SIGNING_KEY:'test-only-duel-signing-secret-at-least-thirty-two-chars'};
  let ip = 0;
  async function call(path, {method = 'GET', token, body, origin = ORIGIN, addr} = {}) {
    const headers = {'Content-Type':'application/json', 'CF-Connecting-IP':addr || `192.0.2.${++ip}`};
    if (origin !== null) headers.Origin = origin;
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await worker.fetch(new Request(`https://pachi-admin.example${path}`, {method, headers, body:body === undefined ? undefined : JSON.stringify(body)}), env);
    const result = response.status === 204 ? null : await response.json();
    assert(!JSON.stringify(result).includes(SECRET), 'The admin secret must never be returned');
    return {status:response.status, headers:response.headers, ...result};
  }
  async function register(name = 'プレイヤー') {
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    const result = await call('/api/register', {method:'POST', body:{name, token}});
    assert.equal(result.status, 200);
    return {token, id:result.player.id, name};
  }
  async function admin() {
    const owner = await register('運営');
    const result = await call('/api/admin/claim', {method:'POST', token:owner.token, body:{key:SECRET}});
    assert.equal(result.status, 200);
    return {...owner, grant:result.grants[0]};
  }
  return {env, call, register, admin};
}
const changedConfig = () => ({...DEFAULT_CONFIG, stats:{...DEFAULT_CONFIG.stats, hp:99999, spAtk:500}, moves:[...DEFAULT_CONFIG.moves]});

test('registration is idempotent and only hashed tokens are stored', async () => {
  const {call, register, env} = setup();
  const player = await register('カサイ');
  const again = await call('/api/register', {method:'POST', body:{token:player.token, name:'二重登録'}});
  assert.equal(again.player.id, player.id);
  assert.equal(again.player.name, 'カサイ');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM players').get().n, 1);
  assert.notEqual(env.DB.sqlite.prepare('SELECT token_hash FROM players').get().token_hash, player.token);
  assert.equal((await call('/api/me')).status, 401);
  assert.equal((await call('/api/me', {token:player.token})).player.id, player.id);
  assert.equal((await call('/api/register', {method:'POST', body:{token:'weak', name:'x'}})).status, 400);
});

test('CORS, malformed requests and data bounds are enforced', async () => {
  const {call, register} = setup();
  assert.equal((await call('/api/status', {origin:'https://attacker.example'})).status, 403);
  const good = await call('/api/status');
  assert.equal(good.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(good.adminExists, false);
  const options = await call('/api/me', {method:'OPTIONS'});
  assert.equal(options.status, 204);
  assert.match(options.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  const player = await register();
  assert.equal((await call('/api/me?cursor=-1', {token:player.token})).status, 400);
  assert.equal((await call('/api/me', {method:'PATCH', token:player.token, body:{name:'a'.repeat(33)}})).status, 400);
  const renamed = await call('/api/me', {method:'PATCH', token:player.token, body:{name:'  新しい名前  '}});
  assert.equal(renamed.player.name, '新しい名前');
});

test('concurrent valid claims produce exactly one permanent administrator and initial grant', async () => {
  const {call, register, env} = setup();
  const players = await Promise.all([register('一人目'), register('二人目')]);
  const wrong = await call('/api/admin/claim', {method:'POST', token:players[0].token, body:{key:'invalid'}});
  assert.equal(wrong.status, 403);
  const results = await Promise.all(players.map(player => call('/api/admin/claim', {method:'POST', token:player.token, body:{key:SECRET}})));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM admin_owner').get().n, 1);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM grants').get().n, 1);
  assert.equal((await call('/api/status')).adminExists, true);
  const winner = players[results.findIndex(r => r.status === 200)], loser = players[results.findIndex(r => r.status === 409)];
  assert.equal((await call('/api/me', {token:winner.token})).player.isAdmin, true);
  assert.equal((await call('/api/admin/config', {token:loser.token})).status, 403);
  assert.equal((await call('/api/admin/claim', {method:'POST', token:loser.token, body:{key:SECRET}})).status, 409);
  const replay = await call('/api/admin/claim', {method:'POST', token:winner.token, body:{key:SECRET}});
  assert.equal(replay.grants.length, 1);
  assert.equal(replay.grants[0].level, 100);
});

test('admin attempts are rate limited before takeover', async () => {
  const {call, register} = setup();
  const player = await register();
  for (let i = 0; i < 8; i++) assert.equal((await call('/api/admin/claim', {method:'POST', token:player.token, addr:'203.0.113.2', body:{key:'wrong'}})).status, 403);
  const blocked = await call('/api/admin/claim', {method:'POST', token:player.token, addr:'203.0.113.2', body:{key:SECRET}});
  assert.equal(blocked.status, 429);
  assert.equal((await call('/api/status')).adminExists, false);
});

test('config revisions reject stale/invalid changes and update only the initial admin Futo', async () => {
  const {call, admin, register} = setup();
  const owner = await admin(), player = await register();
  const before = await call('/api/admin/config', {token:owner.token});
  assert.equal(before.revision, 1);
  const requestId = crypto.randomUUID();
  await call('/api/admin/grants', {method:'POST', token:owner.token, body:{requestId, target:player.id}});
  const bad = changedConfig(); bad.stats.hp = 100000;
  assert.equal((await call('/api/admin/config', {method:'PUT', token:owner.token, body:{config:bad}})).status, 400);
  const update = await call('/api/admin/config', {method:'PUT', token:owner.token, body:{config:changedConfig(), expectedRevision:1}});
  assert.equal(update.revision, 2);
  assert.equal((await call('/api/me', {token:owner.token})).grants[0].stats.hp, 99999);
  assert.equal((await call('/api/me', {token:player.token})).grants[0].stats.hp, 500);
  assert.equal((await call('/api/admin/config', {method:'PUT', token:owner.token, body:{config:changedConfig(), expectedRevision:1}})).status, 409);
  const badMoves = changedConfig(); badMoves.moves[0] = 'not-a-real-move';
  assert.equal((await call('/api/admin/config', {method:'PUT', token:owner.token, body:{config:badMoves}})).status, 400);
});

test('all-player gifts are idempotent snapshots and do not expand on retry', async () => {
  const {call, admin, register, env} = setup();
  const owner = await admin(), first = await register('A'), second = await register('B');
  const requestId = crypto.randomUUID(), config = changedConfig();
  const body = {requestId, target:'all', config};
  const issued = await call('/api/admin/grants', {method:'POST', token:owner.token, body});
  assert.equal(issued.recipientCount, 3);
  const late = await register('遅れて参加');
  const retry = await call('/api/admin/grants', {method:'POST', token:owner.token, body});
  assert.equal(retry.recipientCount, 3); assert.equal(retry.replayed, true);
  assert.equal((await call('/api/me', {token:late.token})).grants.length, 0);
  assert.equal((await call('/api/me', {token:first.token})).grants[0].stats.hp, 99999);
  assert.equal((await call('/api/me', {token:second.token})).grants[0].level, 100);
  assert.equal((await call('/api/admin/grants', {method:'POST', token:first.token, body:{requestId:crypto.randomUUID(), target:'all'}})).status, 403);
  assert.equal((await call('/api/admin/grants', {method:'POST', token:owner.token, body:{...body, target:first.id}})).status, 409);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM grants').get().n, 4);
});

test('specific gifts and pagination never expose another player gifts', async () => {
  const {call, admin, register} = setup();
  const owner = await admin(), recipient = await register(), other = await register();
  for (let i = 0; i < 3; i++) {
    const gift = await call('/api/admin/grants', {method:'POST', token:owner.token, body:{requestId:crypto.randomUUID(), target:recipient.id}});
    assert.equal(gift.recipientCount, 1);
  }
  const first = await call('/api/me?limit=2', {token:recipient.token});
  assert.equal(first.grants.length, 2); assert(first.nextCursor > 0);
  const last = await call(`/api/me?limit=2&cursor=${first.nextCursor}`, {token:recipient.token});
  assert.equal(last.grants.length, 1); assert.equal(last.nextCursor, null);
  assert.equal((await call('/api/me', {token:other.token})).grants.length, 0);
  const roster = await call('/api/admin/players?limit=2', {token:owner.token});
  assert.equal(roster.players.length, 2);
  assert.equal((await call(`/api/admin/players?limit=2&cursor=${roster.nextCursor}`, {token:owner.token})).players.length, 1);
  assert.equal((await call('/api/admin/players', {token:recipient.token})).status, 403);
});

test('concurrent duplicate distribution requests deliver once', async () => {
  const {call, admin, register, env} = setup();
  const owner = await admin(); await register();
  const body = {requestId:crypto.randomUUID(), target:'all', config:changedConfig()};
  const results = await Promise.all([1, 2, 3].map(() => call('/api/admin/grants', {method:'POST', token:owner.token, body})));
  assert(results.every(r => r.status === 200 && r.recipientCount === 2));
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM grants').get().n, 3);
});

test('duel proof authenticates exact owned snapshot and binds the session', async () => {
  const {call, admin, register, env} = setup();
  const owner = await admin(), other = await register();
  const sessionId = crypto.randomUUID().replaceAll('-', ''), side = 0;
  const issued = await call('/api/duel-pass', {method:'POST', token:owner.token, body:{sessionId, side, grantId:owner.grant.grantId}});
  assert.equal(issued.status, 200); assert(issued.pass.length < 2048);
  const verified = await call('/api/duel-pass/verify', {method:'POST', body:{sessionId, side, pass:issued.pass}});
  assert.equal(verified.status, 200); assert.equal(verified.grantId, owner.grant.grantId);
  assert.deepEqual(verified.stats, {...DEFAULT_CONFIG.stats});
  assert.equal(verified.player, undefined);
  const stolen = await call('/api/duel-pass', {method:'POST', token:other.token, body:{sessionId, side, grantId:owner.grant.grantId}});
  assert.equal(stolen.status, 403);
  assert.equal((await call('/api/duel-pass/verify', {method:'POST', body:{sessionId:'0'.repeat(32), side, pass:issued.pass}})).status, 403);
  assert.equal((await call('/api/duel-pass/verify', {method:'POST', body:{sessionId, side:1, pass:issued.pass}})).status, 403);
  assert.equal((await call('/api/duel-pass/verify', {method:'POST', body:{sessionId, side, pass:issued.pass.slice(0, -4) + 'AAAA'}})).status, 403);
  const payload = Buffer.from(JSON.stringify({v:1, sessionId, side, grantId:owner.grant.grantId, config:DEFAULT_CONFIG, expiresAt:Date.now() - 1000}));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.DUEL_SIGNING_KEY), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, payload)).toString('base64url');
  assert.equal((await call('/api/duel-pass/verify', {method:'POST', body:{sessionId, side, pass:`${payload.toString('base64url')}.${signature}`}})).status, 403);
});
