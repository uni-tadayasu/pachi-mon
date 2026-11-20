#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {GlobalChatController,messageText,normalizeMessage,READ_KEY,OPEN_DELAY,CLOSED_DELAY}=require('../global-chat.js');
const SOURCE=fs.readFileSync(path.join(__dirname,'../global-chat.js'),'utf8');
const SELF='P0000000000000001',PEER='P0000000000000002',OTHER='P0000000000000003',NOW=1800000000000;
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),copy=value=>JSON.parse(JSON.stringify(value));
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const message=(id,extra={})=>({id,clientId:uuid(id),authorId:PEER,name:'旅人の名前',text:'メッセージ '+id,createdAt:NOW+id,deletedAt:null,canDelete:false,...extra});
function harness({messages=[],handler,initialId=SELF}={}){
  const timers=new Map(),records=new Map(),calls=[],changes=[];let timerId=0,uuidId=1000;
  const h={messages:copy(messages),player:initialId?{id:initialId,name:'登録した名前',isAdmin:true,adminRole:'sub'}:null,playing:true,hidden:false,online:true,calls,changes,timers,records,handler,
    identify:async()=>{h.player??={id:SELF,name:'登録した名前'};return h.player;}};
  h.request=async(route,options={})=>{
    calls.push({route,...copy(options)});const override=h.handler?.(route,options,h);if(override!==undefined)return override;
    const latestId=h.messages.at(-1)?.id||0;
    if(route.includes('?summary=1')){const after=Number(route.split('after=')[1]);return {latestId,unreadCount:h.messages.filter(m=>m.id>after&&m.authorId!==h.player.id&&m.deletedAt===null).length,serverTime:NOW};}
    if(!options.method)return {messages:copy(h.messages.slice(-100)),latestId,serverTime:NOW};
    if(options.method==='POST'){
      const duplicate=h.messages.find(m=>m.authorId===h.player.id&&m.clientId===options.body.clientId);
      if(duplicate)return {message:copy(duplicate),latestId,duplicate:true,serverTime:NOW};
      const created=message(latestId+1,{clientId:options.body.clientId,authorId:h.player.id,name:h.player.name,text:options.body.text,canDelete:true});h.messages.push(created);return {message:copy(created),latestId:created.id,duplicate:false,serverTime:NOW};
    }
    if(options.method==='DELETE'){const id=Number(route.split('/').at(-1)),row=h.messages.find(m=>m.id===id);Object.assign(row,{text:null,deletedAt:NOW+1000,canDelete:false});return {message:copy(row),latestId,serverTime:NOW};}
    throw Error('Unexpected mock request '+route);
  };
  h.storage={getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,String(value))};
  h.controller=new GlobalChatController({request:h.request,getIdentity:()=>h.player,identify:()=>h.identify(),enabled:mode=>mode==='playing'?h.playing:h.playing&&!h.hidden&&h.online,storage:h.storage,uuid:()=>uuid(++uuidId),
    setTimer(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimer:id=>timers.delete(id),changed:(state,reason)=>changes.push({state,reason})});
  h.open=async()=>{assert.equal(h.controller.open(),true);await settle();};
  h.tick=async()=>{const [id,timer]=[...timers][0]||[];assert(timer,'No scheduled poll');timers.delete(id);timer.fn();await settle();return timer.delay;};
  return h;
}

test('text rules match Unicode length, visible content, controls, CRLF and multiline semantics',()=>{
  assert.equal(messageText('  あ\r\n😀  ').text,'あ\n😀');assert.equal(messageText('😀'.repeat(300)).count,300);assert(messageText('😀'.repeat(300)).ok);assert(!messageText('😀'.repeat(301)).ok);
  for(const value of ['', '  \n  ', '\u200b\u200d\u2060', '\tこんにちは', 'こんにちは\r', 'a\u202eb', 'a\u2067b', '\ud800'])assert.equal(messageText(value).ok,false,JSON.stringify(value));
  assert(messageText('家族 👨‍👩‍👧‍👦').ok);assert(messageText('<img src=x onerror=alert(1)>').ok);
});

