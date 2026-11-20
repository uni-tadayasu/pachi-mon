#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {TradeController,eligible,snapshot,key}=require('../trade-client.js');
const clone=v=>JSON.parse(JSON.stringify(v));
const DATA={species:{komori:{name:'コモリ'},shizuku:{name:'シズク'},arvelion:{name:'アルヴェリオン'},futo:{specialOnly:true},floravelle:{adminOnly:true,specialOnly:true}}};
const PLAYER={id:'P1234567890abcdef',name:'旅人'},OTHER={id:'Pabcdef1234567890',name:'相手'};
const ID='12345678-1234-4123-8123-123456789012';
const mon=(uid='owned',species='komori')=>({uid,species,level:10,xp:4,hp:40,pp:{sprout:10},nickname:'こも',shiny:false});
const room=()=>({id:ID,code:'ABC234',state:'open',revision:2,expiresAt:Date.now()+900000,you:'host',host:{...PLAYER,monster:mon(),confirmed:false},guest:{...OTHER,monster:mon('other','shizuku'),confirmed:false},receipt:null});
const pending=()=>({version:1,ownerId:PLAYER.id,roomId:ID,code:'ABC234',action:null});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
const error=(status,code='ERROR')=>Object.assign(Error(code),{status,code});
function make({stored,handle,commit,check,owner=PLAYER,storageFailure=false}={}){
 const memory=new Map(stored===undefined?[]:[[key,typeof stored==='string'?stored:JSON.stringify(stored)]]),calls=[],commits=[],changes=[];
 const engine={state:{started:true,party:[mon()],storage:[],tradeReceipts:[]}};
 const storage={getItem:k=>memory.get(k)||null,setItem(k,v){if(storageFailure)throw Error('disk full');memory.set(k,v)},removeItem:k=>memory.delete(k)};
 const c=new TradeController({storage,data:DATA,uuid:()=>ID,getEngine:()=>engine,identify:async()=>owner,check,
  request:async(path,options={})=>{calls.push({path,...clone(options)});if(handle)return handle(path,options,c);return{trade:null};},
  commit:async receipt=>{commits.push(clone(receipt));return commit?commit(receipt):{ok:true};},changed:()=>changes.push(c.isLocked())});
 return{c,memory,calls,commits,changes,engine};
}
function committed(){const t=room();t.state='committed';t.receipt={id:'trade:'+ID,revision:t.revision,outgoingUid:'owned',outgoing:mon(),incoming:{...mon('other','shizuku'),uid:'tr-'+ID+'-h'}};return t;}
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(resolve=>setImmediate(resolve));}assert.fail('Expected async boundary');}

test('double-click create issues one request and writes lock before transmission',async()=>{
 const wait=deferred();let h;
 h=make({handle:(path)=>{if(path==='/trades/active')return{trade:null};if(path==='/trades'){assert(h.c.isLocked());assert(h.memory.has(key));return wait.promise;}throw Error(path);}});
 const first=h.c.create();await until(()=>h.calls.some(x=>x.path==='/trades'));
 assert((await h.c.create()).busy);assert.equal(h.calls.filter(x=>x.path==='/trades').length,1);
 wait.resolve({trade:room()});assert((await first).ok);assert(h.c.isLocked());assert.equal(h.c.trade.id,ID);
});

test('uncertain create survives reload and replays exact requestId',async()=>{
 const h=make({handle:path=>path==='/trades/active'?{trade:null}:Promise.reject(Error('network disconnected'))});
 assert(!(await h.c.create()).ok);const p=JSON.parse(h.memory.get(key));assert.equal(p.requestId,ID);assert(h.c.isLocked());
 const resumed=make({stored:p,handle:()=>({trade:room()})});assert((await resumed.c.resume()).ok);
 assert.equal(resumed.calls[0].path,'/trades');assert.equal(resumed.calls[0].body.requestId,p.requestId);
});

test('malformed and rejected join codes do not leave a permanent lock',async()=>{
 const h=make({handle:path=>path==='/trades/join'?Promise.reject(error(404,'TRADE_NOT_FOUND')):{trade:null}});
 assert(!(await h.c.join('bad')).ok);assert.equal(h.calls.length,0);assert(!h.c.isLocked());
 assert(!(await h.c.join('ＡＢＣ２３４')).ok);assert.equal(h.calls.find(x=>x.path==='/trades/join').body.code,'ABC234');assert(!h.c.isLocked());assert(!h.memory.has(key));
});

