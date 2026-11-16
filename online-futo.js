/* Pachi Monsters: server-authorized Futo in casual player battles.
 * © 2026 KASAI SOLUTIONS INC. */
(() => {
  'use strict';
  const LT = globalThis.LT;
  if (!LT?.Duel || !LT.DuelSession || LT.OnlineFuto) return;
  const BaseSession = LT.DuelSession, Duel = LT.Duel;
  const clone = value => JSON.parse(JSON.stringify(value));
  const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const only = (value, fields) => plain(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
  const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  const bounds = { hp: 99999, atk: 9999, def: 9999, spAtk: 9999, spDef: 9999, speed: 9999, accuracy: 300, evasion: 300 };
  const cleanName = value => typeof value === 'string' ? Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()).slice(0, 16).join('') : '';
  const fail = error => ({ ok: false, error });
  function owned() {
    const state = LT.adminBridge?.getEngine?.()?.state;
    return [...(state?.party || []), ...(state?.storage || [])].find(mon => mon.species === 'futo' && typeof mon.grantId === 'string' && mon.grantId.length > 0) || null;
  }
  function ownedLegendary() {
    const id=LT.DATA.legendary?.species;
    const state=LT.adminBridge?.getEngine?.()?.state;
    return id?[...(state?.party||[]),...(state?.storage||[])].find(mon=>mon.species===id)||null:null;
  }
  function appearanceFor(ids){
    const state=LT.adminBridge?.getEngine?.()?.state;
    const party=[...(state?.party||[]),...(state?.storage||[])];
    return ids.map(id=>{const mon=party.find(m=>m.species===id);return {nickname:mon?.nickname||'',shiny:mon?.shiny===true};});
  }
  function validAppearance(team){
    if(team.appearance===undefined)return true;
    return Array.isArray(team.appearance)&&team.appearance.length===team.ids?.length&&team.appearance.every(item=>{
      if(!only(item,['nickname','shiny'])||typeof item.shiny!=='boolean'||typeof item.nickname!=='string')return false;
      try{return LT.MonsterIdentity.normalizeNickname(item.nickname)===item.nickname;}catch(_){return false;}
    });
  }
  function rosterIds(base) {
    const legendary=LT.DATA.legendary?.species,hasLegendary=!!ownedLegendary();
    const ids = (base || Object.keys(LT.DATA.species)).filter(id => !LT.DATA.species[id]?.specialOnly&&(id!==legendary||hasLegendary));
    if (owned() && LT.DATA.species.futo) ids.push('futo');
    return ids;
  }
  function validateSnapshot(snapshot, sessionId, side, now = Date.now()) {
    if (!plain(snapshot) || snapshot.ok === false || snapshot.species !== 'futo' || snapshot.sessionId !== sessionId || snapshot.side !== side ||
      typeof snapshot.grantId !== 'string' || snapshot.grantId.length < 1 || snapshot.grantId.length > 128 ||
      !integer(snapshot.level, 1, 100) || !Number.isSafeInteger(snapshot.expiresAt) || snapshot.expiresAt <= now ||
      !only(snapshot.stats, Object.keys(bounds)) || !Object.entries(bounds).every(([key, max]) => integer(snapshot.stats[key], 1, max)) ||
      !Array.isArray(snapshot.moves) || snapshot.moves.length !== 4 || new Set(snapshot.moves).size !== 4 ||
      snapshot.moves.some(id => typeof id !== 'string' || !Object.hasOwn(LT.DATA.moves, id))) {
      throw new Error('フートの所持確認が無効または期限切れです。部屋を作り直してください。');
    }
    return { grantId: snapshot.grantId, species: 'futo', level: snapshot.level, stats: clone(snapshot.stats), moves: LT.normalizeFutoMoves(snapshot.moves),
      sessionId, side, expiresAt: snapshot.expiresAt };
  }
  function maxPP(move) { return integer(move.pp, 1, 99) ? move.pp : move.kind === 'heal' ? 10 : move.kind === 'guard' ? 15 : move.power >= 42 ? 10 : move.power >= 33 ? 15 : move.power >= 27 ? 20 : 30; }
  function createVerifiedDuel(config, verified) {
    const originalTeams = config.teams;
    const substituteTeams = originalTeams.map((team, side) => {
      if (!team.includes('futo')) return team.slice();
      if (!verified[side]) throw new Error('フートの所持確認が完了していません。');
      const placeholder = Object.keys(LT.DATA.species).find(id => !LT.DATA.species[id].specialOnly && !team.includes(id));
      if (!placeholder) throw new Error('チームを初期化できません。');
      return team.map(id => id === 'futo' ? placeholder : id);
    });
    // Base Duel continues to reject special-only species for unverified callers.
    const duel = Duel.create({ ...config, teams: substituteTeams });
    originalTeams.forEach((team, side) => team.forEach((species, index) => {
      if (species !== 'futo') return;
      const snapshot = verified[side];
      duel.state.teams[side].monsters[index] = { species: 'futo', level: snapshot.level, hp: snapshot.stats.hp, maxHp: snapshot.stats.hp,
        stats: clone(snapshot.stats), stages: LT.BattleStages.empty(), customMoves: snapshot.moves.slice(),
        pp: Object.fromEntries(snapshot.moves.map(id => [id, maxPP(LT.DATA.moves[id])])), guard: false };
    }));
    // Cosmetics are carried separately from combat data. They can never alter
    // rental stats, levels, PP or the server-authorized Futo snapshot.
    config.appearance?.forEach((team,side)=>team?.forEach((look,index)=>{
      const mon=duel.state.teams[side].monsters[index];
      if(mon&&look){mon.shiny=look.shiny===true;if(look.nickname)mon.nickname=look.nickname;}
    }));
    const baseMoves = duel.moves.bind(duel);
    duel.moves = mon => mon.species === 'futo' && Array.isArray(mon.customMoves)
      ? mon.customMoves.map(id => ({ ...LT.DATA.moves[id], pp: mon.pp[id], maxPP: maxPP(LT.DATA.moves[id]) })) : baseMoves(mon);
    return duel;
  }
  class FutoSession extends BaseSession {
    constructor(options) {
      super(options);
      this._futoVerified = [null, null];
      this._futoChecking = false;
    }
    _validTeam(team) {
      if(!validAppearance(team||{}))return false;
      const clean=plain(team)?{...team}:team;if(clean)delete clean.appearance;
      if (!team?.ids?.includes?.('futo')) return super._validTeam(clean) && team.ids.every(id => !LT.DATA.species[id]?.specialOnly);
      return only(clean, ['name', 'ids', 'futo']) && team.name === cleanName(team.name) && !!team.name &&
        Array.isArray(team.ids) && team.ids.length === (this.mode === 'single' ? 3 : 4) && new Set(team.ids).size === team.ids.length &&
        team.ids.every(id => typeof id === 'string' && id.length <= 80 && Object.hasOwn(LT.DATA.species, id) && (id === 'futo' || !LT.DATA.species[id].specialOnly)) &&
        only(team.futo, ['pass']) && typeof team.futo.pass === 'string' && team.futo.pass.length >= 32 && team.futo.pass.length <= 4096;
    }
    async setTeam(input = {}) {
      if(!Array.isArray(input.ids))return fail('チームのパチモンを選んでください。');
      // Adventure ownership controls local selection. Peer teams use the
      // shared fixed combat rules, not a claim of server-verified ownership.
      if(input.ids.includes(LT.DATA.legendary?.species)&&!ownedLegendary())return fail('アルヴェリオンを仲間にしてから編成してください。');
      if (!input.ids.includes('futo')) {
        if(this._closed||!this._started||!this._connected||this.duel||this._teams[this.role]||this._futoChecking)return fail('現在は編成を変更できません。');
        const team={name:cleanName(input.name)||`プレイヤー${this.role+1}`,ids:input.ids.slice(),appearance:appearanceFor(input.ids)};
        if(!this._validTeam(team))return fail('異なる種類のパチモンでチームを編成してください。');
        this._teams[this.role]=team;this._phase='ready';this._message='編成を確定しました。対戦相手の準備を待っています。';
        this._arm(180000,'対戦相手の編成が時間内に完了しなかったため、中断しました。');
        this._send({t:'ready',session:this.sessionId,team});if(!this._closed)this._beginIfReady();this._emit();
        return this._closed?fail(this._message):{ok:true};
      }
      if (this._closed || !this._started || !this._connected || this.duel || this._teams[this.role] || this._futoChecking) return fail('現在は編成を変更できません。');
      const local = owned();
      if (!local) return fail('フートを受け取ってから編成してください。');
      if (typeof LT.Admin?.requestDuelPass !== 'function' || typeof LT.Admin?.verifyDuelPass !== 'function') return fail('フートの所持確認サービスを読み込めません。');
      const team = { name: cleanName(input.name) || `プレイヤー${this.role + 1}`, ids: input.ids.slice(), appearance:appearanceFor(input.ids), futo: { pass: '0'.repeat(32) } };
      if (!this._validTeam(team)) return fail('異なる種類のパチモンでチームを編成してください。');
      this._futoChecking = true;
      const generation = this._generation;
      this._message = 'フートの所持と運営設定を確認しています。'; this._emit();
      try {
        const issued = await LT.Admin.requestDuelPass(this.sessionId, local.grantId, this.role);
        team.futo.pass = issued?.pass;
        if (!this._validTeam(team)) throw new Error('フートの所持確認を発行できませんでした。');
        const verified = validateSnapshot(await LT.Admin.verifyDuelPass(this.sessionId, team.futo.pass, this.role), this.sessionId, this.role);
        if (verified.grantId !== local.grantId) throw new Error('フートの配布記録が一致しません。');
        if (this._closed || this._generation !== generation || this._teams[this.role] || this.duel) return fail(this._message);
        this._futoVerified[this.role] = { pass: team.futo.pass, snapshot: verified };
        this._teams[this.role] = team;
        this._phase = 'ready'; this._message = '編成を確定しました。対戦相手の準備を待っています。';
        this._arm(180000, '対戦相手の編成が時間内に完了しなかったため、中断しました。');
        this._send({ t: 'ready', session: this.sessionId, team });
        if (!this._closed) this._beginIfReady();
        this._emit();
        return this._closed ? fail(this._message) : { ok: true };
      } catch (error) {
        if (!this._closed && this._generation === generation) { this._message = error?.message || 'フートの所持を確認できませんでした。'; this._emit(); }
        return fail(error?.message || 'フートの所持を確認できませんでした。');
      } finally { this._futoChecking = false; }
    }
    async _receive(message) {
      if (message?.v === BaseSession.VERSION && message.t === 'ready' && this._started && this._connected && !this._closed && message.session === this.sessionId && this._validTeam(message.team) && message.team.ids.includes('futo')) {
        const side = 1 - this.role, pass = message.team.futo.pass, generation = this._generation;
        try {
          if (this._futoVerified[side]?.pass !== pass) {
            if (typeof LT.Admin?.verifyDuelPass !== 'function') throw new Error('フートの所持確認サービスを読み込めません。');
            const snapshot = validateSnapshot(await LT.Admin.verifyDuelPass(this.sessionId, pass, side), this.sessionId, side);
            if (this._closed || this._generation !== generation) return;
            this._futoVerified[side] = { pass, snapshot };
          }
        } catch (_) { this._fail('相手のフートの所持または設定を確認できないため、対戦を中断しました。'); return; }
      }
      return super._receive(message);
    }
    _beginIfReady() {
      if (this.duel || !this._teams.every(Boolean)) return;
      try {
        const verified = this._teams.map((team, side) => {
          if (!team.ids.includes('futo')) return null;
          const record = this._futoVerified[side];
          if (!record || record.pass !== team.futo.pass) throw new Error('フートの所持確認が完了していません。');
          return validateSnapshot(record.snapshot, this.sessionId, side);
        });
        this.duel = createVerifiedDuel({ mode: this.mode, teams: this._teams.map(team => team.ids), names: this._teams.map(team => team.name), seed: this.seed, appearance:this._teams.map(team=>team.appearance) }, verified);
        this._beginSync(0);
      } catch (_) { this._fail('フートの編成確認に失敗しました。部屋を作り直してください。'); }
    }
  }
  const baseFingerprint = Duel.rulesFingerprint.bind(Duel);
  Duel.rulesFingerprint = () => baseFingerprint() + ':futo-server-pass-v3-owned-legendary';
  LT.DuelSession = FutoSession;
  LT.OnlineFuto = { owned, ownedLegendary, rosterIds, validateSnapshot, version: 3 };
})();