test('closed polling counts only unread other authors and persists cursors separately by player',async()=>{
  const h=harness({messages:[message(1),message(2,{authorId:SELF}),message(3,{text:null,deletedAt:NOW}),message(4)]}),c=h.controller;
  c.resume(0);await h.tick();assert.equal(c.unreadCount,2);assert.equal([...h.timers.values()][0].delay,CLOSED_DELAY);
  await h.open();assert.equal(c.readId,0,'Fetching alone must not mark a hidden or scrolled log read');c.markRead();assert.equal(c.readId,4);assert.equal(h.records.get(READ_KEY+SELF),'4');assert.equal(c.unreadCount,0);
  c.close();h.player={id:OTHER,name:'別のプレイヤー'};c.resume(0);await h.tick();assert.equal(c.readId,0);assert.equal(c.unreadCount,3);assert.equal(h.records.get(READ_KEY+SELF),'4');
  h.player={id:SELF,name:'登録した名前'};c.resume(0);await h.tick();assert.equal(c.readId,4);assert.equal(c.unreadCount,0);
});

test('initial identity adoption loads the open dialog, while a closed identity callback cannot reopen it',async()=>{
  const identity=deferred(),h=harness({initialId:null,messages:[message(1)]}),c=h.controller;h.identify=()=>identity.promise;
  assert(c.open());assert.equal(h.calls.length,0);c.close();h.player={id:SELF,name:'名前'};identity.resolve(h.player);await settle();assert.equal(c.opened,false);assert.equal(h.calls.length,0);
  await h.open();assert.equal(c.owner,SELF);assert.equal(c.messages.length,1);assert.equal(c.opened,true);assert.equal([...h.timers.values()][0].delay,OPEN_DELAY);
});

test('rapid close/reopen cannot promote an older poll into the new view or roll a newer snapshot back',async()=>{
  const one=deferred(),h=harness({handler:()=>one.promise}),c=h.controller;
  c.open();c.close();c.open();await settle();assert.equal(h.calls.length,1,'Only the latest view may continue after the identity microtask');
  one.resolve({messages:[message(2)],latestId:2});await settle();assert.equal(c.latestId,2);
  const old=deferred(),fresh=deferred();let reads=0;h.handler=()=>++reads===1?old.promise:fresh.promise;
  c.close();c.open();await settle();c.close();c.open();await settle();assert.equal(reads,2);
  fresh.resolve({messages:[message(3)],latestId:3});await settle();old.resolve({messages:[message(2)],latestId:2});await settle();
  assert.equal(c.latestId,3);assert.equal(c.messages[0].id,3);assert.equal(c.opened,true);
});

test('failed sends retain the draft and retry UUID; changing the text creates a new request',async()=>{
  let failures=1;const h=harness({handler:(route,options)=>options.method==='POST'&&failures-->0?Promise.reject(Error('接続が切れました')):undefined}),c=h.controller;await h.open();
  c.setDraft('  こんにちは\r\nみなさん  ');assert.equal(await c.send(),false);const first=h.calls.find(call=>call.method==='POST');assert.equal(c.draft,'  こんにちは\r\nみなさん  ');assert.match(c.status,/接続/);
  await c.poll();assert.match(c.status,/接続/,'A successful background refresh must not erase the actionable send failure');
  assert.equal(await c.send(),true);const posts=h.calls.filter(call=>call.method==='POST');assert.equal(posts[1].body.clientId,first.body.clientId);assert.equal(posts[1].body.text,'こんにちは\nみなさん');assert.equal(c.draft,'');
  failures=1;c.setDraft('次の文章');assert.equal(await c.send(),false);const previous=h.calls.at(-1).body.clientId;c.setDraft('編集した文章');assert.equal(await c.send(),true);assert.notEqual(h.calls.at(-1).body.clientId,previous);
});

test('delete failures remain readable across polls until the user changes the draft or retries',async()=>{
  const h=harness({messages:[message(1,{canDelete:true})],handler:(route,options)=>options.method==='DELETE'?Promise.reject(Error('削除する権限がありません')):undefined}),c=h.controller;await h.open();
  assert.equal(await c.remove(1),false);await c.poll();assert.match(c.status,/権限/);assert.equal(c.messages[0].deletedAt,null);c.setDraft('次の文章');assert.equal(c.status,'');
});

