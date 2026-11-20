#!/usr/bin/env node
'use strict';
// Exercise the shipped team picker and peer protocol with real reserve grants
// plus sub members already owned before the no-initial-gifts policy.
// Each peer has its own engine; battle state must never modify either save.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const linkSource = fs.readFileSync(path.join(root, 'online-futo.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const timers = new Set();
const roles = ['main', 'sub', 'sub-sub'];
const starters = { main: 'komorizen', sub: 'shizunaria', 'sub-sub': 'akehomura' };
const common = ['floravelle', 'zeroveil', 'pearlseria', 'hyogald', 'rurigorm'];
const statKeys = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'];
const appearanceOf = mon => ({ nickname: mon.nickname, shiny: mon.shiny === true, grantId: mon.grantId,
  ...(mon.gender === undefined ? {} : { gender: mon.gender }) });

function section(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert(a >= 0 && b > a, `Missing production section: ${start}`);
  return html.slice(a, b);
}
const pickerSource = section('  function ownedMembers(){', '  const memberLabel=');
const normalizeSource = section('  function normalizeTeam(members,count){', '  function itemOptions(');

function makePeer(role, roleIndex) {
  const context = vm.createContext({ console, crypto: webcrypto, TextEncoder, Uint8Array, Uint32Array,
    setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timer.unref(); timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); } });
  for (const script of scripts) {
    if (/\bsrc=|application\/ld\+json/.test(script[1])) continue;
    if (!context.LT?.Engine) vm.runInContext(script[2], context);
  }
  for (const marker of ['deterministic, save-independent rental-team duels', 'peer-to-peer casual duel protocol']) {
    const script = scripts.find(entry => entry[2].includes(marker));
    assert(script, marker); vm.runInContext(script[2], context);
  }
  const { LT } = context, engine = new LT.Engine();
  assert(engine.newGame('komori').ok);
  const playerId = `P${String(roleIndex + 1).repeat(16)}`, gender = role === 'sub' ? 'female' : 'male';
  const mythical = { grantId: `admin-mythical:${playerId}`, species: 'floravelle', level: 70 };
  if (role === 'sub') {
    const mon = engine.makeMonster(mythical.species, mythical.level); mon.grantId = mythical.grantId;
    engine.state.party.push(mon); engine.state.giftReceipts.push(mon.grantId); engine.markCaught(mon.species);
  } else assert(engine.receiveAdminMythical(mythical).ok);
  const legacy = engine.state.party.find(mon => mon.species === 'floravelle');
  legacy.nickname = '旧キラ';
  engine.setAllocation(legacy, { hp: 64, atk: 64, def: 10 });
  const bundle = { version: 1, playerId, role, members: [starters[role], ...common].map(species => ({
    grantId: `admin-trained-v64:${role}:${playerId}:${species}`, species, level: 100, gender, heldItem: 'trainband', bonusPoints: 99
  })) };
  const addition = {version:2,playerId,role,members:[{
    grantId:`admin-galdogran-v68:${role}:${playerId}:galdogran`,species:'lunaxion',level:100,gender:'none',heldItem:'trainband',bonusPoints:99
  }]};
  for (const grant of [bundle, addition]) {
    if (role !== 'sub') { assert.equal(engine.receiveAdminReserveTeam(grant).added, grant.members.length); continue; }
    const before = JSON.stringify(engine.state), status = engine.adminReserveTeamStatus(grant);
    assert.equal(status.disabled, true); assert.equal(status.canReceive, false); assert.equal(status.canRestore, false);
    for (const options of [{}, {restore:true}]) {
      const blocked = engine.receiveAdminReserveTeam(grant, options);
      assert.equal(blocked.ok, false); assert.equal(blocked.disabled, true); assert.notEqual(blocked.pending, true);
      assert.equal(JSON.stringify(engine.state), before, 'Sub cannot obtain or restore another initial gift');
    }
    // Historical records remain owned and usable; today's receive operation
    // intentionally cannot construct this fixture for the sub role.
    for (const member of LT.AdminReserveRules.normalizeBundle(grant).members) {
      const mon = engine.makeMonster(member.species, member.level);
      Object.assign(mon, {grantId:member.grantId, heldItem:member.heldItem, bonusPoints:member.bonusPoints});
      if (member.gender !== 'none') mon.gender = member.gender;
      if (member.battleGrowth) mon.battleGrowth = member.battleGrowth;
      engine.restoreMonster(mon); engine.state.storage.push(mon); engine.state.giftReceipts.push(mon.grantId); engine.markCaught(mon.species);
    }
  }
  if (role === 'sub') engine.state = new LT.Engine(engine.serialize()).state;
  const members = engine.state.storage.slice();
  members.forEach((mon, index) => {
    const values = [64, 64, 64, 41, 0, 64];
    engine.setAllocation(mon, Object.fromEntries(statKeys.map((key, i) => [key, values[(i + index + roleIndex) % values.length]])));
    mon.nickname = `育成${index + 1}`;
    mon.moveOrder = [3, 1, 0, 2];
    mon.hp -= index + 1;
    mon.pp[LT.DATA.species[mon.species].moves[0]]--;
    assert.equal(engine.allocationInfo(mon).used, 297);
  });
  new LT.Engine(engine.serialize()); // These are valid adventure-save individuals.
  LT.adminBridge = { getEngine: () => engine };
  vm.runInContext(linkSource, context);
  const picker = vm.createContext({ LT, D: LT.DATA, ids: Object.keys(LT.DATA.species), selected: [], itemPicks: [] });
  vm.runInContext(pickerSource + normalizeSource, picker);
  return { role, gender, LT, engine, legacy, members, picker, baseline: JSON.stringify(engine.state) };
}

