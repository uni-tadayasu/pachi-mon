/* Pachi Monsters — real travellers share the solo field; adventure saves stay local. */
(() => {
  'use strict';
  const root=globalThis,LT=root.LT=root.LT||{};
  const DIRECTIONS=new Set(['down','left','right','up']);
  const PLAYER_ID=/^P[0-9a-f]{16}$/;
  const KASAI='謎のトレーナー カサイ';
  const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

  // Keep a bounded interpolation buffer, not a second source of game state.
  class WorldPresence {
    constructor({clock=()=>Date.now(),ttl=15000}={}){this.clock=clock;this.ttl=ttl;this.self=null;this.peers=new Map();this.map=null;this.receivedAt=0;}
    clear(){this.peers.clear();this.map=null;this.receivedAt=0;}
    position(peer,now=this.clock()){
      const t=clamp((now-peer.sampleAt)/peer.duration,0,1);
      return {...peer,x:peer.fromX+(peer.targetX-peer.fromX)*t,y:peer.fromY+(peer.targetY-peer.fromY)*t,moving:peer.moved&&t<1};
    }
    ingest(data,map){
      const now=this.clock(),serverTime=Number(data?.serverTime);
      if(!Number.isFinite(serverTime)||!PLAYER_ID.test(data?.self?.id||'')||!Array.isArray(data?.players))throw Error('フィールドの接続情報を確認できません。');
      if(this.map!==map||this.self?.id!==data.self.id)this.clear();
      this.map=map;this.self={...data.self};this.ttl=clamp(Number(data.ttlMs)||15000,5000,30000);
      const next=new Map();
      for(const row of data.players.slice(0,80)){
        if(!PLAYER_ID.test(row?.id||'')||row.id===this.self.id||row.map!==map||!Number.isFinite(row.x)||!Number.isFinite(row.y)||!DIRECTIONS.has(row.facing)||!Number.isFinite(row.updatedAt)||serverTime-row.updatedAt>this.ttl||row.updatedAt>serverTime+2000)continue;
        const old=this.peers.get(row.id);
        if(old&&row.updatedAt<old.updatedAt){next.set(row.id,old);continue;}
        const current=old?this.position(old,now):row;
        const same=old&&old.targetX===row.x&&old.targetY===row.y;
        if(same){next.set(row.id,{...old,name:String(row.name||'旅人').slice(0,40),status:row.status,isAdmin:row.isAdmin===true,avatar:row.avatar,facing:row.facing,updatedAt:row.updatedAt,seenAt:now,age:Math.max(0,serverTime-row.updatedAt)});continue;}
        const jump=!old||distance(current,row)>8;
        next.set(row.id,{...row,name:String(row.name||'旅人').slice(0,40),isAdmin:row.isAdmin===true,fromX:jump?row.x:current.x,fromY:jump?row.y:current.y,targetX:row.x,targetY:row.y,sampleAt:now,seenAt:now,age:Math.max(0,serverTime-row.updatedAt),duration:clamp(old?now-old.sampleAt:500,180,850),moved:!jump&&distance(current,row)>.01});
      }
      this.peers=next;this.receivedAt=now;
      return this;
    }
    actors(map){
      if(map!==this.map||this.clock()-this.receivedAt>this.ttl)return [];
      const now=this.clock();
      return [...this.peers.values()].filter(peer=>now-peer.seenAt+peer.age<=this.ttl).map(peer=>this.position(peer,now));
    }
    nearby(state,radius=3){
      const offset={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[state.facing]||[0,1];
      const ahead={x:state.x+offset[0],y:state.y+offset[1]};
      return this.actors(state.map).filter(peer=>distance({x:peer.targetX,y:peer.targetY},state)<=radius)
        .sort((a,b)=>(distance(a,ahead)-distance(b,ahead))||a.id.localeCompare(b.id));
    }
  }
  const core={WorldPresence,distance,KASAI};
  if(typeof module!=='undefined'&&module.exports)module.exports=core;
  LT.WorldPresence=WorldPresence;
  if(!root.document?.createElement||!LT.DATA)return;

  const model=new WorldPresence();
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let timer=null,inFlight=null,leavePromise=null,epoch=0,lastSent=0,failures=0,clockOffset=0,connected=false,lastMap='',lastProfile='',lastPayload='',bar=null,dialog=null,dialogMode='',selectedPeer=null,incoming=null,outgoing=null,working=false;
  const handled=new Set(),cleanup=new Set();
  const game=()=>LT.adminBridge?.getEngine?.();
  const playing=()=>LT.adminBridge?.isPlaying?.()===true;
  const online=()=>root.navigator?.onLine!==false;
  const active=()=>online()&&!document.hidden&&playing();
  const say=message=>LT.adminBridge?.toast?.(message);
  const api=(path,options={})=>{
    if(!LT.Admin?.worldRequest)throw Error('交流機能を読み込み中です。');
    return LT.Admin.worldRequest(path,options);
  };
  const mine=()=>LT.Admin?.player?.id||model.self?.id;
  const localAdmin=()=>LT.Admin?.player?.isAdmin===true||(model.self?.id===LT.Admin?.player?.id&&model.self?.isAdmin===true);
  const isBusy=()=>!!(LT.adminBridge?.isBusy?.()||LT.Rooms?.isWorking?.()||LT.KasaiChallenge?.isWorking?.()||LT.onlineActive||LT.tradeActive||LT.localTradeActive||LT.Trade?.isLocked?.()||document.querySelector('dialog[open]'));
  function networkStatus(){
    // Creating an invitation opens its room before publishing the directed offer.
    // That room is still available to its one invited player.
    if(outgoing&&['preparing','sending','pending'].includes(outgoing.phase))return 'idle';
    if(dialog?.open&&dialogMode==='incoming')return 'idle';
    return isBusy()?'busy':'idle';
  }
  function schedule(delay=500){clearTimeout(timer);timer=setTimeout(()=>{void tick();},delay);}
  function mount(){
    if(bar)return;
    const stage=document.querySelector('.game-stage');if(!stage)return;
    bar=document.createElement('section');bar.className='world-network-bar';bar.setAttribute('aria-label','フィールド交流');
    bar.innerHTML='<div class="world-network-summary"><span class="world-network-indicator" aria-hidden="true"></span><span data-world-status role="status" aria-live="polite"></span></div><div class="world-network-actions"><button type="button" data-world-nearby>近くの人</button><button type="button" data-world-rooms>秘密部屋</button><span class="world-always-on">交流 ON</span></div><button type="button" class="world-invite-alert" data-world-invite hidden>招待が届いています</button>';
    stage.append(bar);
    bar.querySelector('[data-world-nearby]').onclick=()=>openNearby();
    bar.querySelector('[data-world-rooms]').onclick=()=>{void LT.Rooms?.open?.();};
    bar.querySelector('[data-world-invite]').onclick=()=>{if(incoming)showIncoming(incoming);};
  }
  function status(){
    mount();if(!bar)return;
    const state=game()?.state,peers=state?model.actors(state.map):[];
    bar.hidden=!playing();bar.dataset.connected=String(connected&&active());
    const label=!online()?'接続待ち · 回線が戻ると自動で再開':document.hidden?'復帰すると交流を再開':connected?`世界と接続 · このエリア ${peers.length}人`:failures?'再接続中 · 冒険は続けられます':'世界につないでいます…';
    const text=bar.querySelector('[data-world-status]');if(text.textContent!==label)text.textContent=label;
    bar.querySelector('[data-world-nearby]').disabled=!connected||!playing()||isBusy();
    bar.querySelector('[data-world-rooms]').disabled=!online()||!playing()||isBusy();
    const alert=bar.querySelector('[data-world-invite]');alert.hidden=!incoming;alert.textContent=incoming?`${incoming.from.name}から${incoming.kind==='trade'?'交換':'対戦'}のお誘い`:'';
  }
  function makeDialog(){
    if(dialog)return;
    dialog=document.createElement('dialog');dialog.id='world-player-dialog';dialog.className='world-player-dialog';dialog.setAttribute('aria-labelledby','world-dialog-title');document.body.append(dialog);
    dialog.addEventListener('cancel',event=>{if(working){event.preventDefault();return;}if(dialogMode==='incoming'){event.preventDefault();void respond(false);}});
    dialog.addEventListener('close',()=>{selectedPeer=null;dialogMode='';schedule(50);});
    dialog.addEventListener('click',event=>{
      const button=event.target.closest('[data-world-action]');if(!button||button.disabled||working)return;
      const action=button.dataset.worldAction;
      if(action==='close'){dialog.close();return;}
      if(action==='select'){const peer=model.peers.get(button.dataset.player);if(peer)showPerson(peer);return;}
      if(action==='battle'||action==='trade'){void invite(selectedPeer,action);return;}
      if(action==='accept'||action==='decline')void respond(action==='accept');
    });
  }
  function show(title,body,mode){
    makeDialog();dialogMode=mode;
    dialog.innerHTML=`<header><div><p>FIELD ENCOUNTER</p><h2 id="world-dialog-title">${escape(title)}</h2></div><button type="button" class="btn btn-small" data-world-action="${mode==='incoming'?'decline':'close'}">閉じる</button></header><div class="world-dialog-body">${body}<p data-world-error role="status" aria-live="polite"></p></div>`;
    if(!dialog.open)dialog.showModal();
    for(const canvas of dialog.querySelectorAll('canvas[data-traveller]'))LT.Art?.traveller?.(canvas,{kind:canvas.dataset.traveller,size:150,facing:'down'});
    status();
  }
  function portrait(person){return `<canvas width="150" height="160" data-traveller="${person.isAdmin?'kasai':person.avatar==='female'?'hero-female':'hero'}" aria-label="${escape(person.name)}の姿"></canvas>`;}
  function showPerson(peer){
    selectedPeer={...peer};
    const busy=peer.status==='busy';
    show(peer.name,`<section class="world-trainer-card${peer.isAdmin?' is-kasai':''}">${portrait(peer)}<div><span class="world-trainer-role">${peer.isAdmin?'MYSTERY TRAINER':'ONLINE TRAINER'}</span><h3>${escape(peer.name)}</h3><p>${peer.isAdmin?'「やあ。君のパチモンたちの力、特別なステージで見せてもらおうか。」':busy?'いまは戦闘・交換・会話中です。少し待ってから話しかけてください。':'同じフィールドを旅しているプレイヤーです。対戦や交換に誘えます。'}</p></div></section><div class="world-dialog-actions"><button type="button" class="btn btn-primary" data-world-action="battle" ${busy&&!peer.isAdmin?'disabled':''}>${peer.isAdmin?'カサイとバトル':'対戦を申し込む'}</button><button type="button" class="btn" data-world-action="trade" ${busy?'disabled':''}>交換を申し込む</button></div><p class="world-dialog-note">${peer.isAdmin?'バトルを選ぶとカサイの専用ステージへ移動します。奥のカサイに話しかけるとソロバトルが始まります。':'相手が承諾すると通信を始めます。'}交換は、お互いのパチモンを確認してから確定します。</p>`,'person');
  }
  function openNearby(){
    if(!playing()||isBusy())return false;
    const state=game()?.state;if(!state)return false;
    const peers=model.nearby(state);
    if(peers.length===1){showPerson(peers[0]);return true;}
    show('近くのトレーナー',peers.length?`<p>話しかける相手を選んでください。</p><div class="world-trainer-list">${peers.map(peer=>`<button class="btn" type="button" data-world-action="select" data-player="${peer.id}"><strong>${escape(peer.name)}</strong><span>${peer.status==='busy'?'取り込み中':'話しかけられます'}</span></button>`).join('')}</div>`:'<p>近くにプレイヤーはいません。同じエリアの旅人に近づき、Eキー・Aボタンか「話す・調べる」で話しかけられます。</p><p>実際に接続中の人だけが表示されます。別のエリアを旅している人は、そのエリアで出会えます。</p>','nearby');
    return true;
  }
  function setWorking(value){working=value;if(dialog?.open)for(const button of dialog.querySelectorAll('button'))button.disabled=value;status();}
  function notice(kind,message){(kind==='battle'?LT.OnlineUI:LT.Trade)?.setWorldNotice?.(message);}
  async function cancelOutgoing(message,sendCancel=true){
    const current=outgoing;if(!current)return;
    if(current.phase==='cancelling')return;
    const previous=current.phase;current.phase='cancelling';
    if(sendCancel&&current.id&&previous!=='accepted'){try{await api('/world/invitations/'+current.id+'/cancel',{method:'POST',body:{}});}catch(_){} }
    let closed;
    try{closed=await (current.kind==='battle'?LT.OnlineUI:LT.Trade)?.cancelWorldWait?.(message);}catch(_){}
    // A trade heartbeat may already be in flight. Keep this exact offer locked
    // until its conditional cleanup runs; never clean up a newer room.
    const trade=current.kind==='trade'?LT.Trade?.worldState?.():null;
    if(outgoing===current&&closed===false&&trade?.active&&!trade.connected&&trade.state==='open'&&(current.cleanupAttempts||0)<12){
      current.cleanupAttempts=(current.cleanupAttempts||0)+1;current.phase='cancel-retry';
      setTimeout(()=>{if(outgoing===current)void cancelOutgoing(message,false);},500);return;
    }
    if(outgoing===current)outgoing=null;
    if(message)say(message);schedule(50);
  }
  async function invite(peer,kind){
    if(!peer||outgoing||incoming||working)return;
    const state=game()?.state;
    if(!active()||!state||distance({x:peer.targetX??peer.x,y:peer.targetY??peer.y},state)>3){say('相手に近づいてから話しかけてください。');return;}
    if(peer.isAdmin&&kind==='battle'){
      dialog?.close();setWorking(true);
      try{await LT.Rooms?.enterKasai?.(peer.id);}finally{setWorking(false);schedule(50);}return;
    }
    setWorking(true);
    const current={target:{id:peer.id,name:peer.name,isAdmin:peer.isAdmin===true,avatar:peer.avatar},kind,phase:'preparing',id:null,createdAt:Date.now()};outgoing=current;
    dialog?.close();
    try{
      if(inFlight)await inFlight;
      if(!await pulse())throw Error('フィールドに接続できませんでした。少し待ってお試しください。');
      if(!active()||outgoing!==current)throw Error('フィールドに接続してから、もう一度お試しください。');
      const onRoomReady=async code=>{
        try{
        if(outgoing!==current||!active())throw Error('申し込みを取り消しました。');
        current.phase='sending';
        const data=await api('/world/invitations',{method:'POST',body:{targetId:current.target.id,kind,roomCode:code,requestId:crypto.randomUUID()}});
        const invitation=data.invitation;
        if(!invitation?.id)throw Error('申し込みを確認できませんでした。');
        if(outgoing!==current){void api('/world/invitations/'+invitation.id+'/cancel',{method:'POST',body:{}}).catch(()=>{});throw Error('申し込みを取り消しました。');}
        current.id=invitation.id;current.phase='pending';current.expiresAt=invitation.expiresAt;
        notice(kind,`${current.target.name}に申し込みました。相手の返事を待っています。`);schedule(200);
        }catch(error){if(outgoing===current)await cancelOutgoing(error?.message||'申し込みを送れませんでした。');throw error;}
      };
      const options={transport:'internet',autoHost:true,encounter:current.target,onRoomReady};
      const opened=kind==='battle'?LT.requestOnline?.(options):await LT.Trade?.open?.(options);
      if(opened!==true)throw Error('いまは通信を開始できません。進行中の操作を終えてからお試しください。');
    }catch(error){await cancelOutgoing(error?.message||'申し込みできませんでした。');}
    finally{setWorking(false);}
  }
  function showIncoming(invitation){
    if(working||outgoing||!active()||(!dialog?.open&&isBusy()))return false;
    if(invitation.expiresAt<=Date.now()+clockOffset)return false;
    incoming=invitation;
    const person=invitation.from,kind=invitation.kind==='trade'?'交換':'対戦';
    show(`${kind}のお誘い`,`${portrait(person)}<p class="world-inviter"><strong>${escape(person.name)}</strong>から${kind}に誘われています。</p><p>${invitation.kind==='trade'?'部屋に入ってから、お互いのパチモンを選びます。両者が確認するまで交換は確定しません。':'承諾すると対戦の準備画面へ進みます。冒険の途中から参加できます。'}</p><div class="world-dialog-actions"><button type="button" class="btn btn-primary" data-world-action="accept">${kind}を受ける</button><button type="button" class="btn" data-world-action="decline">今回は見送る</button></div>`,'incoming');
    return true;
  }
  async function respond(accept){
    const invitation=incoming;if(!invitation||working)return;
    setWorking(true);
    try{
      const data=await api('/world/invitations/'+invitation.id+'/respond',{method:'POST',body:{accept}});
      handled.add(invitation.id);incoming=null;dialog?.close();
      if(accept){
        const confirmed=data.invitation;if(confirmed?.state!=='accepted')throw Error('申し込みの期限が切れました。');
        const options={transport:'internet',joinCode:confirmed.roomCode,autoJoin:true,encounter:confirmed.from};
        const opened=confirmed.kind==='battle'?LT.requestOnline?.(options):await LT.Trade?.open?.(options);
        if(opened!==true)throw Error('通信画面を開けませんでした。相手にもう一度申し込んでもらってください。');
      }
    }catch(error){
      if(dialog?.open){const label=dialog.querySelector('[data-world-error]');if(label)label.textContent=error?.message||'返事を送れませんでした。';}
      else say(error?.message||'返事を送れませんでした。');
    }finally{setWorking(false);schedule(50);}
  }
  function processInvitations(data){
    const list=Array.isArray(data.invitations)?data.invitations:[];
    if(outgoing?.id){
      const invitation=list.find(item=>item.id===outgoing.id);
      if(invitation?.state==='accepted'&&outgoing.phase!=='accepted'){
        outgoing.phase='accepted';notice(outgoing.kind,`${outgoing.target.name}が承諾しました。接続しています。`);
      }else if(invitation&&['declined','cancelled','expired'].includes(invitation.state)){
        void cancelOutgoing(invitation.state==='declined'?'相手は今回の申し込みを見送りました。':'申し込みを終了しました。近づいてもう一度話しかけられます。',false);
      }else if(outgoing?.expiresAt&&outgoing.phase!=='accepted'&&data.serverTime>outgoing.expiresAt){void cancelOutgoing('申し込みの時間が過ぎました。もう一度お試しください。');}
    }
    if(outgoing&&['preparing','sending'].includes(outgoing.phase)&&Date.now()-outgoing.createdAt>45000)void cancelOutgoing('接続の準備に時間がかかっています。もう一度お試しください。');
    if(incoming){
      const next=list.find(item=>item.id===incoming.id);
      if(!next||next.state!=='pending'||next.expiresAt<=data.serverTime){
        handled.add(incoming.id);incoming=null;if(dialogMode==='incoming')dialog?.close();
      }
    }
    if(handled.size>120){const keep=[...handled].slice(-60);handled.clear();keep.forEach(id=>handled.add(id));}
    // A reload can leave a short-lived abandoned offer. Close just that offer;
    // existing trade receipts and recovery remain with the trade controller.
    for(const item of list){if(!outgoing&&item.from?.id===model.self?.id&&item.state==='pending'&&!cleanup.has(item.id)){cleanup.add(item.id);void api('/world/invitations/'+item.id+'/cancel',{method:'POST',body:{}}).catch(()=>{});}}
    if(!incoming&&!outgoing){incoming=list.find(item=>item.to?.id===model.self?.id&&item.state==='pending'&&item.expiresAt>data.serverTime&&!handled.has(item.id))||null;}
    if(incoming&&!working&&!isBusy())showIncoming(incoming);
  }
  async function pulse(){
    if(leavePromise)await leavePromise;
    if(inFlight)return inFlight;
    if(!active())return false;
    const state=game()?.state;if(!state?.started||!LT.DATA.maps[state.map])return false;
    const currentEpoch=epoch;
    const payload={map:state.map,x:state.x,y:state.y,facing:state.facing,avatar:state.avatar==='female'?'female':'male',status:networkStatus()};
    if(state.map!==lastMap){model.clear();lastMap=state.map;}
    let task;task=(async()=>{
      try{
        const delay=270-(Date.now()-lastSent);if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
        if(currentEpoch!==epoch||!active())return false;
        lastSent=Date.now();
        const data=await api('/world/presence',{method:'POST',body:payload});
        if(currentEpoch!==epoch||!active())return false;
        if(game()?.state?.map!==payload.map){model.clear();return false;}
        model.ingest(data,payload.map);clockOffset=data.serverTime-Date.now();connected=true;failures=0;lastPayload=JSON.stringify(payload);
        const profile=[model.self.id,model.self.isAdmin,model.self.name].join(':');if(lastProfile!==profile){lastProfile=profile;LT.adminBridge?.refresh?.();}
        processInvitations(data);return true;
      }catch(error){
        if(currentEpoch!==epoch)return false;
        connected=false;failures++;if(error?.staleIdentity||error?.status===401){model.clear();model.self=null;}
        return false;
      }finally{if(inFlight===task)inFlight=null;status();}
    })();
    inFlight=task;return task;
  }
  async function leave(){
    if(leavePromise)return leavePromise;
    epoch++;connected=false;model.clear();lastMap='';lastPayload='';
    // The server also expires missing heartbeats in 15 seconds if a browser
    // terminates a page before its best-effort leave request can finish.
    const pending=inFlight;
    const task=(async()=>{try{if(pending)await pending;if(LT.Admin?.player)await api('/world/presence',{method:'DELETE',keepalive:true});}catch(_){}finally{status();}})();
    leavePromise=task;try{await task;}finally{if(leavePromise===task)leavePromise=null;}
  }
  async function tick(){
    timer=null;
    if(!active()){
      if(connected||lastMap)await leave();
      status();schedule(1500);return;
    }
    await pulse();
    const wait=failures?Math.min(15000,1000*2**Math.min(failures,4)):networkStatus()==='busy'&&!incoming&&!outgoing?1800:500;
    schedule(wait);
  }
  function moved(){
    const state=game()?.state;if(state?.map!==model.map)model.clear();
    if(active()&&!inFlight)schedule(Math.max(0,270-(Date.now()-lastSent)));
  }
  function checkRoom(){
    if(!outgoing||['preparing','sending','cancelling'].includes(outgoing.phase))return;
    const open=outgoing.kind==='battle'?LT.onlineActive:LT.Trade?.worldState?.()?.active;
    if(open===false){const current=outgoing;outgoing=null;if(current.id&&current.phase!=='accepted')void api('/world/invitations/'+current.id+'/cancel',{method:'POST',body:{}}).catch(()=>{});schedule(100);}
  }
  LT.World={
    actors:map=>online()?model.actors(map):[],
    localKind:avatar=>localAdmin()?'kasai':avatar==='female'?'hero-female':'hero',
    displayName:()=>localAdmin()?KASAI:null,
    interact(){if(!active()||!connected||isBusy())return false;const state=game()?.state,peer=state&&model.nearby(state,2)[0];if(!peer)return false;showPerson(peer);return true;},
    isDialogOpen:()=>dialog?.open===true,
    closeDialog(){if(!dialog?.open||working)return false;if(dialogMode==='incoming')void respond(false);else dialog.close();return true;},
    moved,openNearby,
    refreshPresence:async()=>{if(inFlight)await inFlight;return pulse();},
    status:()=>({enabled:true,connected,players:model.actors(game()?.state?.map).length,displayName:localAdmin()?KASAI:null})
  };
  document.addEventListener('pachi-game-ready',()=>schedule(50));
  document.addEventListener('pachi-admin-bridge-ready',()=>schedule(50));
  document.addEventListener('pachi-online-state',checkRoom);
  document.addEventListener('pachi-trade-state',checkRoom);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);void leave();}else schedule(0);});
  root.addEventListener?.('offline',()=>{void leave();schedule(1500);});
  root.addEventListener?.('online',()=>{failures=0;schedule(0);});
  root.addEventListener?.('pagehide',()=>{clearTimeout(timer);void leave();});
  root.addEventListener?.('storage',event=>{if(event.key==='pachi-player-identity-v1'){epoch++;model.clear();model.self=null;incoming=null;outgoing=null;dialog?.close();schedule(250);}});
  mount();status();schedule(800);
})();