test('a successful send cannot erase text typed while its response was pending',async()=>{
  const pending=deferred(),h=harness({handler:(route,options)=>options.method==='POST'?pending.promise:undefined}),c=h.controller;await h.open();c.setDraft('先の文章');const send=c.send();
  const sent=h.calls.at(-1).body;c.setDraft('次に送る文章');pending.resolve({message:message(1,{authorId:SELF,clientId:sent.clientId,text:sent.text,canDelete:true})});assert.equal(await send,true);assert.equal(c.draft,'次に送る文章');
});

test('close/reopen ignores a pending POST and reconciles its stable UUID from the next snapshot',async()=>{
  const pending=deferred(),h=harness({handler:(route,options)=>options.method==='POST'?pending.promise:undefined}),c=h.controller;await h.open();c.setDraft('閉じても失わない文章');const operation=c.send(),sent=h.calls.at(-1).body;c.close();
  const posted=message(1,{authorId:SELF,clientId:sent.clientId,text:sent.text,canDelete:true});h.messages=[posted];pending.resolve({message:posted});await operation;
  assert.equal(c.opened,false);assert.equal(c.draft,sent.text);assert.equal(c.retry.clientId,sent.clientId);assert.equal(c.messages.length,0);
  await h.open();assert.equal(c.messages.length,1);assert.equal(c.draft,'');assert.equal(c.retry,null);assert.equal(h.calls.filter(call=>call.method==='POST').length,1);
});

test('stale poll/send replies cannot populate another identity or reopen a closed view',async()=>{
  const pending=deferred(),h=harness({handler:()=>pending.promise}),c=h.controller;assert(c.open());await settle();c.close();pending.resolve({messages:[message(1)],latestId:1});await settle();assert.equal(c.messages.length,0);assert.equal(c.opened,false);
  h.handler=null;await h.open();const sendReply=deferred();h.handler=(route,options)=>options.method==='POST'?sendReply.promise:undefined;c.setDraft('前のアカウント');const operation=c.send(),sent=h.calls.at(-1).body;
  h.player={id:OTHER,name:'交代'};sendReply.resolve({message:message(2,{authorId:SELF,clientId:sent.clientId,text:sent.text})});await operation;
  assert.equal(c.owner,OTHER);assert.equal(c.opened,false);assert.equal(c.draft,'');assert.equal(c.messages.length,0);assert.equal(c.retry,null);
});

test('only a complete snapshot advances read position, never a POST latestId covering unseen messages',async()=>{
  const h=harness({messages:[message(1)]}),c=h.controller;await h.open();c.markRead();assert.equal(c.readId,1);
  h.handler=(route,options)=>options.method==='POST'?{message:message(3,{authorId:SELF,clientId:options.body.clientId,text:options.body.text,canDelete:true}),latestId:5}:undefined;
  c.setDraft('自分の送信');assert(await c.send());c.markRead();assert.equal(c.readId,1,'Concurrent messages 2, 4 and 5 have not been fetched');
  h.messages=[message(1),message(2),c.messages.at(-1),message(4),message(5)];await c.poll();assert.equal(c.unreadCount,3);c.markRead();assert.equal(c.readId,5);assert.equal(c.unreadCount,0);
});

test('tombstones replace visible text and a pre-deletion poll cannot resurrect it',async()=>{
  const h=harness({messages:[message(1,{canDelete:true})]}),c=h.controller;await h.open();const stale=deferred();h.handler=(route,options)=>!options.method?stale.promise:undefined;const poll=c.poll();await settle();assert(await c.remove(1));
  stale.resolve({messages:[message(1,{canDelete:true})],latestId:1});await poll;assert.equal(c.messages[0].text,null);assert.equal(c.messages[0].canDelete,false);assert.equal(c.unreadCount,0);
  h.handler=null;await c.poll();assert.equal(c.messages[0].deletedAt,NOW+1000);assert.equal(await c.remove(1),false);
});

