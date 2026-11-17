/* Pachi Monsters — durable two-party trade confirmation and recovery. */
(() => {
  'use strict';
  const LT=globalThis.LT=globalThis.LT||{};
  const KEY='pachi-pending-trade-v1';
  const copy=value=>JSON.parse(JSON.stringify(value));
  function parsePending(raw){const p=JSON.parse(raw);if(!p||p.version!==1||typeof p.ownerId!=='string'||(!p.roomId&&!['create','join'].includes(p.action)))throw Error('Invalid pending trade');return p;}
  const stable=value=>JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(stable(value[key]))])):Array.isArray(value)?value.map(item=>JSON.parse(stable(item))):value);
  function snapshot(mon){
    if(!mon)return null;
    const value={uid:mon.uid,species:mon.species,level:mon.level,xp:mon.xp,hp:mon.hp,pp:copy(mon.pp||{}),nickname:mon.nickname||'',shiny:mon.shiny===true};
    return value;
  }
  function eligible(mon,data=LT.DATA){
    const species=data?.species?.[mon?.species];
    return !!species&&!species.specialOnly&&!species.adminOnly&&mon.species!=='futo'&&mon.species!=='floravelle'&&
      !['grantId','customStats','customMoves','customStatsLevel','futoConfigLevel'].some(key=>mon[key]!==undefined);
  }
  class TradeController {
    constructor({storage,request,identify,getEngine,commit,changed=()=>{},uuid=()=>crypto.randomUUID(),data=LT.DATA}){
      Object.assign(this,{storage,request,identify,getEngine,commit,changed,uuid,data});
      this.pending=null;this.trade=null;this.error='';this.busy=false;this.corrupt=false;this.completed=false;
      try{const raw=storage.getItem(KEY);if(raw)this.pending=parsePending(raw);}
      catch(_){this.corrupt=true;this.error='交換の確認情報を読み込めません。冒険記録を消さず、交換画面を開き直して確認してください。';}
    }
    isLocked(){return this.corrupt||!!this.pending;}
    hasStoredPending(){try{return this.storage.getItem(KEY)!==null;}catch(_){return true;}}
    refreshPending(){
      try{const raw=this.storage.getItem(KEY);if(raw){this.pending=parsePending(raw);this.corrupt=false;}}
      catch(_){this.corrupt=true;}
    }
    emit(){this.changed(this);}
    persist(record){
      const raw=this.storage.getItem(KEY);
      if(raw){try{const latest=parsePending(raw);if(latest.roomId&&record.roomId&&latest.roomId!==record.roomId)throw Error('別のタブの交換を確認しています。「結果を再確認」を押してください。');}catch(error){if(error.message!=='Invalid pending trade'&&!(error instanceof SyntaxError))throw error;}}
      this.storage.setItem(KEY,JSON.stringify(record));this.pending=record;this.emit();
    }
    clear(){
      const raw=this.storage.getItem(KEY);
      if(raw){let latest=null;try{latest=parsePending(raw);}catch(error){if(!this.corrupt)throw error;}if(latest&&(this.corrupt||latest.roomId!==this.pending?.roomId||latest.requestId!==this.pending?.requestId)){this.pending=latest;this.corrupt=false;this.trade=null;this.completed=false;this.emit();return;}}
      this.storage.removeItem(KEY);this.pending=null;this.corrupt=false;this.emit();
    }
    own(trade=this.trade){return trade?.[trade.you]||null;}
    other(trade=this.trade){return trade?.[trade.you==='host'?'guest':'host']||null;}
    inventory(){const state=this.getEngine()?.state;return [...(state?.party||[]),...(state?.storage||[])];}
    async run(action){
      if(this.busy)return {ok:false,busy:true};
      this.busy=true;this.error='';this.emit();
      try{await action();return {ok:true};}
      catch(error){this.error=error?.message||'通信を確認できません。再確認してください。';return {ok:false,error};}
      finally{this.busy=false;this.emit();}
    }
    async identity(){
      const owner=await this.identify();
      if(this.pending?.ownerId&&owner.id!==this.pending.ownerId)throw Error('交換を始めたプレイヤー情報と一致しません。元のプレイヤーで交換結果を確認してください。');
      return owner;
    }
    async accept(trade,owner){
      if(!trade)return;
      if(!['host','guest'].includes(trade.you)||trade[trade.you]?.id!==owner.id)throw Error('交換の参加者情報が一致しません。');
      if(this.pending?.roomId&&this.pending.roomId!==trade.id)throw Error('確認中の交換と別の交換が見つかりました。');
      this.trade=trade;this.completed=false;
      if(trade.state==='cancelled'||trade.state==='expired'){this.clear();return;}
      this.persist({...this.pending,version:1,ownerId:owner.id,roomId:trade.id,code:trade.code,action:null});
      if(trade.state==='committed'){
        if(!trade.receipt)throw Error('成立した交換の受け取り情報を再確認してください。');
        const applied=await this.commit(trade.receipt);
        if(!applied?.ok)throw Error('交換は成立しています。'+(applied?.message||'冒険記録への保存に失敗しました。')+'「結果を再確認」で受け取りを再開できます。');
        // Acknowledge only after the complete save (receipt + replacement) is durable.
        await this.request('/trades/'+trade.id+'/ack',{method:'POST',body:{}});
        this.completed=true;this.clear();
      }
    }
    async recover(){
      this.refreshPending();
      const owner=await this.identity();
      if(this.corrupt){
        const result=await this.request('/trades/active');
        if(!result.trade){this.clear();this.trade=null;return;}
        this.corrupt=false;await this.accept(result.trade,owner);return;
      }
      let result;
      try{
        if(this.pending?.roomId)result=await this.request('/trades/'+this.pending.roomId);
        else if(this.pending?.action==='create')result=await this.request('/trades',{method:'POST',body:{requestId:this.pending.requestId}});
        else if(this.pending?.action==='join')result=await this.request('/trades/join',{method:'POST',body:{code:this.pending.code}});
        else result=await this.request('/trades/active');
      }catch(error){
        // A definitively rejected new join/create is safe to release only after
        // checking that no active room was established for this identity.
        if(!this.pending?.roomId&&this.pending&&[400,403,404,409,410].includes(error.status)){
          const active=await this.request('/trades/active');
          if(active.trade){await this.accept(active.trade,owner);return;}
          this.clear();
        }
        throw error;
      }
      if(result.trade)await this.accept(result.trade,owner);
      else if(this.pending)throw Error('交換結果をまだ確認できません。再確認してください。');
    }
    resume(){return this.run(()=>this.recover());}
    create(){return this.start('create');}
    join(code){return this.start('join',String(code||'').normalize('NFKC').replace(/[\s-]/g,'').toUpperCase());}
    start(action,code){return this.run(async()=>{
      this.refreshPending();
      if(this.isLocked()){await this.recover();return;}
      if(action==='join'&&!/^[A-Z0-9]{6}$/.test(code))throw Error('相手の6文字の交換コードを入力してください。');
      if(!this.getEngine()?.state.started)throw Error('冒険を始めてから交換できます。');
      const owner=await this.identity(),active=await this.request('/trades/active');
      if(active.trade){await this.accept(active.trade,owner);return;}
      this.completed=false;this.trade=null;
      this.persist({version:1,ownerId:owner.id,action,requestId:action==='create'?this.uuid():undefined,code:code||undefined});
      await this.recover();
    });}
    offer(uid){return this.run(async()=>{
      const trade=this.trade;if(!trade||trade.state!=='open')throw Error('交換相手との接続を確認してください。');
      const mon=this.inventory().find(item=>item.uid===uid);
      if(!eligible(mon,this.data))throw Error('このパチモンは交換できません。運営専用・配布個体は対象外です。');
      const owner=await this.identity();
      const result=await this.request('/trades/'+trade.id+'/offer',{method:'POST',body:{revision:trade.revision,monster:snapshot(mon)}});
      await this.accept(result.trade,owner);
    });}
    checkConfirmation(){
      const trade=this.trade,own=this.own(),other=this.other();
      if(!trade||trade.state!=='open'||!own?.monster||!other?.monster)throw Error('お互いのパチモンが選ばれるまでお待ちください。');
      const state=this.getEngine()?.state,mon=this.inventory().find(item=>item.uid===own.monster.uid);
      if(!eligible(mon,this.data)||stable(snapshot(mon))!==stable(snapshot(own.monster)))throw Error('選んだパチモンの状態が変わりました。選び直してください。');
      if(!eligible(other.monster,this.data))throw Error('相手のパチモンを交換できません。');
      if((state.tradeReceipts||[]).length>=(LT.TradeRules?.receiptLimit||4096))throw Error('交換記録が上限に達しています。');
      if(state.party.some(item=>item.uid===mon.uid)&&!state.party.some(item=>item.uid!==mon.uid&&item.hp>0)&&other.monster.hp<=0)throw Error('動ける仲間がいなくなるため、相手のパチモンを回復してから選び直してください。');
      return trade;
    }
    confirm(expectedRevision=this.trade?.revision){return this.run(async()=>{
      if(expectedRevision!==this.trade?.revision)throw Error('交換内容が更新されました。最新のパチモンを見てから、もう一度確認してください。');
      const trade=this.checkConfirmation();if(this.own().confirmed)return;
      const owner=await this.identity();
      const result=await this.request('/trades/'+trade.id+'/confirm',{method:'POST',body:{revision:trade.revision}});
      await this.accept(result.trade,owner);
    });}
    cancel(){return this.run(async()=>{
      await this.recover();if(!this.pending)return;
      const trade=this.trade;if(!trade||trade.state!=='open')throw Error('交換結果を確認してから操作してください。');
      const owner=await this.identity(),result=await this.request('/trades/'+trade.id+'/cancel',{method:'POST',body:{}});
      await this.accept(result.trade,owner);
    });}
  }
  const core={TradeController,eligible,snapshot,key:KEY};
  if(typeof module!=='undefined'&&module.exports)module.exports=core;
  LT.TradeClientCore=core;
  if(!globalThis.document?.createElement||!LT.DATA)return;
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let dialog=null,poll=null,selected='',renderKey='',renderedRevision=null,deferredRender=false;
  const controller=new TradeController({storage:localStorage,request:(path,options)=>LT.Admin.tradeRequest(path,options),identify:()=>LT.Admin.tradeIdentity(),
    getEngine:()=>LT.adminBridge?.getEngine?.(),commit:receipt=>LT.adminBridge?.commitTrade?.(receipt),changed:()=>{LT.tradeActive=controller.isLocked()||dialog?.open===true;render();schedule();}});
  LT.tradeActive=controller.isLocked();
  function monName(mon){return mon?.nickname||LT.DATA.species[mon?.species]?.name||'未選択';}
  function card(person,label){
    const mon=person?.monster,species=LT.DATA.species[mon?.species],type=LT.DATA.elements[species?.element];
    return `<article class="trade-card"><h3>${label}</h3><p class="trade-player">${escape(person?.name||'相手を待っています')}</p>${mon?`<canvas width="240" height="240" data-trade-portrait="${escape(mon.species)}" data-trade-shiny="${mon.shiny===true}" aria-label="${escape(monName(mon))}の姿"></canvas><strong>${escape(monName(mon))}${mon.shiny?' ✦':''}</strong><p>${escape(species?.name)} · ${escape(type?.name)}タイプ<br>Lv.${mon.level} · 体力 ${mon.hp}</p><span class="trade-confirmed">${person.confirmed?'確認済み':'未確認'}</span>`:'<p class="trade-empty">パチモンを選択中</p>'}</article>`;
  }
  function ensureDialog(){
    if(dialog)return;
    dialog=document.createElement('dialog');dialog.id='pachi-trade-dialog';dialog.className='pachi-trade';dialog.setAttribute('aria-labelledby','trade-title');document.body.append(dialog);
    dialog.addEventListener('cancel',event=>{if(controller.isLocked()||controller.busy){event.preventDefault();controller.error='交換を終えるには「交換をキャンセル」を選んでください。';render();}});
    dialog.addEventListener('close',()=>{if(controller.isLocked()){dialog.showModal();return;}LT.tradeActive=false;clearTimeout(poll);poll=null;});
    dialog.addEventListener('change',event=>{if(event.target.id==='trade-monster')selected=event.target.value;});
    dialog.addEventListener('focusout',()=>{if(deferredRender)setTimeout(render,0);});
    dialog.addEventListener('click',async event=>{
      const button=event.target.closest('[data-trade]');if(!button||button.disabled)return;
      const action=button.dataset.trade;
      if(action==='close'){if(!controller.isLocked()&&!controller.busy)dialog.close();return;}
      if(action==='create')await controller.create();
      if(action==='join')await controller.join(dialog.querySelector('#trade-code-input')?.value);
      if(action==='offer')await controller.offer(dialog.querySelector('#trade-monster')?.value);
      if(action==='confirm')await controller.confirm(renderedRevision);
      if(action==='cancel')await controller.cancel();
      if(action==='refresh')await controller.resume();
    });
  }
  function render(){
    if(!dialog)return;
    const trade=controller.trade,locked=controller.isLocked(),busy=controller.busy;
    let body='';
    if(!locked&&!trade){body=`<p>6文字のコードで相手とつながり、お互いのパチモンを確認して交換します。</p><button class="btn btn-primary" data-trade="create">交換コードを作る</button><form class="trade-join" onsubmit="return false"><label for="trade-code-input">相手の交換コード</label><input id="trade-code-input" maxlength="12" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="6文字のコード"><button type="button" class="btn" data-trade="join">コードで参加</button></form>`;}
    else if(!trade){body='<p>交換の接続・結果を確認しています。通信が途切れても、記録を保持して再確認します。</p><button class="btn" data-trade="refresh">結果を再確認</button>';}
    else if(trade.state==='open'){
      const own=controller.own(),other=controller.other(),inventory=controller.inventory().filter(mon=>eligible(mon));
      if(!inventory.some(mon=>mon.uid===selected))selected=own?.monster?.uid||inventory[0]?.uid||'';
      body=`<p class="trade-code-label">相手に伝える交換コード</p><p class="trade-code">${escape(trade.code)}</p><p class="trade-note">有効期限 ${new Date(trade.expiresAt).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})} · 交換中は冒険を一時停止します。</p><div class="trade-pair">${card(own,'自分が渡す')}${card(other,'相手から受け取る')}</div><div class="trade-offer"><label for="trade-monster">渡すパチモン（手持ち・ひかえ）</label><select id="trade-monster">${inventory.map(mon=>`<option value="${escape(mon.uid)}" ${mon.uid===selected?'selected':''}>${escape(monName(mon))} · Lv.${mon.level}${mon.shiny?' · 色違い':''}${controller.getEngine()?.state.party.some(item=>item.uid===mon.uid)?' · 手持ち':' · ひかえ'}</option>`).join('')}</select><button class="btn" data-trade="offer" ${!inventory.length?'disabled':''}>このパチモンを提示</button></div><p class="trade-note">どちらかが選び直すと、お互いの確認が解除されます。両方が確認すると交換が成立します。</p><div class="trade-actions"><button class="btn btn-primary" data-trade="confirm" ${!own?.monster||!other?.monster||own.confirmed?'disabled':''}>${own?.confirmed?'確認済み · 相手を待っています':'この内容で交換を確認'}</button><button class="btn" data-trade="refresh">結果を再確認</button><button class="btn btn-quiet" data-trade="cancel">交換をキャンセル</button></div>`;
    }else if(trade.state==='committed'){
      body=`<p class="trade-result">${controller.completed?'交換が完了しました':'交換成立 · 受け取りを確認中'}</p><div class="trade-pair">${card(controller.own(),'渡したパチモン')}${card(controller.other(),'受け取ったパチモン')}</div><p>${controller.completed?'受け取ったパチモンと交換記録を保存しました。':'この画面から再確認すると、成立済みの交換を重複させずに受け取れます。'}</p>${locked?'<button class="btn btn-primary" data-trade="refresh">結果を再確認</button>':'<button class="btn btn-primary" data-trade="close">冒険へ戻る</button>'}`;
    }else{body=`<p class="trade-result">${trade.state==='expired'?'交換の有効期限が切れました':'交換をキャンセルしました'}</p><p>パチモンは交換されていません。</p><button class="btn btn-primary" data-trade="close">冒険へ戻る</button>`;}
    const codeDraft=dialog.querySelector('#trade-code-input')?.value||'',focusId=document.activeElement?.id;
    const nextKey=String(locked)+body,editing=['trade-monster','trade-code-input'].includes(focusId);
    if(nextKey!==renderKey&&editing&&trade?.state==='open'){deferredRender=true;}
    else if(nextKey!==renderKey){
      const scrollTop=dialog.querySelector('.trade-body')?.scrollTop||0;
      dialog.innerHTML=`<header><div><p class="trade-eyebrow">PACHI MONSTERS</p><h2 id="trade-title">オンライン交換</h2></div><button type="button" class="btn btn-small" data-trade="close" ${locked?'disabled':''}>閉じる</button></header><div class="trade-body">${body}<p class="trade-status" role="status" aria-live="polite"></p><p class="trade-note">運営専用の幻・フート・配布受取情報のある個体は交換できません。</p></div>`;
      renderKey=nextKey;renderedRevision=trade?.revision??null;deferredRender=false;
      if(codeDraft&&dialog.querySelector('#trade-code-input'))dialog.querySelector('#trade-code-input').value=codeDraft;
      if(editing)dialog.querySelector('#'+focusId)?.focus?.({preventScroll:true});
      dialog.querySelector('.trade-body').scrollTop=scrollTop;
      for(const button of dialog.querySelectorAll('button'))button._tradeUnavailable=button.disabled;
      for(const canvas of dialog.querySelectorAll('canvas[data-trade-portrait]'))LT.Art?.creature?.(canvas,canvas.dataset.tradePortrait,{shiny:canvas.dataset.tradeShiny==='true',time:0});
    }
    const status=dialog.querySelector('.trade-status');if(status)status.textContent=controller.error||(busy?'確認しています…':'');
    for(const button of dialog.querySelectorAll('button'))button.disabled=busy||button._tradeUnavailable===true;
  }
  function schedule(){
    clearTimeout(poll);poll=null;
    if(controller.busy||!controller.isLocked()||document.hidden)return;
    poll=setTimeout(()=>{void controller.resume();},4000);
  }
  async function open(){
    controller.refreshPending();
    if(LT.onlineActive||(!controller.isLocked()&&(!LT.adminBridge?.isPlaying?.()||controller.getEngine()?.battle))){LT.adminBridge?.toast?.('冒険中の移動できるときに交換できます。');return;}
    if(!controller.isLocked()){controller.trade=null;controller.completed=false;controller.error='';}
    ensureDialog();if(!dialog.open)dialog.showModal();LT.tradeActive=true;render();await controller.resume();
  }
  async function resume(){
    controller.refreshPending();
    if(!controller.isLocked())return;
    ensureDialog();if(!dialog.open)dialog.showModal();LT.tradeActive=true;render();await controller.resume();
  }
  LT.Trade={open,resume,isLocked:()=>controller.busy||controller.isLocked()||controller.hasStoredPending(),close(){if(dialog?.open&&!controller.isLocked()&&!controller.busy)dialog.close();}};
  for(const name of ['pachi-game-ready','pachi-admin-bridge-ready'])document.addEventListener(name,()=>{void resume();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(controller.isLocked())void resume();else schedule();}});
  globalThis.addEventListener?.('storage',event=>{
    if(event.key!==KEY)return;
    // Another tab can update the pending room. Never trust its claim that a
    // receipt was applied; reload it from the authenticated server.
    if(event.newValue){controller.refreshPending();LT.tradeActive=true;void resume();}
    else if(controller.isLocked())void resume();
  });
  if(controller.isLocked())void resume();
})();
