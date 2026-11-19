#!/usr/bin/env node
'use strict';

// Room visuals use the same catalog, occupied cells and protected paths as the
// service. These checks also exercise actual canvas pixels and engine movement.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
let canvas;
for(const name of [process.env.CANVAS_MODULE,'@napi-rs/canvas','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'].filter(Boolean)) {
  try{canvas=require(name);break;}catch{}
}
assert(canvas,'Install @napi-rs/canvas or set CANVAS_MODULE.');
const plain=value=>JSON.parse(JSON.stringify(value));
const core=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],core);if(core.LT?.Engine)break;
}
assert(core.LT?.Engine,'The shipped movement engine must load.');
function attachArt(LT) {
  const ctx=vm.createContext({LT,document:{createElement(tag){assert.equal(tag,'canvas');return canvas.createCanvas(1,1);}}});
  vm.runInContext(fs.readFileSync(path.join(root,'room-art.js'),'utf8'),ctx,{filename:'room-art.js'});return LT.RoomArt;
}
const art=attachArt(core.LT),engine=new core.LT.Engine();assert(engine.newGame('komori').ok);
const backend=import(pathToFileURL(path.join(root,'server/server.mjs')).href);
const record=(kind='secret',decorations=[])=>({id:'room-owner',mapId:'room:room-owner',owner:{id:'room-owner',name:'みどり',isAdmin:kind==='kasai'},
  kind,revision:7,entrance:{map:'village',x:32,y:7,facing:'up',returnX:32,returnY:8},decorations});
const piece=(itemId,x,y,rotation=0,id=`${itemId}-${x}-${y}`)=>({id,itemId,x,y,rotation});
const homeDecor=[piece('plant',2,3),piece('lamp',6,3),piece('stool',5,6),piece('table',2,7),piece('sofa',4,10),piece('shelf',11,2),
  piece('bed',14,3),piece('aquarium',11,7),piece('crystal',14,10),piece('plush',15,8),piece('rug',11,10),piece('banner',6,10)];
const hallDecor=[piece('plant',3,3),piece('plant',20,3),piece('lamp',5,8),piece('lamp',18,8),piece('sofa',3,10),piece('sofa',19,10),
  piece('shelf',3,14),piece('shelf',19,14),piece('banner',7,3),piece('banner',16,3),piece('crystal',7,6),piece('crystal',16,6),
  piece('aquarium',20,11),piece('rug',3,6),piece('plush',19,7),piece('table',4,15)];
function bounds(cv) {
  const data=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
  let left=cv.width,top=cv.height,right=-1,bottom=-1,opaque=0;const colors=new Set();
  for(let y=0;y<cv.height;y++)for(let x=0;x<cv.width;x++) {
    const i=(y*cv.width+x)*4;if(!data[i+3])continue;
    opaque++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
    colors.add(`${data[i]},${data[i+1]},${data[i+2]},${data[i+3]}`);
  }
  return {left,right,top,bottom,opaque,colors:colors.size,data};
}
function reachable(map) {
  const visited=new Set(),pending=[map.spawn];
  while(pending.length) {
    const p=pending.pop(),key=`${p.x},${p.y}`;
    if(visited.has(key)||!engine.walkable(map,p.x,p.y))continue;
    visited.add(key);for(const [dx,dy] of [[0,1],[1,0],[0,-1],[-1,0]])pending.push({x:p.x+dx,y:p.y+dy});
  }
  return visited;
}
function assertTwoPixelGrid(cv) {
  const pixels=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
  for(let y=0;y<cv.height;y+=2)for(let x=0;x<cv.width;x+=2)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)for(let c=0;c<4;c++)
    assert.equal(pixels[((y+dy)*cv.width+x+dx)*4+c],pixels[(y*cv.width+x)*4+c],`Subpixel detail at ${x},${y}`);
}
function nativeRoom(map,source=art) {
  const out=canvas.createCanvas(map.width*64,map.height*64),ctx=out.getContext('2d');
  for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++)assert(source.ground(ctx,map,x,y));
  source.renderDecor(ctx,map);return out;
}
const output=process.env.ROOM_ART_SNAPSHOTS;
function save(name,cv) {if(output){fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,name),cv.toBuffer('image/png'));}}