test('storage failure prevents room mutation request',async()=>{
 const h=make({storageFailure:true});assert(!(await h.c.create()).ok);
 assert.equal(h.calls.filter(x=>x.path==='/trades').length,0);assert(!h.c.isLocked());
});

test('catalog excludes held items, operator and granted creatures but permits wild legendary',()=>{
 for(const value of [mon('a','futo'),mon('a','floravelle'),{...mon(),heldItem:'leafcrown'},{...mon(),grantId:'gift'}, {...mon(),customStats:{}},{...mon(),customMoves:['x']},{...mon(),customStatsLevel:5}])assert(!eligible(value,DATA));
 assert(eligible(mon('a','arvelion'),DATA));assert(eligible(mon(),DATA));
});

test('offer rejects forbidden or missing local creatures without request',async()=>{
 const h=make({stored:pending()});h.c.trade=room();h.engine.state.party=[mon('owned','futo')];
 assert(!(await h.c.offer('owned')).ok);assert(!(await h.c.offer('missing')).ok);assert.equal(h.calls.length,0);
});

test('a held item is rejected before offering or confirming even if the wire snapshot omits it',async()=>{
 const h=make({stored:pending()});h.c.trade=room();h.engine.state.party[0].heldItem='leafcrown';
 const before=JSON.stringify(h.engine.state);
 assert(!(await h.c.offer('owned')).ok);assert.match(h.c.error,/持ち物.*外して/);
 assert(!(await h.c.confirm()).ok);assert.match(h.c.error,/持ち物.*外して/);
 assert.equal(h.calls.length,0);assert.equal(h.commits.length,0);assert.equal(JSON.stringify(h.engine.state),before);
});

test('owned offers and confirmations use the Engine trade validator before sending',async()=>{
 const h=make({stored:pending()});h.c.trade=room();let validations=0;
 h.engine.toTradeWire=value=>{assert.equal(value,h.engine.state.party[0]);validations++;throw Error('Engine rejected the individual');};
 assert(!(await h.c.offer('owned')).ok);assert(!(await h.c.confirm()).ok);
 assert.equal(validations,2);assert.equal(h.calls.length,0);assert.equal(h.commits.length,0);
});

test('offer uses immutable local snapshot and expected room revision',async()=>{
 const h=make({stored:pending(),handle:()=>({trade:room()})});h.c.trade=room();
 assert((await h.c.offer('owned')).ok);const call=h.calls[0];assert.equal(call.body.revision,2);assert.deepEqual(call.body.monster,snapshot(mon()));
 h.engine.state.party[0].hp=3;assert.equal(call.body.monster.hp,40);
});

test('growth snapshots retain the earned count and reject malformed or out-of-level values',()=>{
 assert.equal(snapshot({...mon(),battleGrowth:7}).battleGrowth,7);
 assert.deepEqual(snapshot({...mon(),battleGrowth:0}),snapshot(mon()),'Zero and missing use the same legacy wire view');
 for(const battleGrowth of [-1,.5,10,99,100,null,'1',false]){
  assert.throws(()=>snapshot({...mon(),battleGrowth}),/育った能力/);
  assert.equal(eligible({...mon(),battleGrowth},DATA),false);
 }
});

test('growth changes or a legacy echo that omits growth stop confirmation before consent',async()=>{
 const h=make({stored:pending()});h.c.trade=room();h.engine.state.party[0].battleGrowth=4;
 assert(!(await h.c.confirm()).ok);assert.match(h.c.error,/状態が変わ/);assert.equal(h.calls.length,0);
 h.c.trade.host.monster.battleGrowth=3;assert(!(await h.c.confirm()).ok);assert.equal(h.calls.length,0);
});

test('a grown offer advertises support at confirmation and survives the durable receipt boundary',async()=>{
 const r=room();r.host.monster.battleGrowth=4;r.guest.monster.battleGrowth=2;
 let checked;
 const h=make({stored:pending(),handle:()=>({trade:r}),check:receipt=>{checked=clone(receipt);return {ok:true};}});
 h.c.trade=r;h.engine.state.party[0].battleGrowth=4;
 assert((await h.c.confirm()).ok);assert.equal(h.calls[0].body.supportsBattleGrowth,true);
 assert.equal(checked.outgoing.battleGrowth,4);assert.equal(checked.incoming.battleGrowth,2);
 const old=make({stored:pending(),handle:()=>({trade:room()})});old.c.trade=room();assert((await old.c.confirm()).ok);assert.equal(old.calls[0].body.supportsBattleGrowth,undefined);
});

