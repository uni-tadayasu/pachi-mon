/* Pachi Monsters — shared, server-authoritative ranked rules for owned teams. */
(() => {
  'use strict';
  const LT=globalThis.LT=globalThis.LT||{};
  if(!LT.Duel||!LT.Engine||!LT.KasaiRules||!LT.FutoRules)throw Error('ランク対戦のルールを読み込めませんでした。');
  const VERSION='ranked-v79-growth';
  const LEGACY_VERSION='ranked-v78';
  const supportsVersion=version=>version===VERSION||version===LEGACY_VERSION;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
  const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const TIERS=Object.freeze([
    ['bronze','ブロンズ',0],['silver','シルバー',1100],['gold','ゴールド',1250],
    ['platinum','プラチナ',1400],['diamond','ダイヤモンド',1600],['master','マスター',1800]
  ].map(([id,name,minRating])=>Object.freeze({id,name,minRating,min:minRating})));
  const engine=new LT.Engine();
  const EMPTY_STAGES=LT.BattleStages.empty();
  const INFO=Object.freeze({version:VERSION,teamSize:3,level:50,initialRating:1000,kFactor:32,
    maxTurns:LT.Duel.rules.maxTurns,tiers:TIERS,format:'single',teamSource:'owned-party-and-storage',
    items:true,allocation:true,uniqueSpecies:true,customStats:'level-50-growth-adjusted',fullRecovery:true,
    battleGrowth:LT.BattleGrowth.perLevel,compatibleVersions:Object.freeze([VERSION,LEGACY_VERSION])});
  function info(){return clone(INFO);}
  function normalizeOwned(party){
    // The adventure validator checks original levels, allocation budgets,
    // special grants and custom-stat limits before any battle normalization.
    // A fainted owned member is eligible because ranked battles start healed.
    if(!Array.isArray(party))throw Error('所持パチモンの情報を確認できません。');
    for(const mon of party){
      // Enrollment is checked against the actual saved level, never a supplied
      // battle-only sourceLevel that could enlarge the earned-growth limit.
      LT.BattleGrowth.count({level:mon?.level,battleGrowth:mon?.battleGrowth});
      if(mon?.bonusPoints!==undefined&&!integer(mon.bonusPoints,0,999))throw Error('育成ポイントの情報が正しくありません。');
      if(mon?.alloc!==undefined){
        const allocation=LT.DATA.allocation,points=mon.alloc;
        if(!points||typeof points!=='object'||Array.isArray(points)||Object.entries(points).some(([key,value])=>!allocation.keys.includes(key)||!integer(value,0,allocation.capPerStat)))throw Error('能力の振り分けが正しくありません。');
        const used=Object.values(points).reduce((sum,value)=>sum+value,0),budget=mon.customStats!==undefined?0:Math.max(0,(mon.level-1)*allocation.pointsPerLevel+(mon.bonusPoints||0));
        if(used>budget)throw Error('獲得した育成ポイントを超えて振り分けられています。');
      }
    }
    return LT.KasaiRules.normalizeParty(clone(party).map(mon=>mon?.hp===0?{...mon,hp:1}:mon));
  }
  function normalizeTeam(team){
    if(!Array.isArray(team)||team.length!==3)throw Error('手持ち・ひかえからパチモンを3体選んでください。');
    const normalized=normalizeOwned(team);
    if(new Set(normalized.map(mon=>mon.uid)).size!==3)throw Error('同じ個体を重複して選ぶことはできません。');
    if(new Set(normalized.map(mon=>mon.species)).size!==3)throw Error('同じ種類のパチモンは1体まで選べます。');
    return normalized;
  }
  function validateTeam(team){
    try{normalizeTeam(team);return {ok:true};}catch(error){return {ok:false,error:error?.message||'所持パチモンの情報を確認できません。'};}
  }
  function rankForRating(value){
    const rating=integer(value,0,Number.MAX_SAFE_INTEGER)?value:INFO.initialRating;
    let index=TIERS.length-1;while(index>0&&rating<TIERS[index].minRating)index--;
    const tier=TIERS[index],nextMinRating=TIERS[index+1]?.minRating??null;
    return {...tier,nextMinRating,progress:nextMinRating===null?1:Math.max(0,Math.min(1,(rating-tier.minRating)/(nextMinRating-tier.minRating)))};
  }
  function create(team0,team1,seed,names){
    if(!integer(seed,0,0xffffffff))throw Error('対戦の乱数情報が正しくありません。');
    const teams=[normalizeTeam(team0),normalizeTeam(team1)];
    const state={version:LT.Duel.rules.version,rankedVersion:VERSION,mode:'single',turn:1,round:1,phase:'action',seed,rng:seed,
      abilityState:{announced:{},consumed:{}},teams:teams.map((team,side)=>({
        name:typeof names?.[side]==='string'?Array.from(names[side].replace(/[\u0000-\u001f\u007f<>]/g,'').trim()).slice(0,24).join('')||`プレイヤー${side+1}`:`プレイヤー${side+1}`,
        monsters:team.map(prepareMember),active:[0]})),winner:null,reason:null,log:[],events:[]};
    return hydrate(state).snapshot();
  }
  function prepareMember(source){
    const mon=clone(source);mon.sourceLevel=mon.level;
    if(mon.customStats!==undefined){
      const reference=mon.customStatsLevel??mon.level;
      // Keep the original base for forward growth, including valid values at
      // its configured cap. Only a base above Lv.50 needs backward conversion.
      if(reference>50){
        const growth=LT.FutoRules.growth;
        mon.customStats=Object.fromEntries(Object.entries(mon.customStats).map(([key,value])=>[key,Math.max(1,value+(50-reference)*growth[key])]));
        mon.customStatsLevel=50;
      }else mon.customStatsLevel=reference;
    }
    mon.level=50;mon.xp=0;
    for(const key of ['status','statusTurns','curse','rechargeTurns'])delete mon[key];
    const stats=engine.stats(mon);mon.stats=stats;mon.maxHp=stats.hp;mon.hp=stats.hp;
    mon.stages=LT.BattleStages.empty();mon.guard=false;
    mon.moveOrder=LT.MoveOrder.normalize(mon.moveOrder);
    if(mon.heldItem)mon.item=mon.heldItem;
    mon.pp=Object.fromEntries(engine.moves(mon).map(move=>[move.id,engine.maxPP(move)]));
    return mon;
  }
  function previewMember(mon){return prepareMember(normalizeOwned([mon])[0]);}
  function moves(mon){return engine.moves(mon).map(move=>({...move,pp:mon.pp[move.id],maxPP:engine.maxPP(move)}));}
  class RankedDuel extends LT.Duel {
    moves(mon){return moves(mon);}
    _name(side,mon){return `${this.state.teams[side].name}の${mon.nickname||LT.DATA.species[mon.species].name}`;}
  }
  function hydrate(value){
    if(!value||!supportsVersion(value.rankedVersion)||value.version!==LT.Duel.rules.version||value.mode!=='single'||
      !integer(value.round,1,1000)||!integer(value.turn,1,101)||!['action','replacement'].includes(value.phase)||
      !integer(value.seed,0,0xffffffff)||!integer(value.rng,0,0xffffffff)||![null,0,1,'draw'].includes(value.winner)||
      !Array.isArray(value.teams)||value.teams.length!==2||!Array.isArray(value.log)||!Array.isArray(value.events)||
      !value.abilityState||!value.abilityState.announced||!value.abilityState.consumed)throw Error('ランク対戦の状態を確認できません。');
    const duel=Object.create(RankedDuel.prototype);
    for(const team of value.teams){
      if(!team||!Array.isArray(team.monsters)||team.monsters.length!==3||new Set(team.monsters.map(mon=>mon?.uid)).size!==3||new Set(team.monsters.map(mon=>mon?.species)).size!==3||
        !Array.isArray(team.active)||team.active.length!==1||!integer(team.active[0],0,2))throw Error('対戦チームを確認できません。');
      for(const mon of team.monsters){
        if(!mon||!own(LT.DATA.species,mon.species)||!integer(mon.sourceLevel,1,100))throw Error('対戦中の仲間を確認できません。');
        const growth=LT.BattleGrowth.count(mon);
        if(value.rankedVersion===LEGACY_VERSION&&growth!==0)throw Error('以前のルールの対戦には実戦成長を追加できません。');
        const expected=engine.stats(mon),stats=mon.stats;
        if(mon.level!==50||mon.maxHp!==expected.hp||!integer(mon.hp,0,mon.maxHp)||!stats||
          Object.keys(stats).length!==Object.keys(expected).length||Object.keys(expected).some(key=>stats[key]!==expected[key])||
          (mon.item!==undefined&&(!own(LT.DATA.heldItems,mon.item)||mon.item!==mon.heldItem))||
          !LT.Duel.validateMoveOrder(mon.moveOrder).ok||
          !mon.stages||Object.keys(EMPTY_STAGES).some(key=>!integer(mon.stages[key],-6,6))||!mon.pp)throw Error('対戦チームの能力値を確認できません。');
        if(duel.moves(mon).some(move=>!integer(mon.pp[move.id],0,move.maxPP)))throw Error('技の残り回数を確認できません。');
      }
    }
    duel.state=clone(value);duel._clearImmuneConditions();return duel;
  }
  function validate(state,side,orders){
    try{return hydrate(state).validate(side,orders);}catch(error){return {ok:false,error:error?.message||'対戦の行動を確認できません。'};}
  }
  function resolve(state,orders){return hydrate(state).resolve(clone(orders));}
  LT.RankedRules=Object.freeze({version:VERSION,info,supportsVersion,normalizeTeam,validateTeam,previewMember,moves,rankForRating,create,hydrate,validate,resolve});
})();