test('room catalog and geometry exactly match the deployed service contract',async()=>{
  const {ROOM_CATALOG,ROOM_LAYOUTS,validateRoomDecorations}=await backend;
  assert.deepEqual(plain(art.catalog),ROOM_CATALOG);assert.deepEqual(plain(art.layouts),ROOM_LAYOUTS);
  for(const [kind,decos] of [['secret',homeDecor],['kasai',hallDecor]]) {
    assert.deepEqual(validateRoomDecorations(decos,kind),decos);
    const before=JSON.stringify(record(kind,decos)),map=art.createMap(JSON.parse(before)),layout=ROOM_LAYOUTS[kind];
    assert.equal(map.width,layout.width);assert.equal(map.height,layout.height);
    assert.deepEqual(plain(map.spawn),{...layout.spawn,facing:'up'});
    assert.equal(map.roomRevision,7);assert.equal(map.roomKindTag,kind);assert.equal(map.roomOwner,'room-owner');
    assert.equal(map.id,'room:room-owner');assert.equal(map.sharedRoom,true);assert.equal(map.interior,true);
    assert.equal(map.tiles.length,map.height);assert(map.tiles.every(row=>row.length===map.width));
    assert.deepEqual(plain(map.returnPoint),{map:'village',x:32,y:8,facing:'down'});
    assert.deepEqual(plain(map.exits[0]),{...layout.exit,to:'village',tx:32,ty:8,facing:'down',door:true,label:core.LT.DATA.maps.village.name});
    assert.equal(JSON.stringify(record(kind,decos)),before,'Constructing a map changed the persisted room record');
  }
  for(const [into,outward] of [['up','down'],['left','right'],['down','up'],['right','left']]) {
    const source=record();source.name='星の読書室';source.entrance.facing=into;
    const map=art.createMap(source);assert.equal(map.name,'星の読書室');assert.equal(map.exits[0].facing,outward);assert.equal(map.returnPoint.facing,outward);
  }
});

test('all four furniture rotations share server collision footprints, while rugs stay walkable',async()=>{
  const {validateRoomDecorations}=await backend;
  for(const item of art.catalog)for(const rotation of [0,90,180,270]) {
    const deco=piece(item.id,2,3,rotation),validated=validateRoomDecorations([deco],'secret'),map=art.createMap(record('secret',validated));
    const w=rotation%180?item.height:item.width,h=rotation%180?item.width:item.height;
    let occupied=0;
    for(let y=1;y<map.height-1;y++)for(let x=1;x<map.width-1;x++) {
      const inside=x>=2&&x<2+w&&y>=3&&y<3+h;
      assert.equal(engine.walkable(map,x,y),!(inside&&item.solid),`${item.id} ${rotation} at ${x},${y}`);
      if(map.tiles[y][x]==='B')occupied++;
    }
    assert.equal(occupied,item.solid?w*h:0);
    assert.equal(map.furniture.length,item.solid?1:0);assert.equal(map.floorDecorations.length,item.solid?0:1);
  }
});

test('maximum furnishing cannot seal the exit, arrival, or Kasai interaction path',async()=>{
  const {validateRoomDecorations}=await backend;
  for(const kind of ['secret','kasai']) {
    const decos=[];
    for(let y=2;y<14&&decos.length<32;y++)for(let x=1;x<8&&decos.length<32;x++)decos.push(piece('plant',x,y));
    const map=art.createMap(record(kind,validateRoomDecorations(decos,kind))),visited=reachable(map);
    assert.equal(map.decorations.length,32);assert(visited.has(`${map.exits[0].x},${map.exits[0].y}`),'Furnishings trapped the visitor');
    for(let y=1;y<map.height-1;y++)for(const x of kind==='kasai'?[11,12]:[8,9])
      if(!map.npcs.some(n=>n.x===x&&n.y===y))assert(visited.has(`${x},${y}`),`${kind}: protected aisle lost at ${x},${y}`);
    if(kind==='kasai') {
      assert.equal(map.npcs.length,0,'An offline Kasai must not be replaced with a ghost NPC');
      assert(visited.has('12,5'),'The challenger cannot approach the live Kasai seat');assert(engine.walkable(map,12,4),'The actual administrator must be able to occupy the seat');
    }
  }
});

