#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),context=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],context);if(context.LT?.Engine)break;
}
const {Engine,DATA:D,TradeRules}=context.LT,copy=value=>JSON.parse(JSON.stringify(value));
const room='12345678-1234-4234-8234-123456789abc',receiptId='trade:'+room;
const game=()=>{const e=new Engine();assert(e.newGame('komori').ok);return e;};
function add(e,species='shizuku',destination='party'){
  const mon=e.makeMonster(species,30);mon.xp=21;mon.hp=Math.max(1,mon.hp-12);mon.shiny=true;mon.nickname='あお';mon.pp[D.species[species].moves[0]]=1;
  e.state[destination].push(mon);e.markCaught(species);return mon;
}
function receipt(e,outgoing=e.state.party[0]){
  const incoming=e.makeMonster('hibana',25);incoming.uid='tr-'+room+'-h';incoming.nickname='ほのお';incoming.shiny=true;incoming.xp=123;incoming.hp=15;incoming.pp[D.species.hibana.moves[0]]=0;
  return {id:receiptId,outgoingUid:outgoing.uid,outgoing:e.tradeMonster(outgoing),incoming,revision:3};
}
function rejectWithoutMutation(e,r){const before=JSON.stringify(e.state);assert(!e.applyTrade(r).ok);assert.equal(JSON.stringify(e.state),before);}

// A receipt replaces exactly one slot, preserves individual data and is durable
// before the client acknowledges it. Retrying must never duplicate a monster.
let e=game();add(e);let r=receipt(e),input=JSON.stringify(r),size=e.state.party.length;
let outcome=e.applyTrade(r);assert(outcome.ok);assert.equal(outcome.destination,'party');assert.equal(outcome.index,0);
assert.equal(e.state.party.length,size);assert.deepEqual(copy(e.state.party[0]),copy(r.incoming));assert.equal(JSON.stringify(r),input);
assert(e.state.caught.includes('hibana'));assert(e.state.seen.includes('hibana'));assert.deepEqual(copy(e.state.tradeReceipts),[receiptId]);
const once=JSON.stringify(e.state);assert(e.applyTrade(r).alreadyReceived);assert.equal(JSON.stringify(e.state),once);
e=new Engine(e.serialize());const reloaded=JSON.stringify(e.state);assert(e.applyTrade(r).alreadyReceived);assert.equal(JSON.stringify(e.state),reloaded);
e.state.party.splice(0,1);assert(e.applyTrade(r).alreadyReceived);assert.equal(e.state.party.length,1,'Acknowledgement retry cannot recreate an incoming monster after it leaves the party');

// A full party and storage are supported because the outgoing slot is reused.
e=game();while(e.state.party.length<D.limits.party)add(e);
while(e.state.storage.length<D.limits.storage)add(e,'shizuku','storage');
r=receipt(e,e.state.storage[211]);const originalParty=copy(e.state.party),originalBefore=e.state.storage[210].uid,originalAfter=e.state.storage[212].uid;
outcome=e.applyTrade(r);assert(outcome.ok);assert.equal(outcome.destination,'storage');assert.equal(outcome.index,211);
assert.equal(e.state.storage.length,D.limits.storage);assert.deepEqual(copy(e.state.party),originalParty);
assert.deepEqual(copy(e.state.storage[211]),copy(r.incoming));assert.equal(e.state.storage[210].uid,originalBefore);assert.equal(e.state.storage[212].uid,originalAfter);
assert.doesNotThrow(()=>new Engine(e.serialize()));

// Moving the offered individual to another slot is safe; changing its data is not.
e=game();add(e);r=receipt(e);assert(e.moveParty(0,1).ok);assert(e.applyTrade(r).ok);assert.equal(e.state.party[1].uid,r.incoming.uid);
for(const change of [mon=>mon.hp--,mon=>mon.xp++,mon=>mon.shiny=true,mon=>mon.nickname='へんこう',mon=>mon.pp[D.species.komori.moves[0]]--,mon=>mon.level++]){
  e=game();r=receipt(e);change(e.state.party[0]);rejectWithoutMutation(e,r);
}
e=game();r=receipt(e);add(e);e.state.party.shift();rejectWithoutMutation(e,r);
e=game();r=receipt(e);const duplicate=copy(r.incoming);e.state.storage.push(duplicate);e.markCaught(duplicate.species);rejectWithoutMutation(e,r);

