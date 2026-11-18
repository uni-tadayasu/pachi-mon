/* Pachi Monsters: link-battle teams (online and local) from the player's own monsters.
 * Arvelion, Floravelle and Futo join like every other species: fixed Lv.50 stats
 * from their species data, their species moves, the individual's allocation
 * points, look, held item, move-slot order and permanent curse. Other conditions,
 * HP and PP start fresh; duel changes never write back to the adventure.
 * Futo's adventure stats are set by the operator and
 * take no allocation points, so in link battles it brings an even spread of the
 * Lv.50 budget. Nothing here needs a server, so the same rules work offline over
 * a local link. Ownership comes from the player's save, as for every species.
 * © 2026 KASAI SOLUTIONS INC. */
(() => {
  'use strict';
  const LT = globalThis.LT;
  if (!LT?.Duel || !LT.DuelSession || LT.OnlineFuto) return;
  const BaseSession = LT.DuelSession, Duel = LT.Duel;
  const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const only = (value, fields) => plain(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
  const cleanName = value => typeof value === 'string' ? Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()).slice(0, 16).join('') : '';
  const fail = error => ({ ok: false, error });
  // 98 points: the whole Lv.50 budget (2 per level), spread evenly.
  const FUTO_LINK_ALLOCATION = Object.freeze({ hp: 16, atk: 17, def: 16, spAtk: 17, spDef: 16, speed: 16 });

  function ownedList() { const state = LT.adminBridge?.getEngine?.()?.state; return [...(state?.party || []), ...(state?.storage || [])]; }
  // Futo comes only from an operator gift; Floravelle only as the operator's own companion.
  function owned() { return ownedList().find(mon => mon.species === 'futo' && typeof mon.grantId === 'string' && mon.grantId.length > 0) || null; }
  function ownedMythical() { return ownedList().find(mon => mon.species === 'floravelle' && /^admin-mythical:[a-zA-Z0-9_.:-]+$/.test(mon.grantId || '')) || null; }
  function ownedLegendary() { const id = LT.DATA.legendary?.species; return id ? ownedList().find(mon => mon.species === id) || null : null; }
  const lookOf = mon => ({ nickname: mon?.nickname || '', shiny: mon?.shiny === true });
  // All of the individual's assigned points, independent of the Lv.50 base stats;
  // Futo with operator stats keeps its existing even 98-point spread.
  function allocationOf(id, mon) {
    if (!mon) return null;
    if (mon.customStats !== undefined) return id === 'futo' ? { ...FUTO_LINK_ALLOCATION } : null;
    return Duel.normalizeAllocation(mon.alloc);
  }
  // Without chosen individuals, the first owned one of each species is used.
  const firstOf = id => ownedList().find(mon => mon.species === id) || null;
  const appearanceFor = ids => ids.map(id => lookOf(firstOf(id)));
  const allocationFor = ids => ids.map(id => allocationOf(id, firstOf(id)));
  const moveOrderOf = mon => LT.MoveOrder.normalize(mon?.moveOrder);
  const moveOrdersFor = ids => ids.map(id => moveOrderOf(firstOf(id)));
  const curseOf = mon => mon?.curse === true && !LT.ConditionRules.isImmune(mon);
  const cursesFor = ids => ids.map(id => curseOf(firstOf(id)));
  function validAllocation(team) {
    if (team.allocation === undefined) return true;
    return Array.isArray(team.allocation) && Array.isArray(team.ids) && team.allocation.length === team.ids.length &&
      team.allocation.every(item => item === null || Duel.validateAllocation(item).ok);
  }
  // Members are the player's own individuals (party and storage), chosen by uid.
  function membersFor(ids, uids) {
    if (!Array.isArray(uids) || uids.length !== ids.length || uids.some(uid => typeof uid !== 'string')) return { ok: false, error: 'チームのパチモンを選び直してください。' };
    if (new Set(uids).size !== uids.length) return { ok: false, error: '同じパチモンは1体まで編成できます。' };
    const all = ownedList(), list = uids.map(uid => all.find(mon => mon.uid === uid) || null);
    if (list.some((mon, i) => !mon || mon.species !== ids[i])) return { ok: false, error: '手持ち・ひかえにいるパチモンだけを編成できます。' };
    return { ok: true, list };
  }
  // Held items the player owns: in the bag, or held by any of their monsters.
  function ownedItems() {
    const state = LT.adminBridge?.getEngine?.()?.state, bag = state?.held || {}, held = LT.DATA.heldItems || {};
    const ids = new Set([...Object.keys(bag).filter(id => (bag[id] || 0) > 0), ...ownedList().map(mon => mon.heldItem).filter(Boolean)]);
    return [...ids].filter(id => Object.hasOwn(held, id)).sort((a, b) => held[a].no - held[b].no);
  }
  function itemsFor(input, list) {
    const size = input.ids.length; let items = input.items;
    if (items === undefined) items = list ? list.map(mon => mon?.heldItem || null) : Array(size).fill(null);
    if (!Array.isArray(items) || items.length !== size) return { ok: false, error: '持ち物の選び方が正しくありません。' };
    items = items.map(id => id || null);
    const check = Duel.validateItems(items, size); if (!check.ok) return { ok: false, error: check.error };
    const mine = new Set(ownedItems()), missing = items.find(id => id && !mine.has(id));
    if (missing) return { ok: false, error: `${LT.DATA.heldItems[missing].name}を持っていません。冒険で手に入れた持ち物だけを使えます。` };
    return { ok: true, items };
  }
  const validItems = team => team.items === undefined || (Array.isArray(team.ids) && Duel.validateItems(team.items, team.ids.length).ok && team.items.some(Boolean));
  function validAppearance(team) {
    if (team.appearance === undefined) return true;
    return Array.isArray(team.appearance) && team.appearance.length === team.ids?.length && team.appearance.every(item => {
      if (!only(item, ['nickname', 'shiny']) || typeof item.shiny !== 'boolean' || typeof item.nickname !== 'string') return false;
      try { return LT.MonsterIdentity.normalizeNickname(item.nickname) === item.nickname; } catch (_) { return false; }
    });
  }
  // Glitch-only companions can battle once owned, but never become rentals or trades.
  function rosterIds(base) {
    const legendary = LT.DATA.legendary?.species, hasLegendary = !!ownedLegendary();
    const ids = (base || Object.keys(LT.DATA.species)).filter(id => !LT.DATA.species[id]?.specialOnly && (id !== legendary || hasLegendary));
    if (owned() && LT.DATA.species.futo) ids.push('futo');
    if (ownedMythical() && LT.DATA.species.floravelle) ids.push('floravelle');
    for (const id of LT.DATA.glitchLine?.ids || []) if (firstOf(id)) ids.push(id);
    return ids;
  }
  // Looks are carried apart from combat data: they never change stats, levels or PP.
  function createDuel(config) {
    const duel = Duel.create(config);
    config.appearance?.forEach((team, side) => team?.forEach((look, index) => {
      const mon = duel.state.teams[side].monsters[index];
      if (mon && look) { mon.shiny = look.shiny === true; if (look.nickname) mon.nickname = look.nickname; }
    }));
    return duel;
  }
  class LinkSession extends BaseSession {
    _validTeam(team) {
      if (!plain(team) || !validAppearance(team) || !validAllocation(team) || !validItems(team) || !Duel.validateMoveOrders(team.moveOrders, team.ids?.length).ok || !Duel.validateCurses(team.curses, team.ids?.length).ok) return false;
      const clean = { ...team }; delete clean.appearance; delete clean.allocation; delete clean.items; delete clean.moveOrders; delete clean.curses;
      return super._validTeam(clean) && Duel.validateTeam(team.ids, this.mode).ok;
    }
    async setTeam(input = {}) {
      if (!Array.isArray(input.ids)) return fail('チームのパチモンを選んでください。');
      if (input.ids.includes(LT.DATA.legendary?.species) && !ownedLegendary()) return fail('アルヴェリオンを仲間にしてから編成してください。');
      if (input.ids.includes('futo') && !owned()) return fail('フートを受け取ってから編成してください。');
      if (input.ids.includes('floravelle') && !ownedMythical()) return fail(`${LT.DATA.species.floravelle?.name || '幻のパチモン'}を迎えてから編成してください。`);
      if (input.ids.some(id => LT.DATA.species[id]?.glitchOnly && !firstOf(id))) return fail('そのパチモンを仲間にしてから編成してください。');
      if (this._closed || !this._started || !this._connected || this.duel || this._teams[this.role]) return fail('現在は編成を変更できません。');
      // Chosen individuals (by uid) bring their own look, points, item, order and
      // permanent curse. A caller cannot override the selected individual's curse.
      const members = input.uids === undefined ? null : membersFor(input.ids, input.uids);
      if (members && !members.ok) return fail(members.error);
      const list = members?.list || null, items = itemsFor(input, list);
      if (!items.ok) return fail(items.error);
      let moveOrders;
      try { moveOrders = list ? list.map(moveOrderOf) : moveOrdersFor(input.ids); }
      catch (_) { return fail('技の並びが正しくありません。仲間の技を並べ直してください。'); }
      const team = { name: cleanName(input.name) || `プレイヤー${this.role + 1}`, ids: input.ids.slice(),
        appearance: list ? list.map(lookOf) : appearanceFor(input.ids), allocation: list ? list.map((mon, i) => allocationOf(input.ids[i], mon)) : allocationFor(input.ids), moveOrders,
        curses: list ? list.map(curseOf) : cursesFor(input.ids) };
      if (items.items.some(Boolean)) team.items = items.items;
      if (!this._validTeam(team)) return fail('異なる種類のパチモンでチームを編成してください。');
      this._teams[this.role] = team; this._phase = 'ready'; this._message = '編成を確定しました。対戦相手の準備を待っています。';
      this._arm(180000, '対戦相手の編成が時間内に完了しなかったため、中断しました。');
      this._send({ t: 'ready', session: this.sessionId, team }); if (!this._closed) this._beginIfReady(); this._emit();
      return this._closed ? fail(this._message) : { ok: true };
    }
    _beginIfReady() {
      if (this.duel || !this._teams.every(Boolean)) return;
      try {
        this.duel = createDuel({ mode: this.mode, teams: this._teams.map(team => team.ids), names: this._teams.map(team => team.name), seed: this.seed,
          appearance: this._teams.map(team => team.appearance), allocation: this._teams.map(team => team.allocation || null), items: this._teams.map(team => team.items || null), moveOrders: this._teams.map(team => team.moveOrders), curses: this._teams.map(team => team.curses) });
        this._beginSync(0);
      } catch (_) { this._fail('チームを準備できませんでした。部屋を作り直してください。'); }
    }
  }

  const baseFingerprint = Duel.rulesFingerprint.bind(Duel);
  Duel.rulesFingerprint = () => baseFingerprint() + ':link-teams-v8-special-three-standard-full-allocation-owned-items-glitch-line-v39:owned-move-order-v48:owned-permanent-curse-v49';
  LT.DuelSession = LinkSession;
  LT.OnlineFuto = { owned, ownedLegendary, ownedMythical, rosterIds, allocationFor, allocationOf, moveOrdersFor, cursesFor, ownedList, ownedItems, linkAllocation: FUTO_LINK_ALLOCATION, version: 8 };
})();
