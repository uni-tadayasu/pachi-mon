#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),model=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],model);if(model.LT?.Engine)break;
}
const {Engine,DATA:D}=model.LT,copy=value=>JSON.parse(JSON.stringify(value));
const begin=html.indexOf('  function commitTrade('),end=html.indexOf('  function showCredits()',begin);assert(begin>0&&end>begin);
const source=html.slice(begin,end),room='12345678-1234-4234-8234-123456789abc';
const barrierBegin=html.indexOf('  let checkedTradeSave='),barrierEnd=html.indexOf('  function begin(',barrierBegin);assert(barrierBegin>0&&barrierEnd>barrierBegin);
const barrierSource=html.slice(barrierBegin,barrierEnd);
function fixture(){
  const engine=new Engine();assert(engine.newGame('komori').ok);
  engine.state.party.push(engine.makeMonster('shizuku',20));engine.markCaught('shizuku');
  const incoming=engine.makeMonster('hibana',25);incoming.uid='tr-'+room+'-h';incoming.nickname='ほのお';incoming.shiny=true;incoming.hp=15;incoming.xp=12;incoming.pp[D.species.hibana.moves[0]]=1;
  const outgoing=engine.tradeMonster(engine.state.party[0]);
  return {engine,receipt:{id:'trade:'+room,revision:3,outgoingUid:outgoing.uid,outgoing,incoming}};
}
function harness({playing=true}={}){
  const {engine,receipt}=fixture(),initial=engine.serialize(),trace=[],controls={quota:false,raw:JSON.stringify(initial),reads:0,writes:0,updates:0,loads:0,pending:false,timers:[],toasts:[],reloads:0};
  const c=vm.createContext({console,Engine,engine,playing,busy:false,storedSave:copy(initial),lastSave:0,SAVE_KEY:'trade-save',BACKUP_KEY:'trade-backup',saveIssueShown:false,performance:{now:()=>123},
    LT:{Trade:{isLocked:()=>controls.pending}},pressedDirection:'down',directionSource:'ArrowDown',
    toast(message){controls.toasts.push(message);},setTimeout(callback,ms){controls.timers.push({callback,ms});},window:{location:{reload(){controls.reloads++;}}},
    updateAll(){trace.push('render');controls.updates++;},loadStored(){trace.push('load');controls.loads++;},
    localStorage:{getItem(key){assert.equal(key,'trade-save');controls.reads++;trace.push('read');return controls.raw;},setItem(key,value){
      if(key==='trade-backup')return;
      assert.equal(key,'trade-save');trace.push('write-attempt');
      if(!JSON.parse(controls.raw).tradeReceipts.includes(receipt.id)&&JSON.parse(value).tradeReceipts.includes(receipt.id)){
        assert(!c.engine.state.tradeReceipts.includes(receipt.id),'Live state must not commit before durable save');
        assert(!c.storedSave.tradeReceipts.includes(receipt.id),'Stored cache must not commit before durable save');
      }
      if(controls.quota)throw Error('Storage quota exceeded');
      new Engine(JSON.parse(value));
      controls.raw=value;controls.writes++;trace.push('written');
    }}
  });
  vm.runInContext(barrierSource+'\n'+source,c);controls.reads=0;trace.length=0;
  // The client may acknowledge only when this bridge returns ok. Track that
  // boundary rather than issuing any real network request in this unit test.
  const commit=(r=receipt)=>{const result=c.commitTrade(r);if(result.ok)trace.push('ack-allowed');return result;};
  return {c,receipt,initial,controls,trace,commit};
}
// A failed write cannot acknowledge or mutate either representation. Retrying
// starts from the same durable outgoing individual and replaces it once.
for(const playing of [true,false]){
  const h=harness({playing}),{c,receipt,controls,trace}=h;
  const live=JSON.stringify(c.engine.state),state=c.engine.state,cached=c.storedSave,raw=controls.raw;
  controls.quota=true;const failed=h.commit();assert(!failed.ok&&failed.pending);assert.equal(c.engine.state,state);assert.equal(JSON.stringify(c.engine.state),live);assert.equal(c.storedSave,cached);assert.equal(c.lastSave,0);assert.equal(controls.raw,raw);assert.equal(controls.writes,0);assert(!trace.includes('ack-allowed'));assert.equal(controls.updates+controls.loads,0);
  controls.quota=false;trace.length=0;const accepted=h.commit();assert(accepted.ok&&!accepted.alreadyReceived);assert.equal(controls.writes,1);assert.equal(c.lastSave,123);
  assert(trace.indexOf('written')<trace.indexOf('ack-allowed'));assert(trace.indexOf('written')<trace.indexOf(playing?'render':'load'));
  const saved=new Engine(JSON.parse(controls.raw));assert.deepEqual(copy(saved.state.party[0]),copy(receipt.incoming));assert.equal(saved.state.party.length,2);assert.deepEqual(copy(saved.state.tradeReceipts),[receipt.id]);
  assert.deepEqual(copy(c.storedSave),copy(saved.serialize()));
  if(playing)assert.deepEqual(copy(c.engine.state),copy(saved.state));else assert.equal(JSON.stringify(c.engine.state),live,'A title-screen recovery does not mutate an inactive engine');
  trace.length=0;const repeated=h.commit();assert(repeated.ok&&repeated.alreadyReceived);assert.equal(controls.writes,1);assert(!trace.includes('write-attempt'));assert(trace.includes('ack-allowed'));
}
// Disk is authoritative: a different tab may have saved newer unrelated fields
// while the exchange screen retained an older in-memory snapshot.
let h=harness(),disk=new Engine(JSON.parse(h.controls.raw));disk.state.coins=987;disk.state.party[1].nickname='みず';disk.state.playSeconds=456;
h.controls.raw=JSON.stringify(disk.serialize());assert(h.commit().ok);assert.equal(h.c.engine.state.coins,987);assert.equal(h.c.engine.state.playSeconds,456);assert.equal(h.c.engine.state.party[1].nickname,'みず');
// Receipt replay must also recover a stale live engine without a second write,
// even if the received individual has since been released in the durable save.
h=harness();disk=new Engine(JSON.parse(h.controls.raw));assert(disk.applyTrade(h.receipt,h.receipt.outgoing).ok);assert(disk.releaseParty(0).ok);disk.state.coins=654;h.controls.raw=JSON.stringify(disk.serialize());
assert.equal(h.c.engine.state.party[0].uid,h.receipt.outgoingUid);
let result=h.commit();assert(result.ok&&result.alreadyReceived);assert.equal(h.controls.writes,0);assert.equal(h.c.engine.state.party.length,1);assert.equal(h.c.engine.state.coins,654);assert(!h.c.engine.state.party.some(mon=>mon.uid===h.receipt.incoming.uid||mon.uid===h.receipt.outgoingUid));
assert.deepEqual(copy(h.c.engine.state),copy(disk.state));
// A delayed result cannot replace an individual whose durable data changed.
h=harness();disk=new Engine(JSON.parse(h.controls.raw));disk.state.party[0].hp--;h.controls.raw=JSON.stringify(disk.serialize());
let before=JSON.stringify(h.c.engine.state),beforeDisk=h.controls.raw;result=h.commit();assert(!result.ok);assert.equal(h.controls.writes,0);assert.equal(JSON.stringify(h.c.engine.state),before);assert.equal(h.controls.raw,beforeDisk);assert(!h.trace.includes('ack-allowed'));
for(const invalid of [null,'not-json','{}']){
  h=harness();h.controls.raw=invalid;before=JSON.stringify(h.c.engine.state);result=h.commit();assert(!result.ok&&result.pending);assert.equal(h.controls.writes,0);assert.equal(JSON.stringify(h.c.engine.state),before);assert(!h.trace.includes('ack-allowed'));
}
for(const blocked of ['busy','battle']){
  h=harness();if(blocked==='busy')h.c.busy=true;else h.c.engine.battle={};before=JSON.stringify(h.c.engine.state);result=h.commit();assert(!result.ok&&result.pending);assert.equal(h.controls.reads,0);assert.equal(h.controls.writes,0);assert.equal(JSON.stringify(h.c.engine.state),before);
}
// A completed receipt must still block an older sleeping tab after the trade
// client has removed its pending-room marker. Its stale save never reaches disk.
h=harness();disk=new Engine(JSON.parse(h.controls.raw));assert(disk.applyTrade(h.receipt).ok);h.controls.raw=JSON.stringify(disk.serialize());beforeDisk=h.controls.raw;before=JSON.stringify(h.c.engine.state);
assert.equal(h.controls.pending,false);h.c.save();assert.equal(h.controls.writes,0);assert.equal(h.controls.raw,beforeDisk);assert.equal(JSON.stringify(h.c.engine.state),before);
assert.equal(h.c.pressedDirection,null);assert.equal(h.c.directionSource,null);assert.equal(h.controls.toasts.length,1);assert.equal(h.controls.timers.length,1);assert.equal(h.controls.timers[0].ms,800);
h.c.save();assert.equal(h.controls.writes,0);assert.equal(h.controls.timers.length,1,'Reload is scheduled once');h.controls.timers[0].callback();assert.equal(h.controls.reloads,1);
// An exchange committed in this tab is remembered before the next ordinary
// save, so the cross-tab barrier does not mistake its own receipt for a remote one.
h=harness();assert(h.commit().ok);h.c.engine.state.coins=432;h.c.save();assert.equal(h.controls.writes,2);assert.equal(h.controls.timers.length,0);disk=new Engine(JSON.parse(h.controls.raw));assert.equal(disk.state.coins,432);assert.equal(disk.state.party[0].uid,h.receipt.incoming.uid);
// A paused battle in another tab cannot trap recovery behind the trade lock.
for(const active of ['pending','tradeActive']){
  h=harness();h.c.engine.battle={};if(active==='pending')h.controls.pending=true;else h.c.LT.tradeActive=true;
  beforeDisk=h.controls.raw;h.c.save();assert.equal(h.controls.raw,beforeDisk);assert.equal(h.controls.writes,0);assert.equal(h.controls.timers.length,1);assert.equal(h.controls.timers[0].ms,800);
  h.c.save();assert.equal(h.controls.timers.length,1);h.controls.timers[0].callback();assert.equal(h.controls.reloads,1);
}
// While a local exchange is open outside battle, saving waits without forcing
// a reload. Unrelated disk changes alone do not trigger the receipt barrier.
h=harness();h.controls.pending=true;h.c.save();assert.equal(h.controls.writes,0);assert.equal(h.controls.timers.length,0);
h=harness();disk=new Engine(JSON.parse(h.controls.raw));disk.state.coins=333;h.controls.raw=JSON.stringify(disk.serialize());assert.equal(vm.runInContext('tradeLocked()',h.c),false);assert.equal(h.controls.timers.length,0);
console.log('Trade bridge checks passed: durable-save-before-ack, write-failure rollback/retry, party/title recovery, latest disk data and receipt replay, sleeping-tab stale-save barrier after pending removal, same-tab receipt acknowledgement, paused-battle reload and ordinary trade locks.');
