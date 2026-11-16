import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import worker, {DEFAULT_CONFIG, validateConfig} from '../server.mjs';

class LocalD1 {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec('PRAGMA foreign_keys=ON;'); this.sqlite.exec(readFileSync(new URL('../drizzle/0000_admin.sql', import.meta.url), 'utf8')); }
  prepare(sql) {
    const database = this;
    return {
      sql,
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
const RECOVERY_ORIGIN = 'https://www.kasai-solutions-inc.com';
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
const LEGACY_MOVES = ['supernova', 'atlas_crystal_4', 'starlight', 'shell'];
const FUTO_MOVES = ['futo_breaker', 'futo_burst', 'futo_ascend', 'futo_restore'];
const legacyConfig = () => ({level:73, stats:{hp:76543, atk:213, def:321, spAtk:654, spDef:456, speed:345, accuracy:121, evasion:109}, moves:[...LEGACY_MOVES]});
function enableRecovery(env, oldOwner) {
  env.ADMIN_RECOVERY_OWNER_ID = oldOwner.id;
  env.ADMIN_RECOVERY_ORIGIN = RECOVERY_ORIGIN;
  env.ALLOWED_ORIGINS = RECOVERY_ORIGIN;
}
function seedLegacyAllBatch(env, owner, config = legacyConfig()) {
  const id = crypto.randomUUID(), json = JSON.stringify(config), now = Date.now();
  const payloadHash = createHash('sha256').update(JSON.stringify({target:'all', config})).digest('hex');
  env.DB.sqlite.prepare('INSERT INTO grant_batches (id, creator_id, target, payload_hash, config_json, max_player_row, created_at) VALUES (?, ?, ?, ?, ?, (SELECT MAX(row_id) FROM players), ?)').run(id, owner.id, 'all', payloadHash, json, now);
  env.DB.sqlite.prepare("INSERT INTO grants (grant_id, batch_id, player_id, config_json, created_at) SELECT ? || ':' || id, ?, id, ?, ? FROM players").run(id, id, json, now);
  return {id, payloadHash, json};
}
async function signFixture(env, data) {
  const payload = Buffer.from(JSON.stringify(data));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.DUEL_SIGNING_KEY), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, payload)).toString('base64url');
  return `${payload.toString('base64url')}.${signature}`;
}

test('Futo defaults upgrade only the exact legacy sequence without changing stats or caller data', () => {
  assert.deepEqual(DEFAULT_CONFIG.moves, FUTO_MOVES);
  const old = legacyConfig(), original = structuredClone(old), normalized = validateConfig(old);
  assert.deepEqual(normalized.moves, FUTO_MOVES);
  assert.equal(normalized.level, original.level);
  assert.deepEqual(normalized.stats, original.stats);
  assert.deepEqual(old, original);
  for (const moves of [
    ['shell', 'supernova', 'atlas_crystal_4', 'starlight'],
    ['supernova', 'atlas_crystal_4', 'starlight', 'pulse'],
    ['futo_breaker', 'futo_burst', 'starlight', 'shell']
  ]) assert.deepEqual(validateConfig({...old, moves}).moves, moves);
  assert.throws(() => validateConfig({...old, moves:['futo_breaker', 'futo_breaker', 'starlight', 'shell']}));
});

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

const legendaryEntitlement = player => [{grantId:`admin-legendary:${player.id}`, species:'arvelion', level:70}];

test('only the current administrator receives a stable initial legendary companion, without creating gifts', async () => {
  const {call, register, env} = setup();
  const owner = await register('運営候補'), visitor = await register('訪問者');
  assert.deepEqual((await call('/api/me', {token:owner.token})).initialCompanions, []);
  const claim = await call('/api/admin/claim', {method:'POST', token:owner.token, body:{key:SECRET}});
  assert.equal(claim.status, 200);
  assert.deepEqual(claim.initialCompanions, legendaryEntitlement(owner));
  const before = env.DB.sqlite.prepare('SELECT * FROM grants ORDER BY row_id').all();
  const batchesBefore = env.DB.sqlite.prepare('SELECT * FROM grant_batches ORDER BY id').all();
  for (const path of ['/api/me', '/api/me?limit=1', '/api/me?limit=1&cursor=9999']) {
    const response = await call(path, {token:owner.token});
    assert.deepEqual(response.initialCompanions, legendaryEntitlement(owner));
    assert(response.grants.every(grant => grant.species === 'futo'));
  }
  const replay = await call('/api/admin/claim', {method:'POST', token:owner.token, body:{key:SECRET}});
  assert.deepEqual(replay.initialCompanions, legendaryEntitlement(owner));
  assert.deepEqual((await call('/api/me', {token:visitor.token})).initialCompanions, []);
  assert.equal((await call('/api/me')).status, 401);
  assert.equal((await call('/api/status')).initialCompanions, undefined);
  assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM grants ORDER BY row_id').all(), before);
  assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM grant_batches ORDER BY id').all(), batchesBefore);
});

