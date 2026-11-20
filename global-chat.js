/* Cross-map player chat. Message content is always rendered as text. */
(() => {
  'use strict';
  const root=globalThis,LT=root.LT=root.LT||{},PLAYER=/^P[0-9a-f]{16}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const READ_KEY='pachi-global-chat-read-v1:',MAX_LENGTH=300,OPEN_DELAY=4000,CLOSED_DELAY=20000;
  const safeId=value=>Number.isSafeInteger(value)&&value>=0;
  function messageText(value){
    const normalized=String(value??'').replace(/\r\n/g,'\n'),text=normalized.trim(),count=Array.from(text).length;
    if(!text.replace(/[\s\u200b-\u200f\u2060-\u206f\ufeff]/gu,''))return {ok:false,text,count,message:'メッセージを入力してください。'};
    if(count>MAX_LENGTH)return {ok:false,text,count,message:'メッセージは300文字以内で入力してください。'};
    if(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(normalized)||Array.from(text).some(char=>char.length===1&&char.charCodeAt(0)>=0xd800&&char.charCodeAt(0)<=0xdfff))
      return {ok:false,text,count,message:'使用できない制御文字が含まれています。'};
    return {ok:true,text,count,message:''};
  }
  function normalizeMessage(value){
    if(!value||!safeId(value.id)||value.id===0||!UUID.test(value.clientId||'')||!PLAYER.test(value.authorId||'')||typeof value.name!=='string'||value.name.length>160||!Number.isFinite(value.createdAt)||value.createdAt<0||value.createdAt>8640000000000000||typeof value.canDelete!=='boolean')throw Error('チャットの表示内容を確認できません。');
    const deleted=value.deletedAt!==null;
    if(deleted?(!Number.isFinite(value.deletedAt)||value.text!==null):(typeof value.text!=='string'||!messageText(value.text).ok))throw Error('チャットの表示内容を確認できません。');
    return {id:value.id,clientId:value.clientId,authorId:value.authorId,name:value.name,text:value.text,createdAt:value.createdAt,deletedAt:value.deletedAt,canDelete:!deleted&&value.canDelete};
  }
  class GlobalChatController {
    constructor({request,getIdentity,identify,enabled,storage,uuid=()=>crypto.randomUUID(),setTimer=(fn,delay)=>root.setTimeout(fn,delay),clearTimer=timer=>root.clearTimeout(timer),changed=()=>{}}){
      Object.assign(this,{request,getIdentity,identify,enabled,storage,uuid,setTimer,clearTimer,changed});
      this.owner=null;this.epoch=0;this.view=0;this.mutations=0;this.opened=false;this.messages=[];this.latestId=0;this.snapshotId=0;this.readId=0;this.unreadCount=0;
      this.draft='';this.draftVersion=0;this.retry=null;this.sending=null;this.deleting=new Map();this.pollTask=null;this.timer=null;this.status='';this.statusKind='';
    }
    get available(){return this.enabled()===true;}
    currentId(){const id=this.getIdentity()?.id;return PLAYER.test(id||'')?id:null;}
    state(){return {owner:this.owner,isOpen:this.opened,available:this.available,messages:this.messages,unreadCount:this.unreadCount,draft:this.draft,sending:!!this.sending,deleting:[...this.deleting.keys()],loading:!!this.pollTask,status:this.status,latestId:this.latestId,readId:this.readId};}
    signal(reason='state'){this.changed(this.state(),reason);}
    storedRead(id){try{const value=Number(this.storage?.getItem(READ_KEY+id));return safeId(value)?value:0;}catch(_){return 0;}}
    storeRead(){if(!this.owner)return;try{this.storage?.setItem(READ_KEY+this.owner,String(this.readId));}catch(_){/* The in-memory cursor still works when storage is full. */}}
    cancelView(){this.view++;this.pollTask=null;this.sending=null;this.deleting.clear();this.clearTimer(this.timer);this.timer=null;}
    adopt(id){
      if(id===this.owner)return;
      const switching=this.owner!==null;this.epoch++;this.cancelView();if(switching)this.opened=false;
      this.owner=id;this.messages=[];this.latestId=0;this.snapshotId=0;this.readId=id?this.storedRead(id):0;this.unreadCount=0;this.draft='';this.draftVersion++;this.retry=null;this.status='';this.statusKind='';this.signal('identity');
    }
    syncIdentity(){const id=this.currentId();if(id!==this.owner)this.adopt(id);return id;}
    resetIdentity(){this.epoch++;this.cancelView();this.opened=false;this.owner=null;this.messages=[];this.latestId=0;this.snapshotId=0;this.readId=0;this.unreadCount=0;this.draft='';this.draftVersion++;this.retry=null;this.status='';this.statusKind='';this.signal('identity');}
    async ensureIdentity(){
      let id=this.currentId();
      if(!id){const epoch=this.epoch,view=this.view;await this.identify();if(epoch!==this.epoch||view!==this.view)return false;id=this.currentId();}
      if(!id)throw Error('プレイヤー情報を確認できません。');return id;
    }
    task(){return {epoch:this.epoch,view:this.view,owner:this.owner,opened:this.opened,mutations:this.mutations,readId:this.readId};}
    valid(task){
      if(this.currentId()!==this.owner){this.syncIdentity();return false;}
      return task.epoch===this.epoch&&task.view===this.view&&task.owner===this.owner&&task.opened===this.opened&&this.available;
    }
    schedule(delay=this.opened?OPEN_DELAY:CLOSED_DELAY){this.clearTimer(this.timer);this.timer=null;if(this.available)this.timer=this.setTimer(()=>{this.timer=null;void this.poll();},delay);}
    resume(delay=0){
      this.syncIdentity();
      if(!this.available){this.cancelView();if(!this.enabled('playing'))this.opened=false;if(!this.opened||this.statusKind!=='mutation-error'){this.status='';this.statusKind='';}this.signal('availability');return;}
      this.signal('availability');this.schedule(delay);
    }
    open(){
      if(!this.available)return false;this.syncIdentity();if(this.opened){this.signal('open');return true;}
      this.cancelView();this.opened=true;this.status='';this.statusKind='';this.signal('open');void this.poll();return true;
    }
    close(){if(!this.opened)return false;this.cancelView();this.opened=false;this.status='';this.statusKind='';this.signal('close');this.schedule();return true;}
    setDraft(value){this.draft=String(value);this.draftVersion++;if(this.statusKind==='mutation-error'){this.status='';this.statusKind='';}this.signal('draft');}
    deriveUnread(){return this.messages.filter(message=>message.id>this.readId&&message.authorId!==this.owner&&message.deletedAt===null).length;}
    markRead(){
      if(!this.opened||!this.available||!this.owner)return;
      // A POST's latestId may include concurrent, unseen messages. Only a full
      // GET snapshot is evidence that the viewport can have shown this far.
      const next=Math.max(this.readId,this.snapshotId);if(next===this.readId&&this.unreadCount===0)return;
      this.readId=next;this.unreadCount=this.deriveUnread();this.storeRead();this.signal('read');
    }
    storageChanged(key){
      if(key==='pachi-player-identity-v1'){this.resetIdentity();this.schedule(0);return;}
      if(this.owner&&key===READ_KEY+this.owner){this.readId=Math.max(this.readId,this.storedRead(this.owner));this.unreadCount=this.opened?this.deriveUnread():0;this.cancelView();this.signal('read');this.schedule(0);}
    }
    reconcileRetry(){
      const retry=this.retry;if(!retry||!this.messages.some(message=>message.authorId===this.owner&&message.clientId===retry.clientId))return false;
      if(this.draftVersion===retry.draftVersion&&messageText(this.draft).text===retry.text){this.draft='';this.draftVersion++;}
      this.retry=null;return true;
    }
    async poll(){
      if(!this.available){this.signal('availability');return false;}if(this.pollTask)return false;
      const marker={};this.pollTask=marker;this.signal('loading');
      try{
        const identity=await this.ensureIdentity();
        // Even an already-known identity yields a microtask here. A close or
        // reopen may have installed a different poll while that task yielded.
        if(!identity||this.pollTask!==marker||!this.available)return false;
        if(identity!==this.owner){this.adopt(identity);return this.poll();}
        const task=this.task();
        const data=await this.request(this.opened?'/world/chat':'/world/chat?summary=1&after='+this.readId);
        if(!this.valid(task)||task.mutations!==this.mutations)return false;
        if(!safeId(data?.latestId))throw Error('チャットの更新を確認できません。');
        if(task.opened){
          if(!Array.isArray(data.messages)||data.messages.length>100)throw Error('チャットの表示内容を確認できません。');
          const messages=data.messages.map(normalizeMessage);
          if(messages.some((message,index)=>index&&message.id<=messages[index-1].id)||data.latestId!==(messages.at(-1)?.id||0))throw Error('チャットの更新順を確認できません。');
          this.messages=messages;this.latestId=data.latestId;this.snapshotId=data.latestId;const recovered=this.reconcileRetry();this.unreadCount=this.deriveUnread();
          if(recovered){this.status='送信済みのメッセージを確認しました。';this.statusKind='info';}else if(this.statusKind!=='mutation-error'){this.status='';this.statusKind='';}this.signal('messages');
        }else{
          if(!safeId(data.unreadCount)||task.readId!==this.readId)return false;
          this.latestId=data.latestId;this.unreadCount=data.unreadCount;this.signal('summary');
        }
        return true;
      }catch(error){if(this.pollTask===marker&&this.available&&this.statusKind!=='mutation-error'){this.status=error?.message||'チャットを更新できません。接続を確認してください。';this.statusKind='poll-error';this.signal('error');}return false;}
      finally{if(this.pollTask===marker){this.pollTask=null;this.signal('loading');this.schedule();}}
    }
    merge(message){this.messages=[...this.messages.filter(row=>row.id!==message.id),message].sort((a,b)=>a.id-b.id).slice(-100);this.unreadCount=this.deriveUnread();}
    async send(){
      if(this.sending||!this.opened||!this.available)return false;
      if(!this.owner||this.currentId()!==this.owner){this.syncIdentity();return false;}
      const input=messageText(this.draft);if(!input.ok){this.status=input.message;this.statusKind='mutation-error';this.signal('error');return false;}
      if(!this.retry||this.retry.text!==input.text)this.retry={clientId:this.uuid(),text:input.text,draftVersion:this.draftVersion};
      else this.retry.draftVersion=this.draftVersion;
      const retry={...this.retry};this.mutations++;const task=this.task();this.sending=task;this.status='送信中…';this.statusKind='progress';this.signal('sending');
      try{
        const data=await this.request('/world/chat',{method:'POST',body:{clientId:retry.clientId,text:retry.text}});
        if(!this.valid(task))return false;const message=normalizeMessage(data?.message);
        if(message.authorId!==this.owner||message.clientId!==retry.clientId)throw Error('送信結果を確認できません。もう一度送信すると確認できます。');
        if(this.draftVersion===retry.draftVersion&&messageText(this.draft).text===retry.text){this.draft='';this.draftVersion++;}
        if(this.retry?.clientId===retry.clientId)this.retry=null;
        this.merge(message);this.status=data.duplicate?'送信済みのメッセージを確認しました。':'送信しました。';this.statusKind='info';this.signal('messages');return true;
      }catch(error){if(this.valid(task)){this.status=error?.message||'送信できませんでした。入力は残っています。';this.statusKind='mutation-error';this.signal('error');}return false;}
      finally{if(this.sending===task){this.sending=null;this.signal('sending');this.schedule(0);}}
    }
    async remove(id){
      const existing=this.messages.find(message=>message.id===id);
      if(!this.opened||!this.available||!existing?.canDelete||this.deleting.has(id)||this.currentId()!==this.owner)return false;
      this.mutations++;const task=this.task();this.deleting.set(id,task);this.signal('deleting');
      try{
        const data=await this.request('/world/chat/'+id,{method:'DELETE'});if(!this.valid(task))return false;
        const message=normalizeMessage(data?.message);if(message.id!==id||message.deletedAt===null)throw Error('削除の結果を確認できません。');
        this.merge(message);this.status='メッセージを削除しました。';this.statusKind='info';this.signal('messages');return true;
      }catch(error){if(this.valid(task)){this.status=error?.message||'削除できませんでした。';this.statusKind='mutation-error';this.signal('error');}return false;}
      finally{if(this.deleting.get(id)===task){this.deleting.delete(id);this.signal('deleting');this.schedule(0);}}
    }
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={GlobalChatController,messageText,normalizeMessage,READ_KEY,OPEN_DELAY,CLOSED_DELAY};
  if(!root.document?.createElement)return;

  const bridge=()=>LT.adminBridge||{},playing=()=>bridge().isPlaying?.()===true;
  const touchKeyboard=()=>root.matchMedia?.('(pointer: coarse)').matches===true;
  let dialog,log,input,sendButton,counter,status,notice,composing=false,seenBottomId=0,lastState='',lastUnread=-1,renderedOwner=null;
  const rows=new Map();
  const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
  const controller=new GlobalChatController({
    request:(path,options)=>LT.Admin.worldRequest(path,options),getIdentity:()=>LT.Admin?.player,identify:()=>LT.Admin.tradeIdentity(),
    enabled:mode=>mode==='playing'?playing():playing()&&!document.hidden&&root.navigator?.onLine!==false,
    storage:root.localStorage,changed:render
  });
  function emitState(state){
    const detail={unreadCount:state.unreadCount,isOpen:state.isOpen,available:state.available},key=JSON.stringify(detail);
    if(key!==lastState){lastState=key;document.dispatchEvent(new CustomEvent('pachi-chat-state',{detail}));}
    if(lastUnread!==state.unreadCount){lastUnread=state.unreadCount;document.dispatchEvent(new CustomEvent('pachi-chat-unread',{detail:{count:state.unreadCount}}));}
  }
  function nearBottom(){return log.scrollHeight-log.clientHeight-log.scrollTop<=24;}
  function viewport(){if(!dialog?.open)return;const view=root.visualViewport;dialog.style.setProperty('--chat-viewport-height',Math.max(1,view?.height||root.innerHeight||700)+'px');dialog.style.setProperty('--chat-viewport-top',Math.max(0,view?.offsetTop||0)+'px');}
  function jumpToLatest(){if(!log)return;log.scrollTop=log.scrollHeight;seenBottomId=controller.messages.at(-1)?.id||0;notice.hidden=true;controller.markRead();}
  function mount(){
    if(dialog)return;
    dialog=node('dialog','global-chat-dialog');dialog.id='global-chat-dialog';dialog.setAttribute('aria-labelledby','global-chat-title');
    const heading=node('header','global-chat-heading'),title=node('h2','','全体チャット'),close=node('button','btn btn-small','閉じる');title.id='global-chat-title';close.type='button';close.dataset.chatAction='close';close.setAttribute('aria-label','全体チャットを閉じる');close.addEventListener('click',()=>controller.close());heading.append(title,close);
    status=node('p','global-chat-status');status.id='global-chat-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    log=node('div','global-chat-log');log.id='global-chat-log';log.tabIndex=0;log.setAttribute('role','log');log.setAttribute('aria-label','全プレイヤーのメッセージ・最新100件');log.setAttribute('aria-live','polite');log.setAttribute('aria-relevant','additions text');
    notice=node('button','global-chat-notice','新しいメッセージへ');notice.type='button';notice.dataset.chatNew='';notice.hidden=true;notice.addEventListener('click',jumpToLatest);
    const form=node('form','global-chat-compose'),label=node('label','','メッセージ'),help=node('span','global-chat-help',touchKeyboard()?'300文字まで。送信ボタンで送れます。':'300文字まで。Enterで送信、Shift+Enterで改行。');label.htmlFor='global-chat-input';help.id='global-chat-help';
    input=node('textarea');input.id='global-chat-input';input.rows=3;input.placeholder='全体にメッセージを送る';input.setAttribute('aria-describedby','global-chat-help global-chat-counter');input.autocomplete='off';input.enterKeyHint=touchKeyboard()?'enter':'send';
    const footer=node('div','global-chat-compose-footer');counter=node('span');counter.id='global-chat-counter';sendButton=node('button','global-chat-send','送信');sendButton.type='submit';footer.append(counter,sendButton);label.append(help);form.append(label,input,footer);
    form.addEventListener('submit',event=>{event.preventDefault();if(!composing)void controller.send();});
    input.addEventListener('input',()=>controller.setDraft(input.value));input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;controller.setDraft(input.value);});
    input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!touchKeyboard()&&!event.shiftKey&&!composing&&!event.isComposing&&event.keyCode!==229){event.preventDefault();void controller.send();}});
    log.addEventListener('scroll',()=>{if(nearBottom())jumpToLatest();});
    dialog.addEventListener('cancel',event=>{event.preventDefault();controller.close();});dialog.addEventListener('close',()=>{if(dialog.open)return;composing=false;controller.close();});dialog.append(heading,status,log,notice,form);document.body.append(dialog);
    root.visualViewport?.addEventListener('resize',viewport);root.visualViewport?.addEventListener('scroll',viewport);root.addEventListener('resize',viewport);
  }
  function updateRows(state){
    const bottom=nearBottom(),anchor=[...log.children].find(row=>row.offsetTop+row.offsetHeight>log.scrollTop),anchorId=anchor?.dataset.chatId,anchorOffset=anchor?anchor.offsetTop-log.scrollTop:0,ids=new Set(state.messages.map(message=>message.id));
    for(const [id,row] of rows)if(!ids.has(id)){row.remove();rows.delete(id);}
    let next=log.firstChild;
    for(const message of state.messages){
      let row=rows.get(message.id);
      if(!row){
        row=node('article','global-chat-message');row.dataset.chatId=String(message.id);
        const meta=node('div','global-chat-meta'),author=node('span','global-chat-author'),time=node('time','global-chat-time'),text=node('p','global-chat-text'),remove=node('button','global-chat-delete','削除');remove.type='button';remove.dataset.chatAction='delete';remove.addEventListener('click',()=>{void controller.remove(message.id);});meta.append(author,time,remove);row.append(meta,text);row.parts={author,time,text,remove};rows.set(message.id,row);
      }
      const {author,time,text,remove}=row.parts,deleted=message.deletedAt!==null;
      row.classList.toggle('is-mine',message.authorId===state.owner);row.classList.toggle('is-deleted',deleted);
      if(author.textContent!==message.name)author.textContent=message.name;
      const stamp=new Date(message.createdAt);time.dateTime=stamp.toISOString();time.textContent=stamp.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});time.title=stamp.toLocaleString('ja-JP');
      const contents=deleted?'削除されたメッセージです':message.text;if(text.textContent!==contents)text.textContent=contents;
      remove.hidden=!message.canDelete;remove.disabled=state.deleting.includes(message.id);remove.setAttribute('aria-label',message.name+'のメッセージを削除');
      if(row!==next)log.insertBefore(row,next);next=row.nextSibling;
    }
    if(bottom)jumpToLatest();else{const prior=anchorId&&rows.get(Number(anchorId));if(prior)log.scrollTop=Math.max(0,prior.offsetTop-anchorOffset);notice.hidden=!(state.messages.at(-1)?.id>seenBottomId);}
  }
  function render(state,reason){
    emitState(state);if(!dialog&&!state.isOpen)return;if(state.isOpen)mount();
    if(!state.isOpen){if(dialog?.open)dialog.close();if(reason==='identity'&&dialog){for(const row of rows.values())row.remove();rows.clear();input.value='';renderedOwner=null;}return;}
    if(!dialog.open){dialog.showModal();seenBottomId=0;log.scrollTop=log.scrollHeight;viewport();}
    if(renderedOwner!==state.owner){for(const row of rows.values())row.remove();rows.clear();renderedOwner=state.owner;seenBottomId=0;}
    if(reason==='messages'||reason==='open'||reason==='identity')updateRows(state);
    if(input.value!==state.draft&&!composing)input.value=state.draft;
    const validation=messageText(state.draft);counter.textContent=validation.count+' / 300';counter.classList.toggle('is-overlimit',validation.count>MAX_LENGTH);input.setAttribute('aria-invalid',String(!!validation.count&&!validation.ok));
    input.disabled=!state.owner||!state.available;sendButton.disabled=state.sending||!state.available||!state.owner||!validation.ok;sendButton.textContent=state.sending?'送信中…':'送信';
    for(const [id,row] of rows)row.parts.remove.disabled=state.deleting.includes(id)||!state.available;
    status.textContent=!state.available?'接続が戻ると更新します。':state.status||(!state.owner||state.loading&&!state.messages.length?'メッセージを読み込んでいます…':!state.messages.length?'まだメッセージはありません。全プレイヤーに届きます。':'どのマップにいるプレイヤーとも話せます。');
  }
  LT.Chat={open:()=>controller.open(),isDialogOpen:()=>controller.opened,closeDialog:()=>controller.close(),get unreadCount(){return controller.unreadCount;},get available(){return controller.available;}};
  document.addEventListener('visibilitychange',()=>controller.resume());document.addEventListener('pachi-game-ready',()=>controller.resume());document.addEventListener('pachi-admin-state',()=>controller.resume());
  root.addEventListener('online',()=>controller.resume());root.addEventListener('offline',()=>controller.resume());root.addEventListener('storage',event=>controller.storageChanged(event.key));
  controller.resume(1200);
})();
