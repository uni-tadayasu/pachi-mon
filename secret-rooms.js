/* Pachi Monsters — wall entrances, personal rooms, and Kasai's shared stage. */
(() => {
  'use strict';
  const root=globalThis,LT=root.LT=root.LT||{},PLAYER=/^P[0-9a-f]{16}$/;
  const offsets={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
  const copy=value=>JSON.parse(JSON.stringify(value));
  const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const overlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
  function footprint(item,rotation=0){const turn=rotation===90||rotation===270;return {width:turn?item.height:item.width,height:turn?item.width:item.height};}
  function placement(room,catalog,decorations,candidate){
    const item=catalog.find(row=>row.id===candidate.itemId);
    if(!item||!Number.isInteger(candidate.x)||!Number.isInteger(candidate.y)||![0,90,180,270].includes(candidate.rotation))return '家具と配置する場所を選んでください。';
    const rect={x:candidate.x,y:candidate.y,...footprint(item,candidate.rotation)};
    if(rect.x<1||rect.y<2||rect.x+rect.width>room.width-1||rect.y+rect.height>room.height-2)return '壁の内側に収まる場所を選んでください。';
    if((room.protected||[]).some(area=>overlap(rect,area)))return '入口・通路・カサイのステージには家具を置けません。';
    for(const other of decorations){if(other.id===candidate.id)continue;const definition=catalog.find(row=>row.id===other.itemId);if(definition&&overlap(rect,{...other,...footprint(definition,other.rotation)}))return 'ほかの家具と重ならない場所を選んでください。';}
    if(!decorations.some(row=>row.id===candidate.id)&&decorations.length>=32)return '一つの部屋には32個まで飾れます。';
    return null;
  }
  const core={footprint,placement,overlap};if(typeof module!=='undefined'&&module.exports)module.exports=core;
  if(!root.document?.createElement||!LT.DATA)return;

  let rooms=[],mapKey='',mine=null,kasai=null,current=null,catalog=[],dialog=null,dialogMode='',busy=false,epoch=0,poll=null,polling=null;
  let editing=null,draft=[],selectedItem='plant',selectedInstance=null,rotation=0,cursor={x:3,y:4},dirty=false,relocation=null,creation=null;
  const bridge=()=>LT.adminBridge;
  const engine=()=>bridge()?.getEngine?.();
  const playing=()=>bridge()?.isPlaying?.()===true;
  const online=()=>root.navigator?.onLine!==false;
  const owner=()=>LT.Admin?.player?.id;
  const ownsRoom=room=>!!owner()&&room?.id===owner()&&room?.owner?.id===owner();
  const ownsCurrentRoom=()=>!!owner()&&engine()?.map?.sharedRoom===true&&engine()?.map?.roomOwner===owner();
  const isKasaiSelf=()=>LT.Admin?.player?.isAdmin===true||ownsCurrentRoom();
  const toast=message=>bridge()?.toast?.(message);
  const api=(path,options)=>LT.Admin.worldRequest(path,options);
  function available(){return playing()&&!bridge()?.isBusy?.()&&!engine()?.battle&&!LT.KasaiLive?.locked?.()&&!LT.onlineActive&&!LT.localTradeActive&&!LT.tradeActive&&!LT.Trade?.isLocked?.();}
  function operation(){const instance=engine();return {revision:++epoch,instance,map:instance?.state.map,owner:owner()||null};}
  function isCurrent(task){
    if(task.revision!==epoch||task.instance!==engine()||task.map!==engine()?.state.map||!playing())return false;
    // The first request may establish this browser's identity. A storage change
    // invalidates the whole operation before a different identity can inherit it.
    if(task.owner===null)task.owner=owner()||null;
    return task.owner===(owner()||null);
  }
  function finish(task){if(task.revision===epoch)setBusy(false);}
  function resetSession(){epoch++;setBusy(false);rooms=[];mine=null;kasai=null;mapKey='';current=null;editing=null;draft=[];dirty=false;relocation=null;creation=null;selectedInstance=null;dialog?.close();refreshSoon();}
  function error(message){const el=dialog?.querySelector('[data-room-message]');if(el){el.textContent=String(message||'操作できませんでした。');el.classList.add('is-error');}else toast(message);}
  function setBusy(value){
    busy=value;if(!dialog?.open)return;
    for(const node of dialog.querySelectorAll('button,input,select')){
      if(value){if(node.dataset.roomBusyDisabled===undefined)node.dataset.roomBusyDisabled=String(node.disabled);node.disabled=true;}
      else if(node.dataset.roomBusyDisabled!==undefined){node.disabled=node.dataset.roomBusyDisabled==='true';delete node.dataset.roomBusyDisabled;}
    }
  }
  function wallAtPlayer(){
    const e=engine(),s=e?.state,m=e?.map;if(!s||!m||m.sharedRoom||!offsets[s.facing])return null;
    const [dx,dy]=offsets[s.facing],x=s.x+dx,y=s.y+dy;
    if(!['#','B'].includes(m.tiles[y]?.[x]))return null;
    if((m.exits||[]).some(p=>p.x===x&&p.y===y)||(m.npcs||[]).some(p=>p.x===x&&p.y===y))return null;
    return {map:m.id,x,y,facing:s.facing};
  }
  const sameDoor=(a,b)=>!!a&&!!b&&a.map===b.map&&a.x===b.x&&a.y===b.y;
  const sameWall=wall=>{const now=wallAtPlayer();return sameDoor(now,wall)&&now.facing===wall.facing;};
  const occupiedWall=wall=>wall?.map===mapKey?rooms.find(room=>sameDoor(room.entrance,wall))||null:null;
  const defaultRoomName=()=>LT.Admin?.player?.isAdmin===true?'カサイのひみつ部屋':Array.from((bridge()?.getPlayerName?.()||'旅人')+'の秘密部屋').slice(0,24).join('');
  function currentWallTask(task,wall){
    if(!isCurrent(task)||!available())return false;
    if(!sameWall(wall)){error('向いている壁が変わりました。目的の壁の前で、もう一度 A / E を押してください。');refreshSoon();return false;}
    return true;
  }
  function doorAhead(){const s=engine()?.state;if(!s||s.map!==mapKey)return null;const [dx,dy]=offsets[s.facing]||[0,1];return rooms.find(room=>room.entrance.x===s.x+dx&&room.entrance.y===s.y+dy)||null;}
  function mount(){
    if(dialog)return;
    dialog=document.createElement('dialog');dialog.id='secret-room-dialog';dialog.className='secret-room-dialog';dialog.setAttribute('aria-labelledby','secret-room-title');document.body.append(dialog);
    dialog.addEventListener('cancel',event=>{if(busy){event.preventDefault();return;}if(dirty&&(dialogMode==='editor'||dialogMode==='discard')){event.preventDefault();if(dialogMode==='discard')renderEditor();else showDiscard();}});
    dialog.addEventListener('click',event=>{const button=event.target.closest('[data-room-action]');if(!button||button.disabled||busy)return;void action(button);});
    dialog.addEventListener('close',()=>{dialogMode='';editing=null;dirty=false;creation=null;relocation=null;});
  }
  function show(title,body,mode='manager'){
    mount();dialogMode=mode;dialog.innerHTML=`<header class="room-dialog-header"><div><span>SECRET ROOM</span><h2 id="secret-room-title">${escape(title)}</h2></div><button type="button" class="btn btn-small" data-room-action="close">閉じる</button></header><div class="room-dialog-content">${body}<p class="room-message" data-room-message role="status" aria-live="polite"></p></div>`;
    if(!dialog.open)dialog.showModal();
  }
  function roomCard(room,label){return `<button type="button" class="room-visit-card${room.kind==='kasai'?' is-kasai':''}" data-room-action="visit" data-room-owner="${room.id}"><span class="room-door-icon" aria-hidden="true">${room.kind==='kasai'?'◆':'▥'}</span><span><small>${escape(label||room.owner.name)}</small><strong>${escape(room.name)}</strong><em>${room.kind==='kasai'?(ownsRoom(room)?'自分の専用ステージ · 飾りつけできます':'カサイの専用ステージ'):'誰でも自由に入れます'}</em></span><b aria-hidden="true">→</b></button>`;}
  function renderManager(){
    const wall=wallAtPlayer(),here=engine()?.map?.sharedRoom,ownHere=ownsCurrentRoom(),ownKasai=mine?.kind==='kasai'&&ownsRoom(mine);
    const editLabel=ownKasai?'カサイの部屋を飾る':'自分の部屋を飾る',atOwnDoor=sameDoor(wall,mine?.entrance),occupied=occupiedWall(wall);
    const mySection=mine?`${roomCard(mine,ownKasai?'運営カサイの部屋':'自分の秘密部屋')}${!ownHere?`<div class="room-owner-actions"><button class="btn btn-primary" data-room-action="edit-own">${editLabel}</button><button class="btn" data-room-action="relocate" ${wall&&!atOwnDoor&&!occupied?'':'disabled'}>${atOwnDoor?'この壁に自分の部屋があります':occupied?'この壁には部屋の入口があります':'この壁へ部屋を移転'}</button><p class="room-note">部屋は運営も含め一人一つです。別の空いた壁に向かい A / E を押すと、家具と名前をそのままに入口を移せます。</p></div>`:''}`:`<section class="room-empty"><h3>壁の向こうに、自分だけの場所を。</h3><p>外のフィールドや建物の壁に向かい、Aボタン / E を押すと秘密部屋を一つ作れます。入口にはドット絵のドアのマークが付き、ほかの旅人も自由に出入りできます。</p><label for="room-new-name">部屋の名前</label><input id="room-new-name" maxlength="24" value="${escape(defaultRoomName())}"><button type="button" class="btn btn-primary" data-room-action="create" ${wall&&!occupied?'':'disabled'}>${occupied?'この壁には部屋の入口があります':wall?'この壁に部屋を作る':'壁に向かってから開いてください'}</button></section>`;
    show(here?engine().map.name:'秘密部屋',`${here?`<div class="room-current-info"><span>${escape(current?.owner?.name||'旅人')}の部屋</span><div>${ownHere?`<button class="btn btn-primary" data-room-action="edit">${ownKasai?'カサイの部屋を飾る':'家具を飾る'}</button>`:''}<button class="btn" data-room-action="leave">フィールドへ戻る</button></div></div>`:''}<section><h3>MY ROOM</h3>${mySection}</section>${kasai&&kasai.id!==mine?.id?`<section><h3>カサイの間</h3>${roomCard(kasai,'謎のトレーナー カサイ')}</section>`:''}<section><div class="room-section-heading"><h3>このエリアの部屋</h3><button class="btn btn-small" data-room-action="refresh">更新</button></div><div class="room-visit-list">${rooms.filter(row=>row.id!==mine?.id&&row.id!==kasai?.id).map(row=>roomCard(row)).join('')||'<p class="room-muted">このエリアには、ほかの秘密部屋がまだありません。</p>'}</div></section>${LT.Admin?.player?.isAdmin!==true&&kasai?.id!==owner()?'<section class="room-reward-check"><button type="button" class="btn" data-room-action="reward">カサイの勝利報酬を確認</button><p class="room-note">ひかえに空きを作った後の受け取りも、ここから確認できます。</p></section>':''}<p class="room-note">入口の前で A / E を押しても入れます。部屋の持ち主だけが家具を変更できます。</p>`);
  }
  async function loadCatalog(){if(catalog.length)return;const data=await api('/world/rooms/catalog');if(!Array.isArray(data.catalog)||!data.catalog.length)throw Error('家具の一覧を読み込めません。');catalog=data.catalog;}
  async function open(){
    if(!available()||busy)return false;
    if(!online()){toast('秘密部屋は接続が戻ると利用できます。');return false;}
    bridge()?.closeModal?.();creation=null;relocation=null;const task=operation();show('秘密部屋','<p>部屋の入口を探しています…</p>');setBusy(true);
    try{
      const [self,special]=await Promise.all([api('/world/rooms/mine'),api('/world/rooms/kasai'),loadCatalog()]);
      if(!isCurrent(task))return false;mine=self.room||null;kasai=special.room||null;if(kasai?.id===owner())mine=kasai;
      const e=task.instance;if(!e.map.sharedRoom){const data=await api('/world/rooms?map='+encodeURIComponent(task.map));if(!isCurrent(task))return false;mapKey=task.map;rooms=data.rooms||[];}
      else{const data=await api('/world/rooms/'+e.map.roomOwner);if(!isCurrent(task))return false;current=data.room;}
      renderManager();return true;
    }catch(err){if(isCurrent(task))error(err.message);return false;}finally{finish(task);}
  }
  function reviewCreation(wall){
    if(busy||!available()||!sameWall(wall)||mine||occupiedWall(wall))return false;
    creation={wall:{...wall},instance:engine(),owner:owner()};relocation=null;
    show('この壁に部屋を作りますか？',`<section class="room-empty room-wall-review"><div class="room-wall-preview"><canvas id="room-entrance-preview" width="96" height="96" aria-hidden="true"></canvas><p><strong>${escape(engine().map.name)}</strong><br>いま向いている壁に、入口のマークが付きます。</p></div><p>${LT.Admin?.player?.isAdmin===true?'専用の対戦ステージがある、カサイの部屋を作ります。':'家具を飾れて、ほかのプレイヤーも訪問できる秘密部屋を作ります。'}部屋は一人一つ。あとから別の壁へ移転できます。</p><label for="room-new-name">部屋の名前</label><input id="room-new-name" maxlength="24" value="${escape(defaultRoomName())}"><div class="room-dialog-actions"><button type="button" class="btn btn-primary" data-room-action="create">この壁に部屋を作る</button><button type="button" class="btn" data-room-action="close">やめる</button></div></section>`,'create');
    LT.RoomArt?.drawDoor?.(dialog.querySelector('#room-entrance-preview').getContext('2d'),{kind:LT.Admin?.player?.isAdmin===true?'kasai':'secret',entrance:{x:0,y:0,facing:wall.facing}},{tileSize:96,label:false,active:true});return true;
  }
  async function inspectWall(wall){
    if(busy||!available())return false;
    if(!online()){toast('接続が戻ると、壁から秘密部屋を作成・移転できます。');return false;}
    creation=null;relocation=null;const task=operation();let route=null;
    show('壁の入口を確認しています','<p>この壁にある部屋と、自分の部屋を確認しています…</p>','wall');setBusy(true);
    try{
      const [area,self]=await Promise.all([api('/world/rooms?map='+encodeURIComponent(wall.map)),api('/world/rooms/mine')]);
      if(!currentWallTask(task,wall))return false;
      if(!Array.isArray(area.rooms)||self.room&&!ownsRoom(self.room))throw Error('部屋の入口を確認できませんでした。もう一度お試しください。');
      rooms=area.rooms;mapKey=wall.map;mine=self.room||null;if(mine?.kind==='kasai')kasai=mine;else if(kasai?.id===owner())kasai=null;
      const door=occupiedWall(wall);route=door?{visit:door.id}:mine?'relocate':'create';
    }catch(err){if(isCurrent(task))error(err.message);return false;}finally{finish(task);}
    if(!route||!currentWallTask(task,wall))return false;
    if(route.visit)return enter(route.visit,false,wall);
    return route==='relocate'?reviewRelocation():reviewCreation(wall);
  }
  async function create(){
    if(busy||!available())return false;
    const wall=wallAtPlayer();if(!wall){error('壁に向かって立ってからお試しください。');return;}
    if(mine){error('自分の部屋は一つです。別の壁へ移転できます。');return false;}
    if(occupiedWall(wall)){error('この壁には、すでに部屋の入口があります。A / E で入室できます。');return false;}
    if(creation&&(creation.owner!==owner()||creation.instance!==engine()||!sameWall(creation.wall))){error('作成する壁が変わりました。目的の壁の前で、もう一度 A / E を押してください。');return false;}
    const name=dialog.querySelector('#room-new-name')?.value||defaultRoomName(),task=operation();let created=null;setBusy(true);
    try{
      if(!await LT.World?.refreshPresence?.())throw Error('フィールドの接続を確認してから、もう一度お試しください。');
      if(!currentWallTask(task,wall))return false;
      const data=await api('/world/rooms',{method:'POST',body:{...wall,name}});if(!currentWallTask(task,wall))return false;
      if(!ownsRoom(data.room)||!sameDoor(data.room.entrance,wall))throw Error('自分の秘密部屋の入口を確認できませんでした。');
      mine=data.room;if(mine.kind==='kasai')kasai=mine;rooms=[...rooms.filter(row=>row.id!==mine.id),mine];mapKey=wall.map;creation=null;created=mine.id;toast('壁に秘密部屋の入口マークができました。');
    }
    catch(err){if(isCurrent(task))error(err.message);}finally{finish(task);}
    return created&&currentWallTask(task,wall)?enter(created,false,wall):false;
  }
  function reviewRelocation(){
    if(busy||!available()||!ownsRoom(mine))return false;
    const wall=wallAtPlayer();if(!wall){error('移転したい壁に向かって立ってください。');return false;}
    if(wall.map===mine.entrance.map&&wall.x===mine.entrance.x&&wall.y===mine.entrance.y){error('この壁には、すでに自分の部屋があります。');return false;}
    if(occupiedWall(wall)){error('この壁には、ほかの部屋の入口があります。A / E で入室できます。');return false;}
    creation=null;
    relocation={roomId:mine.id,revision:mine.revision,wall,instance:engine(),owner:owner()};
    show('秘密部屋を移転しますか？',`<div class="room-relocation-review"><strong>${escape(mine.name)}</strong><p>移転先：${escape(engine().map.name)}の、いま向いている壁</p><p>家具と部屋の名前${mine.kind==='kasai'?'、専用ステージ':''}はそのまま引き継がれます。以前の壁の入口はなくなり、新しい入口から出入りできます。</p></div><div class="room-dialog-actions"><button class="btn btn-primary" data-room-action="confirm-relocate">この壁へ移転する</button><button class="btn" data-room-action="cancel-relocate">戻る</button></div>`,'relocate');return true;
  }
  async function relocate(){
    if(busy||!available()||!relocation)return false;
    const destination=relocation,wall=wallAtPlayer();
    if(destination.owner!==owner()||destination.instance!==engine()||!wall||JSON.stringify(wall)!==JSON.stringify(destination.wall)){error('移転先の壁が変わりました。いまの場所で秘密部屋を開き直してください。');return false;}
    const task=operation();setBusy(true);
    try{
      if(!await LT.World?.refreshPresence?.())throw Error('フィールドの接続を確認してから、もう一度お試しください。');
      if(!currentWallTask(task,wall))return false;
      const data=await api('/world/rooms/'+destination.roomId+'/relocate',{method:'POST',body:{revision:destination.revision,...wall}});
      if(!currentWallTask(task,wall))return false;if(!ownsRoom(data.room)||!sameDoor(data.room.entrance,wall))throw Error('移転した部屋の入口を確認できませんでした。');
      mine=data.room;if(mine.kind==='kasai')kasai=mine;rooms=rooms.filter(room=>room.id!==mine.id);if(mapKey===mine.entrance.map)rooms.push(mine);relocation=null;
      bridge()?.refresh?.();renderManager();toast('秘密部屋を移転しました。家具と名前はそのままです。');return true;
    }catch(err){if(isCurrent(task))error(err.message||'移転できませんでした。部屋は一覧から確認できます。');return false;}finally{finish(task);}
  }
  async function enter(id,expectedKasai=false,expectedWall=null){
    if(busy||!PLAYER.test(id)||!available()||!online())return false;
    const task=operation();setBusy(true);
    try{
      const data=await api(expectedKasai?'/world/rooms/kasai':'/world/rooms/'+id),room=data.room;
      if(!isCurrent(task)||!available())return false;
      if(!room||room.id!==id||room.owner?.id!==id)throw Error('部屋を確認できません。もう一度お試しください。');
      if(expectedWall&&(!sameWall(expectedWall)||!sameDoor(room.entrance,expectedWall))){refreshSoon();throw Error('部屋の入口か現在地が変わりました。壁の前で、もう一度 A / E を押してください。');}
      if(expectedKasai&&room.kind!=='kasai')throw Error('カサイの部屋を確認できません。もう一度話しかけてください。');
      const map=LT.RoomArt.createMap(room),result=bridge().enterSharedRoom(map);
      if(!result?.ok)throw Error(result?.message||'今は部屋へ移動できません。');
      current=room;if(room.id===owner())mine=room;dialog?.close();toast(room.kind==='kasai'?(isKasaiSelf()?'自分の専用ステージへ。「秘密部屋」からカサイの部屋を飾れます。':'カサイの部屋へ。対戦は、接続中のカサイ本人に話しかけて申し込めます。'):`${room.name}へようこそ。${room.id===owner()?'「秘密部屋」から家具を飾れます。':'出口からフィールドへ戻れます。'}`);return true;
    }catch(err){if(task.revision===epoch)error(err.message);return false;}finally{finish(task);}
  }
  async function enterKasai(id){
    if(busy||!available())return false;
    if(id)return enter(id,true);
    if(!online())return false;const task=operation();let target=null;setBusy(true);
    try{const data=await api('/world/rooms/kasai');if(!isCurrent(task))return false;if(!data.room){toast('カサイの部屋はまだ準備中です。');return false;}kasai=data.room;target=kasai.id;}catch(err){if(isCurrent(task))toast(err.message);}finally{finish(task);}
    return target&&isCurrent(task)?enter(target,true):false;
  }
  async function enterLive(room,session){
    if(busy||dirty||dialog?.open||!playing()||!room||room.kind!=='kasai'||!PLAYER.test(room.id||'')||room.owner?.id!==room.id||session?.roomId!==room.id)return {ok:false,message:'進行中の操作を終えてから、カサイのステージへ移動できます。'};
    const task=operation(),result=await bridge()?.stageKasaiLive?.(room,session);
    if(!result?.ok)return result||{ok:false,message:'対戦ステージを準備できません。'};
    if(task.revision!==epoch||task.instance!==engine()||task.owner!==(owner()||null))return {ok:false,message:'プレイヤー情報が変わりました。'};
    current=room;kasai=room;if(ownsRoom(room))mine=room;refreshSoon();return result;
  }
  function leave(){if(LT.KasaiLive?.locked?.())return LT.KasaiLive.leave?.();const result=bridge()?.leaveSharedRoom?.();if(result?.ok){current=null;dialog?.close();toast('部屋の入口へ戻りました。');refreshSoon();}else error(result?.message||'今は外へ戻れません。');return result;}
  function showDiscard(){show('飾りつけを保存しますか？','<p>まだ保存していない変更があります。</p><div class="room-dialog-actions"><button class="btn btn-primary" data-room-action="save">保存する</button><button class="btn" data-room-action="resume">編集を続ける</button><button class="btn" data-room-action="discard">保存せず閉じる</button></div>','discard');}
  function close(){if(!dialog?.open||busy)return false;if(dirty&&(dialogMode==='editor'||dialogMode==='discard')){if(dialogMode==='discard')renderEditor();else showDiscard();return false;}dialog.close();return true;}
  function editor(room){editing=copy(room);draft=copy(room.decorations||[]);dirty=false;selectedInstance=null;cursor={x:3,y:4};rotation=0;renderEditor();}
  function renderEditor(){
    if(!editing)return;
    const catalogHtml=catalog.map(item=>`<button type="button" class="room-item${item.id===selectedItem?' is-selected':''}" data-room-action="item" data-room-item="${item.id}" aria-pressed="${item.id===selectedItem}"><canvas width="64" height="64" data-room-thumbnail="${item.id}" aria-hidden="true"></canvas><span>${escape(item.name)}</span><small>${item.width} × ${item.height}</small></button>`).join('');
    show(editing.kind==='kasai'?'カサイの部屋を飾る':'秘密部屋を飾る',`<p class="room-note">家具を選び、部屋の置きたい場所をタップしてください。配置・移動してから「保存する」で反映されます。${editing.kind==='kasai'?'中央の対戦ステージと通路の両側を飾れます。':''}</p><div class="room-editor"><div class="room-palette" aria-label="家具の一覧">${catalogHtml}</div><div class="room-plan"><canvas id="room-editor-canvas" width="${editing.width*28}" height="${editing.height*28}" tabindex="0" role="img" aria-label="部屋の配置図。矢印キーでも配置位置を選べます。"></canvas><div class="room-position"><label>X <input id="room-x" type="number" min="1" max="${editing.width-2}" value="${cursor.x}"></label><label>Y <input id="room-y" type="number" min="2" max="${editing.height-2}" value="${cursor.y}"></label><button class="btn btn-small" data-room-action="rotate">回転 ${rotation}°</button></div><p class="room-selection" data-room-selection></p><div class="room-editor-actions"><button class="btn btn-primary" data-room-action="place">${selectedInstance?'ここへ移動':'ここに置く'}</button><button class="btn" data-room-action="remove">選んだ家具を片付ける</button></div></div></div><div class="room-save-row"><label>部屋の名前<input id="room-edit-name" maxlength="24" value="${escape(editing.name)}"></label><span data-room-count>${draft.length} / 32 個${dirty?' · 未保存':''}</span><button class="btn btn-primary" data-room-action="save">保存する</button><button class="btn" data-room-action="reload">保存済みに戻す</button></div>`,'editor');
    for(const canvas of dialog.querySelectorAll('[data-room-thumbnail]'))LT.RoomArt.renderThumbnail(canvas,canvas.dataset.roomThumbnail);
    const canvas=dialog.querySelector('#room-editor-canvas');
    canvas.addEventListener('click',event=>{const rect=canvas.getBoundingClientRect();cursor={x:Math.max(1,Math.min(editing.width-2,Math.floor((event.clientX-rect.left)/rect.width*editing.width))),y:Math.max(2,Math.min(editing.height-2,Math.floor((event.clientY-rect.top)/rect.height*editing.height)))};pickAtCursor();updateCursor();});
    canvas.addEventListener('keydown',event=>{const delta={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[event.key];if(delta){event.preventDefault();cursor.x=Math.max(1,Math.min(editing.width-2,cursor.x+delta[0]));cursor.y=Math.max(2,Math.min(editing.height-2,cursor.y+delta[1]));updateCursor();}});
    for(const id of ['room-x','room-y'])dialog.querySelector('#'+id).addEventListener('input',()=>{cursor.x=Number(dialog.querySelector('#room-x').value);cursor.y=Number(dialog.querySelector('#room-y').value);drawEditor();});
    dialog.querySelector('#room-edit-name').addEventListener('input',event=>{editing.name=event.target.value;dirty=true;});drawEditor();
  }
  function pickAtCursor(){const found=draft.find(row=>{const def=catalog.find(item=>item.id===row.itemId);return def&&overlap({x:cursor.x,y:cursor.y,width:1,height:1},{...row,...footprint(def,row.rotation)});});if(found){selectedInstance=found.id;selectedItem=found.itemId;rotation=found.rotation;}else selectedInstance=null;}
  function updateCursor(){if(!dialog?.open||dialogMode!=='editor')return;dialog.querySelector('#room-x').value=cursor.x;dialog.querySelector('#room-y').value=cursor.y;dialog.querySelector('[data-room-action="rotate"]').textContent=`回転 ${rotation}°`;dialog.querySelector('[data-room-action="place"]').textContent=selectedInstance?'ここへ移動':'ここに置く';for(const button of dialog.querySelectorAll('[data-room-item]')){const chosen=button.dataset.roomItem===selectedItem;button.classList.toggle('is-selected',chosen);button.setAttribute('aria-pressed',String(chosen));}drawEditor();}
  function drawEditor(){
    const canvas=dialog?.querySelector('#room-editor-canvas');if(!canvas||!editing)return;
    const map=LT.RoomArt.createMap({...editing,decorations:draft}),ctx=canvas.getContext('2d'),scale=canvas.width/(map.width*64);
    ctx.setTransform(scale,0,0,scale,0,0);ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,map.width*64,map.height*64);
    for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++)LT.RoomArt.ground(ctx,map,x,y);
    LT.RoomArt.dressing(ctx,map);LT.RoomArt.renderDecor(ctx,map,{layer:'objects'});
    ctx.strokeStyle='#d5e5d82c';ctx.lineWidth=1/scale;for(let x=1;x<map.width;x++){ctx.beginPath();ctx.moveTo(x*64,64);ctx.lineTo(x*64,(map.height-1)*64);ctx.stroke();}for(let y=2;y<map.height;y++){ctx.beginPath();ctx.moveTo(64,y*64);ctx.lineTo((map.width-1)*64,y*64);ctx.stroke();}
    const item=catalog.find(row=>row.id===selectedItem),size=item?footprint(item,rotation):{width:1,height:1},candidate={id:selectedInstance,itemId:selectedItem,...cursor,rotation},problem=placement(editing,catalog,draft,candidate);
    if(Number.isFinite(cursor.x)&&Number.isFinite(cursor.y)){ctx.fillStyle=problem?'#d86f5f55':'#9bd6b855';ctx.fillRect(cursor.x*64,cursor.y*64,size.width*64,size.height*64);ctx.strokeStyle=problem?'#ff9881':'#eff4b0';ctx.lineWidth=3/scale;ctx.strokeRect(cursor.x*64+2,cursor.y*64+2,size.width*64-4,size.height*64-4);}
    ctx.setTransform(1,0,0,1,0,0);const label=dialog.querySelector('[data-room-selection]');label.textContent=`${item?.name||'家具'} · (${cursor.x}, ${cursor.y})${problem?' · '+problem:''}`;label.classList.toggle('is-error',!!problem);
  }
  function place(){const entry={id:selectedInstance||crypto.randomUUID(),itemId:selectedItem,x:cursor.x,y:cursor.y,rotation},problem=placement(editing,catalog,draft,entry);if(problem){error(problem);return;}draft=[...draft.filter(row=>row.id!==entry.id),entry];selectedInstance=entry.id;dirty=true;renderEditor();}
  function remove(){if(!selectedInstance)pickAtCursor();if(!selectedInstance){error('片付ける家具をタップしてください。');return;}draft=draft.filter(row=>row.id!==selectedInstance);selectedInstance=null;dirty=true;renderEditor();}
  async function saveDecor(){
    if(LT.KasaiLive?.locked?.()){error('対戦の待ち合わせ中は飾りつけを変更できません。');return;}if(busy||!editing||editing.owner.id!==owner())return;const task=operation(),roomId=editing.id,body={revision:editing.revision,name:editing.name,decorations:copy(draft)};setBusy(true);
    try{const data=await api('/world/rooms/'+roomId,{method:'PATCH',body});if(!isCurrent(task)||editing?.id!==roomId)return;if(data.room?.id!==owner())throw Error('保存結果を確認できませんでした。');mine=data.room;if(kasai?.id===mine.id)kasai=mine;rooms=rooms.map(room=>room.id===mine.id?mine:room);dirty=false;if(engine()?.map?.roomOwner===mine.id){current=mine;bridge().refreshSharedRoom?.(LT.RoomArt.createMap(mine));}editor(mine);toast('飾りつけを保存しました。ほかのプレイヤーにも見えるようになります。');}
    catch(err){if(isCurrent(task))error(err.message||'保存できませんでした。変更はこの画面に残っています。');}finally{finish(task);}
  }
  async function loadEditor(reload=false){
    if(busy||!available())return false;const task=operation(),roomId=reload?editing?.id:owner();if(!roomId||roomId!==owner())return false;setBusy(true);
    try{await loadCatalog();if(!isCurrent(task))return false;const data=await api(reload?'/world/rooms/'+roomId:'/world/rooms/mine');if(!isCurrent(task))return false;if(ownsRoom(data.room)){mine=data.room;editor(data.room);return true;}error('自分の部屋で飾りつけできます。');return false;}
    catch(err){if(isCurrent(task))error(err.message);return false;}finally{finish(task);}
  }
  async function decorateMine(){
    if(busy||!available())return false;
    if(!online()){toast('秘密部屋は接続が戻ると利用できます。');return false;}
    if(dialog?.open&&(dialogMode==='editor'||dialogMode==='discard'))return true;
    bridge()?.closeModal?.();show('自分の部屋を飾る','<p>部屋の飾りつけを読み込んでいます…</p>');
    return loadEditor();
  }
  async function action(button){
    switch(button.dataset.roomAction){
      case 'close':close();break;case 'refresh':await open();break;case 'create':await create();break;
      case 'relocate':reviewRelocation();break;case 'confirm-relocate':await relocate();break;case 'cancel-relocate':relocation=null;await open();break;
      case 'visit':await enter(button.dataset.roomOwner);break;case 'leave':leave();break;
      case 'edit':case 'edit-own':await decorateMine();break;
      case 'reward':if(LT.Admin?.player?.isAdmin!==true&&kasai?.id!==owner()){dialog.close();if(LT.KasaiChallenge?.openRewards)await LT.KasaiChallenge.openRewards();else toast('報酬の確認画面を読み込み中です。');}break;
      case 'item':selectedItem=button.dataset.roomItem;selectedInstance=null;updateCursor();break;
      case 'rotate':rotation=(rotation+90)%360;updateCursor();break;case 'place':place();break;case 'remove':remove();break;
      case 'save':await saveDecor();break;case 'resume':renderEditor();break;case 'discard':dirty=false;dialog.close();break;
      case 'reload':await loadEditor(true);break;
    }
  }
  async function refresh(){
    if(polling||busy||!playing()||!online()||document.hidden){refreshSoon(5000);return;}
    const e=engine(),map=e.state.map,who=owner(),revision=epoch;
    polling=(async()=>{try{
      if(e.map.sharedRoom){const data=await api('/world/rooms/'+e.map.roomOwner);if(revision!==epoch||e!==engine()||e.state.map!==map||owner()!==who)return;if(data.room?.kind===e.map.roomKindTag&&data.room.revision<e.map.roomRevision)return;current=data.room;if(data.room?.revision!==e.map.roomRevision||data.room?.kind!==e.map.roomKindTag){if(!e.battle&&!busy&&!dirty)bridge().refreshSharedRoom?.(LT.RoomArt.createMap(data.room));}}
      else{const data=await api('/world/rooms?map='+encodeURIComponent(map));if(revision!==epoch||e!==engine()||e.state.map!==map||owner()!==who)return;rooms=data.rooms||[];mapKey=map;}
    }catch(_){}finally{polling=null;refreshSoon(5000);}})();return polling;
  }
  function refreshSoon(delay=80){clearTimeout(poll);poll=setTimeout(()=>{void refresh();},delay);}
  LT.Rooms={
    open,enter,enterKasai,enterLive,leave,decorateMine,
    isDialogOpen:()=>dialog?.open===true,isWorking:()=>busy,closeDialog:close,
    current:()=>current,
    moved(){if(engine()?.state.map!==mapKey)refreshSoon();},
    hint(){const liveHint=LT.KasaiLive?.hint?.();if(liveHint)return liveHint;const door=doorAhead();if(door)return `${door.name} · A / E で入室`;if(wallAtPlayer())return '秘密部屋 · A / E で作成・移転';return null;},
    interact(){
      if(LT.KasaiLive?.canTalk?.()&&!dialog?.open&&!busy){void LT.KasaiLive.talk();return true;}
      if(!available()||dialog?.open||busy)return false;
      // Even before the area poll arrives, the wall is checked on the server.
      // An occupied entrance is always a visit, never a create/relocate target.
      const wall=wallAtPlayer();if(wall){void inspectWall(wall);return true;}return false;
    },
    drawEntrances(ctx,map){if(map.id!==mapKey||map.sharedRoom)return;const ahead=doorAhead();for(const room of rooms)LT.RoomArt?.drawDoor?.(ctx,room,{tileSize:64,active:ahead?.id===room.id});}
  };
  document.addEventListener('pachi-game-ready',()=>{resetSession();const task={revision:epoch,instance:engine(),map:engine()?.state.map,owner:owner()||null};void api('/world/rooms/kasai').then(data=>{if(isCurrent(task)){kasai=data.room||null;refreshSoon();}},()=>refreshSoon());});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshSoon();});
  root.addEventListener('online',()=>refreshSoon());
  root.addEventListener('storage',event=>{if(event.key==='pachi-player-identity-v1')resetSession();});
  refreshSoon(1200);
})();