function checkPicker(peer) {
  const { picker, members, legacy, LT } = peer, available = picker.ownedMembers();
  for (const mon of members) {
    const entry = available.find(entry => entry.mon.uid === mon.uid);
    assert(entry, `${peer.role}/${mon.species} is selectable`);
    assert.equal(entry.where, 'ひかえ');
  }
  assert(available.some(entry => entry.mon.uid === legacy.uid));
  assert.equal(available.filter(entry => entry.mon.species === 'floravelle').length, 2, 'both the old Lv70 and new Lv100 mythical appear');
  assert.equal(LT.OnlineFuto.ownedMythical().uid, legacy.uid, 'legacy first-match lookup must not hide the new individual');
  assert(LT.OnlineFuto.isMythicalMember(legacy));
  assert(LT.OnlineFuto.isMythicalMember(members[1]));
  assert.equal(LT.OnlineFuto.isMythicalMember({ ...members[1], gender: peer.gender === 'male' ? 'female' : 'male' }), false);
  assert.equal(LT.OnlineFuto.isMythicalMember({ ...members[1], grantId: members[0].grantId }), false);

  // The actual UI keeps the chosen Lv100 UID and removes duplicate species/items.
  picker.selected = [members[1].uid, legacy.uid, members[2].uid, members[3].uid];
  picker.itemPicks = [];
  picker.normalizeTeam(available, 4);
  assert.equal(picker.selected[0], members[1].uid);
  const selectedMons = picker.selected.map(uid => available.find(entry => entry.mon.uid === uid).mon);
  assert.equal(new Set(selectedMons.map(mon => mon.species)).size, 4);
  assert.equal(selectedMons.filter(mon => mon.species === 'floravelle').length, 1);
  assert.equal(picker.itemPicks.filter(id => id === 'trainband').length, 1, 'the UI handles the six identical adventure held items');
  assert.equal(JSON.stringify(peer.engine.state), peer.baseline);
}

function checkAppearance(peer) {
  const session = new peer.LT.DuelSession({ role: 0, mode: 'single', send: () => true });
  try {
    for (const mon of peer.members) {
      const team = { name: '育成チーム', ids: [mon.species, 'komori', 'hibana'], appearance: [
        appearanceOf(mon),
        { nickname: '', shiny: false }, { nickname: '', shiny: false }
      ] };
      assert(session._validTeam(team), `${peer.role}/${mon.species}: canonical appearance`);
      const mutations = [
        look => { look.gender = mon.gender === 'male' ? 'female' : 'male'; },
        ...(mon.gender === undefined ? [look => { look.gender = 'female'; }] : []),
        look => { look.gender = 'none'; },
        look => { look.grantId = look.grantId.replace(`:${peer.role}:`, ':unknown:'); },
        look => { look.grantId = look.grantId.replace(/:P[0-9a-f]{16}:/, ':Pbad:'); },
        look => { look.grantId = look.grantId.replace(/:[^:]+$/, ':komori'); },
        look => { look.bonusPoints = 99; },
        look => { look.shiny = 'false'; },
        look => { look.nickname = '123456'; }
      ];
      for (const mutate of mutations) {
        const bad = copy(team); mutate(bad.appearance[0]);
        assert.equal(session._validTeam(bad), false, `${peer.role}/${mon.species}: ${JSON.stringify(bad.appearance[0])}`);
      }
    }
  } finally { session.close(); }
}

async function pair(left, right, mode) {
  const queue = [], packets = [], peers = [left, right];
  const sessions = peers.map((peer, role) => new peer.LT.DuelSession({ role, mode, send(message) {
    const wire = copy(message); queue.push({ from: role, message: wire }); packets.push({ from: role, message: copy(wire) }); return true;
  } }));
  const flush = async () => {
    let count = 0;
    while (queue.length) {
      assert(++count < 100, 'bounded peer exchange');
      const { from, message } = queue.shift(); await sessions[1 - from].receive(message);
    }
  };
  sessions.forEach(session => session.start()); await flush();
  assert(sessions.every(session => session.snapshot().connected));
  return { sessions, flush, packets };
}

