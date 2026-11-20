#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context=vm.createContext({console}),html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],context);if(context.LT?.Engine)break;
}
const {Engine}=context.LT,{LocalTradeSession}=require('../local-link.js');
const copy=value=>JSON.parse(JSON.stringify(value)),id='12345678-1234-4234-8234-123456789abc';
function device(species,growth){
  const engine=new Engine();assert(engine.newGame(species).ok);const mon=engine.makeMonster(species,20);mon.battleGrowth=growth;mon.hp=engine.stats(mon).hp;
  engine.state.party=[mon];engine.markCaught(species);
  const device={engine,saved:copy(engine.serialize()),commits:0};
  device.check=receipt=>new Engine(copy(device.saved)).applyTrade(copy(receipt));
  device.commit=receipt=>{const next=new Engine(copy(device.saved)),result=next.applyTrade(copy(receipt));if(result.ok){device.saved=copy(next.serialize());device.engine.state=next.state;device.commits++;}return result;};
  return device;
}
function pair(a,b){
  const pending=[],sent=[],members=[a,b];
  const sessions=members.map((member,role)=>new LocalTradeSession({role,uuid:()=>id,getEngine:()=>member.engine,check:member.check,commit:member.commit,send:message=>{sent.push(copy(message));pending.push([role,copy(message)]);return true;}}));
  const flush=()=>{for(let count=0;pending.length;count++){assert(count<100);const [side,message]=pending.shift();sessions[1-side].receive(message);}};
  sessions[0].start('甲');sessions[1].start('乙');flush();return {sessions,flush,sent};
}

test('local exchange keeps direct growth and exact resulting stats across durable saves and reloads',()=>{
  const a=device('komori',7),b=device('shizuku',3),aStats=copy(a.engine.stats(a.engine.state.party[0])),bStats=copy(b.engine.stats(b.engine.state.party[0]));
  const link=pair(a,b),[host,guest]=link.sessions;
  assert(host.offer(a.engine.state.party[0]).ok);link.flush();assert(guest.offer(b.engine.state.party[0]).ok);link.flush();
  assert.equal(host.mine.battleGrowth,7);assert.equal(host.theirs.battleGrowth,3);
  assert(host.confirm().ok);link.flush();assert.equal(a.commits+b.commits,0);assert(guest.confirm().ok);link.flush();
  assert.equal(a.commits,1);assert.equal(b.commits,1);assert.equal(host.phase,'done');assert.equal(guest.phase,'done');
  const reloadedA=new Engine(copy(a.saved)),reloadedB=new Engine(copy(b.saved));
  assert.equal(reloadedA.state.party[0].battleGrowth,3);assert.equal(reloadedB.state.party[0].battleGrowth,7);
  assert.deepEqual(copy(reloadedA.stats(reloadedA.state.party[0])),bStats);assert.deepEqual(copy(reloadedB.stats(reloadedB.state.party[0])),aStats);
  assert.equal(host.receipt().incoming.battleGrowth,3);assert.equal(guest.receipt().incoming.battleGrowth,7);
});

test('an older local peer is refused before a grown offer is sent while zero-growth exchanges remain compatible',()=>{
  const member=device('komori',7),sent=[],session=new LocalTradeSession({role:0,uuid:()=>id,getEngine:()=>member.engine,check:member.check,commit:member.commit,send:message=>{sent.push(copy(message));return true;}});
  session.start('甲');assert.equal(sent[0].v,1);assert.equal(sent[0].supportsBattleGrowth,true);
  session.receive({t:'hello',v:1,name:'旧版'});
  const before=JSON.stringify(member.saved),count=sent.length,result=session.offer(member.engine.state.party[0]);
  assert.equal(result.ok,false);assert.match(result.message,/相手の端末.*更新/);assert.equal(sent.length,count);assert.equal(member.commits,0);assert.equal(JSON.stringify(member.saved),before);
  const old=member.engine.makeMonster('komori',20);old.battleGrowth=0;
  assert(session.offer(old).ok);assert.equal(sent.at(-1).t,'offer');assert.equal(sent.at(-1).monster.battleGrowth,undefined);
});

test('malformed growth from a local peer is rejected without changing either saved individual',()=>{
  for(const battleGrowth of [-1,.5,20,99,100,null,'1',false]){
    const a=device('komori',7),b=device('shizuku',3),before=[JSON.stringify(a.saved),JSON.stringify(b.saved)],link=pair(a,b),host=link.sessions[0];
    const wire=copy(b.engine.toTradeWire(b.engine.state.party[0]));wire.battleGrowth=battleGrowth;
    host.receive({t:'offer',revision:1,monster:wire});
    assert.equal(host.phase,'error',String(battleGrowth));assert.equal(a.commits+b.commits,0);assert.deepEqual([JSON.stringify(a.saved),JSON.stringify(b.saved)],before);
  }
});