test('confirmation requires current unchanged offer and living-party safety',async()=>{
 const h=make({stored:pending()});h.c.trade=room();h.engine.state.party[0].hp--;
 assert(!(await h.c.confirm()).ok);assert.equal(h.calls.length,0);
 h.engine.state.party[0]=mon();h.c.trade.guest.monster.hp=0;
 assert(!(await h.c.confirm()).ok);assert.equal(h.calls.length,0);
 h.c.trade.guest.monster=mon('other','floravelle');assert(!(await h.c.confirm()).ok);assert.equal(h.calls.length,0);
 h.c.trade=room();h.engine.state.tradeReceipts=Array(4096).fill('old');assert(!(await h.c.confirm()).ok);assert.equal(h.calls.length,0);
});

test('confirmation checks the durable receipt without committing or sending rejected consent',async()=>{
 for(const side of ['host','guest']){
  let allowed=false;const previews=[];
  const h=make({stored:side==='host'?pending():{...pending(),ownerId:OTHER.id},owner:side==='host'?PLAYER:OTHER,
   handle:()=>({trade:{...room(),you:side}}),check:receipt=>{previews.push(clone(receipt));return allowed?{ok:true}:{ok:false,message:'保存済みの個体に持ち物があります。'};}});
  h.c.trade={...room(),you:side};if(side==='guest')h.engine.state.party=[mon('other','shizuku')];
  const before=JSON.stringify(h.engine.state);
  assert(!(await h.c.confirm()).ok);assert.match(h.c.error,/持ち物/);assert.equal(h.calls.length,0);assert.equal(h.commits.length,0);
  const p=previews[0];assert.equal(p.id,'trade:'+ID);assert.equal(p.revision,2);
  assert.equal(p.outgoingUid,side==='host'?'owned':'other');assert.deepEqual(p.outgoing,h.c.own().monster);
  assert.deepEqual(p.incoming,{...h.c.other().monster,uid:'tr-'+ID+(side==='host'?'-h':'-g')});
  assert.equal(JSON.stringify(h.engine.state),before);
  allowed=true;assert((await h.c.confirm()).ok);assert.equal(previews.length,2);
  assert.equal(h.calls.filter(call=>call.path.endsWith('/confirm')).length,1);assert.equal(h.commits.length,0);
 }
});

test('new confirmation checks cannot block already committed receipt recovery',async()=>{
 let checks=0;const h=make({stored:pending(),handle:()=>({trade:committed()}),check:()=>{checks++;throw Error('The outgoing individual is no longer present');}});
 h.engine.state.party=[];
 assert((await h.c.resume()).ok);assert.equal(checks,0);assert.equal(h.commits.length,1);
 assert.equal(h.calls.filter(call=>call.path.endsWith('/ack')).length,1);assert(!h.c.isLocked());
});

test('stale revision is never silently re-confirmed or locally applied',async()=>{
 const changed=room();changed.revision=3;changed.guest.monster.species='arvelion';
 const h=make({stored:pending(),handle:path=>path.endsWith('/confirm')?Promise.reject(error(409,'TRADE_CHANGED')):{trade:changed}});h.c.trade=room();
 assert(!(await h.c.confirm()).ok);assert.equal(h.calls[0].body.revision,2);assert.equal(h.commits.length,0);assert(h.c.isLocked());
 assert((await h.c.resume()).ok);assert.equal(h.c.trade.revision,3);assert.equal(h.calls.filter(x=>x.path.endsWith('/confirm')).length,1);
});

test('committed receipt retries local save before ack and does not duplicate inventory',async()=>{
 let writable=false,applied=0;const receipts=new Set(),t=committed();
 const h=make({stored:pending(),handle:()=>({trade:t}),commit:r=>{if(!writable)return{ok:false,message:'保存容量不足'};if(!receipts.has(r.id)){receipts.add(r.id);applied++;}return{ok:true};}});
 assert(!(await h.c.resume()).ok);assert(h.c.isLocked());assert.equal(h.calls.filter(x=>x.path.endsWith('/ack')).length,0);
 writable=true;assert((await h.c.resume()).ok);assert(!h.c.isLocked());assert(h.c.completed);assert.equal(applied,1);assert(!h.memory.has(key));
});