test('an administrator predating legendary support receives the initial companion on the next profile read', async () => {
  const {call, register, env} = setup();
  const owner = await register();
  // Simulate an already deployed owner row with no legendary migration or claim.
  env.DB.sqlite.prepare('INSERT INTO admin_owner (singleton, player_id, claimed_at) VALUES (1, ?, 1234)').run(owner.id);
  const profile = await call('/api/me', {token:owner.token});
  assert.equal(profile.player.isAdmin, true);
  assert.deepEqual(profile.initialCompanions, legendaryEntitlement(owner));
  assert.deepEqual(profile.grants, []);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM grants').get().n, 0);
});

test('domain recovery moves the initial legendary entitlement to the new owner only', async () => {
  const {call, admin, register, env} = setup();
  const previous = await admin(), replacement = await register('新ドメイン');
  enableRecovery(env, previous);
  assert.deepEqual((await call('/api/me', {token:previous.token})).initialCompanions, legendaryEntitlement(previous));
  assert.deepEqual((await call('/api/me', {token:replacement.token})).initialCompanions, []);
  const recovered = await call('/api/admin/claim', {method:'POST', token:replacement.token, origin:RECOVERY_ORIGIN, body:{key:SECRET}});
  assert.equal(recovered.status, 200);
  assert.deepEqual(recovered.initialCompanions, legendaryEntitlement(replacement));
  const oldProfile = await call('/api/me', {token:previous.token});
  assert.equal(oldProfile.player.isAdmin, false);
  assert.deepEqual(oldProfile.initialCompanions, []);
  assert.deepEqual((await call('/api/me', {token:replacement.token})).initialCompanions, legendaryEntitlement(replacement));
});

