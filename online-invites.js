/* Pachi Monsters — typed invitations; opening a link never joins or confirms. */
(() => {
  'use strict';
  const root=globalThis,LT=root.LT=root.LT||{};
  const MODE_KEY='pachi_invite',ROOM_KEY='pachi_room';
  const MODES=new Set(['battle','trade']);
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const modeName=mode=>mode==='trade'?'オンライン交換':'オンライン対戦';
  function normalizeCode(value){
    const code=typeof value==='string'?value.toUpperCase():'';
    if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code))throw new Error('招待のコードが正しくありません。相手に招待リンクを送り直してもらってください。');
    return code;
  }
  function asUrl(value){
    try{return new URL(value);}catch(_){throw new Error('招待リンクの形式が正しくありません。');}
  }
  function validateMode(mode){
    if(!MODES.has(mode))throw new Error('対戦か交換かを確認できない招待です。相手に招待リンクを送り直してもらってください。');
    return mode;
  }
  function parse(value){
    const url=asUrl(value),modes=url.searchParams.getAll(MODE_KEY),rooms=url.searchParams.getAll(ROOM_KEY);
    if(!modes.length&&!rooms.length)return null;
    if(!/^https?:$/.test(url.protocol)||url.username||url.password)throw new Error('この招待リンクは開けません。ゲーム内で作った招待リンクを使ってください。');
    // Duplicate values are ambiguous even when they happen to be equal.
    if(modes.length!==1||rooms.length!==1)throw new Error('招待情報が不足しているか、重複しています。相手に招待リンクを送り直してもらってください。');
    return Object.freeze({mode:validateMode(modes[0]),code:normalizeCode(rooms[0])});
  }
  function create(mode,code,base=root.location?.href){
    validateMode(mode);code=normalizeCode(code);
    const url=asUrl(base);
    if(!/^https?:$/.test(url.protocol)||url.username||url.password)throw new Error('ゲームをHTTPまたはHTTPSで開いてから招待リンクを作ってください。');
    // A new invitation contains only its kind and room; no old query or fragment.
    url.search='';url.hash='';
    url.searchParams.set(MODE_KEY,mode);url.searchParams.set(ROOM_KEY,code);
    return url.href;
  }
  function shareHtml(mode,code){
    const url=create(mode,code),label=modeName(mode);
    const share=typeof root.navigator?.share==='function'?'<button type="button" class="btn" data-online-invite-share>招待を共有</button>':'';
    return `<section class="online-invite-share" aria-label="${label}の招待"><p class="online-invite-heading">招待リンクを相手に送る</p><label class="online-invite-field">${label}の招待リンク<input class="online-invite-url" type="url" readonly spellcheck="false" autocomplete="off" data-online-invite-url value="${escape(url)}"></label><div class="online-invite-actions"><button type="button" class="btn btn-primary" data-online-invite-copy>招待リンクをコピー</button>${share}</div><p class="online-invite-help">相手はリンクを開き、表示された部屋への参加を選びます。</p><p class="online-invite-status" data-online-invite-status role="status" aria-live="polite"></p></section>`;
  }
  async function handleClick(event){
    const button=event?.target?.closest?.('[data-online-invite-copy], [data-online-invite-share]');
    if(!button)return false;
    event.preventDefault?.();
    if(button.disabled)return true;
    const container=button.closest('.online-invite-share'),field=container?.querySelector('[data-online-invite-url]'),status=container?.querySelector('[data-online-invite-status]');
    if(!field)return true;
    const say=text=>{if(status)status.textContent=text;};
    button.disabled=true;
    try{
      const invite=parse(field.value);
      if(!invite)throw new Error('招待リンクを作り直してください。');
      const url=create(invite.mode,invite.code,field.value);
      if(button.hasAttribute('data-online-invite-share')&&typeof root.navigator?.share==='function'){
        await root.navigator.share({title:'パチモン｜'+modeName(invite.mode),text:modeName(invite.mode)+'に招待しています。リンクを開いて参加してください。',url});
        say('招待の共有を完了しました。');
      }else if(typeof root.navigator?.clipboard?.writeText==='function'){
        await root.navigator.clipboard.writeText(url);say('招待リンクをコピーしました。相手に送ってください。');
      }else{
        field.focus?.({preventScroll:true});field.select?.();say('上のリンクを選択しました。端末のコピー操作で相手に送ってください。');
      }
    }catch(error){
      if(error?.name==='AbortError')say('共有をキャンセルしました。');
      else{field.focus?.({preventScroll:true});field.select?.();say('コピー・共有を完了できませんでした。上のリンクを選択してコピーしてください。');}
    }finally{button.disabled=false;}
    return true;
  }

  // This state holds only the invitation. Adventure saves and pending trade
  // records belong to their existing owners and are never read or written here.
  function createReceiver({href,replace=()=>{},deliver,changed=()=>{}}){
    let pending=null,error='',message='',working=false;
    try{pending=parse(href());}catch(problem){error=problem.message;}
    const snapshot=()=>({pending,error,message,working});
    const emit=()=>changed(snapshot());
    function clean(){
      try{const url=asUrl(href());url.searchParams.delete(MODE_KEY);url.searchParams.delete(ROOM_KEY);replace(url.href);}catch(_){}
    }
    return {
      snapshot,
      async open(){
        if(!pending||working)return false;
        working=true;message='';emit();
        const invite=pending;
        try{
          const result=await deliver(invite);
          if(result===true||result?.accepted===true){if(pending===invite){pending=null;error='';clean();}return true;}
          message=result?.message||'今の操作が終わってから、この招待を開いてください。';return false;
        }catch(problem){message=problem?.message||'招待を開けませんでした。もう一度お試しください。';return false;}
        finally{working=false;emit();}
      },
      dismiss(){pending=null;error='';message='';clean();emit();},
      refresh(){emit();}
    };
  }
  async function routeInvite(invite,environment=root){
    const api=environment.LT||{},document=environment.document,bridge=api.adminBridge;
    validateMode(invite?.mode);const code=normalizeCode(invite?.code);
    const blocked=message=>({accepted:false,message});
    const pendingTrade=api.Trade?.isLocked?.()===true;
    if(pendingTrade){
      // Keep recovery ahead of all new invitations, including battle invites.
      if(!api.onlineActive&&!api.localTradeActive&&!document?.querySelector?.('dialog[open]'))await api.Trade?.resume?.();
      return blocked('進行中の交換の結果を先に確認してください。この招待はそのまま残ります。');
    }
    if(api.onlineActive||api.localTradeActive||api.tradeActive)return blocked('いまの対戦・交換を終えてから、この招待を開いてください。');
    if(bridge?.isBusy?.()||bridge?.getEngine?.()?.battle||document?.querySelector?.('dialog[open]')||document?.body?.classList?.contains?.('is-booting'))return blocked('戦闘や会話、開いている画面を終えてから、この招待を開いてください。');
    if(environment.navigator?.onLine===false)return blocked('インターネットにつながると参加できます。この招待はそのまま残ります。');
    if(invite.mode==='trade'){
      if(!bridge?.isPlaying?.())return blocked('「つづきから」または「冒険をはじめる」で冒険を開いてから、この交換の招待を選んでください。');
      if(!api.Trade?.open)return blocked('交換を準備できません。ページを開き直してください。');
      const options={joinCode:code};
      return {accepted:await (api.requestTrade?api.requestTrade(options):api.Trade.open(options))===true};
    }
    if(!api.OnlineUI?.open)return blocked('対戦を準備できません。ページを開き直してください。');
    const options={transport:'internet',joinCode:code};
    return {accepted:await (api.requestOnline?api.requestOnline(options):api.OnlineUI.open(options))===true};
  }
  const api={normalizeCode,parse,create,shareHtml,handleClick,createReceiver,routeInvite};
  LT.OnlineInvites=Object.freeze(api);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(!root.document?.createElement||!root.location?.href)return;

  const document=root.document;
  let notice=null,rendered='';
  const receiver=createReceiver({href:()=>root.location.href,replace:url=>root.history?.replaceState?.(root.history.state,'',url),deliver:invite=>routeInvite(invite),changed:render});
  function render(state=receiver.snapshot()){
    if(!state.pending&&!state.error){notice?.remove();notice=null;rendered='';return;}
    if(!notice){
      notice=document.createElement('aside');notice.id='online-invite-notice';notice.className='online-invite-notice';notice.setAttribute('aria-labelledby','online-invite-notice-title');
      notice.addEventListener('click',async event=>{
        const button=event.target.closest('[data-online-invite-action]');if(!button||button.disabled)return;
        event.preventDefault();event.stopPropagation();
        if(button.dataset.onlineInviteAction==='dismiss'){receiver.dismiss();return;}
        if(button.dataset.onlineInviteAction==='adventure'){
          if(document.querySelector('dialog[open]')||document.body.classList.contains('is-booting')||LT.Trade?.isLocked?.())return;
          const next=document.getElementById('continue-btn');
          (next&&!next.hidden?next:document.getElementById('start-btn'))?.click();return;
        }
        await receiver.open();
      });
      document.body.append(notice);
    }
    const invite=state.pending,needsAdventure=invite?.mode==='trade'&&!LT.adminBridge?.isPlaying?.();
    const continuing=document.getElementById('continue-btn');
    const title=invite?modeName(invite.mode)+'に招待されています':'招待リンクを確認してください';
    const help=state.error||state.message||(needsAdventure?'冒険を開いたら、この招待から交換に参加できます。':invite?.mode==='trade'?'交換するパチモンは、部屋に参加してから確認できます。':'リンク先の部屋を確認してから参加できます。');
    const action=needsAdventure?'adventure':'open',buttonText=needsAdventure?(continuing&&!continuing.hidden?'つづきから交換へ':'冒険をはじめる'):invite?.mode==='trade'?'招待された交換へ':'招待された対戦へ';
    const html=`<p class="online-invite-eyebrow">PACHI LINK / INVITATION</p><h2 id="online-invite-notice-title">${escape(title)}</h2>${invite?`<p class="online-invite-code">${invite.mode==='trade'?'交換':'対戦'}コード <strong>${escape(invite.code)}</strong></p>`:''}<p class="online-invite-help" role="status" aria-live="polite">${escape(help)}</p><div class="online-invite-actions">${invite?`<button type="button" class="btn btn-primary" data-online-invite-action="${action}" ${state.working?'disabled':''}>${state.working?'画面を開いています…':buttonText}</button>`:''}<button type="button" class="btn" data-online-invite-action="dismiss">${invite?'招待を閉じる':'閉じる'}</button></div>`;
    if(html!==rendered){notice.innerHTML=html;rendered=html;}
  }
  render();
  if(!receiver.snapshot().pending&&!receiver.snapshot().error)return;
  // Refresh the invitation, not the route. Returning from a dialog never joins
  // again, and a new adventure's delayed introduction remains free to finish.
  for(const event of ['pachi-game-ready','pachi-admin-bridge-ready','pachi-online-state','visibilitychange'])document.addEventListener(event,()=>receiver.refresh());
  document.addEventListener('close',()=>receiver.refresh(),true);
  root.addEventListener?.('online',()=>receiver.refresh());
  root.addEventListener?.('focus',()=>receiver.refresh());
})();
