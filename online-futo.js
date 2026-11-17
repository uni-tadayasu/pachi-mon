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
  const specialFields={futo:'futo',floravelle:'mythical'};
  const specialIds=team=>Array.isArray(team?.ids)?team.ids.filter(id=>Object.hasOwn(specialFields,id)):[];
  function ownedMythical(){
    const state=LT.adminBridge?.getEngine?.()?.state;
    return [...(state?.party||[]),...(state?.storage||[])].find(mon=>mon.species==='floravelle'&&/^admin-mythical:[a-zA-Z0-9_.:-]+$/.test(mon.grantId||''))||null;
  }
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
  // Allocation points of the same individual as the appearance, carried at the
  // Lv.50 limits (Duel.scaleAllocation). Futo and the mythical keep their admin stats.
  function allocationFor(ids){
    const state=LT.adminBridge?.getEngine?.()?.state;
    const party=[...(state?.party||[]),...(state?.storage||[])];
    return ids.map(id=>{
      if(Object.hasOwn(specialFields,id))return null;
      const mon=party.find(m=>m.species===id);
      return mon&&mon.customStats===undefined?Duel.scaleAllocation(mon.alloc):null;
    });
  }
  function validAllocation(team){
    if(team.allocation===undefined)return true;
    return Array.isArray(team.allocation)&&Array.isArray(team.ids)&&team.allocation.length===team.ids.length&&
      team.allocation.every((item,index)=>item===null||(!Object.hasOwn(specialFields,team.ids[index])&&Duel.validateAllocation(item).ok));
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
    if(ownedMythical()&&LT.DATA.species.floravelle)ids.push('floravelle');
    return ids;
  }
  function validateSnapshot(snapshot, sessionId, side, now = Date.now(), species = 'futo') {
    if (!plain(snapshot) || snapshot.ok === false || snapshot.species !== species || !Object.hasOwn(specialFields,species) || snapshot.sessionId !== sessionId || snapshot.side !== side ||
      typeof snapshot.grantId !== 'string' || snapshot.grantId.length < 1 || snapshot.grantId.length > 128 ||
      !integer(snapshot.level, 1, 100) || !Number.isSafeInteger(snapshot.expiresAt) || snapshot.expiresAt <= now ||
      !only(snapshot.stats, Object.keys(bounds)) || !Object.entries(bounds).every(([key, max]) => integer(snapshot.stats[key], 1, max)) ||
      !Array.isArray(snapshot.moves) || snapshot.moves.length !== 4 || new Set(snapshot.moves).size !== 4 ||
      snapshot.moves.some(id => typeof id !== 'string' || !Object.hasOwn(LT.DATA.moves, id))) {
      throw new Error('フートの所持確認が無効または期限切れです。部屋を作り直してください。');
    }
    if(species==='floravelle'){
      const def=LT.DATA.species.floravelle,expected=new LT.Engine().stats({species,level:50});
      if(!/^admin-mythical:[a-zA-Z0-9_.:-]+$/.test(snapshot.grantId)||snapshot.level!==50||Object.keys(bounds).some(key=>snapshot.stats[key]!==expected[key])||snapshot.moves.some((id,i)=>id!==def.moves[i]))throw new Error('幻パチモンの使用証明が一致しません。');
    }
    return { grantId: snapshot.grantId, species, level: snapshot.level, stats: clone(snapshot.stats), moves: species==='futo'?LT.normalizeFutoMoves(snapshot.moves):snapshot.moves.slice(),
      sessionId, side, expiresAt: snapshot.expiresAt };
  }
  function maxPP(move) { return integer(move.pp, 1, 99) ? move.pp : move.kind === 'heal' ? 10 : move.kind === 'guard' ? 15 : move.power >= 42 ? 10 : move.power >= 33 ? 15 : move.power >= 27 ? 20 : 30; }
  function createVerifiedDuel(config, verified) {
    const originalTeams = config.teams;
    const substituteTeams = originalTeams.map((team, side) => {
      const used=new Set(team);
      return team.map(id=>{
        if(!Object.hasOwn(specialFields,id))return id;
        if(!verified[side]?.[id])throw new Error('特別な仲間の所持確認が完了していません。');
        const placeholder=Object.keys(LT.DATA.species).find(candidate=>!LT.DATA.species[candidate].specialOnly&&!used.has(candidate));
        if(!placeholder)throw new Error('チームを初期化できません。');used.add(placeholder);return placeholder;
      });
    });
    const duel = Duel.create({ ...config, teams: substituteTeams });
    originalTeams.forEach((team, side) => team.forEach((species, index) => {
      if (!Object.hasOwn(specialFields,species)) return;
      const snapshot = verified[side][species];
      duel.state.teams[side].monsters[index] = { species, level: snapshot.level, hp: snapshot.stats.hp, maxHp: snapshot.stats.hp,
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
    duel.moves = mon => Object.hasOwn(specialFields,mon.species) && Array.isArray(mon.customMoves)
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
      if(!validAppearance(team||{})||!validAllocation(team||{}))return false;
      const clean=plain(team)?{...team}:team;if(clean){delete clean.appearance;delete clean.allocation;}
      const specials=specialIds(team);
      if(!specials.length)return super._validTeam(clean)&&team.ids.every(id=>!LT.DATA.species[id]?.specialOnly);
      return only(clean,['name','ids',...specials.map(id=>specialFields[id])])&&team.name===cleanName(team.name)&&!!team.name&&
        Array.isArray(team.ids)&&team.ids.length===(this.mode==='single'?3:4)&&new Set(team.ids).size===team.ids.length&&
        team.ids.every(id=>typeof id==='string'&&id.length<=80&&Object.hasOwn(LT.DATA.species,id)&&(Object.hasOwn(specialFields,id)||!LT.DATA.species[id].specialOnly))&&
        specials.every(id=>{const proof=team[specialFields[id]];return only(proof,['pass'])&&typeof proof.pass==='string'&&proof.pass.length>=32&&proof.pass.length<=4096;});
    }
    async setTeam(input = {}) {
      if(!Array.isArray(input.ids))return fail('チームのパチモンを選んでください。');
      if(input.ids.includes(LT.DATA.legendary?.species)&&!ownedLegendary())return fail('アルヴェリオンを仲間にしてから編成してください。');
      if(this._closed||!this._started||!this._connected||this.duel||this._teams[this.role]||this._futoChecking)return fail('現在は編成を変更できません。');
      const specials=specialIds(input),locals={futo:owned(),floravelle:ownedMythical()};
      if(specials.some(id=>!locals[id]))return fail('特別な仲間を受け取ってから編成してください。');
      if(specials.length&&(typeof LT.Admin?.requestDuelPass!=='function'||typeof LT.Admin?.verifyDuelPass!=='function'))return fail('仲間の所持確認サービスを読み込めません。');
      const team={name:cleanName(input.name)||`プレイヤー${this.role+1}`,ids:input.ids.slice(),appearance:appearanceFor(input.ids),allocation:allocationFor(input.ids)};
      for(const id of specials)team[specialFields[id]]={pass:'0'.repeat(32)};
      if(!this._validTeam(team))return fail('異なる種類のパチモンでチームを編成してください。');
      this._futoChecking=true;
      const generation=this._generation,records={};
      if(specials.length){this._message='仲間の所持と運営の使用権を確認しています。';this._emit();}
      try{
        for(const id of specials){
          const field=specialFields[id],local=locals[id];
          const issued=await LT.Admin.requestDuelPass(this.sessionId,local.grantId,this.role);
          team[field].pass=issued?.pass;
          if(!this._validTeam(team))throw new Error('仲間の使用証明を発行できませんでした。');
          const snapshot=validateSnapshot(await LT.Admin.verifyDuelPass(this.sessionId,team[field].pass,this.role),this.sessionId,this.role,Date.now(),id);
          if(snapshot.grantId!==local.grantId)throw new Error('仲間の受取記録が一致しません。');
          records[id]={pass:team[field].pass,snapshot};
        }
        if(this._closed||this._generation!==generation||this._teams[this.role]||this.duel)return fail(this._message);
        this._futoVerified[this.role]=records;this._teams[this.role]=team;
        this._phase='ready';this._message='編成を確定しました。対戦相手の準備を待っています。';
        this._arm(180000,'対戦相手の編成が時間内に完了しなかったため、中断しました。');
        this._send({t:'ready',session:this.sessionId,team});if(!this._closed)this._beginIfReady();this._emit();
        return this._closed?fail(this._message):{ok:true};
      }catch(error){
        if(!this._closed&&this._generation===generation){this._message=error?.message||'仲間の所持を確認できませんでした。';this._emit();}
        return fail(error?.message||'仲間の所持を確認できませんでした。');
      }finally{this._futoChecking=false;}
    }
    async _receive(message) {
      if(message?.v===BaseSession.VERSION&&message.t==='ready'&&this._started&&this._connected&&!this._closed&&message.session===this.sessionId&&this._validTeam(message.team)){
        const side=1-this.role,generation=this._generation,records={};
        try{
          for(const id of specialIds(message.team)){
            const pass=message.team[specialFields[id]].pass;
            if(typeof LT.Admin?.verifyDuelPass!=='function')throw new Error('仲間の所持確認サービスを読み込めません。');
            const snapshot=validateSnapshot(await LT.Admin.verifyDuelPass(this.sessionId,pass,side),this.sessionId,side,Date.now(),id);
            if(this._closed||this._generation!==generation)return;
            records[id]={pass,snapshot};
          }
          this._futoVerified[side]=records;
        }catch(_){this._fail('相手の仲間の所持または使用権を確認できないため、対戦を中断しました。');return;}
      }
      return super._receive(message);
    }
    _beginIfReady() {
      if(this.duel||!this._teams.every(Boolean))return;
      try{
        const verified=this._teams.map((team,side)=>Object.fromEntries(specialIds(team).map(id=>{
          const record=this._futoVerified[side]?.[id];
          if(!record||record.pass!==team[specialFields[id]].pass)throw new Error('仲間の所持確認が完了していません。');
          return [id,validateSnapshot(record.snapshot,this.sessionId,side,Date.now(),id)];
        })));
        this.duel=createVerifiedDuel({mode:this.mode,teams:this._teams.map(team=>team.ids),names:this._teams.map(team=>team.name),seed:this.seed,appearance:this._teams.map(team=>team.appearance),allocation:this._teams.map(team=>team.allocation||null)},verified);
        this._beginSync(0);
      }catch(_){this._fail('特別な仲間の編成確認に失敗しました。部屋を作り直してください。');}
    }
  }

  const baseFingerprint = Duel.rulesFingerprint.bind(Duel);
  Duel.rulesFingerprint = () => baseFingerprint() + ':special-server-pass-v5-owner-mythical-allocation';
  LT.DuelSession = FutoSession;
  LT.OnlineFuto = { owned, ownedLegendary, ownedMythical, rosterIds, validateSnapshot, allocationFor, version: 5 };
})();
