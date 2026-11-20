/* Ranked human battles. The service alone pairs players and resolves turns. */
(() => {
  'use strict';
  const root=globalThis,LT=root.LT=root.LT||{},PLAYER=/^P[0-9a-f]{16}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const KEY='pachi-ranked-recovery-v78:',copy=value=>JSON.parse(JSON.stringify(value)),fail=message=>({ok:false,message});
  const info=rules=>typeof rules.info==='function'?rules.info():rules.info;
  const supportsVersion=(rules,version)=>typeof rules.supportsVersion==='function'?rules.supportsVersion(version):(info(rules).compatibleVersions||[info(rules).version]).includes(version);
  const reasonText=reason=>({battle:'決着',forfeit:'降参',turn_timeout:'行動の時間切れ',disconnect:'接続切れ',double_disconnect:'双方の接続切れ',double_timeout:'双方の時間切れ',rules_changed:'対戦ルールの更新',turn_limit:'規定ターン到達',void:'無効試合'}[reason]||'対戦終了');
  class RankedBattleController {
    constructor({request,identify,getIdentity,getEngine,canEnter,canResume=canEnter,setScene,rules=LT.RankedRules,storage,enabled=()=>true,uuid=()=>root.crypto.randomUUID(),clock=()=>Date.now(),changed=()=>{},notify=()=>{}}){
      Object.assign(this,{request,identify,getIdentity,getEngine,canEnter,canResume,setScene,rules,storage,enabled,uuid,clock,changed,notify});
      this.owner=null;this.engine=null;this.epoch=0;this.ticket=0;this.appliedTicket=0;this.busy=null;this.polling=null;this.panelsLoading=null;
      this.profile=null;this.queue=null;this.match=null;this.queueIntent=null;this.actionIntent=null;this.recovering=false;this.known=false;this.error='';this.errorKind='';this.panelsError='';this.history=[];this.leaderboard=[];this.serverOffset=0;this.sceneId=null;this.sceneKey='';
    }
    active(){return !!this.match;}
    queued(){return !!this.queue||!!this.queueIntent;}
    locked(){return this.active()||this.queued()||this.recovering||this.busy?.kind==='queue';}
    state(){return {owner:this.owner,profile:this.profile,queue:this.queue,match:this.match,busy:!!this.busy,working:this.busy?.kind||'',queued:this.queued(),active:this.active(),locked:this.locked(),known:this.known,error:this.error,panelsError:this.panelsError,history:this.history,leaderboard:this.leaderboard,actionIntent:this.actionIntent,queueIntent:this.queueIntent,remaining:Math.max(0,Math.ceil(((this.match?.deadlineAt||this.queue?.expiresAt||0)-(this.clock()+this.serverOffset))/1000))};}
    signal(){this.changed(this.state());}
    saveRecovery(){
      if(!this.owner)return;
      try{if(this.queueIntent||this.match||this.actionIntent)this.storage?.setItem(KEY+this.owner,JSON.stringify({version:1,queueIntent:this.queueIntent,matchId:this.match?.id||null,actionIntent:this.actionIntent}));else this.storage?.removeItem(KEY+this.owner);}catch(_){/* The service still retains the authoritative queue and match. */}
    }
    loadRecovery(){
      try{
        const raw=this.storage?.getItem(KEY+this.owner);if(!raw||raw.length>50000)return;const value=JSON.parse(raw);if(value?.version!==1)return;
        if(value.queueIntent&&UUID.test(value.queueIntent.requestId||'')&&Array.isArray(value.queueIntent.team)&&['joining','waiting','cancelling'].includes(value.queueIntent.phase))this.queueIntent=copy(value.queueIntent);
        if(value.actionIntent&&UUID.test(value.actionIntent.matchId||'')&&UUID.test(value.actionIntent.requestId||'')&&Number.isSafeInteger(value.actionIntent.round)&&Array.isArray(value.actionIntent.orders))this.actionIntent=copy(value.actionIntent);
        this.recovering=!!this.queueIntent||UUID.test(value.matchId||'')||!!this.actionIntent;
      }catch(_){}
    }
    clearScene(){if(this.sceneId)this.setScene(null,this.match?.side??0,this.sceneId);this.sceneId=null;this.sceneKey='';}
    reset(){
      this.clearScene();this.epoch++;this.owner=null;this.engine=null;this.busy=null;this.polling=null;this.panelsLoading=null;this.profile=null;this.queue=null;this.match=null;this.queueIntent=null;this.actionIntent=null;this.recovering=false;this.known=false;this.error='';this.errorKind='';this.panelsError='';this.history=[];this.leaderboard=[];this.signal();
    }
    async identity(fresh=false){
      const start=this.epoch,person=await this.identify({fresh});if(start!==this.epoch)return null;
      if(!PLAYER.test(person?.id||''))throw Error('プレイヤー情報を確認できません。');
      if(this.owner&&(this.owner!==person.id||this.engine!==this.getEngine()))this.reset();
      if(!this.owner){this.owner=person.id;this.engine=this.getEngine();this.loadRecovery();this.signal();}
      return person.id;
    }
    valid(epoch,owner,engine=this.engine){return epoch===this.epoch&&owner===this.owner&&owner===this.getIdentity()?.id&&engine===this.getEngine();}
    team(value){
      const checked=this.rules.validateTeam(value);
      if(checked===false||checked?.ok===false)throw Error(checked?.message||checked?.error||'対戦する3体を選んでください。');
      return copy(this.rules.normalizeTeam(value));
    }
    validateStatus(data){
      if(!data||!supportsVersion(this.rules,data.rulesVersion)||data.profile?.playerId!==this.owner)throw Error('ランクバトルの情報を確認できません。ページを更新してください。');
      if(!Number.isFinite(data.serverTime)||!Number.isSafeInteger(data.profile.rating)||data.profile.rating<0)throw Error('ランクの更新を確認できません。');
      if(data.queue){const q=data.queue;if(!UUID.test(q.id||'')||!UUID.test(q.requestId||'')||q.state!=='waiting'||!Number.isFinite(q.expiresAt)||!Number.isFinite(q.joinedAt))throw Error('待機中の情報を確認できません。');this.team(q.team);}
      if(data.match){
        const m=data.match;if(!UUID.test(m.id||'')||m.rulesVersion!==data.rulesVersion||m.battle?.rankedVersion!==m.rulesVersion||!['battle','result'].includes(m.state)||![0,1].includes(m.side)||!Array.isArray(m.players)||m.players.length!==2||m.players[m.side]?.id!==this.owner||m.players.some(player=>!PLAYER.test(player?.id||'')||typeof player.name!=='string')||!Number.isSafeInteger(m.revision)||m.revision<0||!Number.isSafeInteger(m.round)||!Array.isArray(m.submitted)||m.submitted.length!==2||m.submitted.some(value=>typeof value!=='boolean'))throw Error('対戦相手と進行状況を確認できません。');
        this.rules.hydrate(m.battle);if(m.round!==m.battle.round)throw Error('対戦のターンを確認できません。');
        if(m.state==='result'&&(!m.result||!['win','loss','draw','void'].includes(m.result.outcome)||!Array.isArray(m.result.ratingAfter)||m.result.ratingAfter.length!==2||m.result.ratingAfter.some(value=>!Number.isSafeInteger(value)||value<0)))throw Error('対戦結果を確認できません。');
      }
    }
    present(){
      const match=this.match;if(!match)return false;
      const key=[match.id,match.revision,match.state].join(':');if(key===this.sceneKey)return true;
      if(!this.sceneId&&!this.canResume()){this.error='ほかの操作を終えると、対戦画面に戻ります。';this.errorKind='scene';return false;}
      const result=this.setScene(match.battle,match.side,match.id);
      if(result===false||result?.ok===false){this.error=result?.message||'対戦画面に戻れません。現在の操作を終えてください。';this.errorKind='scene';return false;}
      if(this.errorKind==='scene'){this.error='';this.errorKind='';}this.sceneId=match.id;this.sceneKey=key;return true;
    }
    apply(data,stamp,epoch,owner){
      if(!this.valid(epoch,owner)||stamp<this.appliedTicket)return false;this.validateStatus(data);
      if(this.match&&data.match?.id===this.match.id&&data.match.revision<this.match.revision)return false;
      this.appliedTicket=stamp;this.serverOffset=data.serverTime-this.clock();this.profile=copy(data.profile);this.known=true;this.recovering=false;
      const previous=this.match,previousAction=this.actionIntent,previousQueue=this.queueIntent,wasQueued=this.queued();this.queue=data.queue?copy(data.queue):null;this.match=data.match?copy(data.match):null;
      if(this.match){
        this.queueIntent=null;
        if(this.actionIntent&&(this.actionIntent.matchId!==this.match.id||this.actionIntent.round!==this.match.round||this.match.submitted[this.match.side]||this.match.state!=='battle'))this.actionIntent=null;
        if(this.actionIntent){const validation=this.rules.hydrate(this.match.battle).validate(this.match.side,this.actionIntent.orders);if(!validation.ok)this.actionIntent=null;}
        this.present();
      }else{
        if(previous||this.sceneId)this.clearScene();this.actionIntent=null;
        if(this.queue)this.queueIntent={requestId:this.queue.requestId,team:copy(this.queue.team),phase:this.queueIntent?.requestId===this.queue.requestId&&this.queueIntent.phase==='cancelling'?'cancelling':'waiting'};
        else if(data.intent&&data.intent.requestId===this.queueIntent?.requestId&&['cancelled','expired'].includes(data.intent.state)||this.queueIntent?.phase==='waiting')this.queueIntent=null;
      }
      const reconciled=previousAction&&!this.actionIntent||previousQueue&&(!this.queueIntent||previousQueue.phase==='joining'&&this.queueIntent.phase==='waiting');
      if(reconciled&&this.errorKind==='mutation'){this.error='';this.errorKind='';}
      this.saveRecovery();this.signal();
      if(this.match?.id!==previous?.id&&this.match)this.notify('対戦相手が見つかりました。ランクバトルを開始します。');
      else if(wasQueued&&!this.queued()&&!this.match)this.notify('マッチングの待機を終了しました。');
      return true;
    }
    async refresh(){
      if(this.polling||this.busy||!this.enabled())return {ok:true,skipped:true};
      const marker={};this.polling=marker;
      try{
        const owner=await this.identity();if(this.polling!==marker||!owner)return {ok:false,stale:true};if(!this.enabled())return {ok:true,skipped:true};const epoch=this.epoch,stamp=++this.ticket;
        const data=await this.request('/world/ranked');if(!this.valid(epoch,owner))return {ok:false,stale:true};
        if(this.errorKind==='poll'){this.error='';this.errorKind='';}this.apply(data,stamp,epoch,owner);return {ok:true};
      }catch(error){if(this.polling===marker&&this.errorKind!=='mutation'){this.error=error?.message||'再接続しています。対戦の状態はサーバーに残っています。';this.errorKind='poll';this.signal();}return fail(error?.message||this.error);}
      finally{if(this.polling===marker)this.polling=null;}
    }
    async run(kind,operation,{replace=false}={}){
      if(this.busy&&!replace)return fail('進行中の通信を確認しています。');
      const token={kind};this.busy=token;this.error='';this.errorKind='';this.signal();
      try{return await operation(token);}catch(error){if(this.busy===token){this.error=error?.message||'通信を確認してください。';this.errorKind='mutation';this.signal();}return fail(error?.message||'通信を確認してください。');}
      finally{if(this.busy===token){this.busy=null;this.signal();}}
    }
    async join(value){
      if(this.match||this.queue)return fail('現在の待機・対戦を終えてください。');
      return this.run('queue',async token=>{
        if(!this.known){
          const firstOwner=await this.identity();if(!firstOwner||this.busy!==token)return {ok:false,stale:true};
          const firstEpoch=this.epoch,firstStamp=++this.ticket,data=await this.request('/world/ranked');
          if(!this.valid(firstEpoch,firstOwner)||this.busy!==token)return {ok:false,stale:true};this.apply(data,firstStamp,firstEpoch,firstOwner);
        }
        if(this.match||this.queue)return fail('現在の待機・対戦を終えてください。');
        const owner=await this.identity(true);if(!owner||this.busy!==token)return {ok:false,stale:true};
        if(!this.canEnter())throw Error('冒険の操作を終えてから参加してください。');
        const team=this.team(value),teamKey=JSON.stringify(team);
        if(this.queueIntent&&JSON.stringify(this.queueIntent.team)!==teamKey)throw Error('先の参加結果を確認してください。同じチームで再確認するか、待機を取り消せます。');
        this.queueIntent??={requestId:this.uuid(),team,phase:'joining'};this.queueIntent.phase='joining';this.saveRecovery();this.signal();
        const epoch=this.epoch,stamp=++this.ticket,requestId=this.queueIntent.requestId;
        const data=await this.request('/world/ranked/queue',{method:'POST',body:{requestId,team:copy(team),rulesVersion:info(this.rules).version}});
        if(!this.valid(epoch,owner)||this.busy!==token)return {ok:false,stale:true};this.apply(data,stamp,epoch,owner);return {ok:true};
      });
    }
    async cancel(){
      if(this.match)return {ok:true,matched:true};
      const intent=this.queueIntent||this.queue&&{requestId:this.queue.requestId,team:this.queue.team,phase:'waiting'};
      if(!intent){if(this.busy?.kind==='queue'){this.busy=null;this.signal();}return {ok:true,cancelled:true};}
      return this.run('cancel',async token=>{
        const owner=this.owner,epoch=this.epoch,stamp=++this.ticket;this.queueIntent={...copy(intent),phase:'cancelling'};this.saveRecovery();this.signal();
        const data=await this.request('/world/ranked/queue',{method:'DELETE',body:{requestId:intent.requestId}});
        if(!this.valid(epoch,owner)||this.busy!==token)return {ok:false,stale:true};this.apply(data,stamp,epoch,owner);
        if(!this.match&&data.intent?.requestId===intent.requestId&&['cancelled','expired'].includes(data.intent.state)){this.queueIntent=null;this.queue=null;this.saveRecovery();this.signal();}
        return {ok:true,matched:!!this.match,cancelled:!this.queued()&&!this.match};
      },{replace:this.busy?.kind==='queue'});
    }
    async submit(orders){
      const match=this.match;if(!match||match.state!=='battle'||match.submitted[match.side])return fail('相手の行動を待っています。');
      const validation=this.rules.hydrate(match.battle).validate(match.side,orders);if(!validation.ok)return fail(validation.error||'技か交代先を選んでください。');
      return this.run('action',async()=>{
        const key=JSON.stringify(orders);
        if(this.actionIntent&&JSON.stringify(this.actionIntent.orders)!==key)throw Error('先の行動の送信結果を確認しています。同じ行動で再確認してください。');
        this.actionIntent??={matchId:match.id,round:match.round,requestId:this.uuid(),orders:copy(orders)};this.saveRecovery();this.signal();
        const epoch=this.epoch,owner=this.owner,stamp=++this.ticket,intent=copy(this.actionIntent);
        const data=await this.request('/world/ranked/matches/'+match.id+'/actions',{method:'POST',body:{round:intent.round,orders:intent.orders,requestId:intent.requestId}});
        if(!this.valid(epoch,owner))return {ok:false,stale:true};this.apply(data,stamp,epoch,owner);return {ok:true};
      });
    }
    async forfeit(){
      const match=this.match;if(!match||match.state!=='battle')return fail('対戦は終了しています。');
      return this.run('forfeit',async()=>{const epoch=this.epoch,owner=this.owner,stamp=++this.ticket,data=await this.request('/world/ranked/matches/'+match.id+'/forfeit',{method:'POST',body:{}});if(!this.valid(epoch,owner))return {ok:false,stale:true};this.apply(data,stamp,epoch,owner);return {ok:true};},{replace:this.busy?.kind==='action'});
    }
    async acknowledge(){
      const match=this.match;if(!match||match.state!=='result')return fail('対戦の終了を確認してください。');
      return this.run('ack',async()=>{const epoch=this.epoch,owner=this.owner,stamp=++this.ticket,data=await this.request('/world/ranked/matches/'+match.id+'/ack',{method:'POST',body:{}});if(!this.valid(epoch,owner))return {ok:false,stale:true};this.apply(data,stamp,epoch,owner);return {ok:true};});
    }
    async loadPanels(){
      if(this.panelsLoading||!this.enabled())return;const marker={};this.panelsLoading=marker;
      try{
        const owner=await this.identity();if(this.panelsLoading!==marker||!owner||!this.enabled())return;const epoch=this.epoch;
        const results=await Promise.allSettled([this.request('/world/ranked/history'),this.request('/world/ranked/leaderboard')]);
        if(!this.valid(epoch,owner)||this.panelsLoading!==marker)return;
        if(results[0].status==='fulfilled'&&Array.isArray(results[0].value?.history))this.history=copy(results[0].value.history.slice(0,20));
        if(results[1].status==='fulfilled'&&Array.isArray(results[1].value?.players))this.leaderboard=copy(results[1].value.players.slice(0,50));
        this.panelsError=results.some(result=>result.status==='rejected')?'順位・履歴を更新できませんでした。再読み込みできます。':'';this.signal();
      }catch(error){if(this.panelsLoading===marker){this.panelsError=error?.message||'順位・履歴を更新できませんでした。';this.signal();}}
      finally{if(this.panelsLoading===marker)this.panelsLoading=null;}
    }
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={RankedBattleController,KEY,reasonText};
  LT.RankedBattleController=RankedBattleController;
  if(!root.document?.createElement||!LT.RankedRules)return;
  const document=root.document,rules=LT.RankedRules,bridge=()=>LT.adminBridge||{},engine=()=>bridge().getEngine?.();
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const name=mon=>{
    const legacy=!LT.DATA?.species?.[mon?.species]&&LT.LegacyBattles?.species?.(mon?.species);
    return mon?.nickname||legacy?.name||LT.displayName?.(mon)||LT.DATA?.species?.[mon?.species]?.name||'パチモン';
  };
  const label=mon=>name(mon)+(mon?.gender==='male'?' ♂':mon?.gender==='female'?' ♀':'')+(mon?.shiny?' ★':'');
  const delta=value=>Number.isFinite(value)?(value>0?'+':'')+value:'—';
  const outcomeName=value=>({win:'勝利',loss:'敗北',draw:'引き分け',void:'無効試合'}[value]||'対戦終了');
  const statNames={hp:'体力',atk:'こうげき',def:'ぼうぎょ',spAtk:'とくこう',spDef:'とくぼう',speed:'すばやさ',accuracy:'めいちゅう',evasion:'かいひ'};
  let storage;try{storage=root.localStorage;}catch(_){}
  let dialog=null,wanted=false,roster=[],picks=['','',''],queries=['','',''],selected=null,selectionRound='',showBench=false,leaveReview=false;
  let paintKey='',frame=0,timer=null,playback=false,lastShown=-1,lastActor='',lastEvent='',rosterError='';
  const controller=new RankedBattleController({
    request:(path,options)=>LT.Admin.worldRequest(path,options),identify:options=>LT.Admin.tradeIdentity(options),getIdentity:()=>LT.Admin?.player,getEngine:engine,
    canEnter:()=>bridge().canEnterRanked?.()===true,canResume:()=>typeof bridge().canResumeRanked==='function'?bridge().canResumeRanked()===true:bridge().canEnterRanked?.()===true,setScene:(snapshot,side,id)=>bridge().setRankedBattle?.(snapshot,side,id)===true,
    rules,storage,enabled,changed:()=>render(),notify:message=>bridge().toast?.(message)
  });
  function available(){return bridge().isPlaying?.()===true&&typeof LT.Admin?.worldRequest==='function';}
  function enabled(){return available()&&!document.hidden&&root.navigator?.onLine!==false;}
  function emit(){
    const detail={isOpen:dialog?.open===true,queued:controller.queued(),active:controller.active(),locked:controller.locked(),available:available()},key=JSON.stringify(detail);
    if(key===lastEvent)return;lastEvent=key;document.dispatchEvent(new CustomEvent('pachi-ranked-state',{detail}));
  }
  function viewport(){if(!dialog)return;const view=root.visualViewport;dialog.style.setProperty('--ranked-viewport-height',(view?.height||root.innerHeight||800)+'px');dialog.style.setProperty('--ranked-viewport-top',(view?.offsetTop||0)+'px');}
  function mount(){
    if(dialog)return;dialog=document.createElement('dialog');dialog.id='ranked-battle-dialog';dialog.className='ranked-battle-dialog';dialog.setAttribute('aria-labelledby','ranked-title');document.body.append(dialog);
    dialog.addEventListener('click',click);dialog.addEventListener('input',input);dialog.addEventListener('change',change);
    dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
    dialog.addEventListener('close',()=>{if(dialog.open)return;if(controller.locked()){wanted=true;render();}else{wanted=false;emit();}});
    viewport();
  }
  function readRoster(){
    if(controller.locked()){
      const lockedTeam=controller.queue?.team||controller.queueIntent?.team;
      if(lockedTeam?.length===3){roster=lockedTeam.map(mon=>({mon:copy(mon),where:'参加中',preview:rules.previewMember(mon)}));picks=roster.map(row=>row.mon.uid);}
      return;
    }
    rosterError='';const seen=new Set();
    try{roster=(bridge().getRankedRoster?.()||[]).filter(row=>row?.mon&&typeof row.mon.uid==='string'&&!seen.has(row.mon.uid)&&seen.add(row.mon.uid)).map(row=>{
      try{return {...row,mon:copy(row.mon),preview:rules.previewMember(row.mon)};}catch(error){return {...row,mon:copy(row.mon),error:error?.message||'能力値を確認できません。'};}
    });}catch(error){roster=[];rosterError=error?.message||'所持パチモンを読み込めませんでした。';}
    const used=new Set();picks=picks.map(uid=>{const row=roster.find(item=>item.mon.uid===uid&&!item.error);if(!row||used.has(row.mon.species))return '';used.add(row.mon.species);return uid;});
    picks=picks.map(uid=>{if(uid)return uid;const row=roster.find(item=>!item.error&&!used.has(item.mon.species));if(!row)return '';used.add(row.mon.species);return row.mon.uid;});
  }
  const selectedTeam=()=>picks.map(uid=>roster.find(row=>row.mon.uid===uid)?.mon).filter(Boolean);
  function optionsMarkup(slot){
    const text=queries[slot].normalize('NFKC').toLocaleLowerCase(),used=new Set(picks.filter((_,index)=>index!==slot).map(uid=>roster.find(row=>row.mon.uid===uid)?.mon.species));
    return '<option value="">選んでください</option>'+roster.filter(row=>row.mon.uid===picks[slot]||[name(row.mon),LT.DATA.species[row.mon.species]?.name,row.where,(LT.TypeSystem?.of?.(row.mon)||[]).map(type=>LT.DATA.elements[type]?.name).join(' ')].join(' ').normalize('NFKC').toLocaleLowerCase().includes(text)).map(row=>`<option value="${esc(row.mon.uid)}" ${row.mon.uid===picks[slot]?'selected':''} ${row.error||used.has(row.mon.species)?'disabled':''}>${esc(label(row.mon))} · ${esc(row.where)} Lv.${row.mon.level}${row.error?'（確認が必要）':''}</option>`).join('');
  }
  function memberDetails(row,index){
    if(!row?.preview)return `<p class="ranked-note">${esc(row?.error||'仲間を選んでください。')}</p>`;
    const mon=row.preview,held=LT.DATA.heldItems?.[mon.heldItem],moves=rules.moves(mon),allocation=Object.entries(mon.alloc||{}).filter(([,points])=>points>0).map(([key,points])=>`${statNames[key]||key}+${points}`).join(' / '),growth=mon.battleGrowth||0;
    return `<details class="ranked-mon-details" data-ranked-details="${index}"><summary aria-label="${esc(name(mon))}の能力・持ち物・技を確認">詳細</summary><p>Lv.${row.mon.level} → 対戦 Lv.50</p><dl class="ranked-mon-stats">${Object.entries(statNames).map(([key,title])=>`<dt>${title}</dt><dd>${mon.stats[key]??'—'}</dd>`).join('')}</dl><p>振り分け：${esc(allocation||'なし')}</p><p>実戦成長：${growth}回${growth?`（HP+${growth*2}、攻撃・防御・特攻・特防・素早さ 各+${growth}）`:''}。Lv.50でも全累積分を反映。</p><p>持ち物：${esc(held?.name||'なし')}</p><ol>${moves.map(move=>`<li>${esc(move.name)}<br>PP ${move.maxPP}${move.power?' · 威力 '+move.power:''}</li>`).join('')}</ol><p>体力・PPは全回復。冒険の育成・実戦成長・持ち物・技順を反映します。</p></details>`;
  }
  function ratingMarkup(){
    const profile=controller.profile,rating=profile?.rating??info(rules).initialRating,tier=rules.rankForRating(rating);
    return `<section class="ranked-rating" aria-label="あなたのランク"><h3>${esc(profile?.name||LT.Admin?.player?.name||'あなた')} のランク</h3><strong class="ranked-tier">${esc(tier.name)}</strong><strong class="ranked-rating-value">${rating}<small>RP</small></strong><span class="ranked-progress" role="progressbar" aria-label="次のランクへの進み具合" aria-valuenow="${Math.round(tier.progress*100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${tier.progress*100}%"></i></span><div class="ranked-record"><span>${profile?.wins||0}勝 ${profile?.losses||0}敗 ${profile?.draws||0}分</span><span>${profile?.games||0}試合</span></div><p>${tier.nextMinRating===null?'最高ランクに到達しています。':`次のランクまで ${Math.max(0,tier.nextMinRating-rating)} RP`}</p></section>`;
  }
  function panelsMarkup(){
    return `<aside class="ranked-sidebar"><section class="ranked-rules"><h3>ランクバトルのルール</h3><ul><li>手持ち・ひかえから異なる種類の3体。</li><li>全員Lv.50。育成値・持ち物・技順を反映。</li><li>体力とPPは全回復して開始。冒険の状態は変わりません。</li><li>マッチすると、そのまま対戦画面が開きます。</li><li>1ターン90秒。接続切れが60秒続くと敗北になる場合があります。</li><li>初期1000 RP。相手のレートに応じて勝敗を反映します。</li></ul></section><section class="ranked-leaderboard"><h3>ランキング</h3>${controller.leaderboard.length?`<ol>${controller.leaderboard.map(person=>`<li class="${person.playerId===controller.owner?'is-me':''}"><span class="ranked-position">${Number.isSafeInteger(person.rank)?person.rank:'—'}</span><span class="ranked-player-name">${esc(person.name)}</span><span class="ranked-score">${esc(person.rating)} RP</span></li>`).join('')}</ol>`:'<p class="ranked-empty">試合を終えたプレイヤーの順位が表示されます。</p>'}</section><section class="ranked-history"><h3>最近の対戦</h3>${controller.history.length?`<ol>${controller.history.map(row=>`<li><span class="ranked-player-name">${esc(row.opponent?.name)}<br><time>${esc(new Date(row.playedAt).toLocaleDateString('ja-JP',{month:'numeric',day:'numeric'}))}</time></span><span class="ranked-outcome" data-outcome="${esc(row.outcome)}">${esc(outcomeName(row.outcome))}<br>${delta(row.ratingDelta)} RP</span></li>`).join('')}</ol>`:'<p class="ranked-empty">まだ対戦の記録はありません。</p>'}</section><p class="ranked-error" role="status">${esc(controller.panelsError)}</p><button class="btn" type="button" data-ranked-action="panels">順位・履歴を更新</button></aside>`;
  }
  function header(title,subtitle,closeLabel='閉じる'){return `<header class="ranked-header"><div><p>${esc(subtitle)}</p><h2 id="ranked-title">${esc(title)}</h2></div><button type="button" class="btn" data-ranked-action="close">${closeLabel}</button></header>`;}
  function lobbyMarkup(){
    const locked=controller.locked(),check=rules.validateTeam(selectedTeam()),waiting=controller.queued(),uncertain=controller.queueIntent&&!controller.queue;
    const status=controller.error||rosterError||(waiting?controller.queueIntent?.phase==='cancelling'?'待機の取り消しを確認しています。':uncertain?'参加の結果を再確認できます。チームは保存されています。':'対戦相手を探しています。成立すると自動で対戦を始めます。':!controller.known?'ランクと対戦状況を確認しています。':check.ok?'3体の準備ができました。先頭の仲間から出場します。':check.error);
    return header('ランクバトル','3対3 · 所持パチモン · Lv.50')+`<div class="ranked-body"><div class="ranked-lobby"><main class="ranked-main">${ratingMarkup()}<h3>出場する3体</h3><div class="ranked-roster">${picks.map((uid,index)=>{
      const row=roster.find(item=>item.mon.uid===uid),mon=row?.mon;
      return `<section class="ranked-slot ${row&&!row.error?'':'is-invalid'}" aria-label="出場枠${index+1}"><div class="ranked-mon ${row?'is-selected':''}"><span class="ranked-mon-order">${index+1}</span>${mon?`<canvas width="112" height="112" data-ranked-creature="${esc(mon.species)}" data-ranked-shiny="${mon.shiny===true}" aria-label="${esc(name(mon))}"></canvas><strong class="ranked-mon-name">${esc(label(mon))}</strong><span class="ranked-mon-meta">${esc(row.where)} · Lv.50</span>`:'<strong class="ranked-mon-name">未選択</strong>'}</div><label>名前で検索<input class="ranked-search" data-ranked-search="${index}" type="search" value="${esc(queries[index])}" autocomplete="off" placeholder="パチモン名" ${locked?'disabled':''}></label><label>仲間を選択<select class="ranked-select" data-ranked-team="${index}" aria-label="出場枠${index+1}のパチモン" ${locked?'disabled':''}>${optionsMarkup(index)}</select></label>${memberDetails(row,index)}</section>`;
    }).join('')}</div><p class="ranked-selection">${roster.length?'先頭が最初に出場します。能力や持ち物は「詳細」で確認できます。':'冒険で異なる種類のパチモンを3体集めてから参加できます。'}</p>${uncertain&&controller.queueIntent.phase!=='cancelling'?`<button class="btn" type="button" data-ranked-action="queue-retry" ${controller.busy?'disabled':''}>同じチームで参加を再確認</button>`:''}</main>${panelsMarkup()}</div></div><footer class="ranked-footer"><p class="ranked-status" role="status">${esc(status)}</p>${waiting||controller.busy?.kind==='queue'?`<button type="button" class="btn ranked-danger" data-ranked-action="cancel" ${controller.busy&&controller.busy.kind!=='queue'?'disabled':''}>${controller.queueIntent?.phase==='cancelling'?'取り消しを再確認':'待機を取り消す'}</button>`:`<button type="button" class="btn btn-primary" data-ranked-action="queue" ${controller.busy||!controller.known||!check.ok?'disabled':''}>対戦相手を探す</button>`}</footer>`;
  }
  function hpCard(mon,which,side){const ratio=Math.max(0,Math.min(100,mon.hp/mon.maxHp*100));return `<article class="ranked-health ${which}" data-ranked-health="${side}"><div><span>${which==='foe'?'相手':'自分'} · Lv.50</span><strong data-ranked-name>${esc(label(mon))}</strong></div><div class="ranked-hp"><i style="width:${ratio}%"></i></div><small data-ranked-hp>${Number.isFinite(mon.displayHp)?mon.displayHp:Math.ceil(mon.hp)} / ${mon.maxHp}</small></article>`;}
  function stock(team){return team.monsters.map(mon=>`<span class="${mon.hp>0?'':'fainted'}" title="${esc(name(mon))}" aria-label="${esc(name(mon))} ${mon.hp>0?'戦闘可能':'戦闘不能'}"></span>`).join('');}
  function battleMarkup(match){
    const battle=match.battle,side=match.side,duel=rules.hydrate(battle),me=battle.teams[side],foe=battle.teams[1-side],mon=me.monsters[me.active[0]],finished=match.state==='result'&&!playback;
    const now=root.performance.now(),shown=LT.BattleVFX?.onlineView?.(battle,now)||battle,key=[match.id,battle.round,battle.phase].join(':');
    if(selectionRound!==key){selectionRound=key;selected=null;showBench=battle.phase==='replacement';leaveReview=false;}
    const wait=match.submitted[side],locked=!!controller.busy||wait||playback||!!controller.actionIntent||match.state==='result',choices=duel.moves(mon),replacement=battle.phase==='replacement',need=duel.replacementSlots(side).length>0;
    let commands;
    if(showBench||replacement&&need)commands=`<div class="ranked-bench">${me.monsters.map((member,index)=>`<button type="button" data-ranked-action="switch" data-index="${index}" ${locked||member.hp<=0||me.active.includes(index)?'disabled':''} aria-pressed="${selected?.type==='switch'&&selected.index===index}"><strong>${esc(label(member))}</strong><span>体力 ${member.hp}/${member.maxHp}</span>${me.active.includes(index)?'<small>出場中</small>':''}</button>`).join('')}</div>${!replacement?`<button type="button" class="btn" data-ranked-action="moves" ${locked?'disabled':''}>技を選ぶ</button>`:''}`;
    else commands=`${mon.rechargeTurns>0?'<p class="ranked-note">技の反動でこのターンは休みます。選んだ技のPPは減りません。</p>':''}<div class="ranked-moves">${choices.map((move,index)=>`<button type="button" data-ranked-action="move" data-index="${index}" ${locked||move.pp<=0?'disabled':''} aria-pressed="${selected?.type==='move'&&selected.move===index}"><strong>${esc(move.name)}</strong><span>${esc(LT.DATA.elements[move.element]?.name||'無')} · ${move.category==='special'?'特殊':move.category==='status'||move.kind!=='attack'?'変化':'物理'}</span><small>PP ${move.pp}/${move.maxPP}${move.power>0?' · 威力 '+move.power:''}</small></button>`).join('')}${duel.canStruggle(mon)?`<button type="button" data-ranked-action="struggle" ${locked?'disabled':''} aria-pressed="${selected?.type==='struggle'}"><strong>踏ん張り打ち</strong><small>PP切れの攻撃 · 反動あり</small></button>`:''}</div><button type="button" class="btn" data-ranked-action="bench" ${locked?'disabled':''}>パチモンを交代</button>`;
    const selectedName=selected?.type==='move'?choices[selected.move]?.name:selected?.type==='switch'?name(me.monsters[selected.index])+'に交代':selected?.type==='struggle'?'踏ん張り打ち':'';
    const ready=selected?duel.validate(side,[selected]).ok:replacement&&!need;
    let panel;
    if(finished){const result=match.result,before=result.ratingBefore[side],after=result.ratingAfter[side],change=result.ratingDelta[side],tier=rules.rankForRating(after);panel=`<section class="ranked-result"><h3 class="ranked-result-title">${esc(outcomeName(result.outcome))}</h3><p>${esc(reasonText(result.reason))}</p><strong class="ranked-result-delta ${change>0?'is-positive':change<0?'is-negative':''}">${delta(change)} RP</strong><p class="ranked-result-rating">${before} → ${after} RP<br>${esc(tier.name)}</p><p>対戦結果を記録しました。冒険の仲間はそのままです。</p><button type="button" class="btn btn-primary" data-ranked-action="ack" ${controller.busy?'disabled':''}>ランクの画面に戻る</button></section>`;}
    else if(leaveReview)panel=`<section class="ranked-command"><div class="ranked-leave" role="alert"><h3>降参しますか？</h3><p>この対戦は敗北となり、レートに反映されます。</p><div><button type="button" class="btn" data-ranked-action="stay" ${controller.busy?'disabled':''}>対戦を続ける</button><button type="button" class="btn ranked-danger" data-ranked-action="confirm-forfeit" ${controller.busy&&controller.busy.kind!=='action'?'disabled':''}>降参する</button></div></div></section>`;
    else if(playback)panel='<section class="ranked-command"><h3>エフェクトを再生中…</h3><p class="ranked-note">このターンの動きと体力の変化を確認しています。</p></section>';
    else panel=`<section class="ranked-command"><h3>${replacement?'次の仲間を選ぶ':'このターンの行動'}</h3>${replacement&&!need?'<p>相手が次に出す仲間を選んでいます。</p>':commands}<div class="ranked-selection">${selectedName?esc(selectedName)+' を選択中':replacement&&!need?'相手の交代を確認してください。':'技か交代先を選んでください。'}</div><p class="ranked-note">${match.submitted[1-side]?'相手は行動を確定しています。':'相手の選択は、双方の確定後に公開されます。'}</p></section>`;
    const footerAction=match.state==='battle'&&!playback&&!leaveReview?(controller.actionIntent&&!wait?`<button type="button" class="btn btn-primary" data-ranked-action="retry" ${controller.busy?'disabled':''}>同じ行動で再確認</button>`:`<button type="button" class="btn btn-primary" data-ranked-action="submit" ${locked||!ready?'disabled':''}>${wait?'相手の行動待ち':replacement?'交代を確定':'行動を確定'}</button>`):'';
    const progress=playback?LT.BattleVFX?.onlineProgress?.(battle,now):null,log=battle.log||[],visible=progress?log.slice(0,Math.max(0,log.length-Math.max(0,progress.total-progress.shown))):log;lastShown=progress?.shown??-1;
    return header(finished?'ランクバトルの結果':`TURN ${battle.turn} · ランクバトル`,'3対3 · Lv.50',finished?'閉じる':'降参')+`<div class="ranked-body"><div class="ranked-versus"><div>${esc(match.players[side].name)}<small data-ranked-stock="${side}">${stock(shown.teams[side])}</small></div><b>VS</b><div>${esc(match.players[1-side].name)}<small data-ranked-stock="${1-side}">${stock(shown.teams[1-side])}</small></div></div><div class="ranked-layout"><section class="ranked-arena" aria-label="ランク対戦の場">${hpCard(shown.teams[1-side].monsters[shown.teams[1-side].active[0]],'foe',1-side)}<canvas id="ranked-canvas" width="768" height="400" aria-label="双方1体ずつの対戦画面"></canvas>${hpCard(shown.teams[side].monsters[shown.teams[side].active[0]],'ally',side)}</section>${panel}</div><div class="ranked-log" role="log" aria-label="対戦ログ" aria-live="polite">${visible.slice(-5).map(line=>`<p>${esc(typeof line==='string'?line:line.text||line.message||'')}</p>`).join('')}</div></div><footer class="ranked-footer${match.state==='battle'?' ranked-battle-footer':''}"><p class="ranked-status" role="status">${esc(controller.error||'')}${!controller.error&&!finished?'<span data-ranked-countdown>行動期限まで '+controller.state().remaining+'秒</span>':''}</p>${footerAction}</footer>`;
  }
  function render(){
    if(controller.owner!==lastActor){lastActor=controller.owner;picks=['','',''];queries=['','',''];roster=[];selected=null;selectionRound='';leaveReview=false;}
    if(!available()||!wanted&&!controller.locked()){if(dialog?.open)dialog.close();root.cancelAnimationFrame(frame);emit();return;}
    if(controller.match&&controller.sceneId!==controller.match.id){emit();return;}
    mount();if(!controller.match)readRoster();
    playback=!!controller.match&&!!LT.BattleVFX?.onlineBusy?.(controller.match.battle,root.performance.now());
    const view=controller.match?controller.match.state==='result'&&!playback?'result':'battle':controller.queued()||controller.busy?.kind==='queue'?'queue':'lobby';
    const key=JSON.stringify([view,controller.owner,controller.profile,controller.queueIntent,controller.match,controller.busy?.kind,controller.actionIntent,controller.known,controller.error,controller.panelsError,controller.history,controller.leaderboard,picks,roster,selected,showBench,leaveReview,playback]);
    if(key!==paintKey){
      const active=document.activeElement,focused=dialog.contains?.(active),focusData=focused?{search:active.dataset?.rankedSearch,team:active.dataset?.rankedTeam,action:active.dataset?.rankedAction,index:active.dataset?.index,start:active.selectionStart,end:active.selectionEnd}:null;
      const matchId=controller.match?.id||'',sameView=dialog.dataset.rankedView===view&&dialog.dataset.rankedMatchId===matchId;
      const body=dialog.querySelector('.ranked-body'),scroll=sameView?body?.scrollTop||0:0,commandScroll=sameView?dialog.querySelector('.ranked-command')?.scrollTop||0:0,openDetails=new Set([...dialog.querySelectorAll('[data-ranked-details][open]')].map(node=>node.dataset.rankedDetails));
      paintKey=key;dialog.dataset.rankedView=view;dialog.dataset.rankedMatchId=matchId;dialog.innerHTML=controller.match?battleMarkup(controller.match):lobbyMarkup();
      if(dialog.querySelector('.ranked-body'))dialog.querySelector('.ranked-body').scrollTop=scroll;
      if(dialog.querySelector('.ranked-command'))dialog.querySelector('.ranked-command').scrollTop=commandScroll;
      for(const node of dialog.querySelectorAll('[data-ranked-details]'))if(openDetails.has(node.dataset.rankedDetails))node.open=true;
      for(const canvas of dialog.querySelectorAll('[data-ranked-creature]'))LT.Art?.creature?.(canvas,canvas.dataset.rankedCreature,{shiny:canvas.dataset.rankedShiny==='true',motion:'idle'});
      if(focusData){let target;if(focusData.search!==undefined)target=dialog.querySelector(`[data-ranked-search="${Number(focusData.search)}"]`);else if(focusData.team!==undefined)target=dialog.querySelector(`[data-ranked-team="${Number(focusData.team)}"]`);else if(focusData.action)target=[...dialog.querySelectorAll('[data-ranked-action]')].find(node=>node.dataset.rankedAction===focusData.action&&node.dataset.index===focusData.index);if(target&&!target.disabled){target.focus?.({preventScroll:true});if(focusData.start!==null&&focusData.start!==undefined)try{target.setSelectionRange(focusData.start,focusData.end);}catch(_){}}}
    }
    viewport();if(!dialog.open)dialog.showModal();emit();startDraw();
  }
  function startDraw(){root.cancelAnimationFrame(frame);if(dialog?.open&&!document.hidden)frame=root.requestAnimationFrame(draw);}
  function draw(now){
    if(!dialog?.open||document.hidden)return;
    const match=controller.match,canvas=dialog.querySelector('#ranked-canvas');
    if(match&&canvas){
      LT.PixelSprites?.duel?.(canvas,match.battle,match.side,now);const shown=LT.BattleVFX?.onlineView?.(match.battle,now)||match.battle;
      for(const card of dialog.querySelectorAll('[data-ranked-health]')){const side=Number(card.dataset.rankedHealth),team=shown.teams[side],mon=team?.monsters[team.active[0]];if(!mon)continue;const fill=card.querySelector('.ranked-hp i'),hp=card.querySelector('[data-ranked-hp]'),title=card.querySelector('[data-ranked-name]');if(fill)fill.style.width=Math.max(0,Math.min(100,mon.hp/mon.maxHp*100))+'%';if(hp)hp.textContent=(Number.isFinite(mon.displayHp)?mon.displayHp:Math.ceil(mon.hp))+' / '+mon.maxHp;if(title)title.textContent=label(mon);}
      for(const node of dialog.querySelectorAll('[data-ranked-stock]')){const team=shown.teams[Number(node.dataset.rankedStock)],key=team.monsters.map(mon=>mon.hp>0?1:0).join('');if(node.dataset.health!==key){node.dataset.health=key;node.innerHTML=stock(team);}}
      const next=!!LT.BattleVFX?.onlineBusy?.(match.battle,now),progress=next?LT.BattleVFX?.onlineProgress?.(match.battle,now):null;
      if(next!==playback||(progress?.shown??-1)!==lastShown){playback=next;paintKey='';render();return;}
      const countdown=dialog.querySelector('[data-ranked-countdown]'),countdownText='行動期限まで '+controller.state().remaining+'秒';if(countdown&&countdown.textContent!==countdownText)countdown.textContent=countdownText;
    }
    frame=root.requestAnimationFrame(draw);
  }
  function input(event){const index=event.target?.dataset?.rankedSearch;if(index===undefined||controller.locked())return;const slot=Number(index);if(!Number.isInteger(slot)||slot<0||slot>2)return;queries[slot]=event.target.value;const select=dialog.querySelector(`[data-ranked-team="${slot}"]`);if(select)select.innerHTML=optionsMarkup(slot);}
  function change(event){const index=event.target?.dataset?.rankedTeam;if(index===undefined||controller.locked())return;const slot=Number(index),row=roster.find(item=>item.mon.uid===event.target.value);if(!Number.isInteger(slot)||slot<0||slot>2||row?.error)return;picks[slot]=row?.mon.uid||'';controller.error='';controller.errorKind='';paintKey='';render();}
  async function click(event){
    const button=event.target.closest?.('[data-ranked-action]');if(!button||button.disabled)return;const action=button.dataset.rankedAction;
    if(action==='close'){closeDialog();return;}
    if(action==='panels'){await controller.loadPanels();return;}
    if(action==='queue'||action==='queue-retry'){await controller.join(action==='queue-retry'?copy(controller.queueIntent?.team||[]):copy(selectedTeam()));schedule(0);return;}
    if(action==='cancel'){await controller.cancel();schedule(0);return;}
    if(action==='ack'){if((await controller.acknowledge()).ok){wanted=true;paintKey='';render();void controller.loadPanels();}schedule(0);return;}
    if(action==='stay'){leaveReview=false;paintKey='';render();return;}
    if(action==='confirm-forfeit'){if((await controller.forfeit()).ok)leaveReview=false;paintKey='';render();schedule(0);return;}
    if(action==='retry'){if(controller.actionIntent)await controller.submit(copy(controller.actionIntent.orders));schedule(0);return;}
    const match=controller.match;if(!match||match.state!=='battle'||controller.busy||match.submitted[match.side]||controller.actionIntent||playback||leaveReview)return;
    const index=Number(button.dataset.index);
    if(action==='move')selected={type:'move',slot:0,move:index,target:0};
    if(action==='struggle')selected={type:'struggle',slot:0,target:0};
    if(action==='switch')selected={type:'switch',slot:0,index};
    if(action==='bench')showBench=true;if(action==='moves')showBench=false;
    if(action==='submit'){const duel=rules.hydrate(match.battle),orders=selected?[copy(selected)]:match.battle.phase==='replacement'&&!duel.replacementSlots(match.side).length?[]:null;if(orders)await controller.submit(orders);schedule(0);return;}
    render();
  }
  async function finishClose(){
    const result=controller.match?.state==='result'?await controller.acknowledge():await controller.cancel();
    if(result.ok&&!controller.locked()){wanted=false;leaveReview=false;paintKey='';dialog?.close();render();}schedule(0);
  }
  function closeDialog(){
    if(!dialog?.open)return false;
    if(controller.match?.state==='battle'){leaveReview=!leaveReview;paintKey='';render();return true;}
    if(controller.busy&&controller.busy.kind!=='queue')return false;
    if(controller.locked()){void finishClose();return true;}
    wanted=false;dialog.close();root.cancelAnimationFrame(frame);emit();schedule();return true;
  }
  async function refresh(){if(!enabled())return {ok:true,skipped:true};const result=await controller.refresh();render();return result;}
  function schedule(delay){root.clearTimeout(timer);timer=null;if(!enabled())return;timer=root.setTimeout(async()=>{timer=null;await refresh();schedule();},delay??(wanted||controller.locked()?2000:20000));}
  async function open(){
    if(!available())return fail('冒険を再開してからランクバトルを開いてください。');
    if(!controller.active()&&!bridge().canEnterRanked?.())return fail('現在の対戦や交換を終えてから開いてください。');
    wanted=true;paintKey='';render();const result=await refresh();if(wanted&&!controller.active())void controller.loadPanels();schedule();return result;
  }
  LT.Ranked={open,isDialogOpen:()=>dialog?.open===true,closeDialog,isLocked:()=>controller.locked(),isWorking:()=>!!controller.busy,state:()=>controller.state(),refresh,session:()=>controller.match};
  document.addEventListener('pachi-game-ready',()=>{wanted=false;roster=[];picks=['','',''];controller.reset();paintKey='';schedule(0);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){root.clearTimeout(timer);root.cancelAnimationFrame(frame);}else{render();schedule(0);}});
  document.addEventListener('pachi-online-state',()=>schedule(0));
  root.addEventListener('online',()=>schedule(0));root.addEventListener('offline',()=>{root.clearTimeout(timer);if(controller.locked()){controller.error='接続が切れました。再接続後に対戦状況を確認します。';controller.errorKind='poll';render();}});
  root.addEventListener('storage',event=>{if(event.key==='pachi-player-identity-v1'){wanted=false;controller.reset();paintKey='';schedule(0);}});
  root.addEventListener('resize',viewport);root.visualViewport?.addEventListener('resize',viewport);root.visualViewport?.addEventListener('scroll',viewport);
  schedule(1000);
})();