test('bad or stale decoration records cannot introduce walls, overlaps, or blocked reserved squares',()=>{
  const bad=[piece('plant',8,3),piece('plant',9,12),piece('bed',16,12),piece('unknown',2,3),piece('plant',2.5,5),piece('plant',2,5,45),
    piece('sofa',2,3),piece('rug',2,3,0,'overlap'),piece('plush',4,5,0,'duplicate'),piece('plant',5,5,0,'duplicate')];
  const map=art.createMap(record('secret',bad));
  assert.deepEqual(plain(map.decorations),[bad[6],bad[8]]);assert(reachable(map).has('9,14'));
  const hall=art.createMap(record('kasai',[piece('table',8,3),piece('lamp',12,16),piece('plant',16,3)]));
  assert.deepEqual(plain(hall.decorations),[piece('plant',16,3)]);assert(reachable(hall).has('12,5'));
  assert.throws(()=>art.createMap({...record(),entrance:{map:'village'}}),/出口/);
  assert.throws(()=>art.createMap({...record(),owner:{name:'unknown'}}),/持ち主/);
});

test('twelve furniture sprites fit renderer cache bounds and keep an exact two-pixel grid',()=>{
  const atlas=canvas.createCanvas(6*128,2*144),ctx=atlas.getContext('2d'),hashes=new Set();
  for(const [i,item] of art.catalog.entries())for(const rotation of [0,90,180,270]) {
    const size=art.footprint(item,rotation),source=canvas.createCanvas(size.width*64+128,size.height*64+192),s=source.getContext('2d');
    s.translate(64,96);assert(art.furniture(s,{type:'room-item',itemId:item.id,x:0,y:0,rotation}));
    const pixels=bounds(source);assert(pixels.opaque>120,`${item.id}/${rotation}: empty artwork`);
    assert(pixels.left>=48&&pixels.right<64+size.width*64+16,`${item.id}/${rotation}: side pixels exceed cache bounds`);
    assert(pixels.top>=16&&pixels.bottom<96+size.height*64+32,`${item.id}/${rotation}: height exceeds cache bounds`);
    assertTwoPixelGrid(source);
    const thumb=canvas.createCanvas(128,128);assert(art.renderThumbnail(thumb,item.id,{rotation}));
    const thumbPixels=bounds(thumb);assert(thumbPixels.opaque>80);assert(thumbPixels.left>=4&&thumbPixels.top>=4&&thumbPixels.right<124&&thumbPixels.bottom<124,`${item.id}: clipped thumbnail`);
    if(rotation===0){ctx.drawImage(thumb,(i%6)*128,Math.floor(i/6)*144);hashes.add(thumb.toBuffer('image/png').toString('base64'));}
  }
  assert.equal(hashes.size,12,'Different furniture items share the same thumbnail');save('room-furniture-v56.png',atlas);
});

