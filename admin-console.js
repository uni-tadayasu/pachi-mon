/* Shared administration and durable gifts. No admin secret is shipped to players. */
(() => {
  'use strict';
  const LT = window.LT = window.LT || {};
  const API = 'https://pachi-mon-admin-hub.hisa-0128-1996.chatgpt.site/api';
  const KEY = 'pachi-player-identity-v1';
  const PENDING_KEY = 'pachi-pending-distribution-v1';
  const fields = [['hp','体力',99999],['atk','物理攻撃',9999],['def','物理防御',9999],['spAtk','特殊攻撃',9999],['spDef','特殊防御',9999],['speed','素早さ',9999],['accuracy','命中',300],['evasion','回避',300]];
  const escape = s => String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let identity = null, player = null, status = null, syncing = null, registration = null, pending = 0, lastError = '', consoleDialog = null, revision = 0, savedConfig = null, claimBusy = false;
  let identityEpoch=0, restoreAttempt=0, syncQueued=false, registerQueued=false, sendBusy=false, pendingGrant=null;
  let adminRegistration=null, releaseReview=null, releaseBusy=false, refreshBusy=false;
  const staleIdentity=()=>Object.assign(new Error('プレイヤー情報が切り替わりました。'),{staleIdentity:true});
  try { const x=JSON.parse(localStorage.getItem(KEY)); if(x && /^[A-Za-z0-9_-]{43}$/.test(x.token))identity=x; } catch (_) {}
  function randomToken(){ const bytes=crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
  function persist(next){
    localStorage.setItem(KEY,JSON.stringify(next));
    if(identity?.token!==next.token){identityEpoch++;player=null;status=null;pending=0;registration=null;pendingGrant=null;adminRegistration=null;releaseReview=null;}
    identity=next;
  }
  function serviceStatus(data,previous=status){
    return {adminExists:typeof data?.adminExists==='boolean'?data.adminExists:previous?.adminExists,
      adminRecoveryAvailable:typeof data?.adminRecoveryAvailable==='boolean'?data.adminRecoveryAvailable:previous?.adminRecoveryAvailable===true};
  }
  function adoptIdentity(next,nextPlayer,adminExists,adminRecoveryAvailable=false){
    persist(next);player=nextPlayer;status=serviceStatus({adminExists,adminRecoveryAvailable},null);lastError='';revision=0;savedConfig=null;adminRegistration=null;releaseReview=null;
    if(consoleDialog?.open)consoleDialog.close();
  }
  async function request(path, {method='GET',body,token=identity?.token,auth=true,guardIdentity=true}={}){
    const epoch=identityEpoch;
    const abort=new AbortController(), timer=setTimeout(()=>abort.abort(),15000);
    try {
      const headers={Accept:'application/json'};
      if(body!==undefined)headers['Content-Type']='application/json';
      if(auth && token)headers.Authorization='Bearer '+token;
      const res=await fetch(API+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:abort.signal,credentials:'omit',cache:'no-store',referrerPolicy:'strict-origin-when-cross-origin'});
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
      player=data.player;status=serviceStatus(data);persist({...identity,id:player.id,name:player.name});return player;
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
        let cursor='', totalPending=0, received=0, initialReceived=0;
        const initialSeen=new Set(),initialNames=new Set();
        do{
          if(epoch!==identityEpoch)throw staleIdentity();
          const data=await request('/me?limit=50'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{token});
          if(epoch!==identityEpoch)throw staleIdentity();
          player=data.player;status=serviceStatus(data);
          // Initial companions are a current-owner entitlement, separate from
          // the Futo inbox and its administrator distribution controls.
          if(player?.isAdmin===true){
            for(const companion of data.initialCompanions||[]){
              const method=companion?.species==='arvelion'?'receiveAdminLegendary':companion?.species==='floravelle'?'receiveAdminMythical':null;
              const prefix=companion?.species==='arvelion'?'admin-legendary:':'admin-mythical:';
              if(!method||companion.grantId!==prefix+player.id||initialSeen.has(companion.grantId))continue;
              initialSeen.add(companion.grantId);
              const outcome=LT.adminBridge?.[method]?.(companion);
              if(outcome?.pending||!outcome?.ok)totalPending++;
              else if(!outcome.alreadyReceived){initialReceived++;initialNames.add((LT.DATA?.species?.[companion.species]?.name||(companion.species==='arvelion'?'アルヴェリオン':'キラシード')));}
            }
          }
          for(const grant of data.grants||[]){
            const bridge=LT.adminBridge;if(!bridge){totalPending++;continue;}
            const outcome=bridge.grantFuto(grant);
            let waiting=outcome?.pending || !outcome?.ok;
            if(outcome?.ok && !outcome.alreadyReceived)received++;
            if(player.isAdmin && String(grant.grantId).startsWith('admin-initial:') && outcome?.ok){
              const update=bridge.updateOwnedFuto(grant.grantId,grant);waiting=waiting||update?.pending||!update?.ok;
            }
            if(waiting)totalPending++;
          }
          cursor=data.nextCursor == null?'':String(data.nextCursor);
        }while(cursor);
        pending=totalPending;
        if(received||initialReceived)LT.adminBridge?.toast?.(`${received?'フートを受け取りました。':''}${initialReceived?'運営の初期メンバーに'+[...initialNames].join('・')+'が加わりました。':''}旅の仲間・ひかえを確認してください。`);
      }catch(err){if(!err.staleIdentity&&epoch===identityEpoch){status=null;lastError=err.message;}}
      if(epoch===identityEpoch)refreshSettings();
  }
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
    if(player?.isAdmin===false&&consoleDialog?.open){adminRegistration=null;releaseReview=null;consoleDialog.close();}
    const root=settingsRoot()?.querySelector('#pachi-service');if(!root)return;
    const body=root.querySelector('[data-service-body]');
    const signature=[!!player,player?.isAdmin,player?.id,status?.adminExists,claimBusy,releaseBusy,pending].join('|');
    if(!canClaim()){const field=document.getElementById('pachi-admin-key');if(field)field.value='';}
    if(body.dataset.signature!==signature){
      body.dataset.signature=signature;
      body.innerHTML=`${player?`<label for="pachi-player-id">プレイヤーID</label><input id="pachi-player-id" class="pachi-code" value="${escape(player.id)}" readonly autocomplete="off" spellcheck="false"><div class="pachi-inline"><div><label for="pachi-player-name">配布先に表示する名前</label><input id="pachi-player-name" maxlength="24" autocomplete="nickname" value="${escape(player.name)}"></div><button class="btn btn-small" data-admin-action="name">名前を保存</button></div>`:'<p>プレイヤー情報を確認しています…</p>'}${player?.isAdmin?'<p><strong>運営として登録済み</strong> · フートの能力設定・配布ができます。</p><p>アルヴェリオンは運営の初期メンバーとして1体使用できます。アルヴェリオンの配布機能はありません。</p><button class="btn btn-primary" data-admin-action="console">フートの運営管理</button>':canClaim()?`<div data-claim><label for="pachi-admin-key">運営キー</label><div class="pachi-inline"><div><input id="pachi-admin-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="運営キーを入力"${claimBusy||releaseBusy?' disabled':''}></div><button class="btn btn-primary" data-admin-action="claim"${claimBusy||releaseBusy?' disabled':''}>運営になる</button></div><p>最初に登録した1人が運営になります。</p></div>`:status?.adminExists?'<p>運営は登録済みです。お届けものは冒険中に自動で受け取れます。</p>':'<p>運営の登録状況を確認しています…</p>'}${pending?`<p>受け取り待ちの仲間：${pending}体。冒険を始め、戦闘を終えるか、仲間・ひかえに空きを作ると受け取れます。</p>`:''}<div class="pachi-actions"><button class="btn btn-small" data-admin-action="refresh">お届けものを確認</button>${player?'<button class="btn btn-small" data-admin-action="backup">プレイヤー情報を書き出す</button>':''}<button class="btn btn-small" data-admin-action="restore">プレイヤー情報を復元</button></div>`;
    }
    const line=root.querySelector('.pachi-status');line.textContent=lastError || (status?'接続済み · 冒険のセーブはこれまで通り端末内に保存されます。':'確認中…');line.dataset.error=String(!!lastError);
  }
  function say(message,error=false){lastError=error?message:'';const line=consoleDialog?.open?consoleDialog.querySelector('.pachi-status'):settingsRoot()?.querySelector('.pachi-status');if(line){line.textContent=message;line.dataset.error=String(error);}}
  async function withButton(button,action){button.disabled=true;try{await action();}catch(err){if(!err.staleIdentity)say(err.message,true);}finally{if(button.isConnected&&!sendBusy&&!releaseBusy)button.disabled=false;}}
  async function claim(button){
    if(claimBusy||releaseBusy)return;
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
    box.innerHTML='<h4>運営登録を解除しますか？</h4><p>解除すると、他のプレイヤーにも運営キーの入力欄が表示されます。再び運営になるには運営キーが必要です。冒険の記録や配布済みの仲間は削除されません。</p><div class="pachi-actions"><button class="btn" data-admin-action="release-cancel">解除せず戻る</button><button class="btn pachi-release-confirm" data-admin-action="release-confirm">運営登録を解除する</button></div>';
  }
  function prepareRelease(){
    if(releaseBusy||sendBusy)return;
    if(pendingGrant?.uncertain)throw new Error('配布結果の確認が終わってから、運営登録を解除してください。');
    if(!player?.isAdmin||adminRegistration?.playerId!==player.id||!Number.isSafeInteger(adminRegistration?.claimedAt))throw new Error('運営登録の最新の状態を確認してから、もう一度お試しください。');
    releaseReview={registration:{...adminRegistration},epoch:identityEpoch};renderReleaseReview();
    consoleDialog?.querySelector('[data-admin-action="release-cancel"]')?.focus({preventScroll:false});
  }
  async function releaseAdmin(){
    const review=releaseReview;if(releaseBusy||sendBusy||!review)return;
    if(review.epoch!==identityEpoch||review.registration.playerId!==player?.id||!player?.isAdmin){releaseReview=null;renderReleaseReview();throw staleIdentity();}
    if(pendingGrant?.uncertain)throw new Error('配布結果の確認が終わってから、運営登録を解除してください。');
    releaseBusy=true;
    const controls=[...(consoleDialog?.querySelectorAll('button,input,select')||[])];
    const disabled=controls.map(control=>control.disabled);controls.forEach(control=>{control.disabled=true;});
    try{
      const data=await request('/admin/release',{method:'POST',body:{confirmed:true,expectedRegistration:review.registration}});
      identityEpoch++;registration=null;player=data.player;status=serviceStatus(data,null);adminRegistration=null;releaseReview=null;
      clearPendingGrant();if(consoleDialog?.open)consoleDialog.close();refreshSettings();
      await sync({fresh:true});say('運営登録を解除しました。運営キーを持つプレイヤーが再登録できます。');
    }catch(err){
      if(!err.staleIdentity){adminRegistration=null;releaseReview=null;await sync({fresh:true});}
      throw err;
    }finally{
      releaseBusy=false;controls.forEach((control,index)=>{control.disabled=disabled[index];});renderReleaseReview();refreshSettings();
    }
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
    if(sendBusy)throw new Error('配布結果を確認しています。少しお待ちください。');
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
    if(sendBusy)return null;
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
    return Object.entries(LT.DATA.moves).filter(([id])=>id!=='struggle'&&!exclusive.has(id));
  }
  async function openConsole(){
    if(sendBusy||releaseBusy)throw new Error('操作の結果を確認しています。少しお待ちください。');
    await ensureIdentity();if(!player?.isAdmin)throw new Error('運営として登録されていません。');
    const data=await request('/admin/config');savedConfig=data.config;revision=data.revision;adminRegistration=data.adminRegistration||null;releaseReview=null;
    if(!consoleDialog){consoleDialog=document.createElement('dialog');consoleDialog.className='pachi-console';consoleDialog.setAttribute('aria-labelledby','pachi-console-title');document.body.append(consoleDialog);consoleDialog.addEventListener('click',handleConsole);consoleDialog.addEventListener('cancel',event=>{if(sendBusy||releaseBusy){event.preventDefault();say('操作の結果を確認しています。少しお待ちください。');}});consoleDialog.addEventListener('close',()=>{void sync();});}
    const cfg={...data.config,moves:LT.FutoRules?.normalizeMoves?LT.FutoRules.normalizeMoves(data.config.moves):data.config.moves};const moveLabel=m=>m.kind==='attack'?`${m.category==='physical'?'物理':'特殊'}・威力${m.power}`:m.kind==='heal'?`体力${m.power}%回復`:m.kind==='boost'?'全能力アップ':'防御';const options=selected=>futoMoveEntries().map(([id,m])=>`<option value="${escape(id)}"${id===selected?' selected':''}>${escape(m.name)} · ${escape(moveLabel(m))}</option>`).join('');
    consoleDialog.innerHTML=`<header class="pachi-console-head"><h2 id="pachi-console-title">フートの運営管理</h2><button class="btn btn-small" data-admin-action="close-console" aria-label="運営管理を閉じる">閉じる</button></header><div class="pachi-console-body"><div class="pachi-console-hero"><img src="assets/futo-front-v2.png" alt="フート"><div><p class="pachi-kicker">FUTO · ADMINISTRATOR</p><h3>きみが決める、フートの力。</h3><p>能力を設定し、全員または選んだプレイヤーへ届けます。<br>運営のフートには保存した設定が反映されます。</p></div></div><fieldset><legend>レベル・能力値</legend><div class="pachi-stat-grid"><label>レベル · 1〜100<input name="level" type="number" min="1" max="100" step="1" inputmode="numeric" value="${cfg.level}"></label>${fields.map(([key,label,max])=>`<label>${label} · 1〜${max}<input name="${key}" type="number" min="1" max="${max}" step="1" inputmode="numeric" value="${cfg.stats[key]}"></label>`).join('')}</div><small>能力値は戦闘で使う実際の数値です。フートは設定値を基準に、レベルアップすると能力が伸びます。</small><div class="pachi-move-grid">${cfg.moves.map((id,i)=>`<label>技 ${i+1}<select name="move${i}">${options(id)}</select></label>`).join('')}</div><small>初期技は、裂空拳（物理100）・星核砲（特殊100）・全霊覚醒（全能力アップ）・再生の光（体力半分回復）の順です。</small><div class="pachi-actions"><button class="btn btn-small" data-admin-action="default-moves">初期技4つに戻す</button><button class="btn btn-primary" data-admin-action="config">能力設定を保存</button></div><small>設定の変更は、これから配布する個体と運営の最初の1体に反映。配布済みの個体はそのままです。</small></fieldset><fieldset><legend>プレイヤーへ配布</legend><div class="pachi-send-grid"><label>配布先<select id="pachi-recipient"><option value="all">接続済みの全プレイヤー</option><option value="self">自分だけ</option></select></label><button class="btn btn-small" data-admin-action="players">プレイヤー一覧を更新</button></div><div class="pachi-actions"><button class="btn" data-admin-action="more-players" hidden>次のプレイヤーを読み込む</button><button class="btn btn-primary" data-admin-action="review">配布内容を確認</button></div><small>「全プレイヤー」は、配布した時点で本サービスに接続済みのプレイヤー全員です。未接続のプレイヤーは含まれません。受け取りは次の起動時にも行われます。</small><div id="pachi-review" hidden></div></fieldset>${adminRegistration?'<fieldset class="pachi-owner-controls"><legend>運営登録</legend><p>登録を解除すると、運営キーの入力欄を再び公開します。</p><button class="btn" data-admin-action="release-review">運営登録の解除を確認</button><div id="pachi-release-review" class="pachi-review" hidden></div></fieldset>':''}<p class="pachi-status" role="status" aria-live="polite"></p></div>`;
    consoleDialog._playersCursor=null;pendingGrant=loadPendingGrant();renderPendingGrant();
    if(!consoleDialog.open)consoleDialog.showModal();await loadPlayers(false);renderPendingGrant();
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
    if(button.disabled||sendBusy||releaseBusy)return;
    if(action==='close-console'){consoleDialog.close();return;}
    await withButton(button,async()=>{
      if(action==='release-review'){prepareRelease();return;}
      if(action==='release-cancel'){releaseReview=null;renderReleaseReview();return;}
      if(action==='release-confirm'){await releaseAdmin();return;}
      if(action==='default-moves'){LT.FutoRules.defaultMoves.forEach((id,i)=>{consoleDialog.querySelector(`[name="move${i}"]`).value=id;});say('初期技4つを選びました。「能力設定を保存」で反映できます。');}
      if(action==='config'){const config=readConfig();const data=await request('/admin/config',{method:'PUT',body:{config,expectedRevision:revision}});revision=data.revision;savedConfig=data.config;data.config.moves.forEach((id,i)=>{consoleDialog.querySelector(`[name="move${i}"]`).value=id;});await sync({fresh:true});say(pending?'能力設定を保存しました。戦闘後または受け取り可能になった時に運営のフートへ反映します。':'能力設定を保存しました。運営のフートにも反映しました。');}
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
    if(sendBusy||releaseBusy)throw new Error('操作の確認が終わってから、プレイヤー情報を復元してください。');
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
        if(sendBusy||releaseBusy)throw new Error('操作の確認が終わってから、プレイヤー情報を復元してください。');
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
  setInterval(()=>{if(!document.hidden)void sync();},30000);
  LT.Admin={sync,open:openConsole,get player(){return player;},get pending(){return pending;},
    async tradeIdentity(){const current=await ensureIdentity();return {...current};},
    async tradeRequest(path,options={}){
      if(typeof path!=='string'||!/^\/trades(?:\/(?:active|join|[a-zA-Z0-9-]+)(?:\/(?:offer|confirm|cancel|ack))?)?$/.test(path))throw new Error('交換先の指定が正しくありません。');
      await ensureIdentity();
      return request(path,{method:options.method||'GET',...(options.body!==undefined?{body:options.body}:{})});
    },
    async authorizeSecretEncounter(){
      await ensureIdentity();const epoch=identityEpoch,data=await request('/me?limit=1');
      if(epoch!==identityEpoch)throw staleIdentity();
      player=data.player;status=serviceStatus(data);
      if(player?.isAdmin!==true)throw new Error('この操作は現在の運営だけが使用できます。');
      return {...player};
    },
    async requestDuelPass(sessionId,grantId,side){await ensureIdentity();return request('/duel-pass',{method:'POST',body:{sessionId,grantId,side}});},
    verifyDuelPass(sessionId,pass,side){return request('/duel-pass/verify',{method:'POST',body:{sessionId,pass,side},auth:false});}
  };
  mountSettings();void sync();
})();
