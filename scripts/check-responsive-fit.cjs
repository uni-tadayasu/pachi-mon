#!/usr/bin/env node
'use strict';
// Structural/interaction regression checks for the shared responsive console.
// This runs the production viewport scripts against the real #app markup. It
// intentionally does not pretend that a VM computes CSS geometry: actual pixel
// bounds, clipping and touch-target sizes still need a browser inspection.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const mobileSource=fs.readFileSync(path.join(root,'mobile-screen.js'),'utf8'),desktopSource=fs.readFileSync(path.join(root,'desktop-screen.js'),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
const styleLinks=[...html.matchAll(/<link\b([^>]+)>/gi)].filter(([,attrs])=>/\brel=["']stylesheet["']/.test(attrs)).map(([,attrs])=>/\bhref=["']([^"']+)/.exec(attrs)?.[1]);
assert(styleLinks.at(-1)?.startsWith('responsive-fit.css?'),'The responsive layout must load after every legacy/theme stylesheet');
assert(fs.readFileSync(path.join(root,'responsive-fit.css'),'utf8').trim(),'Responsive stylesheet is empty');

function mediaMatches(query,state){
  return query.split(',').some(part=>[...part.matchAll(/\(\s*([\w-]+)\s*:\s*([^)]+)\)/g)].every(([,key,raw])=>{
    const value=raw.trim(),axis=/^(min|max)-(width|height)$/.exec(key);
    if(axis)return axis[1]==='max'?state[axis[2]]<=parseFloat(value):state[axis[2]]>=parseFloat(value);
    if(key==='orientation')return value===(state.width>state.height?'landscape':'portrait');
    if(key==='any-pointer')return state.pointers.includes(value);
    if(key==='pointer')return state.pointer===value;
    if(key==='prefers-reduced-motion')return value==='no-preference';
    assert.fail('Add the actual viewport feature to this fixture: '+key);
  }));
}
function runtime(initial){
  const state={pointer:'fine',pointers:['fine'],...initial},frames=[],observers=[],media=[],listeners=new Map();let doc,frameSerial=0;
  const on=(target,type,handler)=>{const key=target+':'+type;if(!listeners.has(key))listeners.set(key,[]);listeners.get(key).push(handler);};
  const emit=(target,type,event={})=>{event.type=type;for(const fn of listeners.get(target+':'+type)||[])fn(event);return event;};
  class Node{
    constructor(tag,nodeType=1){this.nodeType=nodeType;this.tagName=tag.toUpperCase();this.childNodes=[];this.parentElement=null;this.attributes=new Map();this.listeners=new Map();this.moves=0;this.scrollTop=0;this.scrollLeft=0;this._text='';this._innerHTML='';
      const values=new Map();this.style={setProperty:(key,value)=>values.set(key,String(value)),getPropertyValue:key=>values.get(key)||'',removeProperty:key=>values.delete(key)};
      this.classList={contains:name=>this.className.split(/\s+/).includes(name),add:(...names)=>this.setAttribute('class',[...new Set([...this.className.split(/\s+/).filter(Boolean),...names])].join(' ')),remove:(...names)=>this.setAttribute('class',this.className.split(/\s+/).filter(name=>!names.includes(name)).join(' ')),toggle:(name,force)=>{const yes=force??!this.classList.contains(name);yes?this.classList.add(name):this.classList.remove(name);return yes;}};
    }
    get id(){return this.getAttribute('id')||'';}set id(value){this.setAttribute('id',value);}
    get className(){return this.getAttribute('class')||'';}set className(value){this.setAttribute('class',value);}
    get hidden(){return this.hasAttribute('hidden');}set hidden(value){value?this.setAttribute('hidden',''):this.removeAttribute('hidden');}
    get open(){return this.hasAttribute('open');}set open(value){value?this.setAttribute('open',''):this.removeAttribute('open');}
    get children(){return this.childNodes.filter(node=>node.nodeType===1);}
    get firstChild(){return this.childNodes[0]||null;}
    get nextSibling(){if(!this.parentElement)return null;return this.parentElement.childNodes[this.parentElement.childNodes.indexOf(this)+1]||null;}
    get isConnected(){return !!doc?.documentElement?.contains(this);}
    get isContentEditable(){return this.getAttribute('contenteditable')==='true';}
    get textContent(){return this._text+this.childNodes.map(node=>node.textContent).join('');}set textContent(value){this.replaceChildren();this._text=String(value);}
    get innerHTML(){return this._innerHTML;}set innerHTML(value){this.replaceChildren();this._innerHTML=String(value);}
    get clientWidth(){return this.bounds?.width||state.width;}get clientHeight(){return this.bounds?.height||state.height;}
    getAttribute(name){return this.attributes.get(name)??null;}hasAttribute(name){return this.attributes.has(name);}
    setAttribute(name,value){const text=String(value);if(this.attributes.get(name)===text)return;this.attributes.set(name,text);for(const o of observers)if(o.target===this&&(!o.options?.attributeFilter||o.options.attributeFilter.includes(name)))o.callback([{type:'attributes',target:this,attributeName:name}]);}
    removeAttribute(name){if(!this.attributes.delete(name))return;for(const o of observers)if(o.target===this&&(!o.options?.attributeFilter||o.options.attributeFilter.includes(name)))o.callback([{type:'attributes',target:this,attributeName:name}]);}
    appendChild(node){return this.insertBefore(node,null);}
    insertBefore(node,reference){assert(node instanceof Node);if(node.parentElement){if(node.contains(doc?.activeElement))doc.activeElement=doc.body;node.parentElement.removeChild(node);}const index=reference?this.childNodes.indexOf(reference):this.childNodes.length;assert(index>=0);this.childNodes.splice(index,0,node);node.parentElement=this;node.moves++;return node;}
    append(...nodes){for(const node of nodes)this.appendChild(node);}
    prepend(...nodes){for(const node of nodes.reverse())this.insertBefore(node,this.firstChild);}
    removeChild(node){const index=this.childNodes.indexOf(node);assert(index>=0);this.childNodes.splice(index,1);node.parentElement=null;return node;}
    remove(){this.parentElement?.removeChild(this);}
    before(node){this.parentElement?.insertBefore(node,this);}
    after(node){this.parentElement?.insertBefore(node,this.nextSibling);}
    replaceChildren(...nodes){for(const node of [...this.childNodes])this.removeChild(node);this.append(...nodes);}
    contains(node){return node===this||this.childNodes.some(child=>child.contains(node));}
    matches(selector){return selector.split(',').some(part=>{
      const attrs=[...part.matchAll(/\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]/g)];let simple=part.trim().replace(/\[[^\]]*\]/g,'');
      if(attrs.some(([,name,value])=>value===undefined?!this.hasAttribute(name):this.getAttribute(name)!==value))return false;
      const tag=/^[a-z][\w-]*/i.exec(simple)?.[0];if(tag&&tag.toUpperCase()!==this.tagName)return false;
      for(const [,kind,name]of simple.matchAll(/([.#])([\w-]+)/g))if(kind==='#'?this.id!==name:!this.classList.contains(name))return false;
      return this.nodeType===1;
    });}
    closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
    querySelectorAll(selector){const result=[];for(const part of selector.split(',')){
      const parts=part.trim().split(/\s+/),leaf=parts.pop();
      const visit=node=>{for(const child of node.childNodes){if(child.matches(leaf)){let parent=child.parentElement,index=parts.length-1;while(parent&&index>=0){if(parent.matches(parts[index]))index--;parent=parent.parentElement;}if(index<0&&!result.includes(child))result.push(child);}visit(child);}};visit(this);
    }return result;}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(handler);}
    dispatchEvent(event){for(const fn of this.listeners.get(event.type)||[])fn(event);return !event.defaultPrevented;}
    click(){this.dispatchEvent({type:'click',target:this});}
    focus(){doc.activeElement=this;}
    getBoundingClientRect(){const b=this.bounds||{left:0,top:0,width:state.width,height:state.height};return{...b,right:b.left+b.width,bottom:b.top+b.height};}
  }
  const htmlNode=new Node('html'),body=new Node('body');htmlNode.append(body);
  doc={documentElement:htmlNode,body,activeElement:body,scrollingElement:htmlNode,fullscreenElement:null,
    createElement:tag=>new Node(tag),createComment:text=>{const node=new Node('#comment',8);node._text=text;return node;},
    getElementById:id=>htmlNode.querySelector('#'+id),querySelector:selector=>htmlNode.querySelector(selector),querySelectorAll:selector=>htmlNode.querySelectorAll(selector),
    addEventListener:(type,fn)=>on('document',type,fn),dispatchEvent:event=>{emit('document',event.type,event);return true;},getSelection:()=>({rangeCount:0})};
  const viewport=new Node('meta');viewport.setAttribute('name','viewport');htmlNode.prepend(viewport);
  const markup=html.slice(html.indexOf('  <div id="app">'),html.indexOf('  <section id="title-screen"'));
  assert(markup.includes('id="game-canvas"'),'Production app markup not found');
  const stack=[body],voidTags=new Set(['AREA','BASE','BR','COL','EMBED','HR','IMG','INPUT','LINK','META','PARAM','SOURCE','TRACK','WBR']);
  for(const match of markup.matchAll(/<!--[\s\S]*?-->|<\/?[a-z][^>]*>/gi)){
    const text=match[0];if(text.startsWith('<!--'))continue;
    if(text.startsWith('</')){assert(stack.length>1,'App markup closes outside its root');stack.pop();continue;}
    const tag=/^<([\w-]+)/.exec(text)[1],node=new Node(tag);
    for(const [,name,dq,sq,bare]of text.slice(tag.length+1,-1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))node.setAttribute(name,dq??sq??bare??'');
    stack.at(-1).append(node);if(!voidTags.has(node.tagName)&&!text.endsWith('/>'))stack.push(node);
  }
  assert.equal(stack.length,1,'Production app markup is unbalanced');
  const dialog=new Node('dialog');dialog.id='responsive-fixture-dialog';body.append(dialog);
  const command=new Node('button');command.id='responsive-fixture-command';doc.getElementById('battle-actions').append(command);let clicks=0;command.addEventListener('click',()=>clicks++);
  const nav={maxTouchPoints:state.pointers.includes('coarse')?5:0};
  const win={innerWidth:state.width,innerHeight:state.height,scrollX:0,scrollY:0,navigator:nav,screen:{orientation:{addEventListener:(type,fn)=>on('orientation',type,fn)}},
    visualViewport:{width:state.width,height:state.height,scale:1,offsetTop:0,offsetLeft:0,addEventListener:(type,fn)=>on('visual',type,fn)},
    addEventListener:(type,fn)=>on('window',type,fn),dispatchEvent:event=>emit('window',event.type,event),scrollTo(x,y){this.scrollX=typeof x==='object'?x.left:x;this.scrollY=typeof x==='object'?x.top:y;htmlNode.scrollTop=0;}};
  class Event{constructor(type,init={}){this.type=type;Object.assign(this,init);this.defaultPrevented=false;}preventDefault(){this.defaultPrevented=true;}stopImmediatePropagation(){this.stopped=true;}}
  class Observer{constructor(callback){this.callback=callback;}observe(target,options){this.target=target;this.options=options;observers.push(this);}disconnect(){}}
  const context=vm.createContext({console,window:win,document:doc,navigator:nav,Element:Node,Event,CustomEvent:Event,MutationObserver:Observer,ResizeObserver:Observer,
    matchMedia:query=>{const item={query,get matches(){return mediaMatches(query,state);},addEventListener:(type,fn)=>on(query,type,fn)};media.push(item);return item;},
    requestAnimationFrame:fn=>{frames.push(fn);return ++frameSerial;},cancelAnimationFrame:()=>{},setTimeout:fn=>{frames.push(fn);return ++frameSerial;},clearTimeout:()=>{}});
  const flush=()=>{let count=0;while(frames.length){assert(++count<100,'Viewport scheduling did not settle');frames.shift()(0);}};
  body.classList.add('is-playing');vm.runInContext(mobileSource,context);vm.runInContext(desktopSource,context);flush();
  function change(next){Object.assign(state,next);win.innerWidth=state.width;win.innerHeight=state.height;Object.assign(win.visualViewport,{width:state.width,height:state.height});for(const item of media)emit(item.query,'change');emit('window','resize');emit('window','orientationchange');flush();}
  return{state,context,document:doc,window:win,root:htmlNode,body,command,dialog,flush,change,emit,Event,get clicks(){return clicks;}};
}

const cases=[
  [320,568,'coarse'],[360,640,'coarse'],[375,667,'coarse'],[390,844,'coarse'],[430,932,'coarse'],
  [568,320,'coarse'],[667,375,'coarse'],[844,390,'coarse'],[932,430,'coarse'],
  [768,1024,'coarse'],[1024,768,'coarse'],[1024,1366,'coarse'],[1366,1024,'coarse'],
  [701,600,'fine'],[800,600,'fine'],[1024,600,'fine'],[1280,720,'fine'],[1366,768,'fine'],[1440,900,'fine'],[1920,1080,'fine']
];
let structureChecks=0,rasterChecks=0;
function assertSeparate(env,label){
  const d=env.document,stage=d.querySelector('.game-stage'),dock=d.getElementById('battle-dock'),meta=d.getElementById('field-meta');
  assert(env.root.classList.contains('viewport-fit'),label+': shared fit is enabled');
  assert(dock&&meta,label+': shared battle and field regions exist');
  assert(!stage.contains(dock)&&!stage.contains(meta),label+': information remains outside the artwork');
  for(const id of ['battle-ui','battle-panel'])assert(dock.contains(d.getElementById(id))&&!stage.contains(d.getElementById(id)),label+': '+id+' is outside the canvas');
  for(const id of ['world-label','world-hint'])assert(meta.contains(d.getElementById(id))&&!stage.contains(d.getElementById(id)),label+': '+id+' is outside the canvas');
  assert.equal(d.querySelectorAll('#battle-dock').length,1);assert.equal(d.querySelectorAll('#field-meta').length,1);
  for(const id of ['battle-ui','battle-panel','world-label','world-hint','game-canvas','touch-action','menu-btn'])assert.equal(d.querySelectorAll('#'+id).length,1,label+': '+id+' was duplicated');
  assert.equal(dock.hidden,!env.body.classList.contains('in-battle'),label+': battle visibility follows play mode');
  assert(d.getElementById('menu-btn').isConnected,label+': main menu remains available');structureChecks++;
}
const resizeStart=html.indexOf('  function resize() {'),resizeEnd=html.indexOf("  window.addEventListener('resize',resize);",resizeStart);
assert(resizeStart>=0&&resizeEnd>resizeStart,'Production canvas-resize handler not found');
for(const [width,height,pointer]of cases){
  const label=`${width}x${height} ${pointer}`,env=runtime({width,height,pointer,pointers:[pointer]});assertSeparate(env,label+' exploration');
  env.body.classList.add('in-battle');env.flush();assertSeparate(env,label+' battle');
  const context=env.context,canvas=env.document.getElementById('game-canvas');context.$=id=>env.document.getElementById(id);context.refitBattleText=()=>{};
  vm.runInContext(html.slice(resizeStart,resizeEnd),context);
  for(const battle of [false,true]){
    context.engine={battle:battle?{}:null};canvas.bounds={left:0,top:0,width:Math.max(1,Math.round(width*.61)),height:Math.max(1,Math.round(height*.43))};
    let writes=0,cw=768,ch=480;Object.defineProperty(canvas,'width',{configurable:true,get:()=>cw,set:value=>{cw=value;writes++;}});Object.defineProperty(canvas,'height',{configurable:true,get:()=>ch,set:value=>{ch=value;writes++;}});
    context.resize();assert(Number.isInteger(cw)&&Number.isInteger(ch)&&cw>0&&ch>0,label+': valid raster');
    assert(cw<=1536&&ch<=1152,label+': bounded rendering allocation');
    assert(Math.abs(cw*canvas.bounds.height-ch*canvas.bounds.width)<=(canvas.bounds.width+canvas.bounds.height)/2+1,label+': artwork is not stretched by raster mismatch');
    const beforeWrites=writes;context.resize();assert.equal(writes,beforeWrites,label+': unchanged size must not clear the canvas');rasterChecks++;
  }
  env.window.visualViewport.height=Math.max(200,height-280);env.emit('visual','resize');env.flush();
  assert.equal(env.root.style.getPropertyValue('--app-height'),Math.min(env.window.innerHeight,env.window.visualViewport.height)+'px',label+': keyboard-visible height');
}

async function lifecycle(){
  const env=runtime({width:1280,height:720}),d=env.document;
  env.body.classList.add('in-battle');d.getElementById('battle-ui').hidden=false;d.getElementById('battle-panel').hidden=false;env.flush();
  const original=Object.fromEntries(['battle-dock','field-meta','battle-ui','battle-panel','world-label','world-hint'].map(id=>[id,{node:d.getElementById(id),moves:d.getElementById(id).moves}]));
  env.command.focus();
  for(const [width,height,pointer]of [...cases,...cases.slice().reverse()]){
    env.change({width,height,pointer,pointers:[pointer]});assertSeparate(env,`transition ${width}x${height}`);
    for(const [id,record]of Object.entries(original)){assert.equal(d.getElementById(id),record.node,id+' preserves identity');assert.equal(record.node.moves,record.moves,id+' is not reparented on rotation');}
    assert.equal(d.activeElement,env.command,'Resize preserves keyboard focus');
  }
  env.command.click();assert.equal(env.clicks,1,'Original event listeners survive layout changes');
  env.change({width:1280,height:720,pointer:'fine',pointers:['fine']});
  env.root.requestFullscreen=async()=>{throw Error('Embedded browser denied fullscreen');};
  await env.context.LT.DesktopScreen.toggle();assert(env.root.classList.contains('desktop-expanded'),'Denied fullscreen has an in-page fit');assertSeparate(env,'fallback fullscreen');
  env.dialog.open=true;const ignored=new env.Event('keydown',{key:'Escape',target:env.command});env.emit('document','keydown',ignored);assert.equal(ignored.defaultPrevented,false,'An open modal keeps its Escape behavior');env.dialog.open=false;
  const exit=new env.Event('keydown',{key:'Escape',target:env.command});env.emit('document','keydown',exit);env.flush();assert(!env.root.classList.contains('desktop-expanded'),'Escape exits only the fit fallback');assert(exit.defaultPrevented&&exit.stopped,'Fallback Escape does not also open the game menu');
  env.root.requestFullscreen=async()=>{d.fullscreenElement=env.root;d.dispatchEvent(new env.Event('fullscreenchange'));};d.exitFullscreen=async()=>{d.fullscreenElement=null;d.dispatchEvent(new env.Event('fullscreenchange'));};
  await env.context.LT.DesktopScreen.toggle();assert(env.root.classList.contains('desktop-expanded'));await env.context.LT.DesktopScreen.toggle();assert(!env.root.classList.contains('desktop-expanded'));assertSeparate(env,'native fullscreen exit');
  const start=html.indexOf('  function showLevelUp(info){'),end=html.indexOf('  async function playBattleEvents(',start);assert(start>=0&&end>start);
  Object.assign(env.context,{settings:{reducedMotion:true},DATA:{statLabels:{hp:'体力'}},portrait:()=>'<canvas></canvas>',escape:value=>String(value),paintPortraits:()=>{},$:id=>d.getElementById(id)});
  vm.runInContext(html.slice(start,end),env.context);
  for(const [width,height,pointer]of [[390,844,'coarse'],[844,390,'coarse'],[1280,720,'fine']]){
    env.change({width,height,pointer,pointers:[pointer]});env.context.showLevelUp({species:'komori',name:'コモリ',level:8,gains:{hp:5},points:2});
    const cards=d.querySelectorAll('.levelup-card');assert.equal(cards.length,1);assert(d.getElementById('battle-dock').contains(cards[0]),'Level-up information uses the dock');assert(!d.querySelector('.game-stage').contains(cards[0]),'Level-up information never covers the art');assert.equal(cards[0].getAttribute('role'),'status');
    env.context.showLevelUp({species:'komori',name:'コモリ',level:9,gains:{hp:5},points:2});assert.equal(d.querySelectorAll('.levelup-card').length,1,'A second announcement replaces the first');env.context.hideLevelUp();assert.equal(d.querySelectorAll('.levelup-card').length,0);
  }
  env.body.classList.remove('in-battle');env.flush();assertSeparate(env,'return to exploration');
  return{resizeTransitions:cases.length*2,focusAndHandlersPreserved:true,fullscreenFallback:true,levelUpOutsideCanvas:true};
}
lifecycle().then(result=>console.log(JSON.stringify({ok:true,viewportCases:cases.length,structureChecks,rasterChecks,...result,coverage:'Real app markup and production DOM/viewport/resize code; CSS pixel geometry requires browser verification'},null,2))).catch(error=>{console.error(error);process.exitCode=1;});