test('native room art is opaque, deterministic, and keeps rugs below depth-sorted objects',()=>{
  const stateBefore=JSON.stringify(engine.state),worldBefore=JSON.stringify(core.LT.DATA.maps);
  for(const [kind,decos] of [['secret',homeDecor],['kasai',hallDecor]]) {
    const map=art.createMap(record(kind,decos)),before=JSON.stringify(map),full=nativeRoom(map),ctx=full.getContext('2d');
    const pixels=bounds(full);assert.equal(pixels.opaque,full.width*full.height);assert(pixels.colors>70,'Room artwork lost its material detail');
    assertTwoPixelGrid(full);
    const again=nativeRoom(map);assert.deepEqual(again.toBuffer('image/png'),full.toBuffer('image/png'),'Rendering is not deterministic');
    const rugMap=art.createMap(record(kind,[piece('rug',2,9)]));
    const layer=canvas.createCanvas(full.width,full.height);art.renderDecor(layer.getContext('2d'),rugMap,{layer:'objects'});
    assert.equal(bounds(layer).opaque,0,'A rug was depth-sorted above players');
    art.renderDecor(layer.getContext('2d'),rugMap,{layer:'floor'});assert(bounds(layer).opaque>0,'Floor decorations were omitted');
    assert.equal(JSON.stringify(map),before,'Rendering mutated collision or placement data');save(`room-${kind}-native-v56.png`,full);
    assert(ctx);full.width=full.height=again.width=again.height=layer.width=layer.height=1;
  }
  assert.equal(JSON.stringify(engine.state),stateBefore);assert.equal(JSON.stringify(core.LT.DATA.maps),worldBefore);
});

test('door overlays distinguish ordinary and Kasai rooms without changing the outdoor map',()=>{
  const ordinary=canvas.createCanvas(96,96),special=canvas.createCanvas(96,96),input=record();input.entrance.x=input.entrance.y=0;
  const before=JSON.stringify(input);assert(art.drawDoor(ordinary.getContext('2d'),input,{label:false}));
  assert(art.drawDoor(special.getContext('2d'),{...input,kind:'kasai'},{label:false}));
  assert(bounds(ordinary).opaque>1800);assert.notDeepEqual(ordinary.toBuffer('image/png'),special.toBuffer('image/png'));
  assert.equal(JSON.stringify(input),before);assert.equal(art.drawDoor(ordinary.getContext('2d'),{entrance:{x:NaN,y:0}}),false);
  const blank=canvas.createCanvas(64,64),c=blank.getContext('2d'),outdoor=core.LT.DATA.maps.village;
  assert.equal(art.ground(c,outdoor,0,0),false);assert.equal(art.dressing(c,outdoor),false);assert.equal(art.furniture(c,{type:'shelf',x:0,y:0}),false);
  assert.equal(bounds(blank).opaque,0,'Room rendering intercepted an ordinary field asset');
});

test('shipped world renderer uses room artwork, live revision refresh, and both Kasai participants',async()=>{
  const {runtime}=require('./check-art.cjs'),{LT,engine:liveEngine,imageErrors}=await runtime();assert.equal(imageErrors.length,0);
  if(!LT.RoomArt)attachArt(LT);
  const original=LT.RoomArt,travellers=LT.TravellerArt,world=LT.World,calls={ground:0,dressing:0,furniture:0},actors=[];
  LT.RoomArt={...original,...Object.fromEntries(Object.keys(calls).map(name=>[name,(...args)=>{const result=original[name](...args);if(result)calls[name]++;return result;}]))};
  LT.TravellerArt={...travellers,get(...args){actors.push(args[0]);return travellers.get(...args);}};
  const liveState=JSON.stringify(liveEngine.state),home=LT.RoomArt.createMap(record('secret',homeDecor)),hall=LT.RoomArt.createMap(record('kasai',hallDecor));
  LT.World={actors:map=>map===hall.id?[{id:'P0000000000000001',name:'カサイ',isAdmin:true,x:12,y:4,facing:'down',moving:false}]:[]};
  for(const map of [home,hall]) {
    const startGround=calls.ground;actors.length=0;
    const view=canvas.createCanvas(900,760),state={...liveEngine.state,map:map.id,x:map.spawn.x,y:map.spawn.y,facing:'up'};
    LT.Art.world(view,{map,state},0,{dayPhase:'day'});assert.equal(bounds(view).opaque,view.width*view.height);
    assert(calls.ground>startGround&&calls.dressing>0&&calls.furniture>0,'The shipped renderer bypassed RoomArt hooks or reused a different room kind');
    assert(actors.includes('hero'),'The arriving player was omitted');
    if(map.roomKindTag==='kasai')assert.equal(actors.filter(kind=>kind==='kasai').length,1,'Only the actual administrator appears at the opposite seat');
    save(`room-${map.roomKindTag}-world-v56.png`,view);
  }
  actors.length=0;LT.World={actors:()=>[]};const emptyHall=canvas.createCanvas(900,760);LT.Art.world(emptyHall,{map:hall,state:{...liveEngine.state,map:hall.id,...hall.spawn}},0);assert(!actors.includes('kasai'),'Offline Kasai still appears as an NPC');
  const beforeCalls=calls.furniture,changed=LT.RoomArt.createMap({...record('secret',[piece('crystal',2,3)]),revision:8}),view=canvas.createCanvas(900,760);
  LT.Art.world(view,{map:changed,state:{...liveEngine.state,map:changed.id,x:9,y:12}},0);
  assert(calls.furniture>beforeCalls,'A new room revision retained stale furniture art in the terrain cache');
  assert.equal(JSON.stringify(liveEngine.state),liveState,'Room previews changed the active player save');LT.RoomArt=original;LT.TravellerArt=travellers;LT.World=world;
});