test('legendary initial companions cannot be distributed to another player or all players', async () => {
  const {call, admin, register, env} = setup();
  const owner = await admin(), recipient = await register();
  const countBefore = env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM grants').get().n;
  for (const target of [recipient.id, 'all', 'self']) {
    const result = await call('/api/admin/grants', {method:'POST', token:owner.token, body:{requestId:crypto.randomUUID(), target, species:'arvelion'}});
    assert.equal(result.status, 400);
    assert.equal(result.error.code, 'SPECIES_NOT_DISTRIBUTABLE');
  }
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM grants').get().n, countBefore);
  assert.deepEqual((await call('/api/me', {token:recipient.token})).initialCompanions, []);
  assert.deepEqual((await call('/api/me', {token:recipient.token})).grants, []);
  const futo = await call('/api/admin/grants', {method:'POST', token:owner.token, body:{requestId:crypto.randomUUID(), target:recipient.id, species:'futo'}});
  assert.equal(futo.status, 200);
  const delivered = await call('/api/me', {token:recipient.token});
  assert.equal(delivered.grants.length, 1);
  assert.equal(delivered.grants[0].species, 'futo');
  assert.deepEqual(delivered.initialCompanions, []);
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
  assert.deepEqual(replay.grants[0].moves, FUTO_MOVES);
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

test('existing config, initial Futo and distributed grants normalize on read without database rewrites', async () => {
  const {call, admin, register, env} = setup();
  const owner = await admin(), recipient = await register();
  const old = legacyConfig(), json = JSON.stringify(old);
  env.DB.sqlite.prepare('UPDATE futo_config SET config_json = ?, revision = 7').run(json);
  env.DB.sqlite.prepare('UPDATE grants SET config_json = ? WHERE grant_id = ?').run(json, owner.grant.grantId);
  const batch = seedLegacyAllBatch(env, owner, old);
  const config = await call('/api/admin/config', {token:owner.token});
  assert.equal(config.revision, 7);
  assert.deepEqual(config.config, {...old, moves:FUTO_MOVES});
  const received = await call('/api/me', {token:recipient.token});
  assert.deepEqual(received.grants[0].moves, FUTO_MOVES);
  assert.equal(received.grants[0].level, old.level);
  assert.deepEqual(received.grants[0].stats, old.stats);
  const own = await call('/api/me', {token:owner.token});
  assert.equal(own.grants.length, 2);
  assert(own.grants.every(grant => grant.moves.join(',') === FUTO_MOVES.join(',')));
  assert.equal(env.DB.sqlite.prepare('SELECT config_json FROM futo_config').get().config_json, json);
  assert(env.DB.sqlite.prepare('SELECT config_json FROM grants').all().every(row => row.config_json === json));
  assert.deepEqual({...env.DB.sqlite.prepare('SELECT payload_hash, config_json FROM grant_batches WHERE id = ?').get(batch.id)}, {payload_hash:batch.payloadHash, config_json:json});

  const custom = {...old, moves:['shell', 'supernova', 'atlas_crystal_4', 'starlight']};
  env.DB.sqlite.prepare('UPDATE futo_config SET config_json = ?').run(JSON.stringify(custom));
  env.DB.sqlite.prepare('UPDATE grants SET config_json = ? WHERE player_id = ?').run(JSON.stringify(custom), recipient.id);
  assert.deepEqual((await call('/api/admin/config', {token:owner.token})).config, custom);
  assert.deepEqual((await call('/api/me', {token:recipient.token})).grants[0].moves, custom.moves);
});

test('legacy gift requests replay with old or normalized defaults while retaining their hash and recipient cutoff', async () => {
  const {call, admin, register, env} = setup();
  const owner = await admin(), recipient = await register(), old = legacyConfig();
  const batch = seedLegacyAllBatch(env, owner, old), late = await register();
  for (const config of [old, {...old, moves:FUTO_MOVES}]) {
    const result = await call('/api/admin/grants', {method:'POST', token:owner.token, body:{requestId:batch.id, target:'all', config}});
    assert.equal(result.status, 200);
    assert.equal(result.recipientCount, 2);
    assert.equal(result.replayed, true);
  }
  await call('/api/admin/config', {method:'PUT', token:owner.token, body:{config:changedConfig()}});
  const omittedConfigRetry = await call('/api/admin/grants', {method:'POST', token:owner.token, body:{requestId:batch.id, target:'all'}});
  assert.equal(omittedConfigRetry.status, 200);
  assert.equal(omittedConfigRetry.recipientCount, 2);
  assert.equal(omittedConfigRetry.replayed, true);
  assert.equal((await call('/api/me', {token:late.token})).grants.length, 0);
  assert.equal((await call('/api/me', {token:recipient.token})).grants.length, 1);
  assert.equal(env.DB.sqlite.prepare('SELECT payload_hash FROM grant_batches WHERE id = ?').get(batch.id).payload_hash, batch.payloadHash);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM grants WHERE batch_id = ?').get(batch.id).n, 2);
  for (const altered of [
    {target:recipient.id, config:old},
    {target:'all', config:{...old, stats:{...old.stats, hp:old.stats.hp + 1}}},
    {target:'all', config:{...old, moves:['shell', 'supernova', 'atlas_crystal_4', 'starlight']}}
  ]) assert.equal((await call('/api/admin/grants', {method:'POST', token:owner.token, body:{requestId:batch.id, ...altered}})).status, 409);
});

test('stored and already signed legacy duel snapshots expose the new defaults but preserve custom moves', async () => {
  const {call, admin, env} = setup(), owner = await admin(), old = legacyConfig();
  env.DB.sqlite.prepare('UPDATE grants SET config_json = ? WHERE grant_id = ?').run(JSON.stringify(old), owner.grant.grantId);
  const sessionId = crypto.randomUUID().replaceAll('-', ''), side = 1;
  const body = {sessionId, side, grantId:owner.grant.grantId};
  const issue = await call('/api/duel-pass', {method:'POST', token:owner.token, body});
  assert.equal(issue.status, 200);
  const signed = JSON.parse(Buffer.from(issue.pass.split('.')[0], 'base64url').toString());
  assert.deepEqual(signed.config, {...old, moves:FUTO_MOVES});
  const newVerified = await call('/api/duel-pass/verify', {method:'POST', body:{sessionId, side, pass:issue.pass}});
  assert.deepEqual(newVerified.moves, FUTO_MOVES);
  assert.deepEqual(newVerified.stats, old.stats);
  const oldPass = await signFixture(env, {v:1, ...body, config:old, expiresAt:Date.now() + 600000});
  const oldVerified = await call('/api/duel-pass/verify', {method:'POST', body:{sessionId, side, pass:oldPass}});
  assert.equal(oldVerified.status, 200);
  assert.deepEqual(oldVerified.moves, FUTO_MOVES);
  assert.equal(oldVerified.level, old.level);
  assert.deepEqual(oldVerified.stats, old.stats);
  const custom = {...old, moves:['futo_breaker', 'shell', 'supernova', 'starlight']};
  const customPass = await signFixture(env, {v:1, ...body, config:custom, expiresAt:Date.now() + 600000});
  assert.deepEqual((await call('/api/duel-pass/verify', {method:'POST', body:{sessionId, side, pass:customPass}})).moves, custom.moves);
});

test('recovery availability is origin-scoped and keeps the existing administrator visible', async () => {
  const {call, admin, register, env} = setup();
  const empty = await call('/api/status');
  assert.equal(empty.adminExists, false);
  assert.equal(empty.adminRecoveryAvailable, false);
  const oldOwner = await admin(), candidate = await register();
  assert.equal((await call('/api/status')).adminRecoveryAvailable, false);
  enableRecovery(env, oldOwner);
  const status = await call('/api/status', {origin:RECOVERY_ORIGIN});
  assert.equal(status.adminExists, true);
  assert.equal(status.adminRecoveryAvailable, true);
  assert(!JSON.stringify(status).includes(oldOwner.id));
  assert.equal((await call('/api/status')).adminRecoveryAvailable, false);
  assert.equal((await call('/api/status', {origin:null})).adminRecoveryAvailable, false);
  assert.equal((await call('/api/me', {origin:RECOVERY_ORIGIN, token:candidate.token})).adminRecoveryAvailable, true);
  assert.equal((await call('/api/register', {method:'POST', origin:RECOVERY_ORIGIN, body:{token:candidate.token, name:candidate.name}})).adminRecoveryAvailable, true);
  env.ADMIN_RECOVERY_OWNER_ID = candidate.id;
  assert.equal((await call('/api/status', {origin:RECOVERY_ORIGIN})).adminRecoveryAvailable, false);
});

test('recovery rejects missing configuration, wrong origin, wrong key and missing authentication', async () => {
  const {call, admin, register, env} = setup();
  const oldOwner = await admin(), candidate = await register();
  env.ALLOWED_ORIGINS = RECOVERY_ORIGIN;
  const request = {method:'POST', token:candidate.token, origin:RECOVERY_ORIGIN, body:{key:SECRET}};
  assert.equal((await call('/api/admin/claim', request)).status, 409);
  env.ADMIN_RECOVERY_OWNER_ID = oldOwner.id;
  assert.equal((await call('/api/admin/claim', request)).status, 409);
  delete env.ADMIN_RECOVERY_OWNER_ID;
  env.ADMIN_RECOVERY_ORIGIN = RECOVERY_ORIGIN;
  assert.equal((await call('/api/admin/claim', request)).status, 409);
  enableRecovery(env, oldOwner);
  assert.equal((await call('/api/admin/claim', {...request, origin:ORIGIN})).status, 409);
  assert.equal((await call('/api/admin/claim', {...request, origin:null})).status, 409);
  assert.equal((await call('/api/admin/claim', {...request, body:{key:'incorrect-key'}})).status, 403);
  assert.equal((await call('/api/admin/claim', {...request, token:undefined})).status, 401);
  assert.equal(env.DB.sqlite.prepare('SELECT player_id FROM admin_owner').get().player_id, oldOwner.id);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM grants').get().n, 1);
  assert.equal(env.ADMIN_CLAIM_KEY, SECRET);
});

test('recovery transfers ownership once, preserves data and grants the current Futo configuration', async () => {
  const {call, admin, register, env} = setup();
  const oldOwner = await admin(), candidate = await register('新ドメイン'), recipient = await register('配布済み');
  const custom = {...legacyConfig(), moves:['shell', 'supernova', 'futo_breaker', 'starlight']};
  assert.equal((await call('/api/admin/config', {method:'PUT', token:oldOwner.token, body:{config:custom}})).status, 200);
  const requestId = crypto.randomUUID();
  assert.equal((await call('/api/admin/grants', {method:'POST', token:oldOwner.token, body:{requestId, target:recipient.id}})).status, 200);
  const priorConfig = {...env.DB.sqlite.prepare('SELECT * FROM futo_config').get()};
  const priorGrants = env.DB.sqlite.prepare('SELECT * FROM grants ORDER BY row_id').all().map(row => ({...row}));
  const priorPlayers = env.DB.sqlite.prepare('SELECT * FROM players ORDER BY row_id').all().map(row => ({...row}));
  enableRecovery(env, oldOwner);
  const recoverRequest = {method:'POST', token:candidate.token, origin:RECOVERY_ORIGIN, body:{key:SECRET}};
  const restored = await call('/api/admin/claim', recoverRequest);
  assert.equal(restored.status, 200);
  assert.equal(restored.player.isAdmin, true);
  assert.equal(restored.adminExists, true);
  assert.equal(restored.adminRecoveryAvailable, false);
  assert.equal(restored.grants.length, 1);
  assert.equal(restored.grants[0].grantId, `admin-initial:${candidate.id}`);
  assert.deepEqual(restored.grants[0].stats, custom.stats);
  assert.deepEqual(restored.grants[0].moves, custom.moves);
  assert.equal(restored.grants[0].level, custom.level);
  assert.deepEqual({...env.DB.sqlite.prepare('SELECT * FROM futo_config').get()}, priorConfig);
  assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM grants WHERE player_id != ? ORDER BY row_id').all(candidate.id).map(row => ({...row})), priorGrants);
  assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM players ORDER BY row_id').all().map(row => ({...row})), priorPlayers);
  assert.equal((await call('/api/me', {token:oldOwner.token})).player.isAdmin, false);
  assert.equal((await call('/api/admin/config', {token:oldOwner.token})).status, 403);
  assert.equal((await call('/api/admin/grants', {method:'POST', token:oldOwner.token, body:{requestId:crypto.randomUUID(), target:'all'}})).status, 403);
  assert.equal((await call('/api/admin/config', {token:candidate.token, origin:RECOVERY_ORIGIN})).status, 200);
  const retry = await call('/api/admin/claim', recoverRequest);
  assert.equal(retry.status, 200);
  assert.equal(retry.grants.length, 1);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM grants WHERE player_id = ?').get(candidate.id).n, 1);
  assert.equal((await call('/api/status', {origin:RECOVERY_ORIGIN})).adminRecoveryAvailable, false);
  assert.equal((await call('/api/admin/claim', {...recoverRequest, token:recipient.token})).status, 409);
  assert.equal((await call('/api/admin/claim', {...recoverRequest, token:oldOwner.token})).status, 409);
});

test('concurrent recovery claims select only one new administrator', async () => {
  const {call, admin, register, env} = setup();
  const oldOwner = await admin(), applicants = await Promise.all([register('候補A'), register('候補B')]);
  enableRecovery(env, oldOwner);
  const results = await Promise.all(applicants.map(candidate => call('/api/admin/claim', {method:'POST', token:candidate.token, origin:RECOVERY_ORIGIN, body:{key:SECRET}})));
  assert.deepEqual(results.map(row => row.status).sort(), [200, 409]);
  const winner = applicants[results.findIndex(row => row.status === 200)], loser = applicants[results.findIndex(row => row.status === 409)];
  assert.equal(env.DB.sqlite.prepare('SELECT player_id FROM admin_owner').get().player_id, winner.id);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM admin_owner').get().n, 1);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM grants WHERE player_id = ?').get(winner.id).n, 1);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM grants WHERE player_id = ?').get(loser.id).n, 0);
  assert.equal((await call('/api/status', {origin:RECOVERY_ORIGIN})).adminRecoveryAvailable, false);
});

