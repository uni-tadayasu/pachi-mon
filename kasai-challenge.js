/* Pachi Monsters — authenticated solo Kasai challenge and explicit reward recovery. */
(() => {
  'use strict';
  const root=globalThis,LT=root.LT=root.LT||{};
  const KEY='pachi-kasai-challenge-v56:',PLAYER=/^P[0-9a-f]{16}$/;
  const copy=value=>JSON.parse(JSON.stringify(value));
  const fullMessage='ひかえが満員です（192体）。空きを作ってから、秘密部屋の「カサイの勝利報酬を確認」で「報酬を受け取る」を選んでください。自動では受け取りません。';
  const selfMessage='運営カサイは自分自身と対戦できません。「飾りつけ」で自分の部屋をデコレーションできます。';
  const fail=(message,code)=>({ok:false,message,...(code?{code}:{})});
  class KasaiChallengeController {
    constructor({storage,request,identify,getEngine,startBattle,commit,refreshPresence=async()=>{},rules=LT.KasaiRules,uuid=()=>crypto.randomUUID(),clock=()=>Date.now(),changed=()=>{}}){
      Object.assign(this,{storage,request,identify,getEngine,startBattle,commit,refreshPresence,rules,uuid,clock,changed});
      this.owner=null;this.pending=null;this.receipt=null;this.pendingLiveSessionId=null;this.busy=false;this.error='';this.errorCode='';
    }
    async identity(){
      const owner=await this.identify();if(!PLAYER.test(owner?.id||''))throw Error('プレイヤー情報を確認できません。');
      if(this.owner?.id!==owner.id){this.pending=null;this.receipt=null;this.pendingLiveSessionId=null;}
      this.owner={id:owner.id,isAdmin:owner.isAdmin===true};
      this.assertChallenger();this.load();this.assertChallenger(this.pending?.challenge.roomId);
      return this.owner.id;
    }
    assertChallenger(roomId){
      if(this.owner?.isAdmin===true||roomId&&roomId===this.owner?.id)throw Object.assign(Error(selfMessage),{code:'KASAI_SELF_BATTLE'});
    }
    async sameOwner(id,roomId){if(await this.identity()!==id)throw Error('プレイヤーが切り替わりました。元のプレイヤーで結果を確認してください。');this.assertChallenger(roomId);}
    load(){
      const raw=this.storage.getItem(KEY+this.owner.id);this.pending=null;if(!raw)return;
      let value;try{value=JSON.parse(raw);}catch(_){throw Error('カサイへの挑戦記録を読み込めません。冒険のセーブはそのままです。');}
      if(raw.length>80000||!value||value.version!==1||value.ownerId!==this.owner.id||!value.challenge||typeof value.challenge!=='object'||value.completion&&(!Array.isArray(value.completion.actions)||value.completion.actions.length>512))throw Error('カサイへの挑戦記録を確認してください。');
      this.pending=value;
    }
    persist(value){this.storage.setItem(KEY+this.owner.id,JSON.stringify(value));this.pending=copy(value);this.changed(this);}
    clear(){if(this.owner)this.storage.removeItem(KEY+this.owner.id);this.pending=null;this.changed(this);}
    state(){
      const engine=this.getEngine(),id=this.receipt?.grantId||this.receipt?.id;
      const delivered=this.receipt?.delivered===true||this.receipt?.ackedAt!=null,locallySaved=!!(id&&engine?.state.giftReceipts?.includes(id));
      const expiry=Number(this.pending?.challenge.expiresAt),expired=Number.isFinite(expiry)&&expiry>0&&expiry<=this.clock();
      const selfChallenge=this.owner?.isAdmin===true||this.errorCode==='KASAI_SELF_BATTLE'||!!(this.owner?.id&&(this.pending?.challenge.roomId===this.owner.id||engine?.map?.roomKindTag==='kasai'&&engine.map.roomOwner===this.owner.id));
      return {busy:this.busy,error:this.error,selfChallenge,pendingWin:!!this.pendingLiveSessionId||this.pending?.completion?.result==='won',pendingLiveSessionId:this.pendingLiveSessionId,expired:!this.pendingLiveSessionId&&expired,hasReceipt:!!this.receipt,delivered,locallySaved,storageFull:(engine?.state.storage.length||0)>=192,canClaim:!selfChallenge&&!delivered&&(!!this.receipt||!!this.pendingLiveSessionId||this.pending?.completion?.result==='won')};
    }
    async run(action){
      if(this.busy)return fail('挑戦の確認中です。');
      this.busy=true;this.error='';this.errorCode='';this.changed(this);
      try{return await action();}
      catch(error){this.errorCode=error?.code||'';this.error=error?.code==='KASAI_SELF_BATTLE'?selfMessage:error?.code==='KASAI_STORAGE_FULL'?fullMessage:error?.message||'通信を確認してください。勝利報酬はカサイに話しかけて再確認できます。';return fail(this.error,this.errorCode);}
      finally{this.busy=false;this.changed(this);}
    }
    inspect(){return this.run(async()=>{
      const owner=await this.identity(),response=await this.request('/world/kasai/reward');await this.sameOwner(owner);
      this.receipt=response.receipt||null;this.pendingLiveSessionId=typeof response.pendingLiveSessionId==='string'&&/^[0-9a-f-]{36}$/.test(response.pendingLiveSessionId)?response.pendingLiveSessionId:null;return {ok:true,...this.state()};
    });}
    start(){return this.run(async()=>{
      const owner=await this.identity(),engine=this.getEngine(),map=engine?.map;
      if(!engine?.state.started||engine.battle||!map?.sharedRoom||!PLAYER.test(map.roomOwner||''))throw Error('カサイの部屋で、カサイに話しかけてください。');
      this.assertChallenger(map.roomOwner);
      if(this.pending?.completion?.result==='won'&&!this.state().delivered)throw Error('先に「報酬を受け取る」で前の勝利を確認してください。');
      const party=this.rules.normalizeParty(engine.state.party),roomId=map.roomOwner;
      const reusable=this.pending?.phase==='starting'&&this.pending.challenge.roomId===roomId&&JSON.stringify(this.pending.challenge.party)===JSON.stringify(party);
      const intent=reusable?this.pending:{version:1,ownerId:owner,phase:'starting',requestId:this.uuid(),challenge:{roomId,party}};
      this.persist(intent);
      await this.refreshPresence();await this.sameOwner(owner,roomId);
      let response;
      try{response=await this.request('/world/kasai/challenges',{method:'POST',body:{requestId:intent.requestId,roomId,party,storageCount:Math.min(192,engine.state.storage.length)}});}
      catch(error){
        if(['KASAI_CHALLENGE_FINISHED','KASAI_CHALLENGE_NOT_FOUND','KASAI_CHALLENGE_CHANGED'].includes(error?.code)){await this.sameOwner(owner);this.clear();}
        throw error;
      }
      await this.sameOwner(owner,roomId);
      const challenge={...response.challenge,token:response.token};
      this.persist({...intent,phase:'battle',challenge});
      const result=await this.startBattle(challenge);
      if(!result?.ok)throw Error(result?.message||'カサイへの挑戦を始められませんでした。もう一度話しかけてください。');
      return {ok:true,challengeId:challenge.id};
    });}
    finish(result){return this.run(async()=>{
      if(!result?.ok||result.kasai!==true||!result.challenge)return {ok:true,ignored:true};
      const owner=await this.identity(),challenge=result.challenge;
      this.assertChallenger(challenge.roomId);
      if(this.pending?.ownerId!==owner||this.pending.challenge.id!==challenge.id||this.pending.challenge.token!==challenge.token)return fail('カサイの挑戦記録が一致しません。');
      if(result.result!=='won'||challenge.result!=='won'){this.clear();return {ok:true,result:result.result};}
      if(this.state().delivered){this.clear();return {ok:true,alreadyReceived:true,message:'カサイに再び勝利！ このプレイヤーのキラシードは受け取り済みです。'};}
      if(!Array.isArray(challenge.actions)||!challenge.actions.length||challenge.actions.length>this.rules.maxActions||challenge.actions.some(action=>!this.rules.normalizeAction(action)))return fail('勝利の行動記録を確認できません。');
      this.persist({...this.pending,phase:'won',completion:{result:'won',actions:copy(challenge.actions)}});
      if(this.getEngine().state.storage.length>=192)return {...fail(fullMessage),pending:true,storageFull:true};
      return this.submitWin(owner);
    });}
    async submitWin(owner){
      await this.sameOwner(owner);
      const pending=this.pending;
      if(pending?.completion?.result!=='won')throw Error('勝利の記録がありません。カサイに挑戦してください。');
      if(this.getEngine()?.battle)throw Error('バトルを終えてから受け取ってください。');
      if(this.getEngine().state.storage.length>=192&&!this.state().expired)throw Error(fullMessage);
      let response;
      try{response=await this.request('/world/kasai/challenges/'+encodeURIComponent(pending.challenge.id)+'/complete',{method:'POST',body:{token:pending.challenge.token,actions:pending.completion.actions,storageCount:Math.min(192,this.getEngine().state.storage.length)}});}
      catch(error){
        if(['KASAI_CHALLENGE_FINISHED','KASAI_CHALLENGE_NOT_FOUND'].includes(error?.code)){
          // A lost completion response may already have created the reward. Check
          // it before releasing an expired challenge; network errors keep recovery.
          const recovered=await this.request('/world/kasai/reward');await this.sameOwner(owner);this.receipt=recovered.receipt||null;
          if(this.receipt)return this.applyReceipt(owner);
          this.clear();throw Error('前の挑戦は期限切れ、または終了しています。カサイにもう一度挑戦できます。');
        }
        throw error;
      }
      await this.sameOwner(owner);
      this.receipt=response.receipt||null;
      return this.applyReceipt(owner);
    }
    async applyReceipt(owner){
      await this.sameOwner(owner);
      const receipt=this.receipt,id=receipt?.grantId||receipt?.id;
      if(!receipt||id!=='kasai-reward:'+owner)throw Error('このプレイヤーの勝利報酬を確認できません。');
      if(receipt.delivered===true||receipt.ackedAt!=null){this.pendingLiveSessionId=null;this.clear();return {ok:true,alreadyReceived:true,message:'このプレイヤーは、カサイからのキラシードを受け取り済みです。'};}
      // commit uses the main UI's existing persistGiftMutation transaction:
      // validate a candidate, write it durably, then replace live adventure state.
      const saved=await this.commit(receipt);
      if(!saved?.ok)throw Error(saved?.message||'報酬をセーブに保存できませんでした。もう一度「報酬を受け取る」を選んでください。');
      await this.sameOwner(owner);
      await this.request('/world/kasai/reward/ack',{method:'POST',body:{receiptId:receipt.id||id}});
      await this.sameOwner(owner);
      this.receipt={...receipt,delivered:true};this.pendingLiveSessionId=null;this.clear();return saved;
    }
    claim(){return this.run(async()=>{
      const owner=await this.identity(),response=await this.request('/world/kasai/reward');await this.sameOwner(owner);
      this.receipt=response.receipt||null;
      this.pendingLiveSessionId=typeof response.pendingLiveSessionId==='string'&&/^[0-9a-f-]{36}$/.test(response.pendingLiveSessionId)?response.pendingLiveSessionId:null;
      if(this.receipt)return this.applyReceipt(owner);
      if(this.pendingLiveSessionId){
        if(this.getEngine()?.battle)throw Error('バトルを終えてから受け取ってください。');
        const storageCount=this.getEngine()?.state.storage.length||0;if(storageCount>=192)throw Error(fullMessage);
        const claimed=await this.request('/world/kasai/live/'+encodeURIComponent(this.pendingLiveSessionId)+'/claim',{method:'POST',body:{storageCount}});
        await this.sameOwner(owner);this.receipt=claimed.receipt||null;return this.applyReceipt(owner);
      }
      return this.submitWin(owner);
    });}
  }
  LT.KasaiChallengeController=KasaiChallengeController;
  if(typeof module!=='undefined'&&module.exports)module.exports={KasaiChallengeController,KEY,fullMessage,selfMessage};
  if(!root.document?.createElement||!LT.KasaiRules)return;

  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let dialog=null,note='';
  const controller=new KasaiChallengeController({storage:root.localStorage,
    request:(path,options)=>LT.Admin.worldRequest(path,options),identify:()=>LT.Admin.tradeIdentity({fresh:true}),
    getEngine:()=>LT.adminBridge?.getEngine?.(),startBattle:challenge=>LT.adminBridge.startKasaiBattle(challenge),
    commit:receipt=>LT.adminBridge.receiveKasaiReward(receipt),refreshPresence:()=>LT.World?.refreshPresence?.(),changed:()=>{if(dialog?.open)render();}});
  function makeDialog(){
    if(dialog)return;dialog=document.createElement('dialog');dialog.id='kasai-challenge-dialog';dialog.className='world-player-dialog';dialog.setAttribute('aria-labelledby','kasai-dialog-title');document.body.append(dialog);
    dialog.addEventListener('cancel',event=>{if(controller.busy)event.preventDefault();});
    dialog.addEventListener('click',event=>{
      const action=event.target.closest('[data-kasai-action]')?.dataset.kasaiAction;if(!action||controller.busy)return;
      if(action==='close'){dialog.close();return;}
      if(action==='start'){dialog.close();void start();}
      if(action==='claim')void claim();
      if(action==='decorate'){dialog.close();void decorate();}
    });
  }
  function render(){
    makeDialog();const state=controller.state(),disabled=state.busy?'disabled':'';
    if(localSelf()||state.selfChallenge){dialog.innerHTML=`<header><div><p>MY ROOM</p><h2 id="kasai-dialog-title">カサイのひみつ部屋</h2></div><button type="button" class="btn btn-small" data-kasai-action="close" ${disabled}>閉じる</button></header><div class="world-dialog-body"><p>${selfMessage}</p><div class="world-dialog-actions"><button type="button" class="btn btn-primary" data-kasai-action="decorate" ${disabled}>飾りつけ</button></div></div>`;return;}
    dialog.innerHTML=`<header><div><p>KASAI VICTORY REWARD</p><h2 id="kasai-dialog-title">謎のトレーナー カサイ</h2></div><button type="button" class="btn btn-small" data-kasai-action="close" ${disabled}>閉じる</button></header><div class="world-dialog-body"><section class="world-trainer-card is-kasai"><canvas width="150" height="160" data-kasai-portrait aria-label="カサイの姿"></canvas><div><span class="world-trainer-role">MYSTERY TRAINER</span><h3>「君の仲間の力を見せてくれ。」</h3><p>フィールドにいるカサイ本人と、専用ステージでリアルタイム対戦。相手の許可後に、双方が技と交代を選びます。</p></div></section><p>初めて勝利したプレイヤーに、Lv.70のキラシードを1体。性別は♂・♀からランダムに決まります。</p>${state.delivered?'<p class="notice">このプレイヤーの勝利報酬は受け取り済みです。再戦は何度でも楽しめます。</p>':state.expired&&state.canClaim?'<p class="notice">前の挑戦の確認期限を過ぎています。「報酬を受け取る」で結果を確認すると、未受け取りの報酬を復旧するか、新しい挑戦に進めます。</p>':state.storageFull?`<p class="notice">${fullMessage}</p>`:state.canClaim?'<p class="notice">受け取りを確認できる勝利記録があります。「報酬を受け取る」を選んでください。</p>':'<p>手持ちに空きがあっても、ひかえが満員のときは受け取れません。</p>'}<div class="world-dialog-actions">${state.canClaim?`<button type="button" class="btn btn-primary" data-kasai-action="claim" ${disabled}>報酬を受け取る</button>`:'<p>新しい対戦は、外のフィールドにいるカサイに話しかけて申し込んでください。</p>'}</div><p role="status" aria-live="polite">${escape(state.busy?'確認しています…':controller.error||note)}</p></div>`;
    const canvas=dialog.querySelector('[data-kasai-portrait]');if(canvas)LT.Art?.traveller?.(canvas,{kind:'kasai',size:150,facing:'down'});
  }
  function show(message=''){note=message;render();if(!dialog.open)dialog.showModal();}
  function localSelf(){const player=LT.Admin?.player,map=controller.getEngine()?.map;return player?.isAdmin===true||!!(player?.id&&map?.roomKindTag==='kasai'&&map.roomOwner===player.id);}
  async function decorate(){dialog?.close();if(LT.Rooms?.decorateMine)return LT.Rooms.decorateMine();return LT.Rooms?.open?.();}
  function talk(){
    const engine=controller.getEngine();
    if(!engine?.map?.sharedRoom||engine.battle||engine.nearbyNPC?.()?.kind!=='kasai')return false;
    if(localSelf()){void decorate();return true;}
    show();void controller.inspect().then(result=>{if(result.code==='KASAI_SELF_BATTLE')void decorate();});return true;
  }
  async function start(){if(localSelf()){await decorate();return fail(selfMessage,'KASAI_SELF_BATTLE');}dialog?.close();if(LT.KasaiLive?.isActive?.())return LT.KasaiLive.talk();const peer=controller.getEngine()?.map?.roomOwner;if(peer&&LT.KasaiLive?.request)return LT.KasaiLive.request(peer);return fail('外のフィールドにいる運営カサイに話しかけて、対戦を申し込んでください。','KASAI_LIVE_REQUIRED');}
  function openRewards(){if(localSelf()){void decorate();return false;}show();void controller.inspect();return true;}
  async function claim(){if(localSelf()){await decorate();return fail(selfMessage,'KASAI_SELF_BATTLE');}const result=await controller.claim();if(result.code==='KASAI_SELF_BATTLE'){await decorate();return result;}note=result.message||'';render();if(result.ok)LT.adminBridge?.toast?.(note||'報酬の受け取りを確認しました。');return result;}
  async function complete(result){
    const saved=await controller.finish(result);
    if(saved.code==='KASAI_SELF_BATTLE'){dialog?.close();LT.adminBridge?.toast?.(selfMessage);}
    else if(result?.kasai&&result.result==='won')show(saved.message||'カサイに勝利しました。');
    return saved;
  }
  LT.KasaiChallenge={talk,start,claim,complete,openRewards,status:()=>controller.state(),isDialogOpen:()=>!!dialog?.open,isWorking:()=>controller.busy,closeDialog:()=>{if(controller.busy)return false;dialog?.close();return true;}};
})();