test('both live seats remain visible with the same full-room framing in short mobile viewports',async()=>{
  const {runtime}=require('./check-art.cjs'),{LT,engine:liveEngine}=await runtime();if(!LT.RoomArt)attachArt(LT);
  const travellers=LT.TravellerArt,world=LT.World,hall=LT.RoomArt.createMap(record('kasai',[])),markers={};
  for(const [kind,color] of [['kasai','#ff00ff'],['hero','#00ffff']]){const sprite=canvas.createCanvas(96,128);sprite.getContext('2d').fillStyle=color;sprite.getContext('2d').fillRect(0,0,96,128);markers[kind]=sprite;}
  LT.TravellerArt={...travellers,get:kind=>markers[kind]||markers.hero};
  const pixelsOf=(view,color)=>{const data=view.getContext('2d').getImageData(0,0,view.width,view.height).data;let count=0,x=0,y=0;for(let i=0;i<data.length;i+=4)if(color.every((value,c)=>data[i+c]===value)&&data[i+3]===255){count++;x+=(i/4)%view.width;y+=Math.floor(i/4/view.width);}return {count,x:x/count,y:y/count};};
  try{
    for(const [width,height] of [[560,140],[844,154],[390,170],[900,760]]){
      const positions=[];
      for(const role of ['challenger','kasai']){
        const owner=role==='kasai',remote={id:'P0000000000000001',name:owner?'挑戦者':'カサイ',isAdmin:!owner,avatar:'male',x:12,y:owner?16:4,facing:owner?'up':'down',moving:false};
        LT.World={actors:map=>map===hall.id?[remote]:[],localKind:()=>owner?'kasai':'hero'};
        const view=canvas.createCanvas(width,height),state={...liveEngine.state,map:hall.id,x:12,y:owner?4:16,facing:owner?'down':'up',party:[]};
        LT.Art.world(view,{map:hall,state},0,{dayPhase:'day'});
        const kasai=pixelsOf(view,[255,0,255]),challenger=pixelsOf(view,[0,255,255]);
        assert(kasai.count>8&&challenger.count>8,`${role} at ${width}×${height} clipped the opposite live participant`);
        assert(kasai.y<challenger.y,'The administrator must remain at the opposite seat above the challenger');positions.push([kasai,challenger]);
      }
      for(let person=0;person<2;person++)for(const axis of ['x','y'])assert(Math.abs(positions[0][person][axis]-positions[1][person][axis])<=1,`Changing the local participant moved the ${axis} camera at ${width}×${height}`);
    }
  }finally{LT.TravellerArt=travellers;LT.World=world;}
});