test('recovery refreshes an existing initial grant without duplicating it', async () => {
  const {call, admin, register, env} = setup();
  const oldOwner = await admin(), candidate = await register();
  const previous = legacyConfig(), active = changedConfig();
  const historicalBatch = `admin-initial:${candidate.id}`;
  env.DB.sqlite.prepare('INSERT INTO grant_batches (id, creator_id, target, payload_hash, config_json, max_player_row, created_at) VALUES (?, ?, ?, ?, ?, 2, 1234)').run(historicalBatch, candidate.id, candidate.id, 'historical-fixture', JSON.stringify(previous));
  env.DB.sqlite.prepare('INSERT INTO grants (grant_id, batch_id, player_id, config_json, created_at) VALUES (?, ?, ?, ?, ?)').run(`admin-initial:${candidate.id}`, historicalBatch, candidate.id, JSON.stringify(previous), 1234);
  await call('/api/admin/config', {method:'PUT', token:oldOwner.token, body:{config:active}});
  enableRecovery(env, oldOwner);
  const result = await call('/api/admin/claim', {method:'POST', token:candidate.token, origin:RECOVERY_ORIGIN, body:{key:SECRET}});
  assert.equal(result.status, 200);
  assert.equal(result.grants.length, 1);
  assert.deepEqual(result.grants[0].stats, active.stats);
  assert.deepEqual(result.grants[0].moves, active.moves);
  assert.equal(result.grants[0].createdAt, 1234);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM grants WHERE player_id = ?').get(candidate.id).n, 1);
  assert.equal(env.DB.sqlite.prepare('SELECT batch_id FROM grants WHERE grant_id = ?').get(`admin-initial:${candidate.id}`).batch_id, historicalBatch);
});

