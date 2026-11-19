/* Pachi Monsters — a consented, server-authoritative duel with the real Kasai. */
(() => {
  'use strict';
  const root=globalThis,LT=root.LT=root.LT||{},PLAYER=/^P[0-9a-f]{16}$/,ACTIVE=new Set(['staging','permission','battle','result']);
  const copy=value=>JSON.parse(JSON.stringify(value)),failure=message=>({ok:false,message});
  const hostName=s=>s?.kasai?.adminRole==='sub'?'サカイ':s?.kasai?.adminRole==='sub-sub'?'イサカ':'カサイ';
  const reasonText=reason=>({talk_timeout:'60秒以内に話しかけられなかったため、フィールドへ戻りました。',declined:'運営が今回の対戦を見送りました。フィールドへ戻りました。',challenger_left:'挑戦者が退出したため、フィールドへ戻りました。',disconnected:'接続が切れたため、対戦を終了してフィールドへ戻りました。',connection_lost:'接続を確認できないため、フィールドへ戻りました。',kasai_changed:'運営が切り替わったため、フィールドへ戻りました。',role_changed:'運営が切り替わったため、フィールドへ戻りました。',battle_error:'対戦の状態を確認できなかったため、フィールドへ戻りました。',unavailable:'現在は対戦を始められません。フィールドへ戻りました。'}[String(reason||'').replaceAll('-','_')]||'運営のステージを退出しました。');
  class KasaiLiveController {
    constructor({request,identify,getEngine,getParty,canEnter,stage,restore,enforce=()=>{},refreshPresence=async()=>{},claimReward=async()=>({ok:true}),rules=LT.KasaiLiveRules,enabled=()=>true,uuid=()=>crypto.randomUUID(),clock=()=>Date.now(),changed=()=>{},notify=()=>{}}){
      Object.assign(this,{request,identify,getEngine,getParty,canEnter,stage,restore,enforce,refreshPresence,claimReward,rules,enabled,uuid,clock,changed,notify});
      this.live=null;this.owner=null;this.stagedId=null;this.stageEngine=null;this.entryParty=null;this.busy=false;this.joining=false;this.polling=null;
      this.error='';this.epoch=0;this.ticket=0;this.appliedTicket=0;this.serverOffset=0;this.lastSeenAt=0;this.pendingCreate=null;this.actionIntent=null;this.restored=new Set();
    }
    active(){return !!this.live&&ACTIVE.has(this.live.state);}
    side(){return this.live?.role==='kasai'?1:0;}
    state(){return {session:this.live,busy:this.busy||this.joining,error:this.error,pendingAction:this.actionIntent,remaining:Math.max(0,Math.ceil(((this.live?.deadlineAt||0)-(this.clock()+this.serverOffset))/1000))};}
    signal(){this.changed(this.state());}
    reset(){
      const prior=this.live,sameStage=prior&&this.stageEngine&&this.stageEngine===this.getEngine()&&this.getEngine()?.state.map==='room:'+prior.roomId;
      this.epoch++;this.live=null;this.owner=null;this.stagedId=null;this.stageEngine=null;this.entryParty=null;this.actionIntent=null;this.pendingCreate=null;this.error='';this.signal();
      if(sameStage){try{this.restore(prior.returnPosition);}catch(_){}}
    }
    async identity(fresh=false){
      const player=await this.identify({fresh});if(!PLAYER.test(player?.id||''))throw Error('プレイヤー情報を確認できません。');
      if(this.owner&&this.owner.id!==player.id)this.reset();
      this.owner={id:player.id,isAdmin:player.isAdmin===true};return this.owner;
    }
    valid(epoch,owner){return epoch===this.epoch&&owner===this.owner?.id;}
    async run(operation){
      if(this.busy||this.joining)return failure('通信の結果を確認しています。');
      this.busy=true;this.error='';this.signal();
      try{return await operation();}
      catch(error){this.error=error?.message||'接続を確認してください。';this.signal();return failure(this.error);}
      finally{this.busy=false;this.signal();}
    }
    async requestChallenge(peerId){this.requesting=true;try{return await this.run(async()=>{
      const player=await this.identity(true);
      if(player.isAdmin||peerId===player.id)throw Error('運営は自分自身と対戦できません。');
      if(!PLAYER.test(peerId||''))throw Error('フィールドの運営トレーナーに話しかけてください。');
      if(this.active())throw Error('現在のステージを退出してから挑戦してください。');
      if(!this.canEnter())throw Error('現在の操作を終えてから、運営トレーナーに話しかけてください。');
      const party=this.getParty();if(!Array.isArray(party)||!party.length)throw Error('手持ちを保存してから挑戦してください。');
      const engine=this.getEngine(),map=engine?.state.map,epoch=this.epoch,owner=player.id;
      await this.refreshPresence();
      if(!this.valid(epoch,owner)||this.getEngine()!==engine||engine?.state.map!==map)throw Error('現在地が変わりました。もう一度相手に話しかけてください。');
      const serialized=JSON.stringify(party);
      if(!this.pendingCreate||this.pendingCreate.peerId!==peerId||this.pendingCreate.partyKey!==serialized)this.pendingCreate={peerId,partyKey:serialized,requestId:this.uuid()};
      const stamp=++this.ticket,response=await this.request('/world/kasai/live',{method:'POST',body:{requestId:this.pendingCreate.requestId,roomId:peerId,party:copy(party),storageCount:Math.min(192,engine.state.storage.length)}});
      if(!this.valid(epoch,owner))return failure('プレイヤーが切り替わりました。');
      await this.apply(response,stamp,epoch,owner);return {ok:true};
    });}finally{this.requesting=false;}}
    async refresh(){
      if(this.busy||this.joining||this.polling||!this.enabled())return {ok:true,skipped:true};
      const task=(async()=>{
        try{
          const player=await this.identity(),epoch=this.epoch,owner=player.id,stamp=++this.ticket;
          const response=await this.request('/world/kasai/live');
          if(!this.valid(epoch,owner))return {ok:true,stale:true};
          await this.apply(response,stamp,epoch,owner);return {ok:true};
        }catch(error){
          this.error=error?.message||'再接続しています…';
          if(this.active()&&this.lastSeenAt&&this.clock()-this.lastSeenAt>=30000)await this.returnFromSession({...this.live,state:'closed',reason:'connection_lost'},false);
          this.signal();return failure(this.error);
        }
      })();this.polling=task;try{return await task;}finally{if(this.polling===task)this.polling=null;}
    }
    async apply(response,stamp,epoch=this.epoch,owner=this.owner?.id){
      if(!this.valid(epoch,owner)||stamp<this.appliedTicket)return false;
      this.appliedTicket=stamp;this.lastSeenAt=this.clock();this.error='';
      if(Number.isFinite(response?.serverTime))this.serverOffset=response.serverTime-this.clock();
      const next=response?.session;
      if(!next){if(this.active())await this.returnFromSession({...this.live,state:'closed',reason:'disconnected'},false);else this.signal();return true;}
      if(typeof next.id!=='string'||!['challenger','kasai'].includes(next.role)||!PLAYER.test(next.roomId||'')||!ACTIVE.has(next.state)&&next.state!=='closed')throw Error('対戦の状況を確認できません。');
      const participant=next.role==='kasai'?next.kasai:next.challenger;
      if(participant?.id!==owner)throw Error('別のプレイヤーの対戦情報を受け取りました。');
      if(next.battle)this.rules.hydrate(next.battle);
      const previous=this.live;
      this.live=copy(next);this.pendingCreate=null;
      if(this.actionIntent&&(this.actionIntent.sessionId!==next.id||this.actionIntent.round!==next.round||next.submitted?.[this.side()]||next.state!=='battle'))this.actionIntent=null;
      if(next.state==='closed'){await this.returnFromSession(next,true);return true;}
      if(this.stagedId!==next.id){
        this.joining=true;this.signal();
        try{
          await this.identity(true);if(!this.valid(epoch,owner))return false;
          if(!this.canEnter())return this.declineUnavailable(next,epoch,owner);
          const party=next.role==='kasai'?this.getParty():null;
          if(next.role==='kasai'&&(!Array.isArray(party)||!party.length))return this.declineUnavailable(next,epoch,owner);
          const engine=this.getEngine(),roomResponse=await this.request('/world/rooms/'+next.roomId);
          if(!this.valid(epoch,owner)||stamp<this.appliedTicket||engine!==this.getEngine())return false;
          const entered=await this.stage(roomResponse.room,next);
          if(!this.valid(epoch,owner))return false;
          if(!entered?.ok){this.error=entered?.message||'ステージに入れませんでした。';return this.declineUnavailable(next,epoch,owner);}
          this.stagedId=next.id;this.stageEngine=engine;this.entryParty=party?copy(party):null;
        }finally{this.joining=false;}
      }
      this.enforce(this.live);this.signal();
      if(!next.arrived?.[this.side()]&&['staging','permission'].includes(next.state)){
        const body=next.role==='kasai'?{party:copy(this.entryParty||this.getParty())}:{};
        const arrived=await this.request('/world/kasai/live/'+encodeURIComponent(next.id)+'/arrive',{method:'POST',body});
        if(this.valid(epoch,owner))await this.apply(arrived,++this.ticket,epoch,owner);
      }
      if(previous?.id!==next.id)this.notify(next.role==='kasai'?`挑戦者と${hostName(next)}のステージへ移動しました。挑戦者の声かけをお待ちください。`:`60秒以内に、奥にいる${hostName(next)}へ話しかけてください。`);
      return true;
    }
    async declineUnavailable(session,epoch,owner){
      const action=session.role==='kasai'?'answer':'leave',body=session.role==='kasai'?{accept:false}:{};
      const response=await this.request('/world/kasai/live/'+encodeURIComponent(session.id)+'/'+action,{method:'POST',body});
      if(this.valid(epoch,owner))await this.apply(response,++this.ticket,epoch,owner);return false;
    }
    async returnFromSession(session,ack){
      this.live=copy(session);this.actionIntent=null;this.signal();
      if(!this.restored.has(session.id)){
        // Closed sessions discovered after a reload still carry a safe server
        // return point. Never restore an old live Engine after a new game starts.
        if(this.getEngine()?.state.map!=='room:'+session.roomId)this.restored.add(session.id);
        else if(!this.stageEngine||this.stageEngine===this.getEngine()){
          const result=await this.restore(session.returnPosition);
          if(result?.ok!==false){this.restored.add(session.id);this.notify(reasonText(session.reason));}
        }
      }
      this.stagedId=null;this.stageEngine=null;this.entryParty=null;
      if(ack&&this.restored.has(session.id)){
        const epoch=this.epoch,owner=this.owner?.id;
        try{await this.request('/world/kasai/live/'+encodeURIComponent(session.id)+'/ack',{method:'POST',body:{}});if(this.valid(epoch,owner)&&this.live?.id===session.id)this.live=null;}catch(error){this.error=error?.message||'退出の確認を再試行しています。';}
      }
      this.signal();
    }
    canTalk(){const e=this.getEngine(),s=this.live;return !!(s?.state==='staging'&&s.role==='challenger'&&s.arrived?.every(Boolean)&&e?.state.map==='room:'+s.roomId&&Math.abs(e.state.x-12)+Math.abs(e.state.y-4)===1);}
    async mutate(action,body={}){
      const session=this.live;if(!session)throw Error('現在の対戦を確認できません。');
      const epoch=this.epoch,owner=this.owner?.id,stamp=++this.ticket;
      const response=await this.request('/world/kasai/live/'+encodeURIComponent(session.id)+'/'+action,{method:'POST',body});
      if(!this.valid(epoch,owner)||this.live?.id!==session.id)return {ok:false,stale:true};
      await this.apply(response,stamp,epoch,owner);return {ok:true,response};
    }
    talk(){return this.run(async()=>{if(!this.canTalk())throw Error(`奥の${hostName(this.live)}の隣まで進んで、話しかけてください。`);await this.refreshPresence();return this.mutate('talk');});}
    answer(accept){return this.run(async()=>{await this.identity(true);if(this.live?.role!=='kasai'||this.live.state!=='permission')throw Error('対戦の申し込みを確認してください。');return this.mutate('answer',{accept:accept===true});});}
    submit(orders){return this.run(async()=>{
      const session=this.live;if(session?.state!=='battle'||session.submitted?.[this.side()])throw Error('相手の行動を待っています。');
      const result=this.rules.hydrate(session.battle).validate(this.side(),orders);if(!result.ok)throw Error(result.error||'行動を選んでください。');
      const key=JSON.stringify(orders);
      if(this.actionIntent&&this.actionIntent.ordersKey!==key)throw Error('前の行動の送信結果を確認しています。同じ行動で再試行してください。');
      this.actionIntent??={sessionId:session.id,round:session.round,ordersKey:key,orders:copy(orders),requestId:this.uuid()};
      return this.mutate('actions',{round:session.round,orders:copy(this.actionIntent.orders),requestId:this.actionIntent.requestId});
    });}
    leave(){return this.run(async()=>{if(!this.active())return {ok:true};if(this.live.role==='kasai')throw Error(`挑戦者が退出するまで、${hostName(this.live)}は席で待機します。`);return this.mutate('leave');});}
    claim(){return this.run(async()=>{
      if(!this.live?.rewardEligible||this.live.role!=='challenger')throw Error('勝利した挑戦者が報酬を受け取れます。');
      if(this.live.rewardDelivered)return {ok:true,alreadyReceived:true};
      const engine=this.getEngine(),storageCount=Math.min(192,engine?.state.storage.length||0);
      if(storageCount>=192)throw Error('ひかえが満員です。空きを作ってから勝利報酬を受け取ってください。');
      const result=await this.mutate('claim',{storageCount});if(!result.ok)return result;
      const received=await this.claimReward();if(!received?.ok)throw Error(received?.message||'保存できませんでした。報酬の受け取りをもう一度お試しください。');
      if(this.live)this.live.rewardDelivered=true;this.signal();return received;
    });}
  }
  LT.KasaiLiveController=KasaiLiveController;
  if(typeof module!=='undefined'&&module.exports)module.exports={KasaiLiveController,reasonText};
  if(!root.document?.createElement||!LT.KasaiLiveRules)return;

  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let dialog=null,banner=null,selected=null,selectionRound='',showBench=false,resultDismissed=null,leaveReview=false,frame=0,paintKey='',playback=false,lastScene='';
  const bridge=()=>LT.adminBridge||{},engine=()=>bridge().getEngine?.();
  const controller=new KasaiLiveController({
    request:(path,options)=>LT.Admin.worldRequest(path,options),identify:options=>LT.Admin.tradeIdentity(options),getEngine:engine,
    getParty:()=>bridge().getKasaiLiveParty?.(),canEnter:()=>bridge().canEnterKasaiLive?.()===true,
    stage:(room,session)=>LT.Rooms?.enterLive?.(room,session)||bridge().stageKasaiLive?.(room,session),restore:point=>bridge().leaveKasaiLive?.(point),enforce:session=>bridge().enforceKasaiLive?.(session),
    refreshPresence:()=>LT.World?.refreshPresence?.(),claimReward:async()=>{dismissResult();return LT.KasaiChallenge?.claim?.();},
    enabled:()=>bridge().isPlaying?.()&&!document.hidden&&root.navigator?.onLine!==false,
    changed:()=>render(),notify:message=>bridge().toast?.(message)
  });
  const name=mon=>LT.displayName?.(mon)||mon?.nickname||LT.DATA?.species?.[mon?.species]?.name||'パチモン';
  function mount(){
    if(!banner){const stage=document.querySelector('.game-stage');if(stage){banner=document.createElement('section');banner.id='kasai-live-banner';banner.className='kasai-live-banner';banner.hidden=true;banner.setAttribute('aria-label','運営の対戦ステージ');stage.before(banner);banner.addEventListener('click',click);}}
    if(dialog)return;dialog=document.createElement('dialog');dialog.id='kasai-live-dialog';dialog.className='kasai-live-dialog';dialog.setAttribute('aria-labelledby','kasai-live-title');document.body.append(dialog);
    dialog.addEventListener('click',click);dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
  }
  function hint(){const s=controller.live;if(!controller.active())return null;if(s.role==='kasai')return s.state==='permission'?'挑戦者からの対戦申込を確認してください':`挑戦者が退出するまで、${hostName(s)}は席で待機`;if(s.state==='staging')return controller.canTalk()?`${hostName(s)} · A / E で対戦を申し込む`:`奥の${hostName(s)}に話しかけよう · あと${controller.state().remaining}秒`;if(s.state==='permission')return `${hostName(s)}の返事を待っています`;if(s.state==='result')return '対戦終了 · 退出するまでステージを探索できます';return `${hostName(s)}とリアルタイム対戦中`;}
  function renderBanner(){
    if(!banner)return;const s=controller.live;banner.hidden=!controller.active()||!bridge().isPlaying?.();if(banner.hidden)return;
    const busy=controller.busy||controller.joining,detail=controller.error||hint();
    banner.innerHTML=`<div><strong>${s.role==='kasai'?esc(s.challenger.name)+' の挑戦':esc(hostName(s))}</strong><span data-kasai-countdown role="status">${esc(detail)}</span></div><div class="kasai-live-banner-actions">${s.state==='result'?'<button type="button" data-kasai-live="result">対戦結果</button>':''}${s.role==='challenger'?`<button type="button" data-kasai-live="leave" ${busy?'disabled':''}>退出する</button>`:''}</div>`;
  }
  function hpCard(mon,which,side,index){const ratio=Math.max(0,Math.min(100,mon.hp/mon.maxHp*100));return `<article class="kasai-live-health ${which}" data-kasai-health="${side}:${index}"><div><span>${which==='foe'?'相手':'自分'} · Lv.${mon.level}</span><strong>${esc(name(mon))}${mon.gender==='male'?' ♂':mon.gender==='female'?' ♀':''}${mon.shiny?' ★':''}</strong></div><div class="kasai-live-hp"><i style="width:${ratio}%"></i></div><small data-kasai-hp>${mon.hp} / ${mon.maxHp}</small></article>`;}
  function stock(team){return team.monsters.map(mon=>`<span class="${mon.hp>0?'':'fainted'}" title="${esc(name(mon))}"></span>`).join('');}
  function battleMarkup(s){
    const b=s.battle,side=controller.side(),duel=LT.KasaiLiveRules.hydrate(b),me=b.teams[side],foe=b.teams[1-side],mon=me.monsters[me.active[0]],enemy=foe.monsters[foe.active[0]],finished=s.state==='result';
    const key=s.id+':'+b.round+':'+b.phase;if(selectionRound!==key){selectionRound=key;selected=null;showBench=b.phase==='replacement';leaveReview=false;}
    const wait=s.submitted?.[side]===true,locked=controller.busy||controller.joining||wait||playback||!!controller.actionIntent;
    const choices=duel.moves(mon),replacement=b.phase==='replacement',needReplacement=duel.replacementSlots(side).length>0;
    const verdict=b.winner==='draw'?'引き分け':b.winner===side?'あなたの勝利！':'対戦終了';
    const commands=showBench||replacement&&needReplacement?`<div class="kasai-live-bench">${me.monsters.map((member,index)=>`<button type="button" data-kasai-live="switch" data-index="${index}" ${locked||member.hp<=0||me.active.includes(index)?'disabled':''} aria-pressed="${selected?.type==='switch'&&selected.index===index}"><strong>${esc(name(member))}</strong><span>Lv.${member.level} · 体力 ${member.hp}/${member.maxHp}</span>${me.active.includes(index)?'<small>出場中</small>':''}</button>`).join('')}</div>${!replacement?'<button type="button" class="btn" data-kasai-live="moves">技を選ぶ</button>':''}`:`<div class="kasai-live-moves">${choices.map((move,index)=>`<button type="button" data-kasai-live="move" data-index="${index}" ${locked||move.pp<=0?'disabled':''} aria-pressed="${selected?.type==='move'&&selected.move===index}"><strong>${esc(move.name)}</strong><span>${esc(LT.DATA.elements[move.element]?.name||'無')} · ${move.kind==='heal'?'回復':move.kind==='guard'?'防御':move.kind==='boost'?'強化':move.category==='special'?'特殊':move.category==='status'?'変化':'物理'}</span><small>PP ${move.pp}/${move.maxPP}${move.power>0?' · 威力 '+move.power:''}</small></button>`).join('')}${duel.canStruggle(mon)?`<button type="button" data-kasai-live="struggle" ${locked?'disabled':''} aria-pressed="${selected?.type==='struggle'}"><strong>踏ん張り打ち</strong><small>PP切れの攻撃 · 反動あり</small></button>`:''}</div><button type="button" class="btn" data-kasai-live="bench" ${locked?'disabled':''}>パチモンを交代</button>`;
    const selectedName=selected?.type==='move'?choices[selected.move]?.name:selected?.type==='switch'?`${name(me.monsters[selected.index])}に交代`:selected?.type==='struggle'?'踏ん張り打ち':null;
    const ready=selected?duel.validate(side,[selected]).ok:replacement&&!needReplacement;
    let panel;
    if(finished)panel=`<section class="kasai-live-result"><h3>${verdict}</h3><p>双方が選んだ行動で勝敗が決まりました。冒険の仲間や持ち物は減りません。</p>${s.role==='challenger'&&s.rewardEligible?`<div class="kasai-live-reward"><strong>勝利報酬 · キラシード Lv.70</strong><p>${s.rewardDelivered?'このプレイヤーは受け取り済みです。':'各プレイヤー1体だけ。性別は♂・♀からランダム。ひかえが満員のときは受け取れません。'}</p>${!s.rewardDelivered?`<button type="button" class="btn btn-primary" data-kasai-live="claim" ${controller.busy?'disabled':''}>キラシードを受け取る</button>`:''}</div>`:''}<button type="button" class="btn btn-primary" data-kasai-live="dismiss">ステージに戻る</button><p>${s.role==='kasai'?'挑戦者が退出するまで席で待機します。':`退出すると、${hostName(s)}もフィールドへ戻ります。`}</p></section>`;
    else panel=`<section class="kasai-live-command"><h3>${replacement?'次の仲間を選ぶ':'このターンの行動'}</h3>${replacement&&!needReplacement?'<p>相手が次に出す仲間を選んでいます。</p>':commands}<div class="kasai-live-selection">${selectedName?esc(selectedName)+' を選択中':replacement&&!needReplacement?'相手の交代を確認してください。':'技か交代先を選んでください。'}</div>${controller.actionIntent&&!wait?`<button type="button" class="btn btn-primary" data-kasai-live="retry" ${controller.busy?'disabled':''}>同じ行動で再確認</button>`:`<button type="button" class="btn btn-primary" data-kasai-live="submit" ${locked||!ready?'disabled':''}>${playback?'エフェクトを再生中…':wait?'相手の行動を待っています':replacement?'交代を確定':'この行動を確定'}</button>`}<p class="kasai-live-note">${s.submitted?.[1-side]?'相手は行動を確定しています。':'相手の選択は、双方の確定後に公開されます。'}</p></section>`;
    return `<header><div><p>LIVE KASAI BATTLE</p><h2 id="kasai-live-title">${finished?verdict:`TURN ${b.turn} · ${esc(s.role==='kasai'?s.challenger.name:hostName(s))}と対戦`}</h2></div>${finished?'<button type="button" class="btn" data-kasai-live="dismiss">閉じる</button>':s.role==='challenger'?'<button type="button" class="btn" data-kasai-live="leave">退出</button>':''}</header><div class="kasai-live-body"><div class="kasai-live-versus"><div>${esc(me.name)}<small>${stock(me)}</small></div><b>VS</b><div>${esc(foe.name)}<small>${stock(foe)}</small></div></div><div class="kasai-live-layout"><section class="kasai-live-arena">${hpCard(enemy,'foe',1-side,foe.active[0])}<canvas id="kasai-live-canvas" width="768" height="400" aria-label="${hostName(s)}との対戦画面"></canvas>${hpCard(mon,'ally',side,me.active[0])}</section>${panel}</div><div class="kasai-live-log" role="log">${(b.log||[]).slice(-4).map(line=>`<p>${esc(line)}</p>`).join('')}</div><p class="kasai-live-error" role="status">${esc(controller.error)}</p>${leaveReview?'<section class="kasai-live-leave"><p>ステージを退出して対戦を終了しますか？</p><div><button type="button" class="btn" data-kasai-live="stay">対戦を続ける</button><button type="button" class="btn" data-kasai-live="confirm-leave">退出する</button></div></section>':''}</div>`;
  }
  function scene(snapshot){const key=snapshot?JSON.stringify([controller.live?.id,snapshot.round,snapshot.phase,snapshot.winner]):'';if(key===lastScene)return;lastScene=key;bridge().setKasaiLiveBattle?.(snapshot);}
  function render(){
    mount();renderBanner();const s=controller.live;
    if(!s||!controller.active()){dialog?.close();scene(null);paintKey='';cancelAnimationFrame(frame);return;}
    if(controller.joining||controller.stagedId!==s.id){dialog.close();scene(null);paintKey='';return;}
    if(s.state==='permission'&&s.role==='kasai'){
      scene(null);const key=JSON.stringify(['permission',s.id,controller.busy,controller.error]);if(paintKey!==key){paintKey=key;dialog.innerHTML=`<header><div><p>CHALLENGE REQUEST</p><h2 id="kasai-live-title">${esc(s.challenger.name)}から対戦の申し込み</h2></div></header><div class="kasai-live-body kasai-live-consent"><p>挑戦者が${hostName(s)}に話しかけました。現在の手持ちで対戦を始めますか？</p><p>あなた自身が技と交代を選び、挑戦者とリアルタイムで戦います。</p><div><button type="button" class="btn" data-kasai-live="decline" ${controller.busy?'disabled':''}>今回は見送る</button><button type="button" class="btn btn-primary" data-kasai-live="accept" ${controller.busy?'disabled':''}>対戦を始める</button></div><p role="status">${esc(controller.error)}</p></div>`;}if(!dialog.open)dialog.showModal();return;
    }
    if(s.battle&&(s.state==='battle'||s.state==='result'&&resultDismissed!==s.id)){
      playback=!!LT.BattleVFX?.onlineBusy?.(s.battle,performance.now());
      const key=JSON.stringify([s.id,s.state,s.battle,s.submitted,s.rewardDelivered,selected,showBench,controller.busy,controller.actionIntent,controller.error,leaveReview,playback]);
      if(paintKey!==key){paintKey=key;dialog.innerHTML=battleMarkup(s);}if(!dialog.open)dialog.showModal();scene(s.battle);startDraw();return;
    }
    dialog.close();scene(null);paintKey='';cancelAnimationFrame(frame);
  }
  function startDraw(){cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);}
  function draw(now){
    const s=controller.live,canvas=dialog?.querySelector('#kasai-live-canvas');if(!dialog?.open||!s?.battle||!canvas)return;
    LT.PixelSprites?.duel?.(canvas,s.battle,controller.side(),now);
    const shown=LT.BattleVFX?.onlineView?.(s.battle,now)||s.battle;
    for(const card of dialog.querySelectorAll('[data-kasai-health]')){const [side,index]=card.dataset.kasaiHealth.split(':').map(Number),mon=shown.teams[side]?.monsters[index];if(!mon)continue;const fill=card.querySelector('.kasai-live-hp i'),label=card.querySelector('[data-kasai-hp]');if(fill)fill.style.width=Math.max(0,Math.min(100,mon.hp/mon.maxHp*100))+'%';if(label)label.textContent=(Number.isFinite(mon.displayHp)?mon.displayHp:Math.ceil(mon.hp))+' / '+mon.maxHp;}
    const next=!!LT.BattleVFX?.onlineBusy?.(s.battle,now);if(playback!==next){playback=next;paintKey='';render();return;}frame=requestAnimationFrame(draw);
  }
  function dismissResult(){if(controller.live?.state==='result')resultDismissed=controller.live.id;dialog?.close();scene(null);paintKey='';renderBanner();}
  function closeDialog(){if(controller.busy||controller.joining)return false;if(controller.live?.state==='result'){dismissResult();return true;}if(controller.live?.state==='permission'&&controller.live.role==='kasai'){void controller.answer(false);return true;}if(controller.live?.state==='battle'&&controller.live.role==='challenger'){leaveReview=!leaveReview;paintKey='';render();return true;}return false;}
  async function click(event){
    const button=event.target.closest('[data-kasai-live]');if(!button||button.disabled)return;const action=button.dataset.kasaiLive,s=controller.live;
    if(action==='accept'||action==='decline'){await controller.answer(action==='accept');return;}
    if(action==='dismiss'){dismissResult();return;}
    if(action==='result'){resultDismissed=null;render();return;}
    if(action==='leave'){if(s?.state==='battle'){leaveReview=true;render();}else await controller.leave();return;}
    if(action==='stay'){leaveReview=false;render();return;}
    if(action==='confirm-leave'){await controller.leave();return;}
    if(action==='claim'){await controller.claim();return;}
    if(action==='retry'){if(controller.actionIntent)await controller.submit(copy(controller.actionIntent.orders));return;}
    if(!s?.battle||s.state!=='battle'||controller.busy||s.submitted?.[controller.side()]||controller.actionIntent||playback)return;
    const index=Number(button.dataset.index);
    if(action==='move')selected={type:'move',slot:0,move:index,target:0};
    if(action==='struggle')selected={type:'struggle',slot:0,target:0};
    if(action==='switch')selected={type:'switch',slot:0,index};
    if(action==='bench')showBench=true;if(action==='moves')showBench=false;
    if(action==='submit'){const duel=LT.KasaiLiveRules.hydrate(s.battle),orders=selected?[copy(selected)]:s.battle.phase==='replacement'&&!duel.replacementSlots(controller.side()).length?[]:null;if(orders)await controller.submit(orders);return;}
    render();
  }
  const refresh=()=>controller.refresh();
  let timer=null;
  function schedule(delay=2000){clearTimeout(timer);timer=setTimeout(async()=>{await refresh();schedule();},delay);}
  LT.KasaiLive={request:peerId=>controller.requestChallenge(peerId),talk:()=>controller.talk(),leave:()=>controller.leave(),refresh,
    session:()=>controller.live,status:()=>controller.state(),isActive:()=>controller.active(),locked:()=>controller.active(),isRequesting:()=>controller.requesting===true&&!controller.active(),busy:()=>controller.busy||controller.joining,isWorking:()=>controller.busy||controller.joining,
    canTalk:()=>controller.canTalk(),hint,isDialogOpen:()=>dialog?.open===true,closeDialog};
  document.addEventListener('pachi-game-ready',()=>{controller.reset();schedule(0);});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule(0);});
  root.addEventListener('online',()=>schedule(0));root.addEventListener('storage',event=>{if(event.key==='pachi-player-identity-v1'){controller.reset();schedule(0);}});
  setInterval(()=>{if(controller.active()&&!document.hidden)renderBanner();},1000);
  schedule(1000);
})();