test('lost ack response preserves receipt and retries safely after reload',async()=>{
 let ackFails=true,applied=0;const seen=new Set(),t=committed();
 const commit=r=>{if(!seen.has(r.id)){seen.add(r.id);applied++;}return{ok:true,alreadyReceived:applied===1};};
 const handle=path=>path.endsWith('/ack')&&ackFails?Promise.reject(Error('response lost')):{trade:t};
 const h=make({stored:pending(),handle,commit});assert(!(await h.c.resume()).ok);assert(h.c.isLocked());assert.equal(applied,1);
 ackFails=false;const next=make({stored:JSON.parse(h.memory.get(key)),handle,commit});assert((await next.c.resume()).ok);assert.equal(applied,1);assert(!next.c.isLocked());
});

test('cancel racing a commit applies the committed receipt instead of undoing it',async()=>{
 const h=make({stored:pending(),handle:()=>({trade:committed()})});h.c.trade=room();
 assert((await h.c.cancel()).ok);assert.equal(h.commits.length,1);assert.equal(h.calls.filter(x=>x.path.endsWith('/cancel')).length,0);assert(!h.c.isLocked());
});

test('cancel only releases after server terminal result; network failure stays locked',async()=>{
 let failed=true;const h=make({stored:pending(),handle:path=>path.endsWith('/cancel')?(failed?Promise.reject(Error('network')):{trade:{...room(),state:'cancelled'}}):{trade:room()}});
 h.c.trade=room();assert(!(await h.c.cancel()).ok);assert(h.c.isLocked());failed=false;
 assert((await h.c.cancel()).ok);assert(!h.c.isLocked());assert.equal(h.c.trade.state,'cancelled');assert.equal(h.commits.length,0);
});

test('identity change and participant mismatch cannot apply another player trade',async()=>{
 const h=make({stored:pending(),owner:OTHER});assert(!(await h.c.resume()).ok);assert.equal(h.calls.length,0);assert(h.c.isLocked());
 const t=room();t.you='guest';const p=make({handle:()=>({trade:t})});assert(!(await p.c.resume()).ok);assert.equal(p.commits.length,0);
});

test('server active receipt is recovered even without local pending metadata',async()=>{
 const h=make({handle:()=>({trade:committed()})});assert((await h.c.resume()).ok);assert.equal(h.commits.length,1);assert(h.c.completed);assert(!h.c.isLocked());
});

test('corrupt pending metadata is released only after authoritative no-active response',async()=>{
 const h=make({stored:'{broken',handle:()=>Promise.reject(Error('offline'))});assert(h.c.isLocked());assert(!(await h.c.create()).ok);assert(h.c.isLocked());assert.equal(h.commits.length,0);
 const restored=make({stored:'{broken'});assert((await restored.c.resume()).ok);assert(!restored.c.isLocked());assert.equal(restored.commits.length,0);assert(!restored.memory.has(key));
});

test('cross-tab storage locks immediately and recovers the latest pending room',async()=>{
 const next={...pending(),roomId:'22222222-2222-4222-8222-222222222222'};
 const h=make({handle:()=>({trade:{...room(),id:next.roomId}})});assert(!h.c.hasStoredPending());
 h.memory.set(key,JSON.stringify(next));assert(h.c.hasStoredPending());assert(!h.c.isLocked());
 assert((await h.c.resume()).ok);assert.equal(h.calls[0].path,'/trades/'+next.roomId);assert.equal(h.c.pending.roomId,next.roomId);
});

test('receipt acknowledgement cannot clear a newer exchange created in another tab',async()=>{
 const next={...pending(),roomId:'22222222-2222-4222-8222-222222222222'};
 const h=make({stored:pending(),handle:path=>{if(path.endsWith('/ack'))h.memory.set(key,JSON.stringify(next));return {trade:committed()};}});
 assert((await h.c.resume()).ok);assert(h.c.isLocked());assert.equal(h.c.pending.roomId,next.roomId);assert.equal(JSON.parse(h.memory.get(key)).roomId,next.roomId);
});

test('confirmation requires the exact revision actually displayed to the player',async()=>{
 const h=make({stored:pending()});h.c.trade=room();h.c.trade.revision=3;
 assert(!(await h.c.confirm(2)).ok);assert.equal(h.calls.length,0);assert.equal(h.commits.length,0);assert.match(h.c.error,/更新/);
});