async function checkBattle(left, right, mode, indexes) {
  const peers = [left, right], p = await pair(left, right, mode);
  try {
    for (const [side, peer] of peers.entries()) {
      // An older entitled mythical must not authorize an invalid chosen UID.
      const invalid = { ...peer.members[1], uid: `${peer.role}-invalid-mythical`, gender: peer.gender === 'male' ? 'female' : 'male' };
      peer.engine.state.storage.push(invalid);
      try {
        assert.equal(peer.picker.ownedMembers().some(entry => entry.mon.uid === invalid.uid), false);
        const badMembers = [invalid, ...peer.members.filter(mon => mon.species !== 'floravelle').slice(0, indexes.length - 1)];
        const refused = await p.sessions[side].setTeam({ ids: badMembers.map(mon => mon.species), uids: badMembers.map(mon => mon.uid), items: badMembers.map(() => null) });
        assert.equal(refused.ok, false); assert.match(refused.error, /受け取り情報/);
      } finally { peer.engine.state.storage.pop(); }

      const chosen = indexes.map(index => peer.members[index]);
      peer.picker.selected = chosen.map(mon => mon.uid); peer.picker.itemPicks = [];
      peer.picker.normalizeTeam(peer.picker.ownedMembers(), chosen.length);
      assert.deepEqual(copy(peer.picker.selected), chosen.map(mon => mon.uid));
      const accepted = await p.sessions[side].setTeam({ name: peer.role, ids: chosen.map(mon => mon.species), uids: copy(peer.picker.selected), items: copy(peer.picker.itemPicks) });
      assert.equal(accepted.ok, true, accepted.error);
    }
    await p.flush();
    const duels = p.sessions.map(session => session.duel);
    assert(duels.every(Boolean), `${mode}: both peers start`);
    assert.equal(duels[0].fingerprint(), duels[1].fingerprint());
    for (const [side, peer] of peers.entries()) {
      const chosen = indexes.map(index => peer.members[index]);
      const ready = p.packets.find(packet => packet.from === side && packet.message.t === 'ready').message.team;
      assert.deepEqual(ready.ids, chosen.map(mon => mon.species));
      for (const [index, source] of chosen.entries()) {
        assert.deepEqual(ready.appearance[index], appearanceOf(source));
        assert.equal(Object.values(ready.allocation[index]).reduce((a, b) => a + b, 0), 297);
        assert.equal(ready.battleGrowth[index],source.battleGrowth||0);assert.equal(ready.sourceLevels[index],100);
        for (const duel of duels) {
          const mon = duel.state.teams[side].monsters[index];
          assert.equal(mon.level, 50); assert.equal(mon.gender, source.gender); assert.equal(mon.grantId, source.grantId);
          if(source.gender === undefined)assert.equal(Object.hasOwn(mon, 'gender'), false, 'genderless battle individuals omit the gender field');
          assert.equal(mon.nickname, source.nickname); assert.equal(mon.shiny, false);
          assert.deepEqual(copy(mon.alloc), copy(peer.LT.Duel.normalizeAllocation(source.alloc)));
          assert.equal(mon.battleGrowth||0,source.battleGrowth||0);if(source.battleGrowth)assert.equal(mon.sourceLevel,100);
          assert.deepEqual(copy(mon.stats), copy(peer.engine.stats({ species: source.species, level: 50, sourceLevel: source.level, alloc: source.alloc, battleGrowth: source.battleGrowth })));
          assert.equal(mon.hp, mon.stats.hp, 'duel HP starts fresh');
          assert.deepEqual(copy(mon.moveOrder), copy(source.moveOrder));
        }
      }
    }
    for (const [side, session] of p.sessions.entries()) {
      const sent = await session.submit(session.duel.legalOrders(side)); assert.equal(sent.ok, true, sent.error);
    }
    await p.flush();
    assert.equal(duels[0].fingerprint(), duels[1].fingerprint(), `${mode}: peers remain synchronized after a real turn`);
    for (const peer of peers) assert.equal(JSON.stringify(peer.engine.state), peer.baseline, `${peer.role}: choice and battle never mutate the save`);
  } finally { p.sessions.forEach(session => session.close()); }
}

(async () => {
  const peers = roles.map(makePeer);
  for (const peer of peers) { checkPicker(peer); checkAppearance(peer); }
  // Each role selects all seven members: first three in singles, last four in doubles.
  // Cycling opponents also exercises all three distinct gender/role grant shapes.
  for (let index = 0; index < peers.length; index++) {
    const left = peers[index], right = peers[(index + 1) % peers.length];
    await checkBattle(left, right, 'single', [0, 1, 2]);
    await checkBattle(left, right, 'double', [3, 4, 5, 6]);
  }
  console.log(JSON.stringify({ ok: true, roles, historicalRoles: ['sub'], members: 21, peerMatches: 6, checks: [
    'sub initial receive and restore disabled; historically owned members preserved',
    'all seven reserve UIDs selectable per role', 'legacy Lv70 and trained Lv100 mythical both listed',
    'duplicate species and held items still excluded', 'exact role gender/grant appearance validated',
    'invalid selected mythical refused despite an older entitled companion', 'full 297 points at Lv50', 'six v64 members keep growth99 and original source level; lunar addition stays unchanged',
    'single and double peers synchronized after a full turn', 'adventure saves unchanged'
  ] }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { for (const timer of timers) clearTimeout(timer); });
