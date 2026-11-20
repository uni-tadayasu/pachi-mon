/* Shared administration and durable gifts. No admin secret is shipped to players. */
(() => {
  'use strict';
  const LT = window.LT = window.LT || {};
  const API = 'https://pachi-mon-admin-hub.hisa-0128-1996.chatgpt.site/api';
  const KEY = 'pachi-player-identity-v1';
  const PENDING_KEY = 'pachi-pending-distribution-v1';
  const adminRoleLabels={main:'運営',sub:'サブ運営','sub-sub':'サブサブ運営'};
  const deputyRoles=['sub','sub-sub'];
  const roleName=role=>role==='sub'?'サカイ':role==='sub-sub'?'イサカ':'カサイ';
  const trainerName=()=>roleName(player?.adminRole);
  const fields = [['hp','体力',99999],['atk','物理攻撃',9999],['def','物理防御',9999],['spAtk','特殊攻撃',9999],['spDef','特殊防御',9999],['speed','素早さ',9999],['accuracy','命中',300],['evasion','回避',300]];
  const escape = s => String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let identity = null, player = null, status = null, syncing = null, registration = null, pending = 0, lastError = '', consoleDialog = null, revision = 0, savedConfig = null, claimBusy = false;
  let identityEpoch=0, restoreAttempt=0, syncQueued=false, registerQueued=false, sendBusy=false, pendingGrant=null;
  let adminRegistration=null, releaseReview=null, releaseBusy=false, refreshBusy=false;
  let adminDevices=null, deviceReview=null, deviceInput='', deviceRole='sub', deviceBusy=false;
  let reserveTeam=null, reserveMessage='', reserveAddition=null, additionMessage='', reserveBusy=false;
  const subAdventureMessage='サブ運営は、自分の冒険で仲間にしたパチモンで遊びます。特別な初期メンバーの自動配布・復元はありません。';
  const initialMembersAllowed=()=>player?.isAdmin===true&&player.adminRole!=='sub';
  const sameDeliveryProfile=profile=>!!player&&!!profile&&profile.id===player.id&&profile.isAdmin===player.isAdmin&&profile.adminRole===player.adminRole;
  const initialPolicyText=()=>player?.adminRole==='sub'?subAdventureMessage:'アルヴェリオンは運営の初期メンバーとして1体使用できます。アルヴェリオンの配布機能はありません。';
  const futoConfigPolicy=()=>player?.adminRole==='sub'?'設定の変更は、これから配布するフートに反映します。配布済みの個体はそのままです。':'設定の変更は、これから配布する個体と運営の最初の1体に反映。配布済みの個体はそのままです。';
  function clearReserveState(){reserveTeam=null;reserveMessage='';reserveAddition=null;additionMessage='';}
  function clearDeviceState(){adminDevices=null;deviceReview=null;deviceInput='';deviceRole='sub';}
  const staleIdentity=()=>Object.assign(new Error('プレイヤー情報が切り替わりました。'),{staleIdentity:true});
  function announcePlayer(){
    refreshConsoleIdentity();
    if(typeof CustomEvent==='function')document.dispatchEvent?.(new CustomEvent('pachi-admin-state',{detail:player?{id:player.id,isAdmin:player.isAdmin===true}:null}));
  }
  function refreshConsoleIdentity(){
    if(!consoleDialog?.open||player?.isAdmin!==true)return;
    const name=trainerName(),labels={
      '#pachi-console-title':`${name}の運営管理`,
      '.pachi-owner-identity h3':name==='カサイ'?'謎の調律士 カサイ':name,
      '.pachi-owner-identity p:nth-of-type(2)':`${name}戦は、あなたが接続中のときに挑戦者と戦うリアルタイム対戦です。入室時の保存済み手持ち・レベル・技・育成を使います。ステージで話しかけられたら対戦を許可してください。自分自身には挑戦できません。`,
      '[data-admin-initial-policy]':initialPolicyText(),
      '[data-admin-config-policy]':futoConfigPolicy(),
      '[data-admin-futo-policy]':player.adminRole==='sub'?'能力を設定し、全員または選んだプレイヤーへ届けます。サブ運営に初期フートは自動追加されません。':'能力を設定し、全員または選んだプレイヤーへ届けます。運営のフートには保存した設定が反映されます。',
      '[data-admin-action="decorate-room"]':`${name}の部屋を飾る`
    };
    for(const [selector,text] of Object.entries(labels)){const node=consoleDialog.querySelector?.(selector);if(node)node.textContent=text;}
  }
  function storedIdentity(raw){
    if(typeof raw!=='string'||raw.length>4096)return null;
    try{
      const value=JSON.parse(raw);
      if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value.token))return null;
      // Cached IDs/roles are not authorization. The token's server profile is
      // loaded before showing an identity or granting any operator controls.
      return {token:value.token,...(typeof value.id==='string'&&/^P[0-9a-f]{16}$/.test(value.id)?{id:value.id}:{}),name:typeof value.name==='string'?value.name.slice(0,32):'旅人'};
    }catch(_){return null;}
  }
  try { identity=storedIdentity(localStorage.getItem(KEY)); } catch (_) {}
  function randomToken(){ const bytes=crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
  function persist(next){
    localStorage.setItem(KEY,JSON.stringify(next));
    if(identity?.token!==next.token){identityEpoch++;player=null;status=null;pending=0;registration=null;pendingGrant=null;adminRegistration=null;releaseReview=null;clearDeviceState();clearReserveState();}
    identity=next;
  }
  function serviceStatus(data,previous=status){
    return {adminExists:typeof data?.adminExists==='boolean'?data.adminExists:previous?.adminExists,
      adminRecoveryAvailable:typeof data?.adminRecoveryAvailable==='boolean'?data.adminRecoveryAvailable:previous?.adminRecoveryAvailable===true};
  }
  function adoptIdentity(next,nextPlayer,adminExists,adminRecoveryAvailable=false){
    persist(next);player=nextPlayer;status=serviceStatus({adminExists,adminRecoveryAvailable},null);lastError='';revision=0;savedConfig=null;adminRegistration=null;releaseReview=null;clearDeviceState();clearReserveState();
    if(consoleDialog?.open)consoleDialog.close();
  }
  async function request(path, {method='GET',body,token=identity?.token,auth=true,guardIdentity=true,keepalive=false}={}){
    const epoch=identityEpoch;
    const abort=new AbortController(), timer=setTimeout(()=>abort.abort(),15000);
    try {
      const headers={Accept:'application/json'};
      if(body!==undefined)headers['Content-Type']='application/json';
      if(auth && token)headers.Authorization='Bearer '+token;
      const res=await fetch(API+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:abort.signal,keepalive,credentials:'omit',cache:'no-store',referrerPolicy:'strict-origin-when-cross-origin'});
      const data=await res.json().catch(()=>null);
      if(guardIdentity&&epoch!==identityEpoch)throw staleIdentity();
      if(!res.ok || !data?.ok){const err=new Error(data?.error?.message || '通信できませんでした。少し待って再試行してください。');err.code=data?.error?.code;err.status=res.status;throw err;}
      return data;
    } catch(err){if(guardIdentity&&epoch!==identityEpoch)throw staleIdentity();if(err.name==='AbortError')throw new Error('接続がタイムアウトしました。冒険はそのまま続けられます。');throw err;}
    finally{clearTimeout(timer);}
  }
  function proposedName(){return (identity?.name || LT.adminBridge?.getPlayerName?.() || '旅人').slice(0,24);}
  async function ensureIdentity(){
    if(player)return player;
    if(registration)return registration;
    if(!identity)persist({token:randomToken(),name:proposedName()});
    const token=identity.token, epoch=identityEpoch;
    const task=(async()=>{
      const data=await request('/register',{method:'POST',body:{token,name:identity.name||proposedName()},auth:false});
      if(epoch!==identityEpoch)throw staleIdentity();
      player=data.player;status=serviceStatus(data);persist({...identity,id:player.id,name:player.name});announcePlayer();return player;
    })();
    registration=task;
    try{return await task;}finally{if(registration===task)registration=null;}
  }
  async function sync({register=false,fresh=false}={}){
    if(syncing){if(register||fresh){syncQueued=true;registerQueued=registerQueued||register;}return syncing;}
    syncQueued=true;registerQueued=registerQueued||register;
    const task=(async()=>{
      try{while(syncQueued){
          const shouldRegister=registerQueued;syncQueued=false;registerQueued=false;
          await syncOnce(shouldRegister);
      }}finally{syncing=null;}
    })();
    syncing=task;
    return task;
  }
  async function syncOnce(register){
      let epoch=identityEpoch;
      try{
        status=serviceStatus(await request('/status',{auth:false}),null);lastError='';refreshSettings();
        if(!identity && !register && !LT.adminBridge?.getEngine?.()){refreshSettings();return;}
        if(!identity)persist({token:randomToken(),name:proposedName()});
        epoch=identityEpoch;await ensureIdentity();
        if(epoch!==identityEpoch)throw staleIdentity();
        const token=identity.token;
        let cursor='', totalPending=0, received=0, initialReceived=0, reserveReceived=0;
        const initialSeen=new Set(),initialNames=new Set();
        do{
          if(epoch!==identityEpoch)throw staleIdentity();
          const requestedProfile=player;
          const data=await request('/me?limit=50'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{token});
          if(epoch!==identityEpoch)throw staleIdentity();
          // A newer heartbeat may appoint or dismiss this device while this
          // inbox page is in flight. Its role must not be rolled back here.
          if(player===requestedProfile)player=data.player;status=serviceStatus(data);
          if(!cursor){
            adoptReserveTeam(data);
            for(const bundle of [reserveTeam,reserveAddition].filter(Boolean)){
              if(!initialMembersAllowed()||!sameDeliveryProfile(data.player)||bundle.role!==player.adminRole||bundle.playerId!==player.id)continue;
              const outcome=LT.adminBridge?.receiveAdminReserveTeam?.(bundle);
              if(outcome?.disabled===true)continue;
              let message=outcome?.message||'';
              if(outcome?.pending||!outcome?.ok){
                const waiting=LT.adminBridge?.adminReserveTeamStatus?.(bundle);
                totalPending+=waiting?.newCount||bundle.members.length;
                message||=bundle.version===2?'冒険を始めると、ヴェルニクスをひかえへ追加できます。':'冒険を始めると、指定の6体をひかえへ追加できます。';
              }else reserveReceived+=outcome.added||0;
              if(bundle.version===2)additionMessage=message;else reserveMessage=message;
            }
          }
          // Initial companions are a current-owner entitlement, separate from
          // the Futo inbox and its administrator distribution controls.
          if(initialMembersAllowed()&&sameDeliveryProfile(data.player)){
            for(const companion of data.initialCompanions||[]){
              const method=companion?.species==='arvelion'?'receiveAdminLegendary':companion?.species==='floravelle'?'receiveAdminMythical':null;
              const prefix=companion?.species==='arvelion'?'admin-legendary:':'admin-mythical:';
              if(!initialMembersAllowed()||!sameDeliveryProfile(data.player)||!method||companion.grantId!==prefix+player.id||initialSeen.has(companion.grantId))continue;
              initialSeen.add(companion.grantId);
              const outcome=LT.adminBridge?.[method]?.(companion);
              if(outcome?.disabled===true)continue;
              if(outcome?.pending||!outcome?.ok)totalPending++;
              else if(!outcome.alreadyReceived){initialReceived++;initialNames.add((LT.DATA?.species?.[companion.species]?.name||(companion.species==='arvelion'?'アルヴェリオン':'キラシード')));}
            }
          }
          for(const grant of data.grants||[]){
            // A sub keeps its own adventure team. Old inbox pages must not
            // re-add its initial Futo or overwrite an already owned one.
            const grantId=String(grant?.grantId??grant?.id??''),initial=grantId.startsWith('admin-initial:');
            if(initial&&(player?.adminRole==='sub'||!sameDeliveryProfile(data.player)))continue;
            const bridge=LT.adminBridge;if(!bridge){totalPending++;continue;}
            const outcome=bridge.grantFuto(grant);
            if(outcome?.disabled===true)continue;
            let waiting=outcome?.pending || !outcome?.ok;
            if(outcome?.ok && !outcome.alreadyReceived)received++;
            if(player.isAdmin && player.adminRole!=='sub' && sameDeliveryProfile(data.player) && initial && outcome?.ok){
              const update=bridge.updateOwnedFuto(grantId,grant);if(update?.disabled!==true)waiting=waiting||update?.pending||!update?.ok;
            }
            if(waiting)totalPending++;
          }
          cursor=data.nextCursor == null?'':String(data.nextCursor);
        }while(cursor);
        pending=totalPending;
        if(received||initialReceived||reserveReceived)LT.adminBridge?.toast?.(`${received?'フートを受け取りました。':''}${initialReceived?'運営の初期メンバーに'+[...initialNames].join('・')+'が加わりました。':''}${reserveReceived?`Lv.100の運営メンバー${reserveReceived}体をひかえに追加しました。`:''}旅の仲間・ひかえを確認してください。`);
      }catch(err){if(!err.staleIdentity&&epoch===identityEpoch){status=null;lastError=err.message;}}
      if(epoch===identityEpoch){refreshSettings();renderAdminReserveTeam();}
  }
  function adoptReserveTeam(data){
    clearReserveState();
    if(!initialMembersAllowed()||data?.player?.isAdmin!==true||data.player.id!==player.id||data.player.adminRole!==player.adminRole)return null;
    try{
      const bundle=LT.AdminReserveRules?.normalizeBundle?.(data.adminReserveTeam);
      if(bundle?.version===1&&bundle.playerId===player.id&&bundle.role===player.adminRole)reserveTeam=bundle;
    }catch(_){}
    try{
      const bundle=LT.AdminReserveRules?.normalizeBundle?.(data.adminReserveAddition);
      if(bundle?.version===2&&bundle.playerId===player.id&&bundle.role===player.adminRole)reserveAddition=bundle;
    }catch(_){}
    return reserveTeam;
  }
  function renderAdminReserveTeam(){
    renderAdminReserveAddition();
    const box=consoleDialog?.open&&consoleDialog.querySelector?.('#pachi-admin-reserve');if(!box)return;
    const group=box.closest?.('fieldset');if(group)group.hidden=!initialMembersAllowed();
    if(!initialMembersAllowed()){clearReserveState();box.innerHTML='';return;}
    if(reserveTeam?.playerId!==player.id||reserveTeam?.role!==player.adminRole){reserveTeam=null;reserveMessage='';box.innerHTML='<p>Lv.100の運営メンバーを確認しています。</p>';return;}
    const state=LT.adminBridge?.adminReserveTeamStatus?.(reserveTeam);
    const members=state?.ok?state.members:reserveTeam.members;
    const disabled=reserveBusy||deviceBusy||releaseBusy||sendBusy||state?.missingCount===0;
    const gender=reserveTeam.role==='sub'?'メス':'オス';
    box.innerHTML=`<p><strong>${trainerName()}の6体 · 全員Lv.100・${gender}</strong></p><p>Lv.1から鍛錬の帯を持って、99回すべて実戦に出場して育った個体です。実戦成長として体力＋198、攻撃・防御・特攻・特防・素早さを各＋99、能力へ直接反映します。強化の振り分けは従来どおり通常198＋鍛錬99の合計297ポイントです。受け取り済みの6体にも反映します。</p><ul class="pachi-reserve-list">${members.map(mon=>`<li><span><strong>${escape(mon.name||LT.DATA?.species?.[mon.species]?.name||mon.species)}</strong><small>Lv.100 · ${mon.gender==='female'?'♀':'♂'}</small></span><span class="pachi-reserve-state">${mon.owned?mon.destination==='party'?'手持ちにいます':'ひかえにいます':mon.received?'復元できます':'受け取り待ち'}</span></li>`).join('')}</ul><p>初回はひかえに追加します。復元では、手持ち・ひかえにいない指定メンバーだけを追加します。</p><div class="pachi-actions"><button type="button" class="btn btn-primary" data-admin-action="restore-reserve"${disabled?' disabled':''}>${reserveBusy?'確認しています…':'足りないメンバーをひかえに復元'}</button></div><p class="pachi-reserve-note" role="status" aria-live="polite">${escape(reserveMessage||(!state?.started?'先に冒険を始めてください。':state?.missingCount===0?'指定の6体はそろっています。':state?.availableSlots<state?.missingCount?`ひかえに${state.missingCount}体分の空きが必要です。現在の空きは${state.availableSlots}体です。`:'現在の運営登録を確認してから復元します。'))}</p>`;
  }
  function renderAdminReserveAddition(){
    const box=consoleDialog?.open&&consoleDialog.querySelector?.('#pachi-admin-reserve-addition');if(!box)return;
    const group=box.closest?.('fieldset');if(group)group.hidden=!initialMembersAllowed();
    if(!initialMembersAllowed()){box.innerHTML='';return;}
    if(reserveAddition?.playerId!==player.id||reserveAddition?.role!==player.adminRole){box.innerHTML='<p>ヴェルニクスの追加配布を確認しています。</p>';return;}
    const state=LT.adminBridge?.adminReserveTeamStatus?.(reserveAddition),member=state?.ok?state.members[0]:reserveAddition.members[0];
    const disabled=reserveBusy||deviceBusy||releaseBusy||sendBusy||state?.missingCount===0;
    const location=member.owned?member.destination==='party'?'手持ちにいます':'ひかえにいます':member.received?'復元できます':'受け取り待ち';
    const note=additionMessage||(!state?.started?'先に冒険を始めてください。':state?.missingCount===0?'ヴェルニクスは受け取り済みです。':state?.availableSlots<1?'ひかえに1体分の空きが必要です。':'現在の運営登録を確認してから復元します。');
    box.innerHTML=`<p><strong>ヴェルニクス · Lv.100・性別なし</strong></p><p>鍛錬の帯を持ってLv.1から99回レベルアップした育成相当です。通常198＋鍛錬99の合計297ポイントを未配分で受け取れます。</p><p class="pachi-reserve-state">${location}</p><p>ひかえに1体を追加します。復元は、手持ち・ひかえにいなくなったヴェルニクスだけを対象にします。</p><div class="pachi-actions"><button type="button" class="btn btn-primary" data-admin-action="restore-reserve-addition"${disabled?' disabled':''}>${reserveBusy?'確認しています…':'ヴェルニクスをひかえに復元'}</button></div><p class="pachi-reserve-note" role="status" aria-live="polite">${escape(note)}</p>`;
  }
  async function restoreAdminReserveTeam(kind='team'){
    if(reserveBusy||deviceBusy||releaseBusy||sendBusy)return null;
    await ensureIdentity();
    if(reserveBusy||deviceBusy||releaseBusy||sendBusy)return null;
    if(player?.isAdmin!==true)throw new Error('現在の運営だけがメンバーを復元できます。');
    if(!initialMembersAllowed()){clearReserveState();renderAdminReserveTeam();throw new Error(subAdventureMessage);}
    const epoch=identityEpoch,actorId=player.id,actorRole=player.adminRole,addition=kind==='addition';
    const setMessage=message=>{if(addition)additionMessage=message;else reserveMessage=message;};
    reserveBusy=true;setMessage('運営登録と受け取り内容を確認しています…');renderAdminReserveTeam();
    try{
      const requestedProfile=player,data=await request('/me?limit=1');
      if(epoch!==identityEpoch||player?.id!==actorId||player?.adminRole!==actorRole)throw staleIdentity();
      if(player===requestedProfile)player=data.player;status=serviceStatus(data);refreshSettings();
      if(player?.adminRole==='sub'){clearReserveState();throw new Error(subAdventureMessage);}
      adoptReserveTeam(data);
      const bundle=addition?reserveAddition:reserveTeam;
      if(!bundle)throw new Error('現在の運営登録に対応するメンバーを確認できませんでした。');
      const outcome=LT.adminBridge?.receiveAdminReserveTeam?.(bundle,{restore:true});
      const message=outcome?.message||'メンバーを復元できませんでした。冒険を始めてから、もう一度お試しください。';setMessage(message);
      if(!outcome?.ok)throw new Error(message);
      if(outcome.added)LT.adminBridge?.toast?.(message);
      say(message);return outcome;
    }catch(err){if(!err.staleIdentity&&epoch===identityEpoch)setMessage(err.message);throw err;}
    finally{reserveBusy=false;if(epoch===identityEpoch)renderAdminReserveTeam();}
  }
  function restoreAdminReserveAddition(){return restoreAdminReserveTeam('addition');}
  function settingsRoot(){const title=document.getElementById('modal-title');return title?.textContent==='冒険の設定'?document.getElementById('modal-content'):null;}
  function mountSettings(){
    const parent=settingsRoot();if(!parent || parent.querySelector('#pachi-service'))return;
    const root=document.createElement('section');root.id='pachi-service';root.className='pachi-service';root.innerHTML='<h3>プレイヤー・お届けもの</h3><div data-service-body></div><p class="pachi-status" role="status" aria-live="polite"></p>';
    parent.append(root);status=null;refreshSettings();void sync({register:true,fresh:true});
  }
  // Only a fresh, explicit unregistered status can offer the operator key.
  // Recovery capabilities and repeated taps never reveal it to other players.
  function canClaim(){return !!player && player.isAdmin!==true && status?.adminExists===false;}
  function refreshSettings(){
    if(player?.adminRole==='sub')clearReserveState();
    announcePlayer();
    if(player?.isAdmin===false){adminRegistration=null;releaseReview=null;clearDeviceState();clearReserveState();if(consoleDialog?.open)consoleDialog.close();}
    renderAdminReserveTeam();
    const root=settingsRoot()?.querySelector('#pachi-service');if(!root)return;
    const body=root.querySelector('[data-service-body]');
    const signature=[!!player,player?.isAdmin,player?.adminRole,player?.id,player?.name,status?.adminExists,claimBusy,releaseBusy,pending].join('|');
    if(!canClaim()){const field=document.getElementById('pachi-admin-key');if(field)field.value='';}
    if(body.dataset.signature!==signature){
      body.dataset.signature=signature;
      body.innerHTML=`${player?`<label for="pachi-player-id">プレイヤーID</label><input id="pachi-player-id" class="pachi-code" value="${escape(player.id)}" readonly autocomplete="off" spellcheck="false"><div class="pachi-inline"><div><label for="pachi-player-name">配布先に表示する名前</label><input id="pachi-player-name" maxlength="24" autocomplete="nickname" value="${escape(player.name)}"></div><button class="btn btn-small" data-admin-action="name">名前を保存</button></div>`:'<p>プレイヤー情報を確認しています…</p>'}${player?.isAdmin?`<p><strong>${adminRoleLabels[player.adminRole]||'運営'}として登録済み · ${trainerName()}</strong> · フートの能力設定・配布ができます。</p><p>${initialPolicyText()}</p><button class="btn btn-primary" data-admin-action="console">${trainerName()}の運営管理</button>`:canClaim()?`<div data-claim><label for="pachi-admin-key">運営キー</label><div class="pachi-inline"><div><input id="pachi-admin-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="運営キーを入力"${claimBusy||releaseBusy?' disabled':''}></div><button class="btn btn-primary" data-admin-action="claim"${claimBusy||releaseBusy?' disabled':''}>運営になる</button></div><p>最初に登録した1人が運営になります。</p></div>`:status?.adminExists?'<p>運営は登録済みです。お届けものは冒険中に自動で受け取れます。</p>':'<p>運営の登録状況を確認しています…</p>'}${pending?`<p>受け取り待ちの仲間：${pending}体。冒険を始め、戦闘を終えるか、仲間・ひかえに空きを作ると受け取れます。</p>`:''}<div class="pachi-actions"><button class="btn btn-small" data-admin-action="refresh">お届けものを確認</button>${player?'<button class="btn btn-small" data-admin-action="backup">プレイヤー情報を書き出す</button>':''}<button class="btn btn-small" data-admin-action="restore">プレイヤー情報を復元</button></div>`;
    }
    const line=root.querySelector('.pachi-status');line.textContent=lastError || (status?'接続済み · 冒険のセーブはこれまで通り端末内に保存されます。':'確認中…');line.dataset.error=String(!!lastError);
  }
  function say(message,error=false){lastError=error?message:'';const line=consoleDialog?.open?consoleDialog.querySelector('.pachi-status'):settingsRoot()?.querySelector('.pachi-status');if(line){line.textContent=message;line.dataset.error=String(error);}}
  async function withButton(button,action){button.disabled=true;try{await action();}catch(err){if(!err.staleIdentity)say(err.message,true);}finally{if(button.isConnected&&!sendBusy&&!releaseBusy&&!deviceBusy&&!reserveBusy)button.disabled=false;}}
  async function claim(button){
    if(claimBusy||releaseBusy||deviceBusy)return;
    const field=document.getElementById('pachi-admin-key'),key=field?.value||'';
    if(!canClaim()){if(field)field.value='';refreshSettings();return;}
    if(!key){say('運営キーを入力してください。',true);return;}
    claimBusy=true;
    try{
      await withButton(button,async()=>{try{
        await ensureIdentity();
        status=serviceStatus(await request('/status',{auth:false}),null);
        if(!canClaim()){refreshSettings();throw new Error('運営はすでに登録されています。最新の状態を確認しました。');}
        const data=await request('/admin/claim',{method:'POST',body:{key}});
        // Older in-flight profile responses must not undo this ownership change.
        identityEpoch++;registration=null;player=data.player;status=serviceStatus(data,{adminExists:true,adminRecoveryAvailable:false});
        say('運営に登録しました。フートとアルヴェリオンを準備しています。');refreshSettings();
        await sync({register:true,fresh:true});await openConsole();
      }finally{if(field)field.value='';const visibleField=document.getElementById('pachi-admin-key');if(visibleField)visibleField.value='';}});
    }finally{claimBusy=false;refreshSettings();await sync({fresh:true});}
  }
  function renderReleaseReview(){
    const box=consoleDialog?.querySelector('#pachi-release-review');if(!box)return;
    box.hidden=!releaseReview;
    if(!releaseReview){box.innerHTML='';return;}
    const own=adminDevices?.devices.find(device=>device.playerId===player?.id);
    const successor=own?.role==='main'&&deputyRoles.map(role=>adminDevices.devices.find(device=>device.role===role)).find(Boolean);
    const succession=successor?`この端末の登録を解除すると、登録済みの${adminRoleLabels[successor.role]}がメイン運営を引き継ぎます。一般プレイヤー向けの運営キーの入力欄は表示されません。`:'メイン運営を解除すると、登録済みのサブ運営、サブサブ運営の順で、残る端末がメイン運営を引き継ぎます。';
    box.innerHTML=`<h4>この端末の運営登録を解除しますか？</h4><p>解除するのは、このプレイヤーIDの運営登録だけです。${succession}運営が0台になったときだけ、他のプレイヤーに運営キーの入力欄が再び表示されます。冒険の記録や配布済みの仲間は削除されません。</p><div class="pachi-actions"><button class="btn" data-admin-action="release-cancel">解除せず戻る</button><button class="btn pachi-release-confirm" data-admin-action="release-confirm">この端末の運営登録を解除する</button></div>`;
  }
  function prepareRelease(){
    if(releaseBusy||sendBusy||deviceBusy)return;
    if(pendingGrant?.uncertain)throw new Error('配布結果の確認が終わってから、運営登録を解除してください。');
    if(!player?.isAdmin||adminRegistration?.playerId!==player.id||!Number.isSafeInteger(adminRegistration?.claimedAt))throw new Error('運営登録の最新の状態を確認してから、もう一度お試しください。');
    releaseReview={registration:{...adminRegistration},epoch:identityEpoch};renderReleaseReview();
    consoleDialog?.querySelector('[data-admin-action="release-cancel"]')?.focus({preventScroll:false});
  }
  async function releaseAdmin(){
    const review=releaseReview;if(releaseBusy||sendBusy||deviceBusy||!review)return;
    if(review.epoch!==identityEpoch||review.registration.playerId!==player?.id||!player?.isAdmin){releaseReview=null;renderReleaseReview();throw staleIdentity();}
    if(pendingGrant?.uncertain)throw new Error('配布結果の確認が終わってから、運営登録を解除してください。');
    releaseBusy=true;
    const controls=[...(consoleDialog?.querySelectorAll('button,input,select')||[])];
    const disabled=controls.map(control=>control.disabled);controls.forEach(control=>{control.disabled=true;});
    let message='';
    try{
      const data=await request('/admin/release',{method:'POST',body:{confirmed:true,expectedRegistration:review.registration}});
      identityEpoch++;registration=null;player=data.player;status=serviceStatus(data,null);adminRegistration=null;releaseReview=null;clearDeviceState();
      clearPendingGrant();if(consoleDialog?.open)consoleDialog.close();refreshSettings();
      message=data.adminExists?'この端末の運営登録を解除しました。別の運営端末は引き続き利用できます。':'この端末の運営登録を解除しました。運営が0台になったため、運営キーで再登録できます。';await sync({fresh:true});
    }catch(err){
      if(!err.staleIdentity){adminRegistration=null;releaseReview=null;await sync({fresh:true});}
      throw err;
    }finally{
      releaseBusy=false;controls.forEach((control,index)=>{control.disabled=disabled[index];});renderReleaseReview();refreshSettings();
    }
    if(message)say(message);
  }
  function deviceActor(epoch=identityEpoch,ownerId=player?.id){
    if(epoch!==identityEpoch||ownerId!==player?.id)throw staleIdentity();
    if(player?.isAdmin!==true||!consoleDialog?.open)throw new Error('現在の運営端末から管理画面を開いてください。');
  }
  function canManageAdminDevices(){return player?.isAdmin===true&&adminDevices?.canManageDevices===true&&adminDevices.devices.some(device=>device.playerId===player.id&&device.role==='main');}
  function requireDeviceManager(){deviceActor();if(!canManageAdminDevices())throw new Error('サブ運営・サブサブ運営の登録・解除はメイン運営から行ってください。');}
  function applyDeviceData(data){
    if(data?.capacity!==3||!Array.isArray(data.devices)||data.devices.length>3)throw new Error('運営端末の一覧を確認できませんでした。再読み込みしてください。');
    const devices=data.devices.map(device=>{
      if(!/^P[0-9a-f]{16}$/.test(device?.playerId||'')||typeof device.name!=='string'||!Object.hasOwn(adminRoleLabels,device.role)||!Number.isSafeInteger(device.claimedAt)||device.claimedAt<0||device.claimedAt>8640000000000000)throw new Error('運営端末の情報を確認できませんでした。');
      return {playerId:device.playerId,name:device.name,role:device.role,claimedAt:device.claimedAt};
    });
    if(new Set(devices.map(device=>device.playerId)).size!==devices.length||new Set(devices.map(device=>device.role)).size!==devices.length||!devices.some(device=>device.playerId===player?.id))throw new Error('この端末の運営登録を確認できませんでした。再読み込みしてください。');
    adminDevices={capacity:3,devices,canManageDevices:data.canManageDevices===true};
    const own=devices.find(device=>device.playerId===player.id);adminRegistration={playerId:own.playerId,claimedAt:own.claimedAt};
    if(player.adminRole!==own.role){player={...player,adminRole:own.role};refreshSettings();}
    if(devices.length===3||own.role!=='main')deviceInput='';
    const vacant=deputyRoles.filter(role=>!devices.some(device=>device.role===role));if(!vacant.includes(deviceRole))deviceRole=vacant[0]||'sub';
    if(own.role!=='main')deviceReview=null;
    return adminDevices;
  }
  function renderAdminDevices(){
    const box=consoleDialog?.querySelector('#pachi-admin-devices');if(!box)return;
    if(player?.isAdmin!==true){box.innerHTML='';return;}
    const disabled=deviceBusy?' disabled':'',refresh=`<button type="button" class="btn btn-small" data-admin-action="devices-refresh"${disabled}>運営端末を再読み込み</button>`;
    if(!adminDevices){box.innerHTML='<p>運営端末の最新の登録状況を確認してください。</p>'+refresh;return;}
    const {devices,capacity}=adminDevices,canManage=canManageAdminDevices(),vacant=deputyRoles.filter(role=>!devices.some(device=>device.role===role));
    const list=devices.map(device=>`<li class="pachi-device"><div><strong>${roleName(device.role)}</strong><span class="pachi-device-role">${adminRoleLabels[device.role]}${device.playerId===player.id?' · この端末':''} · 登録名：${escape(device.name)}</span><code>${escape(device.playerId)}</code></div>${device.playerId===player.id?'<span class="pachi-device-current">利用中</span>':canManage&&deputyRoles.includes(device.role)?`<button type="button" class="btn btn-small" data-admin-action="device-revoke-review" data-device-id="${escape(device.playerId)}"${disabled}>${adminRoleLabels[device.role]}の解除を確認</button>`:''}</li>`).join('');
    let review='';
    if(deviceReview){
      const target=deviceReview.target,grant=deviceReview.kind==='grant',roleLabel=adminRoleLabels[target.role];
      review=`<div id="pachi-device-review" class="pachi-review"><h4>${grant?`この端末を${roleLabel}に登録しますか？`:`この端末の${roleLabel}登録を解除しますか？`}</h4><p><strong>${escape(target.name)}</strong><br><code>${escape(target.playerId)}</code><br>役割：${roleLabel} · 表示名：${roleName(target.role)}</p>${grant?`<p>${roleLabel}は、フートの能力設定・配布・専用ステージの管理など、同じ運営機能を利用できます。メイン運営は、いつでもこの登録を解除できます。運営端末の追加・解除はメイン運営だけが行えます。</p>`:`<p>登録日時：<time datetime="${escape(new Date(target.claimedAt).toISOString())}">${escape(new Date(target.claimedAt).toLocaleString('ja-JP'))}</time></p><p>このプレイヤーIDの${roleLabel}権限を解除します。冒険の記録や配布済みの仲間は削除されません。ほかの運営端末は引き続き利用できます。</p>`}<div class="pachi-actions"><button type="button" class="btn" data-admin-action="device-cancel"${disabled}>やめる</button><button type="button" class="btn ${grant?'btn-primary':'pachi-release-confirm'}" data-admin-action="device-confirm"${disabled}>${grant?`この端末を${roleLabel}に登録する`:`この端末の${roleLabel}登録を解除する`}</button></div></div>`;
    }
    const form=canManage&&vacant.length&&!deviceReview?`<div class="pachi-device-form"><div class="pachi-device-role-picker"><label for="pachi-device-role">登録する役割</label><select id="pachi-device-role"${disabled}>${vacant.map(role=>`<option value="${role}"${role===deviceRole?' selected':''}>${adminRoleLabels[role]} · ${roleName(role)}</option>`).join('')}</select></div><label for="pachi-device-player-id">追加する端末のプレイヤーID</label><div class="pachi-inline"><input id="pachi-device-player-id" type="text" maxlength="17" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Pから始まるプレイヤーID" value="${escape(deviceInput)}"${disabled}><button type="button" class="btn btn-primary" data-admin-action="device-add-review"${disabled}>登録先を確認</button></div><p>追加する端末で「冒険の設定」を開き、表示されたプレイヤーIDを入力してください。空いている役割を選び、確認画面で役割・名前・IDを確かめてから登録します。</p></div>`:devices.length>=capacity?`<p class="pachi-device-capacity">運営端末は3台とも登録済みです。${canManage?'端末を入れ替える場合は、対象のサブ運営・サブサブ運営の登録を解除してください。':'サブ運営・サブサブ運営の登録・解除はメイン運営が行います。'}</p>`:!canManage?'<p>サブ運営・サブサブ運営の登録・解除はメイン運営が行います。</p>':'';
    box.innerHTML=`<p>登録済み ${devices.length} / ${capacity}台。フートの能力設定・配布・専用ステージの管理は、すべての運営端末で利用できます。サブ運営・サブサブ運営の登録・解除はメイン運営が行います。</p><ul class="pachi-device-list">${list}</ul>${form}${review}<div class="pachi-actions">${refresh}</div>`;
  }
  function setDeviceBusy(value){
    deviceBusy=value;
    for(const control of consoleDialog?.querySelectorAll('button,input,select')||[]){
      if(value){control._disabledBeforeDevices=control.disabled;control.disabled=true;}
      else if(control._disabledBeforeDevices!==undefined){control.disabled=control._disabledBeforeDevices;delete control._disabledBeforeDevices;}
    }
  }
  async function loseDeviceAccess(epoch){
    if(epoch!==identityEpoch)throw staleIdentity();
    identityEpoch++;registration=null;player={...player,isAdmin:false,adminRole:null};status=null;adminRegistration=null;releaseReview=null;clearDeviceState();
    if(consoleDialog?.open)consoleDialog.close();refreshSettings();await sync({fresh:true});
  }
  async function withDeviceOperation(action){
    if(deviceBusy||sendBusy||releaseBusy)return null;
    const epoch=identityEpoch,ownerId=player?.id;deviceActor(epoch,ownerId);setDeviceBusy(true);renderAdminDevices();
    try{return await action({epoch,ownerId});}
    catch(err){
      if(!err.staleIdentity&&epoch===identityEpoch){
        deviceReview=null;
        if(err.status===409||err.status===403&&err.code==='MAIN_ADMIN_REQUIRED'){
          adminDevices=null;
          try{const latest=await request('/admin/devices');deviceActor(epoch,ownerId);applyDeviceData(latest);}catch(refreshError){if(refreshError.staleIdentity)throw refreshError;if(refreshError.status===403&&refreshError.code!=='MAIN_ADMIN_REQUIRED')await loseDeviceAccess(epoch);}
        }else if(err.status===403){
          // Retire older in-flight profiles before reflecting a lost role.
          await loseDeviceAccess(epoch);
        }
      }
      throw err;
    }finally{setDeviceBusy(false);renderAdminDevices();}
  }
  async function loadAdminDevices(){
    return withDeviceOperation(async({epoch,ownerId})=>{deviceReview=null;const data=await request('/admin/devices');deviceActor(epoch,ownerId);return applyDeviceData(data);});
  }
  async function prepareDeviceGrant(){
    requireDeviceManager();
    const id=consoleDialog?.querySelector('#pachi-device-player-id')?.value.trim()||'',role=consoleDialog?.querySelector('#pachi-device-role')?.value;
    if(!/^P[0-9a-f]{16}$/.test(id))throw new Error('Pから始まる17文字のプレイヤーIDを入力してください。');
    if(!deputyRoles.includes(role))throw new Error('登録する役割を選んでください。');
    if(id===player?.id)throw new Error('この端末はすでに運営として登録されています。');
    deviceInput=id;deviceRole=role;
    await withDeviceOperation(async({epoch,ownerId})=>{
      deviceReview=null;
      const data=await request('/admin/devices?playerId='+encodeURIComponent(id));deviceActor(epoch,ownerId);applyDeviceData(data);requireDeviceManager();
      const target=data.candidate;
      if(target?.playerId!==id||typeof target.name!=='string'||typeof target.isAdmin!=='boolean')throw new Error('登録先のプレイヤーを確認できませんでした。');
      if(target.isAdmin||adminDevices.devices.some(device=>device.playerId===id))throw new Error('このプレイヤーIDはすでに運営として登録されています。');
      if(adminDevices.devices.length>=adminDevices.capacity)throw new Error('運営端末は3台とも登録済みです。登録済みの端末を確認してください。');
      if(adminDevices.devices.some(device=>device.role===role))throw new Error(`${adminRoleLabels[role]}はすでに登録されています。空いている役割を選び直してください。`);
      deviceReview={kind:'grant',target:{playerId:id,name:target.name,role},epoch,ownerId};
    });
    consoleDialog?.querySelector('[data-admin-action="device-cancel"]')?.focus({preventScroll:false});
  }
  async function prepareDeviceRevoke(id){
    requireDeviceManager();
    if(!/^P[0-9a-f]{16}$/.test(id||'')||id===player?.id)throw new Error('この端末の解除は「この端末の運営登録」から行ってください。');
    await withDeviceOperation(async({epoch,ownerId})=>{
      deviceReview=null;const data=await request('/admin/devices');deviceActor(epoch,ownerId);applyDeviceData(data);requireDeviceManager();
      const target=adminDevices.devices.find(device=>device.playerId===id);
      if(!target)throw new Error('この端末の運営登録はすでに変更されています。最新の一覧を確認してください。');
      if(!deputyRoles.includes(target.role))throw new Error('解除できるのはサブ運営・サブサブ運営の登録だけです。');
      deviceReview={kind:'revoke',target:{...target},epoch,ownerId};
    });
    consoleDialog?.querySelector('[data-admin-action="device-cancel"]')?.focus({preventScroll:false});
  }
  async function confirmDeviceChange(){
    const review=deviceReview;if(!review||deviceBusy||sendBusy||releaseBusy)return null;
    deviceActor(review.epoch,review.ownerId);requireDeviceManager();
    return withDeviceOperation(async({epoch,ownerId})=>{
      if(deviceReview!==review||review.epoch!==epoch||review.ownerId!==ownerId)throw staleIdentity();
      const grant=review.kind==='grant',body={playerId:review.target.playerId,confirmed:true,...(grant?{role:review.target.role}:{claimedAt:review.target.claimedAt})};
      // A lost response must require a fresh membership read before another edit.
      adminDevices=null;
      const data=await request(grant?'/admin/devices':'/admin/devices/revoke',{method:'POST',body});deviceActor(epoch,ownerId);applyDeviceData(data);
      deviceReview=null;deviceInput='';say(grant?data.added===false?'この端末はすでに運営として登録されています。':'運営端末を追加しました。追加した端末で「お届けものを確認」を押すと、運営管理を開けます。':'指定した端末の運営登録を解除しました。');
      return data;
    });
  }
  function readConfig(){
    const stats={};for(const [key,,max]of fields){const value=Number(consoleDialog.querySelector(`[name="${key}"]`).value);if(!Number.isInteger(value)||value<1||value>max)throw new Error('能力値を指定された範囲の整数で入力してください。');stats[key]=value;}
    const level=Number(consoleDialog.querySelector('[name="level"]').value);if(!Number.isInteger(level)||level<1||level>100)throw new Error('レベルは1〜100で入力してください。');
    const moves=[0,1,2,3].map(i=>consoleDialog.querySelector(`[name="move${i}"]`).value);if(new Set(moves).size!==4)throw new Error('技は異なる4種類を選んでください。');
    return{level,stats,moves};
  }
  function loadPendingGrant(){
    try{
      const saved=JSON.parse(localStorage.getItem(PENDING_KEY));
      if(!saved || saved.ownerId!==player?.id)return null;
      const grant=saved.grant,config=grant?.config;
      if(!/^[0-9a-f-]{36}$/i.test(grant?.requestId||'') || !/^(all|self|P[0-9a-f]{16})$/.test(grant?.target||''))return null;
      if(!Number.isInteger(config?.level)||config.level<1||config.level>100)return null;
      if(fields.some(([key,,max])=>!Number.isInteger(config.stats?.[key])||config.stats[key]<1||config.stats[key]>max))return null;
      if(!Array.isArray(config.moves)||config.moves.length!==4||new Set(config.moves).size!==4||config.moves.some(id=>!Object.hasOwn(LT.DATA.moves,id)))return null;
      const normalized={...config,moves:LT.FutoRules?.normalizeMoves?LT.FutoRules.normalizeMoves(config.moves):config.moves};
      return{ownerId:saved.ownerId,grant:{requestId:grant.requestId,target:grant.target,config:normalized},uncertain:saved.uncertain===true};
    }catch(_){return null;}
  }
  function savePendingGrant(){localStorage.setItem(PENDING_KEY,JSON.stringify(pendingGrant));}
  function clearPendingGrant(){localStorage.removeItem(PENDING_KEY);pendingGrant=null;}
  function prepareGrant(target,config){
    if(sendBusy||deviceBusy)throw new Error('操作の結果を確認しています。少しお待ちください。');
    if(pendingGrant?.uncertain)throw new Error('前の配布結果を確認してください。同じ内容で再送しても重複配布されません。');
    pendingGrant={ownerId:player.id,grant:{requestId:crypto.randomUUID(),target,config},uncertain:false};savePendingGrant();
  }
  function renderPendingGrant(){
    const box=consoleDialog?.querySelector('#pachi-review');if(!box)return;
    if(!pendingGrant){box.hidden=true;return;}
    const {grant,uncertain}=pendingGrant,config=grant.config;
    const option=[...(consoleDialog.querySelector('#pachi-recipient')?.options||[])].find(o=>o.value===grant.target);
    const target=option?.textContent||grant.target;
    box.hidden=false;box.className='pachi-review';box.innerHTML=`<strong>${escape(target)}</strong><br>フート Lv.${config.level} · 体力 ${config.stats.hp}<br>${fields.slice(1).map(([key,name])=>escape(name)+' '+config.stats[key]).join(' / ')}<br>技：${config.moves.map(id=>escape(LT.DATA.moves[id].name)).join(' / ')}<br>${uncertain?'前の送信結果を確認しています。同じ内容で再送しても重複配布されません。':'この内容で1体ずつ配布します。'}<div class="pachi-actions"><button class="btn btn-primary" data-admin-action="send">${uncertain?'同じ内容で結果を確認する':'この内容で配布する'}</button><button class="btn" data-admin-action="cancel-send" ${uncertain?'disabled':''}>やめる</button></div>`;
  }
  function setSending(value){
    sendBusy=value;
    for(const control of consoleDialog?.querySelectorAll('button,input,select')||[]){
      if(value){control._disabledBeforeSend=control.disabled;control.disabled=true;}
      else if(control._disabledBeforeSend!==undefined){control.disabled=control._disabledBeforeSend;delete control._disabledBeforeSend;}
    }
  }
  async function submitPendingGrant(){
    if(sendBusy||deviceBusy)return null;
    const item=pendingGrant;if(!item)return null;
    if(item.ownerId!==player?.id)throw new Error('配布を準備したプレイヤー情報に戻してから再試行してください。');
    setSending(true);
    try{
      // Persist the exact operation before sending. A timeout/reload can safely
      // replay this request ID without creating a second grant batch.
      item.uncertain=true;savePendingGrant();
      const data=await request('/admin/grants',{method:'POST',body:item.grant});
      clearPendingGrant();await sync({fresh:true});return data;
    }catch(err){
      if(!err.staleIdentity)err.message+=' 同じ内容で結果を確認してください。重複配布はされません。';
      throw err;
    }finally{setSending(false);renderPendingGrant();}
  }
  function futoMoveEntries(){
    const exclusive=new Set([...(LT.DATA.species?.[LT.DATA.legendary?.species]?.moves||[]),...(LT.DATA.species?.[LT.DATA.mythical?.species]?.moves||[]),...Object.keys(LT.DATA.signatureMoves||{})]);
    return Object.entries(LT.DATA.moves).filter(([id,move])=>id!=='struggle'&&!exclusive.has(id)&&!move.hiddenDex);
  }
  async function openConsole(){
    if(sendBusy||releaseBusy||deviceBusy)throw new Error('操作の結果を確認しています。少しお待ちください。');
    await ensureIdentity();if(!player?.isAdmin)throw new Error('運営として登録されていません。');
    const data=await request('/admin/config');savedConfig=data.config;revision=data.revision;adminRegistration=data.adminRegistration||null;releaseReview=null;clearDeviceState();
    if(!consoleDialog){consoleDialog=document.createElement('dialog');consoleDialog.className='pachi-console';consoleDialog.setAttribute('aria-labelledby','pachi-console-title');document.body.append(consoleDialog);consoleDialog.addEventListener('click',handleConsole);consoleDialog.addEventListener('cancel',event=>{if(sendBusy||releaseBusy||deviceBusy||reserveBusy){event.preventDefault();say('操作の結果を確認しています。少しお待ちください。');}});consoleDialog.addEventListener('close',()=>{deviceReview=null;void sync();});}
    const cfg={...data.config,moves:LT.FutoRules?.normalizeMoves?LT.FutoRules.normalizeMoves(data.config.moves):data.config.moves};const moveLabel=m=>m.kind==='attack'?`${m.category==='physical'?'物理':'特殊'}・威力${m.power}`:m.kind==='heal'?`体力${m.power}%回復`:m.kind==='boost'?'全能力アップ':'防御';const options=selected=>futoMoveEntries().map(([id,m])=>`<option value="${escape(id)}"${id===selected?' selected':''}>${escape(m.name)} · ${escape(moveLabel(m))}</option>`).join('');
    consoleDialog.innerHTML=`<header class="pachi-console-head"><h2 id="pachi-console-title">${trainerName()}の運営管理</h2><button class="btn btn-small" data-admin-action="close-console" aria-label="運営管理を閉じる">閉じる</button></header><div class="pachi-console-body"><section class="pachi-owner-identity"><h3>${trainerName()==='カサイ'?'謎の調律士 カサイ':trainerName()}</h3><p>専用の姿で世界のプレイヤーと冒険。幻の草むらでは、すべてのパチモンに出会えます。</p><p>${trainerName()}戦は、あなたが接続中のときに挑戦者と戦うリアルタイム対戦です。入室時の保存済み手持ち・レベル・技・育成を使います。ステージで話しかけられたら対戦を許可してください。自分自身には挑戦できません。</p><p data-admin-initial-policy>${initialPolicyText()}</p><div class="pachi-actions"><button type="button" class="btn btn-primary" data-admin-action="decorate-room">${trainerName()}の部屋を飾る</button><button type="button" class="btn" data-admin-action="sync-kasai-party">対戦用の手持ちを更新</button><button type="button" class="btn btn-primary" data-admin-action="secret-grass">裏技・幻の草むら</button></div></section><fieldset class="pachi-owner-controls pachi-reserve-controls"><legend>Lv.100の運営メンバー</legend><div id="pachi-admin-reserve"></div></fieldset><fieldset class="pachi-owner-controls pachi-reserve-controls"><legend>ヴェルニクスの追加配布</legend><div id="pachi-admin-reserve-addition"></div></fieldset><fieldset class="pachi-owner-controls pachi-device-controls"><legend>運営端末</legend><div id="pachi-admin-devices"></div></fieldset><div class="pachi-console-hero"><img src="assets/dex/futo.webp?v=20261120-originality-v67" width="96" height="96" alt="フート"><div><p class="pachi-kicker">FUTO · ADMINISTRATOR</p><h3>きみが決める、フートの力。</h3><p data-admin-futo-policy>能力を設定し、全員または選んだプレイヤーへ届けます。<br>${player.adminRole==='sub'?'サブ運営に初期フートは自動追加されません。':'運営のフートには保存した設定が反映されます。'}</p></div></div><fieldset><legend>レベル・能力値</legend><div class="pachi-stat-grid"><label>レベル · 1〜100<input name="level" type="number" min="1" max="100" step="1" inputmode="numeric" value="${cfg.level}"></label>${fields.map(([key,label,max])=>`<label>${label} · 1〜${max}<input name="${key}" type="number" min="1" max="${max}" step="1" inputmode="numeric" value="${cfg.stats[key]}"></label>`).join('')}</div><small>能力値は戦闘で使う実際の数値です。フートは設定値を基準に、レベルアップすると能力が伸びます。</small><div class="pachi-move-grid">${cfg.moves.map((id,i)=>`<label>技 ${i+1}<select name="move${i}">${options(id)}</select></label>`).join('')}</div><small>初期技は、裂空拳（物理100）・星核砲（特殊100）・全霊覚醒（全能力アップ）・再生の光（体力半分回復）の順です。</small><div class="pachi-actions"><button class="btn btn-small" data-admin-action="default-moves">初期技4つに戻す</button><button class="btn btn-primary" data-admin-action="config">能力設定を保存</button></div><small data-admin-config-policy>${futoConfigPolicy()}</small></fieldset><fieldset><legend>プレイヤーへ配布</legend><div class="pachi-send-grid"><label>配布先<select id="pachi-recipient"><option value="all">接続済みの全プレイヤー</option><option value="self">自分だけ</option></select></label><button class="btn btn-small" data-admin-action="players">プレイヤー一覧を更新</button></div><div class="pachi-actions"><button class="btn" data-admin-action="more-players" hidden>次のプレイヤーを読み込む</button><button class="btn btn-primary" data-admin-action="review">配布内容を確認</button></div><small>「全プレイヤー」は、配布した時点で本サービスに接続済みのプレイヤー全員です。未接続のプレイヤーは含まれません。受け取りは次の起動時にも行われます。</small><div id="pachi-review" hidden></div></fieldset>${adminRegistration?'<fieldset class="pachi-owner-controls"><legend>この端末の運営登録</legend><p>この端末の登録だけを解除します。別の運営端末が残っていれば、運営キーの入力欄は公開されません。</p><button class="btn" data-admin-action="release-review">この端末の解除を確認</button><div id="pachi-release-review" class="pachi-review" hidden></div></fieldset>':''}<p class="pachi-status" role="status" aria-live="polite"></p></div>`;
    consoleDialog._playersCursor=null;pendingGrant=loadPendingGrant();renderPendingGrant();
    if(!consoleDialog.open)consoleDialog.showModal();renderAdminDevices();renderAdminReserveTeam();
    await sync({fresh:true});
    if(!consoleDialog?.open||player?.isAdmin!==true)return;
    try{await loadAdminDevices();}catch(err){if(!err.staleIdentity)say(err.message,true);}
    if(!consoleDialog?.open||player?.isAdmin!==true)return;
    await loadPlayers(false);renderPendingGrant();
  }
  async function loadPlayers(more){
    const data=await request('/admin/players?limit=50'+(more&&consoleDialog._playersCursor?'&cursor='+encodeURIComponent(consoleDialog._playersCursor):''));
    const select=consoleDialog.querySelector('#pachi-recipient'),value=select.value;
    if(!more)select.innerHTML='<option value="all">接続済みの全プレイヤー</option><option value="self">自分だけ</option>';
    for(const p of data.players){if(p.id===player.id)continue;const option=document.createElement('option');option.value=p.id;option.textContent=p.name+' · '+p.id;select.append(option);}
    if([...select.options].some(o=>o.value===value))select.value=value;
    consoleDialog._playersCursor=data.nextCursor;consoleDialog.querySelector('[data-admin-action="more-players"]').hidden=!data.nextCursor;
  }
  async function handleConsole(event){const button=event.target.closest('[data-admin-action]');if(!button)return;const action=button.dataset.adminAction;
    if(button.disabled||sendBusy||releaseBusy||deviceBusy||reserveBusy)return;
    if(action==='close-console'){consoleDialog.close();return;}
    await withButton(button,async()=>{
      if(action==='secret-grass'){await LT.SecretEncounter?.open?.();return;}
      if(action==='decorate-room'){
        if(!LT.adminBridge?.isPlaying?.())throw new Error(`冒険を再開してから、${trainerName()}の部屋を飾ってください。`);
        consoleDialog.close();const opened=await LT.Rooms?.decorateMine?.();if(!opened)LT.adminBridge?.toast?.('部屋の編集を開けませんでした。移動できる状態で、秘密部屋から開いてください。');return;
      }
      if(action==='sync-kasai-party'){
        if(!LT.adminBridge?.canSyncKasaiParty?.())throw new Error('冒険を再開し、バトルや通信を終えてから更新してください。別のタブで冒険記録が変わった場合は、先に再読み込みしてください。');
        if(!LT.adminBridge?.saveNow?.())throw new Error('冒険を再開し、バトルを終えてから手持ちを保存してください。');
        const result=await LT.KasaiParty?.sync?.({force:true});if(!result?.ok)throw new Error(result?.message||'手持ちを更新できませんでした。');say(result.message||'現在の手持ちを反映しました。');return;
      }
      if(action==='restore-reserve'){await restoreAdminReserveTeam();return;}
      if(action==='restore-reserve-addition'){await restoreAdminReserveAddition();return;}
      if(action==='devices-refresh'){await loadAdminDevices();return;}
      if(action==='device-add-review'){await prepareDeviceGrant();return;}
      if(action==='device-revoke-review'){await prepareDeviceRevoke(button.dataset.deviceId);return;}
      if(action==='device-cancel'){deviceReview=null;renderAdminDevices();return;}
      if(action==='device-confirm'){await confirmDeviceChange();return;}
      if(action==='release-review'){prepareRelease();return;}
      if(action==='release-cancel'){releaseReview=null;renderReleaseReview();return;}
      if(action==='release-confirm'){await releaseAdmin();return;}
      if(action==='default-moves'){LT.FutoRules.defaultMoves.forEach((id,i)=>{consoleDialog.querySelector(`[name="move${i}"]`).value=id;});say('初期技4つを選びました。「能力設定を保存」で反映できます。');}
      if(action==='config'){const config=readConfig();const data=await request('/admin/config',{method:'PUT',body:{config,expectedRevision:revision}});revision=data.revision;savedConfig=data.config;data.config.moves.forEach((id,i)=>{consoleDialog.querySelector(`[name="move${i}"]`).value=id;});await sync({fresh:true});say(player?.adminRole==='sub'?'能力設定を保存しました。これから配布するフートに反映されます。':pending?'能力設定を保存しました。戦闘後または受け取り可能になった時に運営のフートへ反映します。':'能力設定を保存しました。運営のフートにも反映しました。');}
      if(action==='players'||action==='more-players')await loadPlayers(action==='more-players');
      if(action==='review'){
        const config=readConfig(),select=consoleDialog.querySelector('#pachi-recipient');
        prepareGrant(select.value,config);renderPendingGrant();consoleDialog.querySelector('#pachi-review').scrollIntoView({block:'nearest'});
      }
      if(action==='cancel-send'){if(pendingGrant?.uncertain)throw new Error('先に同じ内容で配布結果を確認してください。');clearPendingGrant();renderPendingGrant();}
      if(action==='send'){
        const data=await submitPendingGrant();if(data)say(`${data.recipientCount}人にフートを配布しました。${data.replayed?'（送信済みの内容を確認しました）':''}`);
      }
    });
  }
  function backup(){
    const payload={kind:'pachi-player-identity',version:1,token:identity.token,playerId:player.id,name:player.name};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Pachi_Player_Identity.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);say('プレイヤー情報を書き出しました。このファイルを他の人へ渡さないでください。冒険の記録は別に書き出してください。');
  }
  async function restore(){
    if(LT.Trade?.isLocked?.()||LT.tradeActive)throw new Error('交換の完了またはキャンセルを確認してから、プレイヤー情報を復元してください。');
    if(sendBusy||releaseBusy||deviceBusy||reserveBusy)throw new Error('操作の確認が終わってから、プレイヤー情報を復元してください。');
    const file=document.createElement('input');file.type='file';file.accept='.json,application/json';
    file.onchange=async()=>{
      const attempt=++restoreAttempt;
      try{
        const f=file.files[0];if(!f)return;
        if(f.size>4096)throw new Error('プレイヤー情報のファイルを選んでください。');
        const data=JSON.parse(await f.text());
        if(data.kind!=='pachi-player-identity'||!/^[A-Za-z0-9_-]{43}$/.test(data.token))throw new Error('プレイヤー情報の形式が違います。');
        const me=await request('/me',{token:data.token,guardIdentity:false});
        if(attempt!==restoreAttempt)throw staleIdentity();
        if(sendBusy||releaseBusy||deviceBusy||reserveBusy)throw new Error('操作の確認が終わってから、プレイヤー情報を復元してください。');
        if(LT.Trade?.isLocked?.()||LT.tradeActive)throw new Error('交換の完了またはキャンセルを確認してから、プレイヤー情報を復元してください。');
        adoptIdentity({token:data.token,id:me.player.id,name:me.player.name},me.player,me.adminExists,me.adminRecoveryAvailable);
        await sync({fresh:true});
        if(attempt===restoreAttempt)say('プレイヤー情報を復元しました。冒険の記録は変更していません。');
      }catch(err){if(!err.staleIdentity)say(err.message,true);}
    };file.click();
  }
  document.addEventListener('click',event=>{const button=event.target.closest?.('#pachi-service [data-admin-action]');if(!button)return;
    const action=button.dataset.adminAction;
    if(action==='claim'){void claim(button);return;}
    if(action==='refresh'){
      if(refreshBusy)return;refreshBusy=true;
      void (async()=>{try{await sync({register:true});if(!lastError)say(pending?'空き枠や冒険の開始を待っているお届けものがあります。':'お届けものを確認しました。');}catch(err){if(!err.staleIdentity)say(err.message,true);}finally{refreshBusy=false;}})();
      return;
    }
    void withButton(button,async()=>{
      if(action==='console')await openConsole();
      if(action==='name'){await ensureIdentity();const name=document.getElementById('pachi-player-name').value.trim();if(!name)throw new Error('名前を入力してください。');const data=await request('/me',{method:'PATCH',body:{name}});player=data.player;status=serviceStatus(data);persist({...identity,name:player.name});refreshSettings();say('プレイヤー名を保存しました。');}
      if(action==='backup')backup();if(action==='restore')await restore();
    });
  });
  new MutationObserver(mountSettings).observe(document.getElementById('modal-content'),{childList:true});
  for(const name of ['pachi-game-ready','pachi-admin-bridge-ready'])document.addEventListener(name,()=>{void sync({fresh:true});});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void sync();});
  document.addEventListener('pachi-party-changed',renderAdminReserveTeam);
  window.addEventListener?.('storage',event=>{
    if(event.key!==KEY&&event.key!==null||event.storageArea&&event.storageArea!==localStorage)return;
    let raw;try{raw=localStorage.getItem(KEY);}catch(_){return;}
    // A later write may already be on disk when an older event is delivered.
    // Let its matching event handle that value instead of restoring stale data.
    if(event.key===KEY&&raw!==event.newValue)return;
    const next=raw===null?null:storedIdentity(raw);
    if(raw!==null&&!next)return; // Keep malformed data intact for recovery.
    if(identity?.token===next?.token){
      if(next){identity=next;void sync({fresh:true});}
      return;
    }
    identityEpoch++;restoreAttempt++;
    identity=next;player=null;status=null;pending=0;registration=null;pendingGrant=null;
    adminRegistration=null;releaseReview=null;revision=0;savedConfig=null;lastError='';clearDeviceState();clearReserveState();
    if(consoleDialog?.open)consoleDialog.close();
    refreshSettings();LT.adminBridge?.refresh?.();
    // Do not echo a storage event back to disk. Registration/profile reads use
    // this new token; old requests fail their captured epoch before applying.
    // A removal retires the old token without immediately writing a new one.
    if(next)void sync({fresh:true});
  });
  setInterval(()=>{if(!document.hidden)void sync();},30000);
  LT.Admin={sync,open:openConsole,get player(){return player;},get pending(){return pending;},
    async worldRequest(path,options={}){
      if(typeof path!=='string'||!/^\/world\/(?:presence|population|ranked(?:\/(?:queue|history|leaderboard|matches\/[0-9a-f-]{36}\/(?:actions|forfeit|ack)))?|chat(?:\/[1-9][0-9]*|\?summary=1&after=(?:0|[1-9][0-9]*))?|trainer-pass(?:\/verify)?|invitations(?:\/[a-zA-Z0-9-]+(?:\/(?:respond|cancel))?)?|rooms(?:\/(?:mine|kasai|catalog|P[0-9a-f]{16}(?:\/relocate)?)|\?map=[a-zA-Z0-9_%.-]+)?|kasai\/(?:party|live(?:\/[a-zA-Z0-9-]+\/(?:arrive|talk|answer|actions|leave|ack|claim))?|challenges(?:\/[a-zA-Z0-9-]+\/(?:complete|cancel))?|reward(?:\/ack)?))$/.test(path))throw new Error('交流先の指定が正しくありません。');
      await ensureIdentity();
      const requestedProfile=player;
      const data=await request(path,{method:options.method||'GET',...(options.body!==undefined?{body:options.body}:{}),keepalive:options.keepalive===true});
      // A heartbeat carries the full current role, including appointments and
      // promotion. Never overwrite a newer /me profile with a delayed reply.
      if(data.self&&data.self.id===player?.id&&player===requestedProfile){
        const role=data.self.isAdmin===true?(Object.hasOwn(adminRoleLabels,data.self.adminRole)?data.self.adminRole:data.self.adminRole===undefined?'main':null):null;
        if(player.isAdmin!==!!role||player.adminRole!==role){
          player={...player,isAdmin:!!role,adminRole:role};
          clearDeviceState();clearReserveState();refreshSettings();if(consoleDialog?.open){renderAdminDevices();renderAdminReserveTeam();}LT.adminBridge?.refresh?.();
        }
      }
      return data;
    },
    async tradeIdentity({fresh=false}={}){
      await ensureIdentity();
      if(fresh){const requestedProfile=player,data=await request('/me?limit=1');if(player===requestedProfile)player=data.player;status=serviceStatus(data);refreshSettings();}
      return {...player};
    },
    async tradeRequest(path,options={}){
      if(typeof path!=='string'||!/^\/trades(?:\/(?:active|join|[a-zA-Z0-9-]+)(?:\/(?:offer|confirm|cancel|ack))?)?$/.test(path))throw new Error('交換先の指定が正しくありません。');
      await ensureIdentity();
      return request(path,{method:options.method||'GET',...(options.body!==undefined?{body:options.body}:{})});
    },
    async authorizeSecretEncounter(){
      await ensureIdentity();const epoch=identityEpoch,requestedProfile=player,data=await request('/me?limit=1');
      if(epoch!==identityEpoch)throw staleIdentity();
      if(player===requestedProfile)player=data.player;status=serviceStatus(data);refreshSettings();
      if(player?.isAdmin!==true)throw new Error('この操作は現在の運営だけが使用できます。');
      return {...player};
    },
    async requestDuelPass(sessionId,grantId,side){await ensureIdentity();return request('/duel-pass',{method:'POST',body:{sessionId,grantId,side}});},
    verifyDuelPass(sessionId,pass,side){return request('/duel-pass/verify',{method:'POST',body:{sessionId,pass,side},auth:false});}
  };
  mountSettings();void sync();
})();