test('hidden/offline/title states stop requests and resuming uses the correct polling interval',async()=>{
  const h=harness(),c=h.controller;await h.open();const before=h.calls.length;h.hidden=true;c.resume();assert.equal(h.timers.size,0);await c.poll();assert.equal(h.calls.length,before);assert(c.opened);
  h.hidden=false;c.resume();await h.tick();assert.equal([...h.timers.values()][0].delay,OPEN_DELAY);
  h.online=false;c.resume();assert.equal(h.timers.size,0);h.online=true;c.close();c.resume();await h.tick();assert.equal([...h.timers.values()][0].delay,CLOSED_DELAY);
  h.playing=false;c.resume();assert.equal(h.timers.size,0);assert.equal(c.opened,false);
});

test('snapshot validation rejects malformed order and strips operator metadata without rewriting player names',async()=>{
  const raw=message(1,{name:'<b>本当の登録名</b>',adminRole:'sub',isAdmin:true}),clean=normalizeMessage(raw);assert.equal(clean.name,raw.name);assert(!Object.hasOwn(clean,'adminRole'));assert(!Object.hasOwn(clean,'isAdmin'));
  for(const version of ['1','2','3','4','5'])for(const variant of ['8','9','a','b'])assert.doesNotThrow(()=>normalizeMessage(message(1,{clientId:`00000000-0000-${version}000-${variant}000-000000000001`})));
  assert.throws(()=>normalizeMessage(message(1,{clientId:'00000000-0000-0000-0000-000000000001'})),/表示内容/,'The server and every reader must enforce the same UUID boundary');
  const h=harness({handler:()=>({messages:[message(2),message(1)],latestId:1})});await h.open();assert.equal(h.controller.messages.length,0);assert.match(h.controller.status,/更新順/);assert.equal(h.controller.readId,0);
});

// A deliberately small DOM implements only standard APIs used by the actual
// client. No browser or production chat requests are used by this suite.
function uiHarness({coarse=false,messages=[],queuedClose=false}={}){
  const h=harness({messages}),events={},windowEvents={},nodes=new Map(),timers=new Map(),closeEvents=[];let timerId=0;
  class Element{
    constructor(tag){this.tagName=tag;this.children=[];this.parentNode=null;this.dataset={};this.listeners={};this.attributes={};this.value='';this._text='';this.open=false;this.hidden=false;this.disabled=false;this.scrollTop=0;this.clientHeight=180;this.style={setProperty:(key,value)=>{this.style[key]=value;}};const classes=new Set();this.classList={toggle(name,on){on?classes.add(name):classes.delete(name);},contains:name=>classes.has(name)};}
    set id(value){this._id=value;nodes.set(value,this);}get id(){return this._id;}
    set textContent(value){this._text=String(value);}get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    set innerHTML(_){throw Error('Chat must never render authored content with innerHTML');}
    get firstChild(){return this.children[0]||null;}get nextSibling(){if(!this.parentNode)return null;return this.parentNode.children[this.parentNode.children.indexOf(this)+1]||null;}
    get offsetHeight(){return this.tagName==='article'?60:20;}get offsetTop(){return this.parentNode?this.parentNode.children.indexOf(this)*60:0;}get scrollHeight(){return this.children.length*60;}
    append(...children){for(const child of children)this.insertBefore(child,null);}
    insertBefore(child,next){child.remove();const index=next?this.children.indexOf(next):this.children.length;assert(index>=0);this.children.splice(index,0,child);child.parentNode=this;}
    remove(){if(this.parentNode){const siblings=this.parentNode.children;siblings.splice(siblings.indexOf(this),1);this.parentNode=null;}}
    setAttribute(name,value){this.attributes[name]=String(value);}addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
    emit(type,values={}){const event={target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...values};for(const fn of this.listeners[type]||[])fn(event);return event;}
    showModal(){this.open=true;}close(){if(this.open){this.open=false;if(queuedClose)closeEvents.push(()=>this.emit('close'));else this.emit('close');}}
  }
  const doc={hidden:false,body:new Element('body'),createElement:tag=>new Element(tag),addEventListener(type,fn){(events[type]||=[]).push(fn);},dispatchEvent(event){for(const fn of events[event.type]||[])fn(event);}};
  const sandbox={document:doc,navigator:{onLine:true},innerHeight:700,console,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},crypto:{randomUUID:()=>uuid(9000)},localStorage:h.storage,
    matchMedia:()=>({matches:coarse}),addEventListener(type,fn){(windowEvents[type]||=[]).push(fn);},
    setTimeout(fn,delay){assert.equal(this.document,doc,'setTimeout lost its browser receiver');const id=++timerId;timers.set(id,{fn,delay});return id;},
    clearTimeout(id){assert.equal(this.document,doc,'clearTimeout lost its browser receiver');timers.delete(id);},
    LT:{Admin:{get player(){return h.player;},tradeIdentity:()=>h.identify(),worldRequest:h.request},adminBridge:{isPlaying:()=>h.playing,toast(){}}}};
  vm.runInContext(SOURCE,vm.createContext(sandbox),{filename:'global-chat.js'});
  return {...h,doc,nodes,timers,events,windowEvents,LT:sandbox.LT,get:id=>nodes.get(id),flushClose:()=>{for(const event of closeEvents.splice(0))event();},open:async()=>{assert(sandbox.LT.Chat.open());await settle();}};
}

