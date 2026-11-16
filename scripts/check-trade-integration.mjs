#!/usr/bin/env node
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import worker from '../server/server.mjs';
import core from '../trade-client.js';

const context={console},html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
 if(/\bsrc=|application\/ld\+json/.test(match[1]))continue;
 runInNewContext(match[2],context);if(context.LT?.Engine)break;
}
const {Engine,DATA}=context.LT,{TradeController,key}=core,copy=v=>JSON.parse(JSON.stringify(v));
class LocalD1{
 constructor(){this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON');for(const file of ['0000_admin.sql','0001_trades.sql'])this.sqlite.exec(readFileSync(new URL('../server/drizzle/'+file,import.meta.url),'utf8'));}
 prepare(sql){const db=this;return{values:[],bind(...v){this.values=v;return this;},execute(){const results=db.sqlite.prepare(sql).all(...this.values).map(row=>({...row}));return{results,success:true,meta:{changes:db.sqlite.prepare('SELECT changes() AS n').get().n}};},async first(){return this.execute().results[0]||null;},async all(){return this.execute();},async run(){return this.execute();}};}
 async batch(statements){this.sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.execute());this.sqlite.exec('COMMIT');return result;}catch(error){this.sqlite.exec('ROLLBACK');throw error;}}
}
function service(){
 const env={DB:new LocalD1()};let address=0;
 async function request(path,{token,method='GET',body}={}){
  const headers={Origin:'https://uni-tadayasu.github.io','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.'+(++address)};if(token)headers.Authorization='Bearer '+token;
  const response=await worker.fetch(new Request('https://trades.example/api'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env),data=await response.json();
  if(!response.ok)throw Object.assign(Error(data.error?.message),{status:response.status,code:data.error?.code});return data;
 }
 async function player(name,species){
  const token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),{player}=await request('/register',{method:'POST',body:{token,name}});
  let engine=new Engine();engine.newGame(species);engine.state.party[0].nickname=name;engine.state.party[0].shiny=true;engine.state.party[0].xp=4;engine.state.party[0].pp[DATA.species[species].moves[0]]=1;
  const memory=new Map([['save',JSON.stringify(engine.serialize())]]),storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
  const faults={save:false,ack:false};let writes=0;
  function controller(){return new TradeController({storage,data:DATA,identify:async()=>player,getEngine:()=>engine,
   request:async(path,options)=>{const result=await request(path,{...options,token});if(path.endsWith('/ack')&&faults.ack)throw Error('Acknowledgement response lost');return result;},
   commit:receipt=>{const candidate=new Engine(JSON.parse(memory.get('save'))),result=candidate.applyTrade(receipt);if(!result.ok)return result;
    if(!result.alreadyReceived){if(faults.save)return {ok:false,message:'保存容量不足'};memory.set('save',JSON.stringify(candidate.serialize()));writes++;}engine=candidate;return result;}});}
  return{player,token,memory,faults,controller,get engine(){return engine;},get writes(){return writes;},request:(path,options)=>request(path,{...options,token})};
 }
 return{player,env};
}
async function prepare(a,b){
 const ca=a.controller(),cb=b.controller();assert((await ca.create()).ok);assert((await cb.join(ca.trade.code)).ok);
 assert((await ca.resume()).ok);assert((await ca.offer(a.engine.state.party[0].uid)).ok);assert((await cb.resume()).ok);assert((await cb.offer(b.engine.state.party[0].uid)).ok);assert((await ca.resume()).ok);
 return{ca,cb};
}

test('real service, two clients and Engine exchange individual data exactly once',async()=>{
 const s=service(),a=await s.player('こもり','komori'),b=await s.player('しずく','shizuku'),originalA=copy(a.engine.state.party[0]),originalB=copy(b.engine.state.party[0]),{ca,cb}=await prepare(a,b);
 assert((await ca.confirm()).ok);assert.equal(a.writes,0);assert((await cb.confirm()).ok);assert.equal(b.writes,1);assert((await ca.resume()).ok);assert.equal(a.writes,1);
 assert.deepEqual({...copy(a.engine.state.party[0]),uid:originalB.uid},originalB);assert.deepEqual({...copy(b.engine.state.party[0]),uid:originalA.uid},originalA);
 assert(!ca.isLocked());assert(!cb.isLocked());assert.equal((await a.request('/trades/active')).trade,null);assert.equal((await b.request('/trades/active')).trade,null);
 assert.equal(a.engine.state.tradeReceipts.length,1);assert.equal(b.engine.state.tradeReceipts.length,1);assert.equal(a.engine.state.party.length,1);assert.equal(b.engine.state.party.length,1);
 assert.equal(s.env.DB.sqlite.prepare("SELECT count(*) AS n FROM trades WHERE state='committed'").get().n,1);
});

test('real committed exchange survives disk failure, reload and lost acknowledgement response',async()=>{
 const s=service(),a=await s.player('こもり','komori'),b=await s.player('ひばな','hibana'),{ca,cb}=await prepare(a,b),original=JSON.stringify(b.engine.state.party);
 assert((await ca.confirm()).ok);b.faults.save=true;assert(!(await cb.confirm()).ok);assert(cb.isLocked());assert.equal(JSON.stringify(b.engine.state.party),original);assert.equal(b.writes,0);
 assert.equal((await b.request('/trades/active')).trade.state,'committed');
 b.faults.save=false;b.faults.ack=true;const retry=b.controller();assert(!(await retry.resume()).ok);assert(retry.isLocked());assert.equal(b.writes,1);assert.equal((await b.request('/trades/active')).trade,null);
 b.faults.ack=false;const last=b.controller();assert((await last.resume()).ok);assert(!last.isLocked());assert.equal(b.writes,1);assert.equal(b.engine.state.party.length,1);assert.equal(b.engine.state.tradeReceipts.length,1);assert(!b.memory.has(key));
 assert((await ca.resume()).ok);assert.equal(a.writes,1);assert.equal(a.engine.state.party[0].species,'hibana');assert.equal(b.engine.state.party[0].species,'komori');
});