test('simultaneous retries from the same recovery player grant only one initial Futo', async () => {
  const {call, admin, register, env} = setup();
  const oldOwner = await admin(), candidate = await register();
  enableRecovery(env, oldOwner);
  const request = {method:'POST', token:candidate.token, origin:RECOVERY_ORIGIN, body:{key:SECRET}};
  const results = await Promise.all([call('/api/admin/claim', request), call('/api/admin/claim', request)]);
  assert(results.every(result => result.status === 200 && result.grants.length === 1));
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM grants WHERE player_id = ?').get(candidate.id).n, 1);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM grant_batches WHERE id LIKE 'admin-recovery:%'").get().n, 1);
});

test('initial registration also preserves a pre-existing Futo configuration', async () => {
  const {call, register, env} = setup(), candidate = await register(), config = legacyConfig();
  env.DB.sqlite.prepare('INSERT INTO futo_config (singleton, config_json, revision, updated_at) VALUES (1, ?, 9, 12345)').run(JSON.stringify(config));
  const result = await call('/api/admin/claim', {method:'POST', token:candidate.token, body:{key:SECRET}});
  assert.equal(result.status, 200);
  assert.deepEqual(result.grants[0].stats, config.stats);
  assert.equal(result.grants[0].level, config.level);
  assert.deepEqual(result.grants[0].moves, FUTO_MOVES);
  assert.equal(env.DB.sqlite.prepare('SELECT revision FROM futo_config').get().revision, 9);
});

