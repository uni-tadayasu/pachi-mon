/* Pachi Monsters — real travellers share the solo field; adventure saves stay local. */
(() => {
  'use strict';
  const root=globalThis,LT=root.LT=root.LT||{};
  const DIRECTIONS=new Set(['down','left','right','up']);
  const PLAYER_ID=/^P[0-9a-f]{16}$/;
  const KASAI='謎のトレーナー カサイ';
  const operatorNames={main:KASAI,sub:'サカイ','sub-sub':'イサカ'};
  const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  function worldProfile(person){
    // Avatar text alone is never an operator credential. An absent role is the
    // original server's main-only format; explicit invalid roles fail closed.
    const role=person?.isAdmin===true?(person.adminRole==='sub'||person.adminRole==='sub-sub'?person.adminRole:person.adminRole==='main'||person.adminRole===undefined?'main':null):null;
    return {name:role?operatorNames[role]:typeof person?.name==='string'&&person.name?person.name.slice(0,40):'旅人',isAdmin:!!role,adminRole:role,
      avatar:role==='main'?'kasai':role==='sub'?'sub-admin':role==='sub-sub'?'sub-sub-admin':person?.avatar==='female'?'female':'male'};
  }
  const profileKey=person=>JSON.stringify([person?.id,person?.isAdmin,[typeof person?.adminRole,person?.adminRole],person?.name,person?.avatar]);
  const portraitKind=person=>{const profile=worldProfile(person);return profile.isAdmin?profile.avatar:profile.avatar==='female'?'hero-female':'hero';};

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
      this.map=map;this.self={...data.self,...worldProfile(data.self)};this.ttl=clamp(Number(data.ttlMs)||15000,5000,30000);
      const next=new Map();
      for(const row of data.players.slice(0,80)){
        if(!PLAYER_ID.test(row?.id||'')||row.id===this.self.id||row.map!==map||!Number.isFinite(row.x)||!Number.isFinite(row.y)||!DIRECTIONS.has(row.facing)||!Number.isFinite(row.updatedAt)||serverTime-row.updatedAt>this.ttl||row.updatedAt>serverTime+2000)continue;
        const old=this.peers.get(row.id);
        if(old&&row.updatedAt<old.updatedAt){next.set(row.id,old);continue;}
        const current=old?this.position(old,now):row;
        const same=old&&old.targetX===row.x&&old.targetY===row.y;
        if(same){next.set(row.id,{...old,...worldProfile(row),status:row.status,facing:row.facing,updatedAt:row.updatedAt,seenAt:now,age:Math.max(0,serverTime-row.updatedAt)});continue;}
        const jump=!old||distance(current,row)>8;
        next.set(row.id,{...row,...worldProfile(row),fromX:jump?row.x:current.x,fromY:jump?row.y:current.y,targetX:row.x,targetY:row.y,sampleAt:now,seenAt:now,age:Math.max(0,serverTime-row.updatedAt),duration:clamp(old?now-old.sampleAt:500,180,850),moved:!jump&&distance(current,row)>.01});
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
  function populationData(data){
    if(!data||!Array.isArray(data.rows)||!Number.isSafeInteger(data.total)||data.total<0||!Number.isFinite(data.serverTime))throw Error('オンライン人数を確認できません。');
    const maps=new Set(),rows=[];let total=0;
    for(const row of data.rows){
      if(typeof row?.map!=='string'||!(/^[a-z][a-z0-9_-]{0,79}$/.test(row.map)||/^room:P[0-9a-f]{16}$/.test(row.map))||maps.has(row.map)||!Number.isSafeInteger(row.count)||row.count<1)throw Error('オンライン人数を確認できません。');
      maps.add(row.map);total+=row.count;if(!Number.isSafeInteger(total))throw Error('オンライン人数を確認できません。');
      rows.push({map:row.map,count:row.count,name:typeof row.name==='string'?row.name.slice(0,80):'',kind:row.kind==='kasai'?'kasai':row.kind==='secret'?'secret':null});
    }
    if(total!==data.total)throw Error('オンライン人数を確認できません。');
    return {rows,total,serverTime:data.serverTime,ttlMs:clamp(Number(data.ttlMs)||15000,5000,30000)};
  }
  const core={WorldPresence,distance,KASAI,populationData};
  if(typeof module!=='undefined'&&module.exports)module.exports=core;
  LT.WorldPresence=WorldPresence;
  if(!root.document?.createElement||!LT.DATA)return;

  const model=new WorldPresence();
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let timer=null,inFlight=null,leavePromise=null,epoch=0,lastSent=0,failures=0,clockOffset=0,connected=false,lastMap='',lastProfile='',lastPayload='',bar=null,dialog=null,dialogMode='',selectedPeer=null,incoming=null,outgoing=null,working=false;
  let population=null,populationRequest=null,populationEpoch=0,populationNext=0,populationQuery='',populationOnlyActive=true,populationError='';
  let presenceProfile=null,presenceProfileKey='';
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
  function localProfile(){
    const player=LT.Admin?.player;if(!PLAYER_ID.test(player?.id||''))return null;
    // A later /me result takes precedence over an earlier presence response.
    // Otherwise, the latest heartbeat can revoke a cached operator appearance.
    const current=model.self?.id===player.id&&player===presenceProfile&&profileKey(player)===presenceProfileKey?model.self:player;
    return worldProfile(current);
  }
  const localAdmin=()=>localProfile()?.isAdmin===true;
  const localName=()=>{const profile=localProfile();return profile?.isAdmin?profile.name:null;};
  const isBusy=(allowLiveRead=false)=>!!(LT.adminBridge?.isBusy?.()||LT.Rooms?.isWorking?.()||LT.KasaiChallenge?.isWorking?.()||LT.KasaiLive?.isWorking?.()||(!allowLiveRead&&LT.KasaiLive?.locked?.())||LT.onlineActive||LT.tradeActive||LT.localTradeActive||LT.Trade?.isLocked?.()||document.querySelector('dialog[open]'));
  function networkStatus(){
    // Creating an invitation opens its room before publishing the directed offer.
    // That room is still available to its one invited player.
    if(outgoing&&['preparing','sending','pending'].includes(outgoing.phase))return 'idle';
    // Preparing a live Kasai request is the intended invitation action, not an
    // unrelated busy state. Its fresh position must remain request-eligible.
    if(LT.KasaiLive?.isRequesting?.()===true)return 'idle';
    if(dialog?.open&&dialogMode==='incoming')return 'idle';
    return isBusy()?'busy':'idle';
  }
  function schedule(delay=500){clearTimeout(timer);timer=setTimeout(()=>{void tick();},delay);}
  function mount(){
    if(bar)return;
    const stage=document.querySelector('.game-stage');if(!stage)return;
    bar=document.createElement('section');bar.className='world-network-bar';bar.setAttribute('aria-label','フィールド交流');
    bar.innerHTML='<div class="world-network-summary"><span class="world-network-indicator" aria-hidden="true"></span><span data-world-status role="status" aria-live="polite"></span></div><div class="world-network-actions"><button type="button" data-world-nearby>近くの人</button><button type="button" data-world-rooms>秘密部屋</button><button type="button" data-world-population aria-haspopup="dialog" aria-controls="world-player-dialog" aria-expanded="false">オンライン一覧</button><span class="world-always-on">交流 ON</span></div><button type="button" class="world-invite-alert" data-world-invite hidden>招待が届いています</button>';
    // A separate row above the canvas keeps connection controls off the
    // traveller sprites, including fixed-height phone and tablet layouts.
    stage.before(bar);
    bar.querySelector('[data-world-nearby]').onclick=()=>openNearby();
    bar.querySelector('[data-world-rooms]').onclick=()=>{void LT.Rooms?.open?.();};
    bar.querySelector('[data-world-population]').onclick=()=>openPopulation();
    bar.querySelector('[data-world-invite]').onclick=()=>{if(incoming)showIncoming(incoming);};
  }
  function status(){
    mount();if(!bar)return;
    bar.hidden=!playing()||!!game()?.battle;bar.dataset.connected=String(connected&&active());
    const label=!online()?'接続待ち':document.hidden?'一時停止':connected?'接続中':failures?'再接続中':'接続中…';
    const text=bar.querySelector('[data-world-status]');if(text.textContent!==label)text.textContent=label;
    bar.querySelector('[data-world-nearby]').disabled=!connected||!playing()||isBusy();
    bar.querySelector('[data-world-rooms]').disabled=!online()||!playing()||isBusy();
    const populationButton=bar.querySelector('[data-world-population]');populationButton.disabled=!playing()||!online()||isBusy(true);populationButton.setAttribute('aria-expanded',String(dialog?.open&&dialogMode==='population'));
    const alert=bar.querySelector('[data-world-invite]');alert.hidden=!incoming;alert.textContent=incoming?`${incoming.from.name}から${incoming.kind==='trade'?'交換':'対戦'}のお誘い`:'';
    if(dialog?.open&&dialogMode==='population')renderPopulation();
  }
  function makeDialog(){
    if(dialog)return;
    dialog=document.createElement('dialog');dialog.id='world-player-dialog';dialog.className='world-player-dialog';dialog.setAttribute('aria-labelledby','world-dialog-title');document.body.append(dialog);
    dialog.addEventListener('cancel',event=>{if(working){event.preventDefault();return;}if(dialogMode==='incoming'){event.preventDefault();void respond(false);}});
    dialog.addEventListener('close',()=>{selectedPeer=null;dialogMode='';invalidatePopulation();status();schedule(50);});
    dialog.addEventListener('click',event=>{
      const button=event.target.closest('[data-world-action]');if(!button||button.disabled||working)return;
      const action=button.dataset.worldAction;
      if(action==='close'){dialog.close();return;}
      if(action==='population-filter'){populationOnlyActive=!populationOnlyActive;renderPopulation();return;}
      if(action==='select'){const peer=model.peers.get(button.dataset.player);if(peer)showPerson(peer);return;}
      if(action==='battle'||action==='trade'){void invite(selectedPeer,action);return;}
      if(action==='accept'||action==='decline')void respond(action==='accept');
    });
  }
  function show(title,body,mode){
    makeDialog();if(dialogMode==='population'&&mode!=='population')invalidatePopulation();dialogMode=mode;dialog.dataset.mode=mode;
    dialog.innerHTML=`<header><div><p>${mode==='population'?'ONLINE STAGES':'FIELD ENCOUNTER'}</p><h2 id="world-dialog-title">${escape(title)}</h2></div><button type="button" class="btn btn-small" data-world-action="${mode==='incoming'?'decline':'close'}">閉じる</button></header><div class="world-dialog-body">${body}<p data-world-error role="status" aria-live="polite"></p></div>`;
    if(!dialog.open)dialog.showModal();
    for(const canvas of dialog.querySelectorAll('canvas[data-traveller]'))LT.Art?.traveller?.(canvas,{kind:canvas.dataset.traveller,size:150,facing:'down'});
    status();
  }
  function invalidatePopulation(){populationEpoch++;population=null;populationRequest=null;populationNext=0;populationError='';}
  function populationFresh(){return population&&population.owner===mine()&&population.map===game()?.state?.map&&active()&&Date.now()-population.sampleAt<=population.ttlMs;}
  function renderPopulation(){
    if(!dialog?.open||dialogMode!=='population')return;
    const summary=dialog.querySelector('[data-world-population-summary]'),list=dialog.querySelector('[data-world-population-list]'),updated=dialog.querySelector('[data-world-population-updated]'),filter=dialog.querySelector('[data-world-population-filter]');
    if(!summary||!list||!updated||!filter)return;
    filter.setAttribute('aria-pressed',String(populationOnlyActive));filter.textContent=populationOnlyActive?'接続中のみ':'全ステージ';
    if(!populationFresh()){
      summary.textContent=!active()?'接続が戻ると人数を更新します。':populationError?'最新のオンライン人数を取得できません。':'オンライン人数を更新しています…';
      list.innerHTML='<li class="world-population-empty">人数を確認中です。</li>';updated.textContent=populationError||'実際に接続が確認できた人数だけを表示します。';return;
    }
    const currentMap=game().state.map,counts=new Map(population.rows.map(row=>[row.map,row])),rows=new Map();
    for(const [map,info] of Object.entries(LT.DATA.maps))if(!info.sharedRoom)rows.set(map,{map,name:info.name||map,count:0});
    for(const row of population.rows){const info=LT.DATA.maps[row.map];rows.set(row.map,{...row,name:row.name||info?.name||row.map});}
    if(!rows.has(currentMap)&&LT.DATA.maps[currentMap])rows.set(currentMap,{map:currentMap,name:LT.DATA.maps[currentMap].name||'秘密部屋',count:0});
    const query=populationQuery.trim().toLocaleLowerCase(),visible=[...rows.values()].filter(row=>(!populationOnlyActive||row.count>0)&&(!query||row.name.toLocaleLowerCase().includes(query)))
      .sort((a,b)=>(Number(b.map===currentMap)-Number(a.map===currentMap))||(b.count-a.count)||a.name.localeCompare(b.name,'ja'));
    summary.textContent=`世界全体 ${population.total}人 · このステージ ${counts.get(currentMap)?.count||0}人（自分を含む）`;
    list.innerHTML=visible.map(row=>`<li class="world-population-row${row.map===currentMap?' is-current':''}"${row.map===currentMap?' aria-current="location"':''}><span><strong>${escape(row.name)}</strong><small>${row.map===currentMap?'現在地':row.kind==='kasai'?'運営の部屋':row.kind==='secret'?'プレイヤーの秘密部屋':'フィールド・建物'}</small></span><span class="world-population-count">${row.count}<small>人</small></span></li>`).join('')||'<li class="world-population-empty">該当するステージはありません。</li>';
    updated.textContent=populationError||`約5秒ごとに更新 · 退出した人は最大${Math.ceil(population.ttlMs/1000)}秒で一覧から外れます。`;
  }
  async function refreshPopulation(){
    if(!dialog?.open||dialogMode!=='population'||!active()||populationRequest||Date.now()<populationNext)return false;
    const task={epoch:populationEpoch,engine:game(),map:game()?.state?.map,owner:mine(),sampleAt:Date.now()};populationRequest=task;populationNext=Date.now()+5000;
    const current=()=>populationRequest===task&&task.epoch===populationEpoch&&dialog?.open&&dialogMode==='population'&&active()&&game()===task.engine&&game()?.state?.map===task.map&&mine()===task.owner;
    try{const data=populationData(await api('/world/population'));if(!current())return false;if(population&&data.serverTime<population.serverTime)return false;population={...data,...task};populationError='';renderPopulation();return true;}
    catch(error){if(current()){populationError='人数を更新できません。接続を確認して再度お試しください。';renderPopulation();}return false;}
    finally{if(populationRequest===task)populationRequest=null;}
  }
  function openPopulation(){
    if(dialog?.open&&dialogMode==='population'){dialog.close();return true;}
    if(!active()||isBusy(true))return false;
    invalidatePopulation();populationQuery='';populationOnlyActive=true;
    show('ステージ別オンライン人数','<p class="world-population-summary" data-world-population-summary role="status" aria-live="polite">オンライン人数を更新しています…</p><div class="world-population-tools"><label for="world-population-search">ステージを探す<input id="world-population-search" type="search" placeholder="ステージ名・部屋名" autocomplete="off"></label><button type="button" class="btn btn-small" data-world-action="population-filter" data-world-population-filter aria-pressed="true">接続中のみ</button></div><ul class="world-population-list" data-world-population-list aria-label="ステージごとの接続人数"></ul><p class="world-dialog-note" data-world-population-updated></p>','population');
    dialog.querySelector('#world-population-search').addEventListener('input',event=>{populationQuery=String(event.target.value||'');renderPopulation();});
    void refreshPopulation();return true;
  }
  function portrait(person){return `<canvas width="150" height="160" data-traveller="${portraitKind(person)}" aria-label="${escape(worldProfile(person).name)}の姿"></canvas>`;}
  function showPerson(peer){
    peer={...peer,...worldProfile(peer)};selectedPeer={...peer};
    const busy=peer.status==='busy',sub=peer.adminRole==='sub'||peer.adminRole==='sub-sub',trainer=sub?escape(peer.name):'カサイ';
    const adminNote=sub?`${trainer}本人と専用ステージへ移動します。60秒以内に近づいて話しかけ、相手が承諾すると対戦が始まります。`:'カサイ本人と専用ステージへ移動します。60秒以内に近づいて話しかけ、カサイが承諾すると対戦が始まります。';
    show(peer.name,`<section class="world-trainer-card${peer.isAdmin?' is-kasai':''}">${portrait(peer)}<div><span class="world-trainer-role">${peer.adminRole==='sub-sub'?'SUB SUB ADMIN':sub?'SUB ADMIN':peer.isAdmin?'MYSTERY TRAINER':'ONLINE TRAINER'}</span><h3>${escape(peer.name)}</h3><p>${peer.isAdmin?(busy?`${trainer}はいま取り込み中です。対戦の受付が再開するまでお待ちください。`:sub?'運営の専用ステージで対戦できます。':'「やあ。君のパチモンたちの力、特別なステージで見せてもらおうか。」'):busy?'いまは戦闘・交換・会話中です。少し待ってから話しかけてください。':'同じフィールドを旅しているプレイヤーです。対戦や交換に誘えます。'}</p></div></section><div class="world-dialog-actions"><button type="button" class="btn btn-primary" data-world-action="battle" ${busy?'disabled':''}>${peer.isAdmin?`${trainer}とバトル`:'対戦を申し込む'}</button><button type="button" class="btn" data-world-action="trade" ${busy?'disabled':''}>交換を申し込む</button></div><p class="world-dialog-note">${peer.isAdmin?adminNote:'相手が承諾すると通信を始めます。'}交換は、お互いのパチモンを確認してから確定します。</p>`,'person');
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
      const trainer=peer.adminRole==='main'?'カサイ':peer.name;
      if(peer.id===mine()||localAdmin()){say('運営は、自分自身や別の運営に挑戦できません。');return;}
      if(peer.status==='busy'){say(`${trainer}はいま取り込み中です。少し待ってから話しかけてください。`);return;}
      dialog?.close();setWorking(true);
      try{if(!LT.KasaiLive?.request)throw Error(`${trainer}との対戦を読み込み中です。`);const result=await LT.KasaiLive.request(peer.id);if(result?.ok===false)say(result.message||`${trainer}に申し込めませんでした。`);}catch(error){say(error?.message||`${trainer}に申し込めませんでした。`);}finally{setWorking(false);schedule(50);}return;
    }
    setWorking(true);
    const current={target:{id:peer.id,...worldProfile(peer)},kind,phase:'preparing',id:null,createdAt:Date.now()};outgoing=current;
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
    const person={...invitation.from,...worldProfile(invitation.from)},kind=invitation.kind==='trade'?'交換':'対戦';
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
      }else if(profileKey(next.from)!==profileKey(incoming.from)){
        incoming=next;if(dialog?.open&&dialogMode==='incoming')showIncoming(next);
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
        const playerProfile=LT.Admin?.player,playerProfileKey=profileKey(playerProfile);
        const data=await api('/world/presence',{method:'POST',body:payload});
        if(currentEpoch!==epoch||!active())return false;
        if(playerProfile?.id&&LT.Admin?.player?.id!==playerProfile.id)return false;
        if(game()?.state?.map!==payload.map){model.clear();return false;}
        model.ingest(data,payload.map);clockOffset=data.serverTime-Date.now();connected=true;failures=0;lastPayload=JSON.stringify(payload);
        presenceProfile=playerProfile;presenceProfileKey=playerProfileKey;
        const profile=profileKey(model.self);if(lastProfile!==profile){lastProfile=profile;LT.adminBridge?.refresh?.();}
        if(dialog?.open&&dialogMode==='person'&&selectedPeer){
          const current=model.peers.get(selectedPeer.id);
          if(!current)dialog.close();
          else if(profileKey(current)!==profileKey(selectedPeer)||current.status!==selectedPeer.status)showPerson(current);
        }
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
    epoch++;connected=false;model.clear();lastMap='';lastPayload='';invalidatePopulation();
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
    if(dialog?.open&&dialogMode==='population'){renderPopulation();void refreshPopulation();}
    const wait=failures?Math.min(15000,1000*2**Math.min(failures,4)):networkStatus()==='busy'&&!incoming&&!outgoing?1800:500;
    schedule(wait);
  }
  function moved(){
    const state=game()?.state;if(state?.map!==model.map)model.clear();
    if(dialog?.open&&dialogMode==='population'&&(population&&population.map!==state?.map||populationRequest&&populationRequest.map!==state?.map)){invalidatePopulation();renderPopulation();void refreshPopulation();}
    if(active()&&!inFlight)schedule(Math.max(0,270-(Date.now()-lastSent)));
  }
  function checkRoom(){
    if(!outgoing||['preparing','sending','cancelling'].includes(outgoing.phase))return;
    const open=outgoing.kind==='battle'?LT.onlineActive:LT.Trade?.worldState?.()?.active;
    if(open===false){const current=outgoing;outgoing=null;if(current.id&&current.phase!=='accepted')void api('/world/invitations/'+current.id+'/cancel',{method:'POST',body:{}}).catch(()=>{});schedule(100);}
  }
  LT.World={
    actors:map=>online()?model.actors(map):[],
    localKind:avatar=>{const profile=localProfile();return profile?.isAdmin?portraitKind(profile):avatar==='female'?'hero-female':'hero';},
    displayName:localName,
    interact(){if(!active()||!connected||isBusy())return false;const state=game()?.state,peer=state&&model.nearby(state,2)[0];if(!peer)return false;showPerson(peer);return true;},
    isDialogOpen:()=>dialog?.open===true,
    closeDialog(){if(!dialog?.open||working)return false;if(dialogMode==='incoming')void respond(false);else dialog.close();return true;},
    moved,openNearby,openPopulation,
    refreshPresence:async()=>{if(inFlight)await inFlight;return pulse();},
    status:()=>({enabled:true,connected,players:model.actors(game()?.state?.map).length,displayName:localName()})
  };
  document.addEventListener('pachi-game-ready',()=>{if(dialogMode==='population')dialog?.close();invalidatePopulation();schedule(50);});
  document.addEventListener('pachi-admin-bridge-ready',()=>schedule(50));
  document.addEventListener('pachi-online-state',checkRoom);
  document.addEventListener('pachi-trade-state',checkRoom);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);void leave();}else schedule(0);});
  root.addEventListener?.('offline',()=>{void leave();schedule(1500);});
  root.addEventListener?.('online',()=>{failures=0;schedule(0);});
  root.addEventListener?.('pagehide',()=>{clearTimeout(timer);void leave();});
  root.addEventListener?.('storage',event=>{if(event.key==='pachi-player-identity-v1'){epoch++;model.clear();model.self=null;presenceProfile=null;presenceProfileKey='';incoming=null;outgoing=null;dialog?.close();schedule(250);}});
  mount();status();schedule(800);
})();