test('a queued native close event cannot close a newly reopened chat dialog',async()=>{
  const h=uiHarness({queuedClose:true});await h.open();const dialog=h.get('global-chat-dialog');
  assert(h.LT.Chat.closeDialog());assert(h.LT.Chat.open());h.flushClose();await settle();assert.equal(dialog.open,true);assert.equal(h.LT.Chat.isDialogOpen(),true);
  dialog.close();h.flushClose();assert.equal(h.LT.Chat.isDialogOpen(),false);
});

test('native UI uses safe player-name text, role-free rows, receiver-safe timers and readable scroll anchors',async()=>{
  const h=uiHarness({messages:Array.from({length:8},(_,i)=>message(i+1,{name:i===0?'<img src=x>':'登録名 '+i,text:i===0?'<script>bad()</script>':'会話 '+i}))});await h.open();
  const log=h.get('global-chat-log'),first=log.children[0];assert.equal(first.parts.author.textContent,'<img src=x>');assert.equal(first.parts.text.textContent,'<script>bad()</script>');assert(!first.textContent.includes('運営'));assert.equal(h.LT.Chat.unreadCount,0);
  log.scrollTop=60;const anchor=log.children[1],before=anchor.offsetTop-log.scrollTop;h.messages.push(message(9));const scheduled=[...h.timers.values()].find(timer=>timer.delay===OPEN_DELAY);assert(scheduled);scheduled.fn();await settle();
  assert.equal(anchor.offsetTop-log.scrollTop,before,'Polling moved a reader away from the same message');assert.equal(log.scrollTop,60);assert.equal(h.LT.Chat.unreadCount,1);
  const notice=log.parentNode.children.find(child=>Object.hasOwn(child.dataset,'chatNew'));assert.equal(notice.hidden,false);notice.emit('click');assert.equal(h.LT.Chat.unreadCount,0);assert.equal(notice.hidden,true);
});

test('IME confirmation and Shift+Enter never submit, desktop Enter sends, and touch Enter remains a newline',async()=>{
  const h=uiHarness();await h.open();const input=h.get('global-chat-input');input.value='日本語入力';input.emit('input');
  input.emit('compositionstart');input.emit('keydown',{key:'Enter',isComposing:true});input.emit('compositionend');input.emit('keydown',{key:'Enter',keyCode:229});input.emit('keydown',{key:'Enter',shiftKey:true});await settle();assert.equal(h.calls.filter(call=>call.method==='POST').length,0);
  assert.equal(input.emit('keydown',{key:'Enter',keyCode:13}).defaultPrevented,true);await settle();assert.equal(h.calls.filter(call=>call.method==='POST').length,1);assert.equal(input.value,'');
  const touch=uiHarness({coarse:true});await touch.open();const area=touch.get('global-chat-input');area.value='改行できる';area.emit('input');assert.equal(area.emit('keydown',{key:'Enter',keyCode:13}).defaultPrevented,false);await settle();assert.equal(touch.calls.filter(call=>call.method==='POST').length,0);
  area.parentNode.emit('submit');await settle();assert.equal(touch.calls.filter(call=>call.method==='POST').length,1);
});