for (const operation of ['config', 'grants']) test(`a former administrator cannot finish a queued ${operation} write after recovery`, async () => {
  const {call, admin, register, env} = setup();
  const oldOwner = await admin(), candidate = await register();
  enableRecovery(env, oldOwner);
  const originalBatch = env.DB.batch.bind(env.DB);
  let release, started;
  const gate = new Promise(resolve => { release = resolve; }), atGate = new Promise(resolve => { started = resolve; });
  env.DB.batch = async statements => {
    const sql = statements[0].sql;
    if ((operation === 'config' && sql.startsWith('UPDATE futo_config')) || (operation === 'grants' && sql.startsWith('INSERT OR IGNORE INTO grant_batches'))) { started(); await gate; }
    return originalBatch(statements);
  };
  const requestId = crypto.randomUUID();
  const pending = call(`/api/admin/${operation}`, {method:operation === 'config' ? 'PUT' : 'POST', token:oldOwner.token, body:operation === 'config' ? {config:changedConfig()} : {requestId, target:'all'}});
  await atGate;
  const recovered = await call('/api/admin/claim', {method:'POST', token:candidate.token, origin:RECOVERY_ORIGIN, body:{key:SECRET}});
  assert.equal(recovered.status, 200);
  release();
  assert.equal((await pending).status, 403);
  assert.equal(JSON.parse(env.DB.sqlite.prepare('SELECT config_json FROM futo_config').get().config_json).stats.hp, DEFAULT_CONFIG.stats.hp);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM grant_batches WHERE id = ?').get(requestId).n, 0);
});
