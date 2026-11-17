#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../native-app.js'),'utf8');
function environment(native=true) {
  const messages=[], classes=new Set(), listeners=new Map();
  let clock=0;
  const context=vm.createContext({
    window:{webkit:{messageHandlers:{pachiNative:{postMessage:message=>messages.push(message)}}}},
    location:{protocol:native?'pachimon:':'https:',hostname:native?'app':'www.kasai-solutions-inc.com'},
    document:{documentElement:{classList:{add:value=>classes.add(value)}},
      addEventListener:(name,handler)=>{const entries=listeners.get(name)||[];entries.push(handler);listeners.set(name,entries);}},
    performance:{now:()=>clock},
    TextEncoder,Response,File,DOMException,setTimeout,clearTimeout,
  });
  vm.runInContext(source,context);
  return {bridge:context.window.PachiNative,messages,classes,listeners,
    setTime:value=>{clock=value;},pointer:event=>{for(const listener of listeners.get('pointerdown')||[])listener(event);}};
}
(async()=>{
  const web=environment(false);
  assert.equal(web.bridge.available,false);
  assert.equal(web.listeners.size,0);
  web.bridge.bindGame({});assert.equal(web.messages.length,0);
  await assert.rejects(web.bridge.apiRequest('/status'));
  assert.throws(()=>web.bridge.exportJSON('{"version":1}'));
  const {bridge,messages,classes,pointer,setTime}=environment();
  const calls=[];
  bridge.bindGame({exportSave:()=>calls.push('export'),openSettings:()=>calls.push('settings'),
    importSave:async file=>calls.push(['import',await file.text()]),background:()=>calls.push('pause'),
    foreground:()=>calls.push('resume'),toast:message=>calls.push(['error',message])});
  assert.equal(bridge.available,true);assert(classes.has('native-app'));
  assert.equal(messages[0].command,'ready');
  const control=({disabled=false,ariaDisabled=false}={})=>({disabled,matches:()=>disabled,
    getAttribute:()=>ariaDisabled?'true':null,closest(){return this;}});
  const countHaptics=()=>messages.filter(message=>message.command==='haptic').length;
  pointer({isTrusted:false,button:0,target:control()});
  pointer({isTrusted:true,button:0,target:control({disabled:true})});
  pointer({isTrusted:true,button:0,target:control({ariaDisabled:true})});
  pointer({isTrusted:true,button:2,target:control()});
  pointer({isTrusted:true,button:0,target:{closest:()=>null}});
  assert.equal(countHaptics(),0);
  pointer({isTrusted:true,button:0,target:control()});
  assert.equal(countHaptics(),1);
  setTime(40);pointer({isTrusted:true,button:0,target:control()});
  assert.equal(countHaptics(),1);
  setTime(80);pointer({isTrusted:true,button:0,target:control()});
  assert.equal(countHaptics(),2);
  bridge.exportJSON('{"version":1}');assert.equal(messages.at(-1).kind,'adventure');
  bridge.exportJSON('{"token":"fixture"}','playerIdentity');assert.equal(messages.at(-1).kind,'playerIdentity');
  for(const input of ['[]','null','not json',JSON.stringify({value:'あ'.repeat(180000)})])assert.throws(()=>bridge.exportJSON(input));
  assert.throws(()=>bridge.exportJSON('{}','../../keys'));
  bridge.copyCode('AB12CD');assert.equal(messages.at(-1).command,'copyCode');
  assert.throws(()=>bridge.copyCode('https://example.com'));
  for(const badPath of ['https://example.com','//example.com','/../me','/%2e%2e/me','/%2fexample','/%5cme','/%zz','/me#secret'])await assert.rejects(bridge.apiRequest(badPath));
  await assert.rejects(bridge.apiRequest('/me',{method:'TRACE'}));
  const request=bridge.apiRequest('/me?limit=50&cursor=abc%3D',{method:'GET',token:'x'.repeat(43)});
  const id=messages.at(-1).id;
  bridge.receive({type:'apiResponse',id:'wrong',status:200,body:'{}'});
  bridge.receive({type:'apiResponse',id,status:200,body:'{"ok":true}'});
  assert.deepEqual(await(await request).json(),{ok:true});
  const failure=bridge.apiRequest('/me');
  bridge.receive({type:'apiResponse',id:messages.at(-1).id,error:'offline'});
  await assert.rejects(failure,/offline/);
  const oversized=bridge.apiRequest('/me');
  bridge.receive({type:'apiResponse',id:messages.at(-1).id,status:200,body:'x'.repeat(1048577)});
  await assert.rejects(oversized);
  const controller=new AbortController();
  const cancelled=bridge.apiRequest('/status',{signal:controller.signal});
  controller.abort();await assert.rejects(cancelled,{name:'AbortError'});
  assert.equal(messages.at(-1).command,'cancelAPI');
  await assert.rejects(bridge.apiRequest('/status',{signal:controller.signal}),{name:'AbortError'});
  bridge.receive({type:'requestExport'});bridge.receive({type:'requestSettings'});
  bridge.receive({type:'background'});bridge.receive({type:'foreground'});
  bridge.receive({type:'importSave',json:'{"version":1}'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls.slice(0,5),['export','settings','pause','resume',['import','{"version":1}']]);
  bridge.receive({type:'importSave',json:'[]'});assert.equal(calls.at(-1)[0],'error');
  bridge.receive({type:'arbitraryJavaScript',json:'alert(1)'});
  console.log('Native bridge passed: web isolation, bounded JSON, correlation, path/response validation, abort, lifecycle, backup handoff and trusted throttled haptics.');
})().catch(error=>{console.error(error);process.exitCode=1;});
