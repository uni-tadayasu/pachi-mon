import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import worker, {DEFAULT_CONFIG, MYTHICAL_CONFIG, validateConfig} from '../server.mjs';

class LocalD1 {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec('PRAGMA foreign_keys=ON;'); for (const file of ['0000_admin.sql','0006_sub_admin.sql','0007_third_admin.sql','0009_global_chat.sql','0010_ranked.sql']) this.sqlite.exec(readFileSync(new URL('../drizzle/'+file, import.meta.url), 'utf8')); }
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
function seedLegacyInitialGrant(env,creator,recipient,config=DEFAULT_CONFIG,batchId=`admin-initial:${recipient.id}`){
  const json=JSON.stringify(config),hash=createHash('sha256').update(json).digest('hex'),grantId=`admin-initial:${recipient.id}`;
  env.DB.sqlite.prepare('INSERT INTO grant_batches (id,creator_id,target,payload_hash,config_json,max_player_row,created_at) VALUES (?,?,?,?,?,(SELECT row_id FROM players WHERE id=?),?)').run(batchId,creator.id,recipient.id,hash,json,recipient.id,1234);
  env.DB.sqlite.prepare('INSERT INTO grants (grant_id,batch_id,player_id,config_json,created_at) VALUES (?,?,?,?,?)').run(grantId,batchId,recipient.id,json,1234);
  return {grantId,batchId,json,row:env.DB.sqlite.prepare('SELECT * FROM grants WHERE grant_id=?').get(grantId)};
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

const legendaryEntitlement = player => [{grantId:`admin-legendary:${player.id}`, species:'arvelion', level:70},{grantId:`admin-mythical:${player.id}`,species:'floravelle',level:70}];

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
  for (const target of [recipient.id, 'all', 'self']) for(const species of ['arvelion','floravelle']) {
    const result = await call('/api/admin/grants', {method:'POST', token:owner.token, body:{requestId:crypto.randomUUID(), target, species}});
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

test('explicit recovery re-registers with the operator key alone, without recovery settings', async () => {
  const {call, admin, register, env} = setup();
  const oldOwner = await admin(), candidate = await register();
  assert.equal(env.ADMIN_RECOVERY_OWNER_ID, undefined);
  assert.equal(env.ADMIN_RECOVERY_ORIGIN, undefined);
  const request = {method:'POST', token:candidate.token, body:{key:SECRET, recover:true}};
  // An ordinary claim still stops at the existing operator; the explicit request still needs the key and a player.
  assert.equal((await call('/api/admin/claim', {...request, body:{key:SECRET}})).status, 409);
  assert.equal((await call('/api/admin/claim', {...request, body:{key:'incorrect-key', recover:true}})).status, 403);
  assert.equal((await call('/api/admin/claim', {...request, token:undefined})).status, 401);
  assert.equal(env.DB.sqlite.prepare('SELECT player_id FROM admin_owner').get().player_id, oldOwner.id);
  // With the key, the seat moves to this player, with the operator's initial companions.
  const recovered = await call('/api/admin/claim', request);
  assert.equal(recovered.player.isAdmin, true);
  assert.deepEqual(recovered.initialCompanions.map(row => row.species).sort(), ['arvelion', 'floravelle']);
  assert.equal(env.DB.sqlite.prepare('SELECT player_id FROM admin_owner').get().player_id, candidate.id);
  assert.equal((await call('/api/admin/config', {token:oldOwner.token})).status, 403);
  assert.equal((await call('/api/admin/config', {token:candidate.token})).status, 200);
  // The status never offers the key form to everyone.
  assert.equal((await call('/api/status')).adminRecoveryAvailable, false);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM admin_owner').get().n, 1);
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


test('mythical proof is owner-only, fixed, session-bound and revoked on ownership transfer', async()=>{
  const {call,admin,register,env}=setup(),owner=await admin(),other=await register();
  const sessionId='c'.repeat(32),side=0,grantId=`admin-mythical:${owner.id}`;
  const issued=await call('/api/duel-pass',{method:'POST',token:owner.token,body:{sessionId,side,grantId,config:changedConfig()}});
  assert.equal(issued.status,200);
  const verified=await call('/api/duel-pass/verify',{method:'POST',body:{sessionId,side,pass:issued.pass}});
  assert.equal(verified.status,200);assert.equal(verified.species,'floravelle');assert.equal(verified.level,50);
  assert.deepEqual(verified.stats,MYTHICAL_CONFIG.stats);assert.deepEqual(verified.moves,MYTHICAL_CONFIG.moves);
  for(const id of [grantId,`admin-mythical:${other.id}`])assert.equal((await call('/api/duel-pass',{method:'POST',token:other.token,body:{sessionId,side,grantId:id}})).status,403);
  for(const extra of [{sessionId:'d'.repeat(32)},{side:1},{pass:issued.pass.slice(0,-4)+'AAAA'}])assert.equal((await call('/api/duel-pass/verify',{method:'POST',body:{sessionId,side,pass:issued.pass,...extra}})).status,403);
  enableRecovery(env,owner);
  assert.equal((await call('/api/admin/claim',{method:'POST',token:other.token,origin:RECOVERY_ORIGIN,body:{key:SECRET}})).status,200);
  assert.equal((await call('/api/duel-pass/verify',{method:'POST',body:{sessionId,side,pass:issued.pass}})).status,403,'An old owner proof is invalid immediately on verification');
  assert.equal((await call('/api/duel-pass',{method:'POST',token:owner.token,body:{sessionId,side,grantId}})).status,403);
  assert.equal((await call('/api/duel-pass',{method:'POST',token:other.token,body:{sessionId,side,grantId:`admin-mythical:${other.id}`}})).status,200);
});

test('only the current owner can confirm release of the reviewed registration', async()=>{
  const {call,admin,register,env}=setup(),owner=await admin(),visitor=await register();
  const config=await call('/api/admin/config',{token:owner.token});
  const expectedRegistration=config.adminRegistration;
  assert.equal(expectedRegistration.playerId,owner.id);assert(Number.isSafeInteger(expectedRegistration.claimedAt));
  const request={method:'POST',body:{confirmed:true,expectedRegistration}};
  assert.equal((await call('/api/admin/release',request)).status,401);
  assert.equal((await call('/api/admin/release',{...request,token:visitor.token})).status,403);
  for(const body of [{},{confirmed:false,expectedRegistration},{confirmed:true},{confirmed:true,expectedRegistration:{playerId:visitor.id,claimedAt:expectedRegistration.claimedAt}}]){
    const result=await call('/api/admin/release',{method:'POST',token:owner.token,body});
    assert.equal(result.status,400);assert.equal(result.error.code,'RELEASE_CONFIRMATION_REQUIRED');
  }
  const stale=await call('/api/admin/release',{...request,token:owner.token,body:{confirmed:true,expectedRegistration:{...expectedRegistration,claimedAt:expectedRegistration.claimedAt-1}}});
  assert.equal(stale.status,409);assert.equal(stale.error.code,'ADMIN_REGISTRATION_CHANGED');
  assert.equal(env.DB.sqlite.prepare('SELECT player_id FROM admin_owner').get().player_id,owner.id);
  assert.equal((await call('/api/status')).adminExists,true);
});

test('owner release opens registration without deleting identities, settings or gifts', async()=>{
  const {call,admin,register,env}=setup(),owner=await admin(),visitor=await register();
  await call('/api/admin/config',{method:'PUT',token:owner.token,body:{config:changedConfig()}});
  await call('/api/admin/grants',{method:'POST',token:owner.token,body:{requestId:crypto.randomUUID(),target:visitor.id}});
  const expectedRegistration=(await call('/api/admin/config',{token:owner.token})).adminRegistration;
  const before=Object.fromEntries(['players','futo_config','grant_batches','grants'].map(table=>[table,env.DB.sqlite.prepare(`SELECT * FROM ${table}`).all()]));
  const released=await call('/api/admin/release',{method:'POST',token:owner.token,body:{confirmed:true,expectedRegistration}});
  assert.equal(released.status,200);assert.equal(released.released,true);assert.equal(released.player.isAdmin,false);assert.equal(released.adminExists,false);
  assert.equal((await call('/api/status')).adminExists,false);
  const me=await call('/api/me',{token:owner.token});assert.equal(me.player.isAdmin,false);assert.deepEqual(me.initialCompanions,[]);
  for(const table of Object.keys(before))assert.deepEqual(env.DB.sqlite.prepare(`SELECT * FROM ${table}`).all(),before[table],`${table} must survive release`);
  assert.equal((await call('/api/admin/config',{token:owner.token})).status,403);
  assert.equal((await call('/api/admin/release',{method:'POST',token:owner.token,body:{confirmed:true,expectedRegistration}})).status,403);
  assert.equal((await call('/api/admin/claim',{method:'POST',token:visitor.token,body:{key:'invalid-key'}})).status,403);
  const claimed=await call('/api/admin/claim',{method:'POST',token:visitor.token,body:{key:SECRET}});
  assert.equal(claimed.status,200);assert.equal(claimed.player.isAdmin,true);assert.equal(claimed.adminExists,true);
  assert.deepEqual((await call('/api/admin/config',{token:visitor.token})).config,changedConfig());
  assert.equal((await call('/api/admin/claim',{method:'POST',token:owner.token,body:{key:SECRET}})).status,409);
});

test('a queued release cannot delete a replacement administrator', async()=>{
  const {call,admin,register,env}=setup(),owner=await admin(),replacement=await register();
  const expectedRegistration=(await call('/api/admin/config',{token:owner.token})).adminRegistration;
  const originalBatch=env.DB.batch.bind(env.DB);
  let resume,started;
  const gate=new Promise(resolve=>{resume=resolve;}),atGate=new Promise(resolve=>{started=resolve;});
  env.DB.batch=async statements=>{
    if(statements[1]?.sql.startsWith('DELETE FROM admin_owner')){started();await gate;}
    return originalBatch(statements);
  };
  const pending=call('/api/admin/release',{method:'POST',token:owner.token,body:{confirmed:true,expectedRegistration}});
  await atGate;
  const recovered=await call('/api/admin/claim',{method:'POST',token:replacement.token,body:{key:SECRET,recover:true}});assert.equal(recovered.status,200);
  resume();assert.equal((await pending).status,409);
  assert.equal(env.DB.sqlite.prepare('SELECT player_id FROM admin_owner').get().player_id,replacement.id);
  assert.equal((await call('/api/me',{token:replacement.token})).player.isAdmin,true);
});

for(const operation of ['config','grants'])test(`a queued ${operation} mutation loses authority after owner release`,async()=>{
  const {call,admin,env}=setup(),owner=await admin();
  const expectedRegistration=(await call('/api/admin/config',{token:owner.token})).adminRegistration;
  const originalBatch=env.DB.batch.bind(env.DB);let resume,started;
  const gate=new Promise(resolve=>{resume=resolve;}),atGate=new Promise(resolve=>{started=resolve;});
  env.DB.batch=async statements=>{
    const sql=statements[0].sql;
    if((operation==='config'&&sql.startsWith('UPDATE futo_config'))||(operation==='grants'&&sql.startsWith('INSERT OR IGNORE INTO grant_batches'))){started();await gate;}
    return originalBatch(statements);
  };
  const requestId=crypto.randomUUID();
  const pending=call(`/api/admin/${operation}`,{method:operation==='config'?'PUT':'POST',token:owner.token,body:operation==='config'?{config:changedConfig()}:{requestId,target:'all'}});
  await atGate;
  assert.equal((await call('/api/admin/release',{method:'POST',token:owner.token,body:{confirmed:true,expectedRegistration}})).status,200);
  resume();assert.equal((await pending).status,403);
  assert.equal((await call('/api/status')).adminExists,false);
  assert.equal(JSON.parse(env.DB.sqlite.prepare('SELECT config_json FROM futo_config').get().config_json).stats.hp,DEFAULT_CONFIG.stats.hp);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM grant_batches WHERE id = ?').get(requestId).n,0);
});

test('the additive second-admin migration preserves existing records and enforces two distinct fixed seats',()=>{
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync(new URL('../drizzle/0000_admin.sql',import.meta.url),'utf8'));
  const ids=['P0000000000000001','P0000000000000002','P0000000000000003'];
  for(const [index,id] of ids.entries())db.prepare('INSERT INTO players (id,token_hash,name,created_at,updated_at) VALUES (?,?,?,?,?)').run(id,'hash'+index,'既存'+index,100,100);
  db.prepare('INSERT INTO admin_owner VALUES (1,?,1234)').run(ids[0]);
  db.prepare('INSERT INTO futo_config VALUES (1,?,7,100)').run(JSON.stringify(legacyConfig()));
  db.prepare('INSERT INTO grant_batches VALUES (?,?,?,?,?,?,?)').run('old-batch',ids[0],ids[1],'old-hash',JSON.stringify(DEFAULT_CONFIG),3,100);
  db.prepare('INSERT INTO grants (grant_id,batch_id,player_id,config_json,created_at) VALUES (?,?,?,?,?)').run('old-gift','old-batch',ids[1],JSON.stringify(DEFAULT_CONFIG),100);
  const before=Object.fromEntries(['players','admin_owner','futo_config','grant_batches','grants'].map(table=>[table,db.prepare('SELECT * FROM '+table).all()]));
  const schema=db.prepare("SELECT sql FROM sqlite_schema WHERE name='admin_owner'").get().sql;
  db.exec(readFileSync(new URL('../drizzle/0006_sub_admin.sql',import.meta.url),'utf8'));
  for(const [table,rows] of Object.entries(before))assert.deepEqual(db.prepare('SELECT * FROM '+table).all(),rows,table);
  assert.equal(db.prepare("SELECT sql FROM sqlite_schema WHERE name='admin_owner'").get().sql,schema);
  assert.deepEqual(db.prepare('SELECT * FROM admin_members').all().map(row=>({...row})),[{singleton:1,player_id:ids[0],claimed_at:1234}]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM admin_registration_clock').get().n,0,'Migration does not seed runtime state');
  assert.throws(()=>db.prepare('INSERT INTO sub_admin_owner VALUES (1,?,2000)').run(ids[0]),/another seat/);
  db.prepare('INSERT INTO sub_admin_owner VALUES (1,?,2000)').run(ids[1]);
  assert.throws(()=>db.prepare('UPDATE sub_admin_owner SET player_id=?').run(ids[0]),/another seat/);
  assert.throws(()=>db.prepare('UPDATE admin_owner SET player_id=?').run(ids[1]),/another seat/);
  assert.throws(()=>db.prepare('INSERT OR IGNORE INTO admin_owner VALUES (1,?,3000)').run(ids[1]),/another seat/);
  for(const table of ['admin_owner','sub_admin_owner'])assert.throws(()=>db.prepare('INSERT INTO '+table+' VALUES (2,?,3000)').run(ids[2]),/CHECK/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM admin_members').get().n,2);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
});

test('admin device lookup and grant require current authority, exact existing player ID and confirmation',async()=>{
  const {call,admin,register,env}=setup(),owner=await admin(),target=await register('サブ候補');
  for(const path of ['/api/admin/devices','/api/admin/devices?playerId='+target.id]){
    assert.equal((await call(path)).status,401);
    assert.equal((await call(path,{token:target.token})).error.code,'ADMIN_REQUIRED');
  }
  const request={method:'POST',body:{playerId:target.id,confirmed:true}};
  assert.equal((await call('/api/admin/devices',request)).status,401);
  assert.equal((await call('/api/admin/devices',{...request,token:target.token,body:{...request.body,isAdmin:true,role:'main'}})).status,403);
  const lookup=await call('/api/admin/devices?playerId='+target.id,{token:owner.token});
  assert.deepEqual(lookup.candidate,{playerId:target.id,name:'サブ候補',displayName:'サブ候補',isAdmin:false});
  assert.equal(lookup.capacity,3);assert.equal(lookup.devices.length,1);assert.equal(lookup.devices[0].role,'main');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM admin_members').get().n,1,'Lookup never promotes');
  for(const body of [{playerId:target.id},{playerId:target.id,confirmed:false}])assert.equal((await call('/api/admin/devices',{method:'POST',token:owner.token,body})).error.code,'ADMIN_CONFIRMATION_REQUIRED');
  assert.equal((await call('/api/admin/devices',{...request,token:owner.token,body:{playerId:owner.id,confirmed:true}})).error.code,'ADMIN_SELF_TARGET');
  for(const id of ['bad-id','Pffffffffffffffff']){
    const expected=id==='bad-id'?'INVALID_PLAYER_ID':'PLAYER_NOT_FOUND';
    assert.equal((await call('/api/admin/devices?playerId='+id,{token:owner.token})).error.code,expected);
    assert.equal((await call('/api/admin/devices',{...request,token:owner.token,body:{playerId:id,confirmed:true}})).error.code,expected);
  }
  assert.equal((await call('/api/admin/devices',{...request,token:owner.token,body:{...request.body,role:'main'}})).error.code,'INVALID_ADMIN_ROLE');
  const granted=await call('/api/admin/devices',{...request,token:owner.token,body:{...request.body,role:'sub'}});
  assert.equal(granted.status,200);assert.equal(granted.added,true);assert.equal(granted.devices[1].playerId,target.id);assert.equal(granted.devices[1].role,'sub');
  const registered=await call('/api/admin/devices?playerId='+target.id,{token:owner.token});
  assert.deepEqual(registered.candidate,{...granted.devices[1],isAdmin:true});
  assert.equal(JSON.stringify(registered).includes('token_hash'),false);
  const me=await call('/api/me',{token:target.token});assert.equal(me.player.isAdmin,true);assert.deepEqual(me.initialCompanions,[]);
  assert.equal(me.grants.filter(grant=>grant.grantId==='admin-initial:'+target.id).length,0);
});

test('concurrent device grants fill exactly two deputy seats and duplicate retries are idempotent',async()=>{
  const {call,admin,register,env}=setup(),owner=await admin(),candidates=await Promise.all(Array.from({length:6},(_,i)=>register('候補'+i)));
  const grant=target=>call('/api/admin/devices',{method:'POST',token:owner.token,body:{playerId:target.id,confirmed:true}});
  const results=await Promise.all(candidates.map(grant)),winnerIndex=results.findIndex(result=>result.status===200),winner=candidates[winnerIndex];
  assert.equal(results.filter(result=>result.status===200).length,2);
  for(const [index,result] of results.entries())if(result.status!==200){assert.equal(result.status,409);assert.equal(result.error.code,'ADMIN_CAPACITY_REACHED');assert.equal((await call('/api/me',{token:candidates[index].token})).grants.length,0);}
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM admin_members').get().n,3);
  assert.equal(env.DB.sqlite.prepare('SELECT player_id FROM admin_owner').get().player_id,owner.id);
  for(const member of env.DB.sqlite.prepare('SELECT singleton,player_id FROM admin_members').all())assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM grants WHERE grant_id=?').get('admin-initial:'+member.player_id).n,member.singleton===2?0:1,'Concurrent legacy allocation checks the actual assigned seat');
  const before=env.DB.sqlite.prepare('SELECT * FROM grant_batches').all();
  const repeated=await Promise.all([grant(winner),grant(winner)]);assert(repeated.every(result=>result.status===200&&result.added===false));
  assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM grant_batches').all(),before);
  const h=setup(),main=await h.admin(),sub=await h.register();
  const request={method:'POST',token:main.token,body:{playerId:sub.id,confirmed:true}};
  const simultaneous=await Promise.all([h.call('/api/admin/devices',request),h.call('/api/admin/devices',request)]);
  assert(simultaneous.every(result=>result.status===200));assert.equal(simultaneous.filter(result=>result.added).length,1);
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM grants WHERE player_id=?').get(sub.id).n,0);
});

test('secondary admin has equal config and distribution powers while each config response identifies its own registration',async()=>{
  const {call,admin,register}=setup(),main=await admin(),sub=await register('サブ運営'),visitor=await register();
  await call('/api/admin/devices',{method:'POST',token:main.token,body:{playerId:sub.id,confirmed:true}});
  const delivered=await call('/api/admin/grants',{method:'POST',token:sub.token,body:{requestId:crypto.randomUUID(),target:visitor.id}});assert.equal(delivered.status,200);
  const oldGift=(await call('/api/me',{token:visitor.token})).grants[0];
  const updated=await call('/api/admin/config',{method:'PUT',token:sub.token,body:{config:changedConfig()}});assert.equal(updated.status,200);
  for(const actor of [main,sub]){
    const config=await call('/api/admin/config',{token:actor.token});assert.equal(config.adminRegistration.playerId,actor.id);assert.deepEqual(config.config,changedConfig());
    const initial=(await call('/api/me',{token:actor.token})).grants.find(grant=>grant.grantId==='admin-initial:'+actor.id);if(actor.id===sub.id)assert.equal(initial,undefined);else assert.deepEqual(initial.stats,changedConfig().stats);
    assert.equal((await call('/api/admin/players',{token:actor.token})).players.filter(player=>player.isAdmin).length,2);
  }
  assert.deepEqual((await call('/api/me',{token:visitor.token})).grants[0],oldGift,'Previously delivered gifts stay snapshots');
  const all=await call('/api/admin/grants',{method:'POST',token:sub.token,body:{requestId:crypto.randomUUID(),target:'all'}});assert.equal(all.status,200);assert.equal(all.recipientCount,3);
  assert.equal((await call('/api/me',{token:sub.token})).grants.length,1,'An explicitly requested all-player gift still includes sub');
});

test('sub hides old pending initial grants from every inbox replay while manual gifts and existing Futo proofs remain valid',async()=>{
  const {call,admin,register,env}=setup(),main=await admin(),sub=await register('自力で冒険');
  assert.equal((await call('/api/admin/devices',{method:'POST',token:main.token,body:{playerId:sub.id,role:'sub',confirmed:true}})).status,200);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM grants WHERE player_id=?').get(sub.id).n,0);
  const old=seedLegacyInitialGrant(env,main,sub,DEFAULT_CONFIG,`admin-recovery:P0000000000000001:${sub.id}`);
  const manual=[];
  for(let i=0;i<3;i++){
    const requestId=crypto.randomUUID(),result=await call('/api/admin/grants',{method:'POST',token:main.token,body:{requestId,target:sub.id}});
    assert.equal(result.status,200);manual.push(requestId+':'+sub.id);
  }
  const before=env.DB.sqlite.prepare('SELECT * FROM grants WHERE player_id=? ORDER BY row_id').all(sub.id);
  for(const path of ['/api/me','/api/me?cursor=0&limit=100','/api/me?playerId='+main.id+'&role=main']){
    const profile=await call(path,{token:sub.token});assert.equal(profile.status,200);assert.deepEqual(profile.grants.map(grant=>grant.grantId),manual);
    assert.deepEqual(profile.initialCompanions,[]);assert.equal(profile.adminReserveTeam,null);assert.equal(profile.adminReserveAddition,null);
  }
  let cursor=0;const paged=[];
  do{const page=await call('/api/me?limit=1&cursor='+cursor,{token:sub.token});assert.equal(page.grants.length,1);paged.push(page.grants[0].grantId);cursor=page.nextCursor;}while(cursor!==null);
  assert.deepEqual(paged,manual,'Filtering happens before LIMIT, so hidden initial rows cannot hide manual gifts');
  const claimed=await call('/api/admin/claim',{method:'POST',token:sub.token,body:{key:SECRET,recover:true}});
  assert.equal(claimed.status,200);assert.deepEqual(claimed.initialCompanions,[]);assert.deepEqual(claimed.grants.map(grant=>grant.grantId),manual);
  assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM grants WHERE player_id=? ORDER BY row_id').all(sub.id),before,'Inbox/claim retries never remove, redeliver, or mutate stored ownership rows');
  assert.equal((await call('/api/admin/config',{method:'PUT',token:sub.token,body:{config:changedConfig()}})).status,200);
  assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM grants WHERE grant_id=?').get(old.grantId),old.row,'Undelivered sub initial rows are not revived by config updates; existing owned stats stay valid');
  const initial=(await call('/api/me',{token:main.token})).grants.find(grant=>grant.grantId==='admin-initial:'+main.id);assert.deepEqual(initial.stats,changedConfig().stats);
  const sessionId='a'.repeat(32),pass=await call('/api/duel-pass',{method:'POST',token:sub.token,body:{grantId:old.grantId,sessionId,side:0}});assert.equal(pass.status,200);
  const proof=await call('/api/duel-pass/verify',{method:'POST',body:{pass:pass.pass,sessionId,side:0}});assert.equal(proof.status,200);assert.equal(proof.grantId,old.grantId);assert.deepEqual(proof.stats,DEFAULT_CONFIG.stats);
  assert.equal((await call('/api/me',{token:sub.token})).grants.length,3);
});

for(const role of ['sub','sub-sub'])test(`recovery into ${role} keeps the role-specific initial-delivery policy without deleting historical ownership`,async()=>{
  const {call,admin,register,env}=setup(),main=await admin(),previous=await register(),replacement=await register();
  assert.equal((await call('/api/admin/devices',{method:'POST',token:main.token,body:{playerId:previous.id,role,confirmed:true}})).status,200);
  const historical=seedLegacyInitialGrant(env,main,replacement,legacyConfig());enableRecovery(env,previous);
  const request={method:'POST',token:replacement.token,body:{key:SECRET,recover:true},origin:RECOVERY_ORIGIN};
  const result=await call('/api/admin/claim',request);assert.equal(result.status,200);assert.equal(result.player.adminRole,role);
  assert.equal(result.grants.length,role==='sub'?0:1);assert.equal(result.initialCompanions.length,role==='sub'?0:2);
  const saved=env.DB.sqlite.prepare('SELECT * FROM grants WHERE grant_id=?').get(historical.grantId);assert.equal(saved.row_id,historical.row.row_id);
  if(role==='sub')assert.deepEqual(saved,historical.row);else assert.deepEqual(validateConfig(JSON.parse(saved.config_json)),DEFAULT_CONFIG);
  const recoveryCount=env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM grant_batches WHERE id LIKE 'admin-recovery:%' AND target=?").get(replacement.id).n;assert.equal(recoveryCount,role==='sub'?0:1);
  const me=await call('/api/me',{token:replacement.token,origin:RECOVERY_ORIGIN});assert.equal(me.grants.length,role==='sub'?0:1);
  assert.equal(me.adminReserveTeam?.members.length??0,role==='sub'?0:6);assert.equal(me.adminReserveAddition?.members.length??0,role==='sub'?0:1);
  const retry=await call('/api/admin/claim',request);assert.equal(retry.status,200);assert.equal(retry.grants.length,result.grants.length);
  assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM grants WHERE grant_id=?').get(historical.grantId),saved);
  assert.equal((await call('/api/me',{token:main.token})).grants.filter(grant=>grant.grantId==='admin-initial:'+main.id).length,1);
});

for(const historical of [false,true])test(`promotion to main ${historical?'preserves an already-owned initial Futo':'issues a missing initial Futo exactly once'} after a gift-free sub role`,async()=>{
  const {call,admin,register,env}=setup(),main=await admin(),sub=await register();
  assert.equal((await call('/api/admin/devices',{method:'POST',token:main.token,body:{playerId:sub.id,role:'sub',confirmed:true}})).status,200);
  const old=historical?seedLegacyInitialGrant(env,main,sub,legacyConfig(),`admin-recovery:P0000000000000001:${sub.id}`):null;
  assert.equal((await call('/api/admin/config',{method:'PUT',token:main.token,body:{config:changedConfig()}})).status,200);
  assert.deepEqual((await call('/api/me',{token:sub.token})).grants,[],'Sub remains gift-free until the actual promotion');
  const expectedRegistration=(await call('/api/admin/config',{token:main.token})).adminRegistration;
  const request={method:'POST',token:main.token,body:{confirmed:true,expectedRegistration}},released=await call('/api/admin/release',request);assert.equal(released.status,200);
  const profile=await call('/api/me',{token:sub.token});assert.equal(profile.player.adminRole,'main');assert.equal(profile.grants.length,1);assert.equal(profile.grants[0].grantId,'admin-initial:'+sub.id);
  const row=env.DB.sqlite.prepare('SELECT * FROM grants WHERE player_id=?').get(sub.id);
  if(old)assert.deepEqual(row,old.row,'Promotion never overwrites an existing individual configuration or receipt');
  else assert.deepEqual(profile.grants[0].stats,changedConfig().stats);
  const before=env.DB.sqlite.prepare('SELECT * FROM grant_batches').all();
  assert.equal((await call('/api/admin/release',request)).status,403);
  const repeated=await call('/api/admin/claim',{method:'POST',token:sub.token,body:{key:SECRET}});assert.equal(repeated.status,200);assert.equal(repeated.grants.length,1);
  assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM grants WHERE player_id=?').get(sub.id),row);assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM grant_batches').all(),before);
});

test('self release preserves the other admin and keeps ordinary key registration hidden until both leave',async()=>{
  const {call,admin,register}=setup(),main=await admin(),sub=await register(),visitor=await register();
  await call('/api/admin/devices',{method:'POST',token:main.token,body:{playerId:sub.id,confirmed:true}});
  const expectedRegistration=(await call('/api/admin/config',{token:main.token})).adminRegistration;
  const released=await call('/api/admin/release',{method:'POST',token:main.token,body:{confirmed:true,expectedRegistration}});assert.equal(released.status,200);assert.equal(released.adminExists,true);assert.equal(released.player.isAdmin,false);
  assert.equal((await call('/api/status')).adminExists,true);assert.equal((await call('/api/me',{token:sub.token})).player.isAdmin,true);
  const promoted=await call('/api/admin/devices',{token:sub.token});assert.equal(promoted.devices[0].role,'main');assert.equal(promoted.canManageDevices,true);
  assert.equal((await call('/api/admin/claim',{method:'POST',token:visitor.token,body:{key:SECRET}})).error.code,'ADMIN_ALREADY_EXISTS','The public key cannot add an admin while the successor remains');
  const own=(await call('/api/admin/config',{token:sub.token})).adminRegistration;
  const invalid=await call('/api/admin/release',{method:'POST',token:sub.token,body:{confirmed:true,expectedRegistration}});assert.equal(invalid.error.code,'RELEASE_CONFIRMATION_REQUIRED');
  assert.equal((await call('/api/admin/release',{method:'POST',token:sub.token,body:{confirmed:true,expectedRegistration:own}})).adminExists,false);
  assert.equal((await call('/api/admin/claim',{method:'POST',token:visitor.token,body:{key:SECRET}})).status,200);
});

test('main can revoke sub, sub cannot remove main, and stale review cannot revoke a same-millisecond replacement',async t=>{
  t.mock.method(Date,'now',()=>1800000000000);
  const {call,admin,register}=setup(),main=await admin(),sub=await register(),visitor=await register();
  const add=()=>call('/api/admin/devices',{method:'POST',token:main.token,body:{playerId:sub.id,confirmed:true}});
  const first=await add(),old=first.devices.find(device=>device.playerId===sub.id);
  const body={playerId:sub.id,claimedAt:old.claimedAt,confirmed:true};
  assert.equal((await call('/api/admin/devices/revoke',{method:'POST',body})).status,401);
  assert.equal((await call('/api/admin/devices/revoke',{method:'POST',token:visitor.token,body})).status,403);
  assert.equal((await call('/api/admin/devices/revoke',{method:'POST',token:sub.token,body})).error.code,'MAIN_ADMIN_REQUIRED');
  assert.equal((await call('/api/admin/devices/revoke',{method:'POST',token:main.token,body:{...body,confirmed:false}})).error.code,'ADMIN_CONFIRMATION_REQUIRED');
  assert.equal((await call('/api/admin/devices/revoke',{method:'POST',token:main.token,body})).revoked,true);
  const second=await add(),current=second.devices.find(device=>device.playerId===sub.id);assert(current.claimedAt>old.claimedAt);
  const stale=await call('/api/admin/devices/revoke',{method:'POST',token:main.token,body});assert.equal(stale.error.code,'ADMIN_REGISTRATION_CHANGED');
  assert.equal((await call('/api/admin/config',{token:sub.token})).status,200);
  const primary=second.devices.find(device=>device.playerId===main.id);
  const forbidden=await call('/api/admin/devices/revoke',{method:'POST',token:sub.token,body:{playerId:main.id,claimedAt:primary.claimedAt,confirmed:true}});assert.equal(forbidden.status,403);assert.equal(forbidden.error.code,'MAIN_ADMIN_REQUIRED');
  assert.equal((await call('/api/admin/devices',{method:'POST',token:sub.token,body:{playerId:visitor.id,confirmed:true}})).error.code,'MAIN_ADMIN_REQUIRED');
  assert.equal((await call('/api/admin/devices',{token:sub.token})).canManageDevices,false);
  assert.equal((await call('/api/admin/devices/revoke',{method:'POST',token:main.token,body:{playerId:main.id,claimedAt:primary.claimedAt,confirmed:true}})).error.code,'ADMIN_SELF_TARGET');
  const released=await call('/api/admin/release',{method:'POST',token:main.token,body:{confirmed:true,expectedRegistration:{playerId:main.id,claimedAt:primary.claimedAt}}});assert.equal(released.status,200);
  assert.equal((await call('/api/admin/config',{token:main.token})).status,403);
  const promoted=await call('/api/admin/devices',{token:sub.token});assert.equal(promoted.devices[0].playerId,sub.id);assert.equal(promoted.devices[0].role,'main');assert.equal(promoted.canManageDevices,true);assert(promoted.devices[0].claimedAt>current.claimedAt);
  const staleRelease=await call('/api/admin/release',{method:'POST',token:sub.token,body:{confirmed:true,expectedRegistration:{playerId:sub.id,claimedAt:current.claimedAt}}});assert.equal(staleRelease.error.code,'ADMIN_REGISTRATION_CHANGED');
  const restored=await call('/api/admin/devices',{method:'POST',token:sub.token,body:{playerId:main.id,confirmed:true}});assert.equal(restored.status,200);assert.equal(restored.devices.find(device=>device.playerId===main.id).role,'sub');
});

for(const replace of [false,true])test(`queued device grant rechecks ${replace?'replaced':'revoked'} actor membership atomically`,async()=>{
  const {call,admin,register,env}=setup(),main=await admin(),sub=await register(),target=await register();
  await call('/api/admin/devices',{method:'POST',token:main.token,body:{playerId:sub.id,confirmed:true}});
  const own=(await call('/api/admin/config',{token:main.token})).adminRegistration;
  const subOwn=(await call('/api/admin/config',{token:sub.token})).adminRegistration;
  await call('/api/admin/release',{method:'POST',token:sub.token,body:{confirmed:true,expectedRegistration:subOwn}});
  const original=env.DB.batch.bind(env.DB);let resume,started,paused=false;
  const gate=new Promise(resolve=>resume=resolve),atGate=new Promise(resolve=>started=resolve);
  env.DB.batch=async statements=>{if(!paused&&statements[0].sql.startsWith('INSERT INTO admin_registration_clock')){paused=true;started();await gate;}return original(statements);};
  const pending=call('/api/admin/devices',{method:'POST',token:main.token,body:{playerId:target.id,confirmed:true}});await atGate;
  assert.equal((await call('/api/admin/release',{method:'POST',token:main.token,body:{confirmed:true,expectedRegistration:own}})).status,200);
  if(replace)assert.equal((await call('/api/admin/claim',{method:'POST',token:main.token,body:{key:SECRET}})).status,200);
  resume();assert.equal((await pending).status,403);
  assert.equal((await call('/api/me',{token:target.token})).player.isAdmin,false);assert.equal((await call('/api/me',{token:target.token})).grants.length,0);
});

test('queued revoke rechecks actor authority before deleting the reviewed target',async()=>{
  const {call,admin,register,env}=setup(),main=await admin(),sub=await register();
  const added=await call('/api/admin/devices',{method:'POST',token:main.token,body:{playerId:sub.id,confirmed:true}}),target=added.devices.find(device=>device.playerId===sub.id);
  const own=(await call('/api/admin/config',{token:main.token})).adminRegistration;
  const original=env.DB.prepare.bind(env.DB);let resume,started,paused=false;
  const gate=new Promise(resolve=>resume=resolve),atGate=new Promise(resolve=>started=resolve);
  env.DB.prepare=sql=>{const statement=original(sql);if(!paused&&sql.startsWith('DELETE FROM sub_admin_owner')){const first=statement.first.bind(statement);statement.first=async(...args)=>{paused=true;started();await gate;return first(...args);};}return statement;};
  const pending=call('/api/admin/devices/revoke',{method:'POST',token:main.token,body:{playerId:sub.id,claimedAt:target.claimedAt,confirmed:true}});await atGate;
  assert.equal((await call('/api/admin/release',{method:'POST',token:main.token,body:{confirmed:true,expectedRegistration:own}})).status,200);
  resume();assert.equal((await pending).status,403);assert.equal((await call('/api/admin/config',{token:sub.token})).status,200);
});

for(const seat of ['main','sub'])test(`key recovery replaces only the ${seat} seat and preserves the other administrator`,async()=>{
  const {call,admin,register,env}=setup(),main=await admin(),sub=await register(),replacement=await register();
  const added=await call('/api/admin/devices',{method:'POST',token:main.token,body:{playerId:sub.id,confirmed:true}});
  const target=seat==='main'?main:sub,other=seat==='main'?sub:main,before=added.devices.find(device=>device.playerId===other.id);
  if(seat==='sub')enableRecovery(env,sub);
  const request={method:'POST',token:replacement.token,body:{key:SECRET,recover:true},...(seat==='sub'?{origin:RECOVERY_ORIGIN}:{})};
  assert.equal((await call('/api/admin/claim',request)).status,200);
  const devices=await call('/api/admin/devices',{token:replacement.token});assert.equal(devices.devices.length,2);
  assert.deepEqual(devices.devices.find(device=>device.playerId===other.id),before);assert.equal(devices.devices.find(device=>device.playerId===replacement.id).role,seat);
  assert.equal((await call('/api/me',{token:target.token})).player.isAdmin,false);assert.equal((await call('/api/me',{token:other.token})).player.isAdmin,true);
  assert.equal((await call('/api/admin/claim',{method:'POST',token:other.token,body:{key:SECRET,recover:true}})).status,200,'Existing secondary claim is idempotent and does not seize the primary seat');
  assert.equal((await call('/api/status',{...(seat==='sub'?{origin:RECOVERY_ORIGIN}:{})})).adminRecoveryAvailable,false);
});

test('queued revoke cannot remove a secondary registration replaced after review',async()=>{
  const {call,admin,register,env}=setup(),main=await admin(),sub=await register();
  const add=()=>call('/api/admin/devices',{method:'POST',token:main.token,body:{playerId:sub.id,confirmed:true}}),first=await add(),old=first.devices.find(device=>device.playerId===sub.id);
  const body={playerId:sub.id,claimedAt:old.claimedAt,confirmed:true},request={method:'POST',token:main.token,body};
  const original=env.DB.prepare.bind(env.DB);let resume,started,paused=false;
  const gate=new Promise(resolve=>resume=resolve),atGate=new Promise(resolve=>started=resolve);
  env.DB.prepare=sql=>{const statement=original(sql);if(!paused&&sql.startsWith('DELETE FROM sub_admin_owner')){const first=statement.first.bind(statement);statement.first=async(...args)=>{paused=true;started();await gate;return first(...args);};}return statement;};
  const pending=call('/api/admin/devices/revoke',request);await atGate;
  assert.equal((await call('/api/admin/devices/revoke',request)).status,200);
  const replacement=await add(),current=replacement.devices.find(device=>device.playerId===sub.id);assert(current.claimedAt>old.claimedAt);
  resume();assert.equal((await pending).error.code,'ADMIN_REGISTRATION_CHANGED');
  assert.equal((await call('/api/admin/config',{token:sub.token})).adminRegistration.claimedAt,current.claimedAt);
});

test('main self-release never promotes a different secondary than its atomic snapshot',async()=>{
  const {call,admin,register,env}=setup(),main=await admin(),oldSub=await register(),newSub=await register();
  const added=await call('/api/admin/devices',{method:'POST',token:main.token,body:{playerId:oldSub.id,confirmed:true}}),old=added.devices.find(device=>device.playerId===oldSub.id);
  const expectedRegistration=(await call('/api/admin/config',{token:main.token})).adminRegistration;
  const original=env.DB.batch.bind(env.DB);let resume,started,paused=false;
  const gate=new Promise(resolve=>resume=resolve),atGate=new Promise(resolve=>started=resolve);
  env.DB.batch=async statements=>{if(!paused&&statements[1]?.sql.startsWith('DELETE FROM admin_owner')){paused=true;started();await gate;}return original(statements);};
  const request={method:'POST',token:main.token,body:{confirmed:true,expectedRegistration}},pending=call('/api/admin/release',request);await atGate;
  assert.equal((await call('/api/admin/devices/revoke',{method:'POST',token:main.token,body:{playerId:oldSub.id,claimedAt:old.claimedAt,confirmed:true}})).status,200);
  assert.equal((await call('/api/admin/devices',{method:'POST',token:main.token,body:{playerId:newSub.id,confirmed:true}})).status,200);
  resume();assert.equal((await pending).error.code,'ADMIN_REGISTRATION_CHANGED');
  const unchanged=await call('/api/admin/devices',{token:main.token});assert.equal(unchanged.devices.find(device=>device.role==='main').playerId,main.id);assert.equal(unchanged.devices.find(device=>device.role==='sub').playerId,newSub.id);
  assert.equal((await call('/api/admin/release',request)).status,200);
  const promoted=await call('/api/admin/devices',{token:newSub.token});assert.equal(promoted.devices.length,1);assert.equal(promoted.devices[0].role,'main');assert.equal(promoted.canManageDevices,true);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM sub_admin_owner').get().n,0);
});

test('third-seat migration preserves deployed two-seat records and rejects every cross-seat duplicate',()=>{
  const secondMigration=readFileSync(new URL('../drizzle/0006_sub_admin.sql',import.meta.url));
  assert.equal(createHash('sha256').update(secondMigration).digest('hex'),'274076a7a2c7a9ce474dafbb240ca478c44ca4171cf1e3380baafab58833f99d','Deployed migration 0006 is immutable');
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync(new URL('../drizzle/0000_admin.sql',import.meta.url),'utf8'));db.exec(secondMigration.toString());
  const ids=['P0000000000000001','P0000000000000002','P0000000000000003','P0000000000000004'];
  for(const [index,id] of ids.entries())db.prepare('INSERT INTO players (id,token_hash,name,created_at,updated_at) VALUES (?,?,?,?,?)').run(id,'hash'+index,'既存'+index,100,100);
  db.prepare('INSERT INTO admin_owner VALUES (1,?,1234)').run(ids[0]);db.prepare('INSERT INTO sub_admin_owner VALUES (1,?,2345)').run(ids[1]);
  db.prepare('INSERT INTO admin_registration_clock VALUES (1,2345,?)').run('existing-operation');
  db.prepare('INSERT INTO futo_config VALUES (1,?,7,100)').run(JSON.stringify(legacyConfig()));
  db.prepare('INSERT INTO grant_batches VALUES (?,?,?,?,?,?,?)').run('old-batch',ids[0],ids[1],'old-hash',JSON.stringify(DEFAULT_CONFIG),4,100);
  db.prepare('INSERT INTO grants (grant_id,batch_id,player_id,config_json,created_at) VALUES (?,?,?,?,?)').run('old-gift','old-batch',ids[1],JSON.stringify(DEFAULT_CONFIG),100);
  const before=Object.fromEntries(['players','admin_owner','sub_admin_owner','admin_registration_clock','futo_config','grant_batches','grants'].map(table=>[table,db.prepare('SELECT * FROM '+table).all()]));
  db.exec(readFileSync(new URL('../drizzle/0007_third_admin.sql',import.meta.url),'utf8'));
  for(const [table,rows] of Object.entries(before))assert.deepEqual(db.prepare('SELECT * FROM '+table).all(),rows,table);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM third_admin_owner').get().n,0);
  db.prepare('INSERT INTO third_admin_owner VALUES (1,?,3456)').run(ids[2]);
  assert.deepEqual(db.prepare('SELECT singleton,player_id FROM admin_members ORDER BY singleton').all().map(row=>({...row})),ids.slice(0,3).map((id,index)=>({singleton:index+1,player_id:id})));
  for(const [seat,table] of ['admin_owner','sub_admin_owner','third_admin_owner'].entries()){
    for(const [other,id] of ids.slice(0,3).entries())if(other!==seat){
      assert.throws(()=>db.prepare('INSERT OR IGNORE INTO '+table+' VALUES (1,?,4000)').run(id),/another seat/);
      assert.throws(()=>db.prepare('UPDATE '+table+' SET player_id=?').run(id),/another seat/);
    }
    assert.throws(()=>db.prepare('INSERT INTO '+table+' VALUES (2,?,4000)').run(ids[3]),/CHECK/);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM admin_members').get().n,3);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
});

test('main chooses either deputy role, retries preserve it, and legacy requests choose the first vacant role',async()=>{
  const {call,admin,register,env}=setup(),main=await admin(),third=await register('サブサブ候補'),sub=await register('サブ候補'),other=await register();
  const grant=(target,role)=>call('/api/admin/devices',{method:'POST',token:main.token,body:{playerId:target.id,confirmed:true,...(role===undefined?{}:{role})}});
  for(const role of ['main','admin',null,3])assert.equal((await grant(third,role)).error.code,'INVALID_ADMIN_ROLE');
  const first=await grant(third,'sub-sub');assert.equal(first.status,200);assert.equal(first.capacity,3);
  const registered=first.devices.find(device=>device.playerId===third.id);assert.equal(registered.role,'sub-sub');
  assert.equal((await call('/api/admin/devices?playerId='+third.id,{token:main.token})).candidate.role,'sub-sub');
  assert.equal((await grant(third,'sub-sub')).added,false);assert.equal((await grant(third)).added,false);
  assert.equal((await grant(third,'sub')).error.code,'ADMIN_ROLE_CHANGED');
  assert.equal(env.DB.sqlite.prepare('SELECT claimed_at FROM third_admin_owner').get().claimed_at,registered.claimedAt);
  const second=await grant(sub);assert.equal(second.status,200);assert.equal(second.devices.find(device=>device.playerId===sub.id).role,'sub');
  for(const role of ['sub','sub-sub'])assert.equal((await grant(other,role)).error.code,'ADMIN_ROLE_OCCUPIED');
  assert.equal((await grant(other)).error.code,'ADMIN_CAPACITY_REACHED');
  for(const deputy of [sub,third]){
    assert.equal((await call('/api/admin/devices',{token:deputy.token})).canManageDevices,false);
    assert.equal((await call('/api/admin/devices',{method:'POST',token:deputy.token,body:{playerId:other.id,role:'sub',confirmed:true}})).error.code,'MAIN_ADMIN_REQUIRED');
    assert.equal((await call('/api/admin/devices/revoke',{method:'POST',token:deputy.token,body:{playerId:main.id,claimedAt:second.devices[0].claimedAt,confirmed:true}})).error.code,'MAIN_ADMIN_REQUIRED');
  }
  const own=(await call('/api/admin/config',{token:third.token})).adminRegistration;
  assert.equal((await call('/api/admin/release',{method:'POST',token:third.token,body:{confirmed:true,expectedRegistration:own}})).adminExists,true);
  const surviving=await call('/api/admin/devices',{token:main.token});assert.deepEqual(surviving.devices.map(device=>device.role),['main','sub']);
  assert.equal((await grant(other)).devices.find(device=>device.playerId===other.id).role,'sub-sub');
});

test('racing explicit appointments never silently move a player or occupy an unrequested role',async()=>{
  const {call,admin,register,env}=setup(),main=await admin(),first=await register(),second=await register();
  const grant=(target,role)=>call('/api/admin/devices',{method:'POST',token:main.token,body:{playerId:target.id,role,confirmed:true}});
  const sameSeat=await Promise.all([grant(first,'sub'),grant(second,'sub')]);
  assert.equal(sameSeat.filter(result=>result.status===200).length,1);assert.equal(sameSeat.find(result=>result.status!==200).error.code,'ADMIN_ROLE_OCCUPIED');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM third_admin_owner').get().n,0,'Explicit sub request never falls through to sub-sub');
  const h=setup(),owner=await h.admin(),target=await h.register();
  const results=await Promise.all(['sub','sub-sub'].map(role=>h.call('/api/admin/devices',{method:'POST',token:owner.token,body:{playerId:target.id,role,confirmed:true}})));
  assert.equal(results.filter(result=>result.status===200).length,1);assert.equal(results.find(result=>result.status!==200).error.code,'ADMIN_ROLE_CHANGED');
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM admin_members WHERE player_id=?').get(target.id).n,1);
  const assigned=h.env.DB.sqlite.prepare('SELECT singleton FROM admin_members WHERE player_id=?').get(target.id).singleton;
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM grants WHERE player_id=?').get(target.id).n,assigned===2?0:1);
});

for(const role of ['main','sub','sub-sub'])test(`three-seat recovery replaces only ${role} while preserving both other registrations`,async()=>{
  const {call,admin,register,env}=setup(),main=await admin(),sub=await register(),third=await register(),replacement=await register();
  for(const [actor,role] of [[sub,'sub'],[third,'sub-sub']])assert.equal((await call('/api/admin/devices',{method:'POST',token:main.token,body:{playerId:actor.id,role,confirmed:true}})).status,200);
  const before=(await call('/api/admin/devices',{token:main.token})).devices,target={main,sub,'sub-sub':third}[role];enableRecovery(env,target);
  assert.equal((await call('/api/admin/claim',{method:'POST',token:replacement.token,origin:RECOVERY_ORIGIN,body:{key:SECRET}})).status,200);
  const after=(await call('/api/admin/devices',{token:replacement.token})).devices;assert.equal(after.length,3);
  for(const registration of before)if(registration.playerId!==target.id)assert.deepEqual(after.find(device=>device.playerId===registration.playerId),registration);
  assert.equal(after.find(device=>device.playerId===replacement.id).role,role);assert.equal((await call('/api/me',{token:replacement.token})).player.adminRole,role);
  assert.equal((await call('/api/me',{token:target.token})).player.isAdmin,false);assert.equal((await call('/api/status',{origin:RECOVERY_ORIGIN})).adminRecoveryAvailable,false);
});

test('a queued main release rechecks successor priority if sub is appointed ahead of sub-sub',async()=>{
  const {call,admin,register,env}=setup(),main=await admin(),third=await register(),sub=await register();
  const added=await call('/api/admin/devices',{method:'POST',token:main.token,body:{playerId:third.id,role:'sub-sub',confirmed:true}}),thirdBefore=added.devices.find(device=>device.playerId===third.id);
  const expectedRegistration=(await call('/api/admin/config',{token:main.token})).adminRegistration;
  const original=env.DB.batch.bind(env.DB);let resume,started,paused=false;
  const gate=new Promise(resolve=>resume=resolve),atGate=new Promise(resolve=>started=resolve);
  env.DB.batch=async statements=>{if(!paused&&statements[1]?.sql.startsWith('DELETE FROM admin_owner')){paused=true;started();await gate;}return original(statements);};
  const request={method:'POST',token:main.token,body:{confirmed:true,expectedRegistration}},pending=call('/api/admin/release',request);await atGate;
  assert.equal((await call('/api/admin/devices',{method:'POST',token:main.token,body:{playerId:sub.id,role:'sub',confirmed:true}})).status,200);
  resume();assert.equal((await pending).error.code,'ADMIN_REGISTRATION_CHANGED');
  assert.equal((await call('/api/admin/config',{token:main.token})).status,200);
  assert.equal((await call('/api/admin/release',request)).status,200);
  const after=(await call('/api/admin/devices',{token:sub.token})).devices;assert.equal(after.find(device=>device.role==='main').playerId,sub.id);assert.deepEqual(after.find(device=>device.playerId===third.id),thirdBefore);
});