// Incoming and outgoing special gifts, unknown fields and invalid stats cannot
// cross the exchange boundary, including the operator's gifted legendary.
for(const invalid of [
  value=>{value.incoming.species='futo';},value=>{value.incoming.species='floravelle';},
  value=>{value.incoming.grantId='admin-legendary:owner';},value=>{value.incoming.customStats={hp:10};},
  value=>{value.incoming.customMoves=[];},value=>{value.incoming.customStatsLevel=1;},value=>{value.incoming.futoConfigLevel=1;},
  value=>{value.incoming.level=0;},value=>{value.incoming.level=101;},value=>{value.incoming.xp=999999;},
  value=>{value.incoming.hp=-1;},value=>{value.incoming.hp=999999;},value=>{value.incoming.shiny=1;},
  value=>{value.incoming.nickname='123456';},value=>{value.incoming.nickname='bad\u0000';},
  value=>{value.incoming.pp={};},value=>{value.incoming.pp.extra=1;},value=>{value.incoming.pp[D.species.hibana.moves[0]]=-1;},
  value=>{value.incoming.uid='lt-unrelated';},value=>{value.outgoingUid='missing';},
  value=>{value.outgoing.grantId='gift';},value=>{value.outgoing.pp.extra=1;},
  value=>{value.id='invalid';},value=>{value.revision=0;},value=>{value.revision=1.5;},value=>{value.revision='3';}
]){e=game();r=receipt(e);invalid(r);rejectWithoutMutation(e,r);}
for(const invalid of [null,[],{},true]){e=game();rejectWithoutMutation(e,invalid);}
e=game();const legend=e.makeMonster('arvelion',70);assert(TradeRules.isEligible(legend));legend.grantId='admin-legendary:owner';assert(!TradeRules.isEligible(legend));
assert(!TradeRules.isEligible(e.makeMonster('futo',50)));assert(!TradeRules.isEligible(e.makeMonster('floravelle',70)));
for(const id of D.starters)assert(TradeRules.isEligible(e.makeMonster(id,5)));

// Core identity fields retain exact semantics; optional cosmetics and PP field
// ordering use the same canonical representation as the server.
e=game();r=receipt(e);delete r.outgoing.shiny;r.outgoing.nickname='';r.outgoing.pp=Object.fromEntries(Object.entries(r.outgoing.pp).reverse());
assert(e.applyTrade(r).ok);
e=game();r=receipt(e);r.incoming.nickname=' ほのお ';delete r.incoming.shiny;assert(e.applyTrade(r).ok);
assert.equal(e.state.party[0].nickname,'ほのお');assert.equal(e.state.party[0].shiny,false);

// A fainted incoming individual may enter storage or a party with another
// healthy member, but never make a saved party unusable.
e=game();r=receipt(e);r.incoming.hp=0;rejectWithoutMutation(e,r);add(e);assert(e.applyTrade(r).ok);assert.equal(e.state.party[0].hp,0);
e=game();const stored=add(e,'shizuku','storage');r=receipt(e,stored);r.incoming.hp=0;assert(e.applyTrade(r).ok);assert.equal(e.state.storage[0].hp,0);
e=game();r=receipt(e);assert(e.startBattle('komori',1));assert(e.applyTrade(r).pending);assert.equal(e.state.tradeReceipts.length,0);
assert(new Engine().applyTrade(r).pending);

// Version 3 and older saves migrate without disturbing other identity/history.
e=game();add(e);let legacy=e.serialize();delete legacy.tradeReceipts;const before=JSON.stringify(legacy);
let migrated=new Engine(legacy);assert.deepEqual(copy(migrated.state.tradeReceipts),[]);assert.equal(JSON.stringify(legacy),before);
legacy.version=2;assert.deepEqual(copy(new Engine(legacy).state.tradeReceipts),[]);
for(const invalid of [null,{},['bad'],[receiptId,receiptId]]){const bad=e.serialize();bad.tradeReceipts=invalid;assert.throws(()=>new Engine(bad));}
assert.equal(TradeRules.receiptLimit,4096);
const ids=Array.from({length:TradeRules.receiptLimit},(_,i)=>'trade:aaaaaaaa-aaaa-aaaa-aaaa-'+i.toString(16).padStart(12,'0'));
e.state.tradeReceipts=ids;r=receipt(e);rejectWithoutMutation(e,r);assert.doesNotThrow(()=>new Engine(e.serialize()));
const excessive=e.serialize();excessive.tradeReceipts.push(receiptId);assert.throws(()=>new Engine(excessive));
console.log('Trade engine checks passed: exact-slot exchange, durable replay, full party/storage, offered-data guard, strict normal monsters, UID collisions, HP/PP/cosmetics, final living guard and legacy receipt migration.');
