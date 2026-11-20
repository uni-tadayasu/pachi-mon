/* Pachi Monsters — shared rules for a live Kasai duel with both saved parties. */
(() => {
  'use strict';
  const LT=globalThis.LT=globalThis.LT||{};
  if(!LT.Duel||!LT.Engine||!LT.KasaiRules)throw Error('カサイ対戦のルールを読み込めませんでした。');
  const clone=value=>JSON.parse(JSON.stringify(value));
  const VERSION='kasai-live-v83-vernix';
  const LEGACY_VERSION='kasai-live-v58';
  const engine=new LT.Engine();
  const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const cleanName=(value,fallback)=>typeof value==='string'?Array.from(value.replace(/[\u0000-\u001f\u007f<>]/g,'').trim()).slice(0,24).join('')||fallback:fallback;

  class LiveDuel extends LT.Duel {
    moves(mon){return engine.moves(mon).map(move=>({...move,pp:mon.pp[move.id],maxPP:engine.maxPP(move)}));}
    _name(side,mon){return `${this.state.teams[side].name}の${mon.nickname||LT.DATA.species[mon.species].name}`;}
  }

  function create(challengerParty,kasaiParty,seed,names=['挑戦者','謎のトレーナー カサイ']){
    if(!integer(seed,0,0xffffffff))throw Error('対戦の乱数情報が正しくありません。');
    const parties=[challengerParty,kasaiParty].map(party=>LT.KasaiRules.normalizeParty(party));
    // Build the same state shape as an ordinary human duel, without the casual
    // rental mode's three-member and Lv.50 restrictions. No adventure is mutated.
    const state={version:LT.Duel.rules.version,liveVersion:VERSION,mode:'single',turn:1,round:1,phase:'action',seed,rng:seed,
      abilityState:{announced:{},consumed:{}},teams:parties.map((party,side)=>({
        name:cleanName(names?.[side],side===0?'挑戦者':'謎のトレーナー カサイ'),
        monsters:party.map(source=>{
          const mon=clone(source),stats=engine.stats(mon);
          delete mon.status;delete mon.statusTurns;delete mon.rechargeTurns;
          mon.stats=stats;mon.hp=stats.hp;mon.maxHp=stats.hp;
          mon.stages=LT.BattleStages.empty();mon.guard=false;
          if(mon.heldItem)mon.item=mon.heldItem;
          mon.moveOrder=LT.MoveOrder.normalize(mon.moveOrder);
          mon.pp=Object.fromEntries(engine.moves(mon).map(move=>[move.id,engine.maxPP(move)]));
          LT.ConditionRules.clearImmune(mon);
          return mon;
        }),active:[0]})),winner:null,reason:null,log:[],events:[]};
    return hydrate(state).snapshot();
  }

  function hydrate(value){
    if(value?.liveVersion===LEGACY_VERSION){
      if(!LT.LegacyBattles)throw Error('以前の対戦ルールを読み込めませんでした。画面を更新してください。');
      return LT.LegacyBattles.live().hydrate(value);
    }
    if(!value||value.liveVersion!==VERSION||value.mode!=='single'||!integer(value.round,1,1000)||!integer(value.turn,1,101)||
      !['action','replacement'].includes(value.phase)||!integer(value.seed,0,0xffffffff)||!integer(value.rng,0,0xffffffff)||
      ![null,0,1,'draw'].includes(value.winner)||!Array.isArray(value.teams)||value.teams.length!==2)throw Error('対戦状態を確認できません。');
    for(const team of value.teams){
      if(!team||!Array.isArray(team.monsters)||team.monsters.length<1||team.monsters.length>6||!Array.isArray(team.active)||team.active.length!==1||!integer(team.active[0],0,team.monsters.length-1))throw Error('対戦中の手持ちを確認できません。');
      for(const mon of team.monsters){
        if(!mon||!LT.DATA.species[mon.species]||!integer(mon.level,1,100)||!integer(mon.maxHp,1,1000000)||!integer(mon.hp,0,mon.maxHp)||!mon.stats||!mon.pp||!mon.stages)throw Error('対戦中の仲間を確認できません。');
        const moves=engine.moves(mon);
        if(moves.some(move=>!integer(mon.pp[move.id],0,engine.maxPP(move))))throw Error('技の残り回数を確認できません。');
      }
    }
    const duel=Object.create(LiveDuel.prototype);duel.state=clone(value);duel._clearImmuneConditions();return duel;
  }

  function validate(state,side,orders){
    try{return hydrate(state).validate(side,orders);}catch(error){return {ok:false,error:error?.message||'行動を確認できません。'};}
  }
  function resolve(state,orders){return hydrate(state).resolve(clone(orders));}
  LT.KasaiLiveRules=Object.freeze({version:VERSION,create,hydrate,validate,resolve});
})();
