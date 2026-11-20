/* Pachi Monsters — detailed pixel materials and deterministic battle choreography.
 * © 2026 KASAI SOLUTIONS INC. No gameplay mutations.
 */
(() => {
  'use strict';
  const LT = globalThis.LT = globalThis.LT || {};
  const TAU = Math.PI * 2;
  // Fixed budgets keep the high-resolution passes bounded on touch devices.
  const budgets = Object.freeze({low:Object.freeze({particles:12,ribbonSteps:14,corona:7,ornaments:3}),balanced:Object.freeze({particles:20,ribbonSteps:20,corona:11,ornaments:5}),high:Object.freeze({particles:28,ribbonSteps:26,corona:15,ornaments:7})});
  const palettes = {
    leaf: ['#e5ffb1', '#8bdd71', '#328d70', '#fff6cd'],
    tide: ['#d9ffff', '#59dce9', '#287ec4', '#f1fdff'],
    ember: ['#fff2bc', '#ffb247', '#ed5b64', '#fffaf0'],
    wind: ['#f0ffe3', '#aae6c5', '#69a9da', '#ffffff'],
    crystal: ['#fff2ff', '#d6acff', '#7685ec', '#fff9cf'],
    thunder: ['#fff6b0', '#f1c746', '#9a6c34', '#fffdf1'],
    ice: ['#eaffff', '#a7e8ed', '#538bba', '#ffffff'],
    earth: ['#edd3a4', '#b58b57', '#63503d', '#fff0cb'],
    stone: ['#f3deb2', '#b7a489', '#62596c', '#fff0ce'],
    neutral: ['#fff4d6', '#f1c891', '#b58a8e', '#ffffff'],
    void: ['#f0eaff', '#b4a8e0', '#594d91', '#a6fff0']
  };
  // Exactly 24 move effects. Every move maps to one, by its role in the type's
  // roster (or a named exception); colours come from the move or its type.
  const MOVE_EFFECTS = Object.freeze(['seed','petals','roots','water-orbs','wave','ripples','ice','flame','fire-vortex','fire-lance','wind-blades','feathers',
    'vortex','crystals','star-rings','beam','impact','healing','shield','ascension','lightning','starfall','astral-rend','creation-nova']);
  const ROLE_EFFECTS = {
    pWeak:{leaf:'seed',tide:'water-orbs',ember:'flame',wind:'wind-blades',crystal:'crystals'},
    sWeak:{leaf:'seed',tide:'water-orbs',ember:'flame',wind:'feathers',crystal:'crystals'},
    pMid:{leaf:'roots',tide:'wave',ember:'fire-lance',wind:'wind-blades',crystal:'crystals'},
    sMid:{leaf:'petals',tide:'wave',ember:'fire-vortex',wind:'feathers',crystal:'star-rings'},
    pStrong:{leaf:'roots',tide:'wave',ember:'fire-lance',wind:'wind-blades',crystal:'crystals'},
    sStrong:{leaf:'petals',tide:'wave',ember:'fire-vortex',wind:'vortex',crystal:'star-rings'},
    sHeavy:{leaf:'petals',tide:'wave',ember:'creation-nova',wind:'vortex',crystal:'starfall'},
    pRecoil:{leaf:'impact',tide:'impact',ember:'impact',wind:'impact',crystal:'impact'},
    sDrain:{leaf:'roots',tide:'ripples',ember:'fire-vortex',wind:'feathers',crystal:'beam'},
    pDrain:{leaf:'roots',tide:'ripples',ember:'flame',wind:'feathers',crystal:'beam'},
    pPierce:{leaf:'roots',tide:'ice',ember:'fire-lance',wind:'lightning',crystal:'crystals'},
    sPierce:{leaf:'astral-rend',tide:'ice',ember:'astral-rend',wind:'lightning',crystal:'beam'}
  };
  const NAMED_EFFECTS = {nudge:'impact',pulse:'ripples',dawnstep:'impact',dew:'ripples',struggle:'impact',
    futo_breaker:'impact',futo_burst:'beam',arvelion_rend:'astral-rend',arvelion_nova:'creation-nova',
    verdant_lance:'seed',forest_crown:'petals',genesis_bloom:'roots',root_drain:'healing',sig_leaf:'petals',sig_tide:'astral-rend',sig_ember:'creation-nova',
    null_curse:'astral-rend',null_ray:'beam',null_scorch:'flame'};
  // ID-based variations keep Kiraseed's four techniques within the existing
  // material families; these same cue points drive their sound and HP timing.
  const KIRASEED_CUES={verdant_lance:{duration:1180,impactAt:.43},forest_crown:{duration:1100,impactAt:.45},
    genesis_bloom:{duration:1400,impactAt:.48},root_drain:{duration:1200,impactAt:.43}};
  const movePalettes = {
    futo_breaker:['#fff1fb','#ff8bcf','#913eb7','#ffecbd'],
    futo_burst:['#fff5ff','#ee7bda','#873ed4','#ffd6ed'],
    futo_ascend:['#fff1fb','#ffa1db','#a050cb','#ffe6ae'],
    futo_restore:['#fffaff','#efb7ed','#ab8ed1','#e2ffeb'],
    arvelion_rend:['#fff4ca','#ffc34c','#e65e24','#fff8e3'],
    arvelion_nova:['#fff3bd','#ffae32','#d94416','#fff8df'],
    arvelion_crown:['#fff2b2','#ffd159','#dc7c22','#fff8de'],
    arvelion_renewal:['#fff4ca','#ffc963','#e08a32','#fff9e9'],
    verdant_lance:['#f1ffd0','#a2dc61','#326a43','#fff8c6'],
    forest_crown:['#fff0d2','#d5a1df','#764c96','#ffe89e'],
    genesis_bloom:['#e4ffbd','#88bf59','#386643','#f6dda3'],
    root_drain:['#fbffd5','#b4e27d','#5c9460','#ffe5a4'],
    sig_leaf:['#fbffe0','#b6f26a','#2f9e4f','#ffe9a3'],
    sig_tide:['#eefcff','#7ee3ff','#1f6fd1','#fff2b8'],
    sig_ember:['#fff3d6','#ff9a3d','#c8331c','#ffe08a'],
    null_restore:['#f1edff','#b4a8e0','#594d91','#a6fff0'],
    null_ray:['#f5efff','#b2a0ef','#5a448e','#9dfff0'],
    null_scorch:['#ffeddc','#e7799e','#6c376f','#ffdf9b']
  };
  // Conditions show on the afflicted monster every turn they hold: when they land,
  // when they stop a move, as a damage tick, as an end-of-turn reminder, and when they end.
  const CONDITIONS = Object.freeze(['bloom','bubble','scorch','dizzy','crystal']);
  const VOLATILE_CONDITIONS = Object.freeze(['curse']);
  const CONDITION_ELEMENTS = {bloom:'leaf',bubble:'tide',scorch:'ember',dizzy:'wind',crystal:'crystal',curse:'void'};
  const CONDITION_NAMES = {bloom:'花毒',bubble:'水封',scorch:'灯焼け',dizzy:'目眩',crystal:'結晶化',curse:'呪縛'};
  const conditionPalettes = {
    bloom: ['#f6e6ff', '#b98ae6', '#6d3ea6', '#ff9fd6'],
    bubble: ['#effcff', '#7fd2f2', '#2f86c4', '#ffffff'],
    scorch: ['#fff1c7', '#ff9a4a', '#d4452a', '#ffe08a'],
    dizzy: ['#fffbe0', '#f2d65a', '#b98a1e', '#ffffff'],
    crystal: ['#fbf4ff', '#c8b2f4', '#7b62c8', '#fff9cf'],
    curse: ['#f5eaff', '#bb8be0', '#60377d', '#a6fff0']
  };
  const MOMENT_DURATION = {inflict:1100,blocked:1000,ongoing:950,tick:1000,cure:820};
  const CONDITION_INK = {bloom:'#3d1d63',bubble:'#164a73',scorch:'#6e1d10',dizzy:'#5a3d00',crystal:'#3b2c7a',curse:'#291a45'};
  const clamp = (n,a=0,b=1) => Math.max(a,Math.min(b,n));
  const ease = n => 1-Math.pow(1-clamp(n),3);
  const smooth = n => { n=clamp(n); return n*n*(3-2*n); };
  const phase = (t,a,b) => clamp((t-a)/(b-a));
  const hash = text => { let h=2166136261; for(const s of String(text))h=Math.imul(h^s.charCodeAt(0),16777619); return h>>>0; };
  const random = (seed,i) => { let n=Math.imul((seed+i*374761393)>>>0,668265263);n=(n^(n>>>13))>>>0;return n/4294967296; };
  const mixPoint = (a,b,t) => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  // Authored pixel clusters: dark silhouette, shaded body, material facets and
  // a restrained white highlight. These are small source sprites, not blurred
  // copies of a vector shape. One bounded cache serves every move and palette.
  const PIXEL_MOTIFS=Object.freeze({
    leaf:[
      '             00 ', '         0000330 ', '      001223330  ', '    0012233320   ',
      '   0122233220    ', '  0122333210     ', ' 01223322310     ', '01233322110      ',
      '0233322110       ', '033322110        ', '03221100         ', '001100           '
    ],
    feather:[
      '              0 ', '           0030 ', '         023330 ', '       0233430  ',
      '     02333430   ', '   023334330    ', ' 0233343230     ', '023334330       ',
      '003343230       ', ' 034330         ', '033230          ', '0030            '
    ],
    crystal:[
      '      0      ', '     030     ', '    02340    ', '   0233440   ',
      '  012334440  ', ' 01223344440 ', ' 01223344440 ', ' 01223344440 ',
      ' 01223344440 ', ' 01223334440 ', ' 01222334440 ', ' 01222334440 ',
      ' 01222334440 ', '  012233440  ', '  01223340   ', '   012340    ',
      '    0130     ', '     00      '
    ],
    rock:[
      '    00000    ', '  00233300   ', ' 0233344420  ', '023333442210 ',
      '023334222110 ', '0233322221110', '0123222211110', '0122222111110',
      '011222111110 ', ' 0112111110  ', '  01111000   ', '   0000      '
    ],
    droplet:[
      '      0      ', '     030     ', '     0340    ', '    02340    ',
      '   0233440   ', '  023344440  ', ' 02334444220 ', '023344442210 ',
      '0233444222110', '0233442222110', '0233322222110', '0232222222110',
      '0122222221110', '012222211110 ', ' 0111111100  ', '  00000000   '
    ],
    flame:[
      '        0         ', '       020        ', '       0230       ', '      02330       ',
      '     023330       ', '     023230  0    ', '    0232230 020   ', ' 0  023223002230  ',
      '0200232223222330  ', '0230232222222330  ', '02322322322223320 ', '02322223322223320 ',
      '02322233332223320 ', '02322334433223320 ', '02323344443323320 ', '01233444444333210 ',
      ' 012344444433210  ', '  0123444433210   ', '   01233332100    ', '     0000000      '
    ],
    glint:[
      '       0       ', '      030      ', '      030      ', '     02320     ',
      '    0233320    ', '   023343320   ', ' 0233344433320 ', '033344444443330',
      ' 0233344433320 ', '   023343320   ', '    0233320    ', '     02320     ',
      '      030      ', '      030      ', '       0       '
    ]
  });
  const motifCache=new Map(),MOTIF_CACHE_LIMIT=96;
  const shade=(hex,factor)=>/^#[\da-f]{6}$/i.test(hex)?'#'+hex.slice(1).match(/../g).map(v=>Math.round(parseInt(v,16)*factor).toString(16).padStart(2,'0')).join(''):hex;
  function materialSprite(c,kind,palette){
    const rows=PIXEL_MOTIFS[kind];if(!rows)return null;
    const key=kind+':'+palette.join(':');
    if(motifCache.has(key)){const value=motifCache.get(key);motifCache.delete(key);motifCache.set(key,value);return value;}
    const width=Math.max(...rows.map(row=>row.length)),height=rows.length;
    let cv;
    try{
      const doc=c.canvas?.ownerDocument||globalThis.document;
      if(doc?.createElement)cv=doc.createElement('canvas');
      else if(typeof globalThis.OffscreenCanvas==='function')cv=new globalThis.OffscreenCanvas(width,height);
      // The offline renderer also supplies a constructible canvas. Browsers use
      // ownerDocument above and never require a native HTMLCanvas constructor.
      else if(c.canvas?.constructor)cv=new c.canvas.constructor(width,height);
      if(!cv?.getContext)return null;
      cv.width=width;cv.height=height;
      const cc=cv.getContext('2d');if(!cc)return null;
      const colors=[shade(palette[2],.64),palette[2],palette[1],palette[0],palette[3]];
      rows.forEach((row,y)=>{
        for(let x=0;x<row.length;){const value=row[x],start=x;while(x<row.length&&row[x]===value)x++;
          if(value===' ')continue;cc.fillStyle=colors[Number(value)];cc.fillRect(start,y,x-start,1);
        }
      });
    }catch(_){return null;}
    motifCache.set(key,cv);while(motifCache.size>MOTIF_CACHE_LIMIT)motifCache.delete(motifCache.keys().next().value);
    return cv;
  }
  function pixelMaterial(c,kind,x,y,width,height,angle,palette,alpha=1){
    if(width<=0||height<=0||alpha<=0)return true;
    const sprite=materialSprite(c,kind,palette);if(!sprite)return false;
    c.save();c.globalAlpha*=clamp(alpha);c.imageSmoothingEnabled=false;c.translate(Math.round(x),Math.round(y));c.rotate(angle);
    c.drawImage(sprite,-Math.round(width/2),-Math.round(height/2),Math.max(1,Math.round(width)),Math.max(1,Math.round(height)));c.restore();return true;
  }
  // One optional transparent 4 × 2 sheet, requested only for a battle. A slow
  // download never blocks a move; all families retain the authored pixel and
  // procedural layers above. A timeout releases callers but still adopts a
  // late load, without opening another concurrent image request.
  const accentBase=globalThis.document?.currentScript?.src||globalThis.document?.baseURI||'';
  const accent={image:null,state:'idle',promise:null,retryAt:0,timedOut:false};
  function preload(){
    if(accent.state==='loaded')return Promise.resolve(true);
    if(accent.state==='loading'||accent.state==='timed-out')return accent.promise;
    if(accent.state==='failed'&&Date.now()<accent.retryAt)return accent.promise;
    if(typeof globalThis.Image!=='function')return Promise.resolve(false);
    const image=accent.image=new globalThis.Image();accent.state='loading';accent.timedOut=false;
    let settled=false,finished=false,timer;
    accent.promise=new Promise(resolve=>{
      const release=ok=>{if(settled)return;settled=true;globalThis.clearTimeout?.(timer);resolve(ok);};
      const finish=ok=>{
        if(finished)return;finished=true;image.onload=null;image.onerror=null;
        accent.state=ok?'loaded':'failed';accent.retryAt=ok?0:Date.now()+30000;accent.timedOut=false;
        if(!ok)accent.image=null;release(ok);
      };
      image.onload=()=>finish(image.naturalWidth>=512&&image.naturalHeight>=256&&Math.abs(image.naturalWidth/image.naturalHeight-2)<.05);
      image.onerror=()=>finish(false);image.decoding='async';image.fetchPriority='low';
      timer=globalThis.setTimeout?.(()=>{accent.state='timed-out';accent.timedOut=true;release(false);},15000);
      try{image.src=accentBase&&typeof globalThis.URL==='function'?new globalThis.URL('assets/battle-effects-v32.png',accentBase).href:'assets/battle-effects-v32.png';}catch(_){finish(false);}
    });
    return accent.promise;
  }
  function accentCell(event){
    if(['faint','arrival','miss','condition'].includes(event.style))return -1;
    // The old sheet has no electrical, frost, soil or stone cell. Their authored
    // pixel materials stay readable without an unrelated decorative overlay.
    if(['thunder','ice','earth','stone'].includes(event.element))return -1;
    if(event.move?.startsWith('futo_'))return 6;
    if(event.style==='healing')return event.move==='arvelion_renewal'?5:7;
    if(['shield','ascension','capture','star-rings','starfall'].includes(event.style))return event.element==='leaf'?7:5;
    return {ember:0,tide:1,leaf:2,crystal:3,wind:4}[event.element]??5;
  }
  function drawAccent(c,event,x,y,s,t,size,low){
    const image=accent.image,cell=accentCell(event);if(accent.state!=='loaded'||!image||cell<0)return;
    const supportive=['healing','shield','ascension','capture'].includes(event.style);
    const progress=phase(t,supportive?.12:.36,supportive?.94:.94);
    const envelope=Math.sin(progress*Math.PI);if(envelope<=.01)return;
    const col=cell%4,row=Math.floor(cell/4),x0=Math.floor(col*image.naturalWidth/4),y0=Math.floor(row*image.naturalHeight/2);
    const width=Math.floor((col+1)*image.naturalWidth/4)-x0,height=Math.floor((row+1)*image.naturalHeight/2)-y0;
    const extent=(supportive?120:130)*s*size*(.66+ease(progress)*.4);
    const lift=(cell===0||cell===3?10:0)*s;
    c.save();c.globalAlpha*=envelope*(low?.26:supportive?.37:.44);c.imageSmoothingEnabled=false;
    c.translate(Math.round(x),Math.round(y-lift));
    // A drifting leaf/air orbit and expanding impact give each accent a phase;
    // upright fire, water and crystal retain their material's natural direction.
    if([2,4,5,6,7].includes(cell))c.rotate((progress-.5)*(cell===4?.5:.18));
    c.drawImage(image,x0,y0,width,height,-Math.round(extent/2),-Math.round(extent/2),Math.round(extent),Math.round(extent));c.restore();
  }
  const artStatus=()=>({state:accent.state,loaded:accent.state==='loaded',timedOut:accent.timedOut,sheets:accent.image?1:0,motifCache:motifCache.size,motifCacheLimit:MOTIF_CACHE_LIMIT});
  function resolveMove(event,fallback) {
    const moves=LT.DATA?.moves||{};
    if(event?.move&&moves[event.move])return moves[event.move];
    if(event?.moveId&&moves[event.moveId])return moves[event.moveId];
    const quoted=/「([^」]+)」/.exec(event?.text||'')?.[1];
    if(quoted){const found=Object.values(moves).find(m=>m.name===quoted);if(found)return found;}
    return event?.side==='enemy'||typeof event?.side==='number'?null:fallback;
  }
  function effectOf(move={}) {
    if(move.kind==='heal')return 'healing';
    if(move.kind==='guard')return 'shield';
    if(move.kind==='boost')return 'ascension';
    if(NAMED_EFFECTS[move.id])return NAMED_EFFECTS[move.id];
    if(move.element==='thunder')return 'lightning';
    if(move.element==='ice')return 'ice';
    if(move.element==='earth'||move.element==='stone')return move.category==='special'?'crystals':'impact';
    const byRole=ROLE_EFFECTS[move.role]?.[move.element];if(byRole)return byRole;
    return {leaf:'seed',tide:'water-orbs',ember:'flame',wind:'wind-blades',crystal:'crystals'}[move.element]||'impact';
  }
  function classify(move={},kind=move.kind) {
    if(kind==='faint')return 'faint';
    if(kind==='switch')return 'arrival';
    if(kind==='miss')return 'miss';
    if(kind==='capture'||kind==='caught'||kind==='resonate')return 'capture';
    if(kind==='recoil')return 'impact';
    if(kind==='heal')return 'healing';
    if(kind==='guard')return 'shield';
    if(kind==='boost')return 'ascension';
    return effectOf(move);
  }
  function conditionOf(event) {
    const known=kind=>CONDITIONS.includes(kind)||VOLATILE_CONDITIONS.includes(kind)?kind:null;
    if(event?.kind==='status'&&event.status==='cure')return known(event.was)||(/泡/.test(event.text||'')?'bubble':/結晶/.test(event.text||'')?'crystal':null);
    return known(event?.status);
  }
  function momentOf(event) {
    if(event.kind==='statusTick')return 'tick';
    if(event.status==='cure')return 'cure';
    return event.blocked||/動けない/.test(event.text||'')?'blocked':event.ongoing?'ongoing':'inflict';
  }
  function fromEvent(event,fallback=null,now=globalThis.performance?.now?.()||0) {
    if(event?.kind==='status'||event?.kind==='statusTick'){
      const condition=conditionOf(event);if(!condition)return null;
      const moment=momentOf(event),amount=moment==='tick'?(Number(event.amount)||Number(/(\d+)(?:のダメージ|ダメージ)/.exec(event.text||'')?.[1]||0)):0;
      return {kind:event.kind,style:'condition',condition,moment,move:'',element:CONDITION_ELEMENTS[condition],power:25,category:'status',
        releaseAt:.1,impactAt:.45,side:event.side??'ally',slot:event.slot||0,target:event.slot||0,amount,critical:false,
        started:now,duration:MOMENT_DURATION[moment],seed:hash('condition:'+condition+':'+moment+':'+(event.side??'ally')+':'+(event.slot||0))};
    }
    if(!event||!['damage','attack','heal','guard','boost','miss','capture','caught','resonate','recoil','faint','switch'].includes(event.kind))return null;
    if(event.kind==='heal' && (event.amount===0||/効果がなかった|満タン|満ちている/.test(event.text||'')))return null;
    if(event.kind==='boost' && event.changed===false)return null;
    const move=['faint','switch'].includes(event.kind)?{element:event.element}:resolveMove(event,fallback)||{element:event.element};
    const style=classify(move,event.kind),large=(move.power||0)>=40;
    const cue=['damage','attack','heal'].includes(event.kind)?KIRASEED_CUES[move.id||event.move]:null;
    const amount=Number.isFinite(event.amount)?event.amount:Number(/(\d+)(?:のダメージ|ダメージ)/.exec(event.text||'')?.[1]||/(?:体力が|HPが)(\d+)/.exec(event.text||'')?.[1]||0);
    return {kind:event.kind,style,move:move.id||event.move||'',element:event.element||move.element||'neutral',
      raised:event.raised,power:move.power||25,category:move.category||(['heal','guard','boost'].includes(event.kind)?'status':'special'),
      releaseAt:.14,impactAt:cue?.impactAt??.43,side:event.side??'ally',slot:event.slot||0,target:event.target||0,
      amount,critical:event.critical===true||/鮮やかな一撃|急所/.test(event.text||''),effectiveness:event.effectiveness,
      started:now,duration:cue?.duration??(event.kind==='faint'?950:event.kind==='switch'?650:event.kind==='miss'?720:event.kind==='boost'?1400:event.kind==='heal'||event.kind==='guard'?1050:large?1180:940),
      seed:hash((move.id||event.text||style)+':'+(event.side??'ally')+':'+(event.slot||0))};
  }
  function anchors(width,height,e,options={}) {
    const online=options.online===true,me=options.side===1?1:0,doubled=options.double===true;
    const own=online?(e.side===me):(e.side!=='enemy');
    const inset=Math.max(0,Math.min(.4,Number(globalThis.LT?.battleInset)||0));
    function at(ours,slot=0) {
      return {x:width*(doubled?(ours?(slot===1?.47:.19):(slot===1?.82:.57)):(ours?.28:.73)),
        y:height*(doubled?(ours?.75:.37):((ours?.71:.42)-(online?0:inset)*.3))};
    }
    const source=at(own,e.slot),self=['heal','guard','boost','recoil','faint','switch','status','statusTick'].includes(e.kind);
    return {source,target:self?source:at(!own,e.target),own};
  }
  function motionReduced(options) {
    return options.reducedMotion===true || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true
      || globalThis.document?.documentElement?.classList?.contains('reduce-motion')===true
      || globalThis.document?.body?.classList?.contains('reduce-motion')===true;
  }
  function paintLabel(c,label) {
    c.save();
    try {
      c.globalAlpha=label.alpha;c.lineCap='square';c.lineJoin='miter';
      c.font=label.font;c.textAlign='center';c.textBaseline='middle';
      c.lineWidth=label.width;c.strokeStyle=label.ink;c.fillStyle=label.fill;
      c.strokeText(label.text,label.x,label.y);c.fillText(label.text,label.x,label.y);
    } finally { c.restore(); }
  }
  // Only effect art enters the transparent pixel layer. Labels and numbers
  // retain the display's native resolution, and the battle beneath is never
  // copied or resampled. Without the optional helper, the normal renderer works.
  function render(c,w,h,time,event,options={}) {
    if(!c||!event||event.kind==='text'||!Number.isFinite(time))return false;
    const reduced=motionReduced(options),duration=clamp(Number(event.duration)||940,300,2400),progress=(time-event.started)/duration;
    if(reduced&&!(event.style==='condition'&&event.condition==='curse')||progress<0||progress>1)return false;
    const layer=LT.ScenePixels?.layer;
    if(typeof layer!=='function')return renderPass(c,w,h,time,event,options);
    const presentation={labels:[],layered:true};let rendered=false,painted=false;
    c.save();
    try {
      // The original renderer uses physical canvas coordinates and owns its
      // effect opacity; caller transforms/alpha must not move or dim this pass.
      c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;
      painted=layer(c,w,h,{long:768},target=>{rendered=renderPass(target,w,h,time,event,options,presentation);});
    } catch(_) { painted=false; }
    finally { c.restore(); }
    if(!painted)return renderPass(c,w,h,time,event,options);
    if(rendered&&presentation.labels.length){
      c.save();
      try {
        c.setTransform(1,0,0,1,0,0);c.beginPath();c.rect(0,0,w,h);c.clip();
        for(const label of presentation.labels)paintLabel(c,label);
      } finally { c.restore(); }
    }
    return rendered;
  }
  function renderPass(c,w,h,time,event,options={},presentation=null) {
    if(!c||!event||event.kind==='text'||!Number.isFinite(time))return false;
    const reduced=motionReduced(options);
    // Curse keeps a quiet, stationary ghost when motion is reduced. Every
    // other effect retains its existing reduced-motion behavior.
    if(reduced&&!(event.style==='condition'&&event.condition==='curse'))return false;
    const duration=clamp(Number(event.duration)||940,300,2400),progress=(time-event.started)/duration;
    if(progress<0||progress>1)return false;
    const t=reduced?.5:progress;
    const e=event.style?event:{...event,style:classify(resolveMove(event)||{element:event.element},event.kind)};
    const {source,target,own}=anchors(w,h,e,options),p=e.style==='condition'?conditionPalettes[e.condition]||palettes.neutral:movePalettes[e.move]||palettes[e.element]||palettes.neutral;
    const quality=options.quality||'balanced',low=quality==='low'||w<600;
    const budget=budgets[low?'low':quality==='high'?'high':'balanced'];
    const count=budget.particles,seed=e.seed||hash(e.move||e.style);
    const unit=Math.min(w/768,h/440),s=Math.max(.4,unit),size=(e.power>=40?1.28:1)*(e.critical?1.08:1);
    const fade=smooth(t/.1)*(1-smooth((t-.78)/.22)),travel=ease(phase(t,.12,.46)),burst=ease(phase(t,.42,1));
    const hitAlpha=Math.sin(phase(t,.4,1)*Math.PI),cx=target.x,cy=target.y;
    const direction=Math.atan2(cy-source.y,cx-source.x);
    const point=mixPoint(source,target,travel),q=low?2:1;
    const snap=n=>Math.round(n/q)*q;
    c.save();if(!presentation?.layered)c.setTransform(1,0,0,1,0,0);c.beginPath();c.rect(0,0,w,h);c.clip();
    c.globalAlpha=fade;c.lineCap='square';c.lineJoin='miter';c.imageSmoothingEnabled=false;
    if(accentCell(e)>=0){if(!low)void preload();drawAccent(c,e,cx,cy,s,t,size,low);}
    const stroke=(points,color,width=2,alpha=1,close=false)=>{
      c.save();c.globalAlpha*=clamp(alpha);c.strokeStyle=color;c.lineWidth=width*s;
      c.beginPath();points.forEach((v,i)=>i?c.lineTo(snap(v[0]),snap(v[1])):c.moveTo(snap(v[0]),snap(v[1])));if(close)c.closePath();c.stroke();c.restore();
    };
    const ellipse=(x,y,rx,ry,color,width=2,alpha=1,start=0,end=TAU)=>{
      if(rx<=0||ry<=0)return;c.save();c.globalAlpha*=clamp(alpha);c.strokeStyle=color;c.lineWidth=width*s;
      c.beginPath();c.ellipse(x,y,rx,ry,0,start,end);c.stroke();c.restore();
    };
    const glow=(x,y,r,alpha=.45,color=p[1])=>{
      if(r<=0)return;const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(.25,color);g.addColorStop(1,color+'00');
      c.save();c.globalAlpha*=clamp(alpha);c.globalCompositeOperation='screen';c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2);c.restore();
    };
    const poly=(points,color,alpha=1)=>{
      c.save();c.globalAlpha*=clamp(alpha);c.fillStyle=color;c.beginPath();points.forEach((v,i)=>i?c.lineTo(snap(v[0]),snap(v[1])):c.moveTo(snap(v[0]),snap(v[1])));c.closePath();c.fill();c.restore();
    };
    const star=(x,y,r,color=p[3],rotation=0,alpha=1)=>{
      if(pixelMaterial(c,'glint',x,y,r*2,r*2,rotation,[p[0],color,p[2],p[3]],alpha))return;
      const points=[];for(let i=0;i<8;i++){const a=i*Math.PI/4+rotation,rr=i%2?r*.25:r;points.push([x+Math.cos(a)*rr,y+Math.sin(a)*rr]);}poly(points,color,alpha);
    };
    const shard=(x,y,len,angle,color=p[1],alpha=1)=>{
      if(pixelMaterial(c,'crystal',x,y,len*.78,len*1.85,angle+Math.PI/2,[p[0],color,p[2],p[3]],alpha))return;
      const dx=Math.cos(angle),dy=Math.sin(angle),rr=len*.24;
      poly([[x+dx*len,y+dy*len],[x-dy*rr,y+dx*rr],[x-dx*len*.7,y-dy*len*.7],[x+dy*rr,y-dx*rr]],color,alpha);
      stroke([[x-dx*len*.55,y-dy*len*.55],[x+dx*len*.75,y+dy*len*.75]],p[3],1,alpha*.8);
    };
    const rock=(x,y,r,angle=0,alpha=1)=>{
      if(r<=0||alpha<=0)return;
      if(pixelMaterial(c,'rock',x,y,r*2.1,r*1.8,angle,p,alpha))return;
      // Canvas factories can be unavailable in embedders and test contexts.
      // Keep a complete, faceted fallback without reading any source pixels.
      const points=[],lengths=[1,.83,.96,.77,.93,.86];
      for(let i=0;i<6;i++){const a=angle+i*TAU/6;points.push([x+Math.cos(a)*r*lengths[i],y+Math.sin(a)*r*.85*lengths[i]]);}
      poly(points,p[1],alpha);stroke(points,p[2],2.2,alpha,true);
      poly([points[0],points[1],[x,y],points[5]],p[0],alpha*.8);
      poly([points[2],points[3],points[4],[x,y]],p[2],alpha*.65);
    };
    const leaf=(x,y,r,angle,color=p[1],alpha=1)=>{
      if(pixelMaterial(c,e.element==='wind'?'feather':'leaf',x,y,r*2.25,r*1.7,angle+Math.PI/4,[p[0],color,p[2],p[3]],alpha))return;
      c.save();c.translate(x,y);c.rotate(angle);c.globalAlpha*=clamp(alpha);c.fillStyle=color;
      c.beginPath();c.moveTo(-r,0);c.quadraticCurveTo(0,-r,r,0);c.quadraticCurveTo(0,r,-r,0);c.fill();c.strokeStyle=p[0];c.lineWidth=s;c.beginPath();c.moveTo(-r*.65,0);c.lineTo(r*.6,0);c.stroke();c.restore();
    };
    const sparks=(x,y,n=count,radius=80*s*size,color=p[1])=>{
      for(let i=0;i<n;i++){const a=random(seed,i)*TAU,dist=(.2+.8*random(seed,i+33))*radius*burst,xx=x+Math.cos(a)*dist,yy=y+Math.sin(a)*dist*.72;
        const r=(2+random(seed,i+77)*3)*s*(1-burst*.6);star(xx,yy,r,i%3?p[0]:color,a+t,.8*hitAlpha);
      }
    };
    const impactRing=(radius=70*s*size)=>{
      if(t<.4)return;glow(cx,cy,radius*.85,hitAlpha*.33);
      ellipse(cx,cy,radius*burst,radius*.64*burst,p[0],2,(1-burst)*.8);
      ellipse(cx,cy,radius*.76*burst,radius*.49*burst,p[1],1,(1-burst)*.5);
    };
    const trail=(a,b,width=5)=>{stroke([[a.x,a.y],[b.x,b.y]],p[2],width*2,.24);stroke([[a.x,a.y],[b.x,b.y]],p[1],width,.75);stroke([[a.x,a.y],[b.x,b.y]],p[0],Math.max(1,width*.23),.95);};

    // Soft filled ribbons provide continuous body and taper. The halo and
    // bright spine use the same path, so fast projectiles stay readable.
    const ribbon=(points,width,color,alpha=1)=>{
      if(points.length<2||width<=0||alpha<=0)return;
      const left=[],right=[];
      for(let i=0;i<points.length;i++){
        const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)];
        const angle=Math.atan2(b[1]-a[1],b[0]-a[0])+Math.PI/2;
        const taper=Math.sin(Math.PI*(i+.18)/(points.length-.64));
        const r=width*s*Math.max(.035,taper);
        left.push([points[i][0]+Math.cos(angle)*r,points[i][1]+Math.sin(angle)*r]);
        right.push([points[i][0]-Math.cos(angle)*r,points[i][1]-Math.sin(angle)*r]);
      }
      poly(left.concat(right.reverse()),color,alpha);
      stroke(points,p[0],Math.max(.7,width*.18),alpha*.7);
    };
    const curvedTrail=(a,b,bend,width,color=p[1],alpha=1)=>{
      const points=[],angle=Math.atan2(b.y-a.y,b.x-a.x),nx=-Math.sin(angle),ny=Math.cos(angle);
      for(let i=0;i<=budget.ribbonSteps;i++){
        const u=i/budget.ribbonSteps,pt=mixPoint(a,b,u),bulge=Math.sin(u*Math.PI)*bend;
        points.push([pt.x+nx*bulge,pt.y+ny*bulge]);
      }
      ribbon(points,width,color,alpha);
    };
    const mote=(x,y,r,color,alpha=1)=>{
      if(r<=0||alpha<=0)return;c.save();c.globalAlpha*=clamp(alpha);c.fillStyle=color;
      c.beginPath();c.ellipse(x,y,r,r*.72,0,0,TAU);c.fill();c.restore();
    };
    // Rounded, tapering tongues distinguish Arvelion's living lamp-fire from
    // crystalline shards. The same deterministic path serves all four moves.
    const lampFlame=(x,y,r,lean=0,color=p[1],alpha=1)=>{
      if(pixelMaterial(c,'flame',x,y-r*.48,r*1.85,r*2.25,lean*.28,[p[0],color,p[2],p[3]],alpha))return;
      if(r<=0||alpha<=0)return;c.save();c.globalAlpha*=clamp(alpha);
      c.fillStyle=color;c.beginPath();c.moveTo(x,y+r*.45);
      c.quadraticCurveTo(x-r,y+r*.16,x-r*.55,y-r*.6);
      c.quadraticCurveTo(x-r*.15,y-r*.35,x+lean*r,y-r*1.7);
      c.quadraticCurveTo(x+r*.9,y-r*.6,x+r*.55,y+r*.06);
      c.quadraticCurveTo(x+r*.3,y+r*.5,x,y+r*.45);c.fill();
      c.fillStyle=p[0];c.beginPath();c.moveTo(x-r*.22,y+r*.18);
      c.quadraticCurveTo(x-r*.2,y-r*.3,x+lean*r*.4,y-r*.7);
      c.quadraticCurveTo(x+r*.45,y-r*.1,x+r*.19,y+r*.22);c.closePath();c.fill();c.restore();
    };
    if(e.style==='condition'){condition();c.restore();return true;}
    // ── Conditions: a motif sized to the afflicted monster, drawn around and over it.
    // Shapes carry a dark outline so they read on pale and dark creatures alike.
    function condition(){
      c.globalAlpha=1; // the motif carries its own fade
      const inset=options.online?0:clamp(Number(globalThis.LT?.battleInset)||0,0,.4);
      const box=options.double?Math.min(w*.28,h*.52):own?Math.min(w*(options.online?.4:.38),h*(options.online?.68:.64)*(1-inset*.5)):Math.min(w*(options.online?.34:.32),h*(options.online?.57:.52)*(1-inset*.55));
      // The art fills its box from about 8% to 95% of its height and 9% to 91% of its width.
      const H=Math.max(16,box*.44),W=Math.max(14,box*.41),foot=cy+H,u=H/110,kind=e.condition,moment=e.moment||'ongoing',ink=CONDITION_INK[kind]||'#19253d';
      const env=smooth(t/.12)*(1-smooth((t-.82)/.18)),grow=moment==='inflict'?ease(phase(t,0,.4)):1;
      const hurt=!reduced&&moment==='tick'?Math.sin(phase(t,.36,.66)*Math.PI):0,cure=moment==='cure';
      const dot=(x,y,r,fill,alpha=1)=>{
        if(r<=0||alpha<=0)return;c.save();c.globalAlpha*=clamp(alpha);c.beginPath();c.arc(x,y,r,0,TAU);c.fillStyle=fill;c.fill();
        c.lineWidth=Math.max(1,r*.26);c.strokeStyle=ink;c.stroke();c.beginPath();c.arc(x-r*.34,y-r*.34,r*.27,0,TAU);c.fillStyle='#ffffff';c.fill();c.restore();
      };
      const star5=(x,y,r,fill,rotation=0,alpha=1)=>{
        if(r<=0||alpha<=0)return;c.save();c.globalAlpha*=clamp(alpha);c.beginPath();
        for(let i=0;i<10;i++){const a=rotation-Math.PI/2+i*Math.PI/5,rr=i%2?r*.46:r;if(i)c.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);else c.moveTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);}
        c.closePath();c.lineWidth=Math.max(1.2,r*.28);c.strokeStyle=ink;c.stroke();c.fillStyle=fill;c.fill();c.restore();
      };
      const veil=(alpha,color=p[1])=>{
        if(alpha<=0)return;const g=c.createRadialGradient(cx,cy-H*.1,H*.08,cx,cy-H*.1,H*1.1);g.addColorStop(0,color+'b0');g.addColorStop(.7,color+'60');g.addColorStop(1,color+'00');
        c.save();c.globalAlpha*=clamp(alpha);c.fillStyle=g;c.beginPath();c.ellipse(cx,cy-H*.1,W*1.05,H*1.1,0,0,TAU);c.fill();c.restore();
      };
      const flame=(x,y,r,lean,alpha)=>{lampFlame(x,y,r*1.28,lean,p[2],alpha*.9);lampFlame(x,y,r,lean,p[1],alpha);};
      const shardOutline=(points,fill,alpha)=>{
        if(alpha<=0)return;c.save();c.globalAlpha*=clamp(alpha);c.beginPath();points.forEach((v,i)=>i?c.lineTo(v[0],v[1]):c.moveTo(v[0],v[1]));c.closePath();
        c.fillStyle=fill;c.fill();c.lineWidth=Math.max(1,1.8*u);c.strokeStyle=ink;c.stroke();c.restore();
      };
      // Ground ring and, on a damage tick, a hurt pulse over the body.
      ellipse(cx,foot-H*.06,W*(.82+.08*Math.sin(t*TAU)),H*.17,p[1],2.4,env*.7);
      if(moment==='inflict'){const land=phase(t,0,.34);if(land<1)ellipse(cx,cy,W*(1.9-.85*ease(land)),H*(1.5-.45*ease(land)),p[0],3,(1-land)*env);}
      if(hurt>0){veil(hurt*.55,p[2]);ellipse(cx,cy,W*(.6+phase(t,.36,.8)*.6),H*(.55+phase(t,.36,.8)*.5),p[0],2.6,hurt);}
      if(kind==='bloom'){
        // Poison spores bubble up and pop over a violet veil; petals circle the body.
        veil(env*.4);
        for(let i=0,n=low?9:16;i<n;i++){
          const r0=random(seed,i),r1=random(seed,i+19),r2=random(seed,i+41),life=phase(t,r0*.45,r0*.45+.4);
          if(life<=0||life>=1)continue;
          const x=cx+(r1-.5)*W*1.6+Math.sin(life*TAU+i)*W*.06,y=cy+H*.55-life*H*1.55,rad=(5+r2*5)*u*(1-life*.25)*grow;
          if(life<.84)dot(x,y,rad,i%3?p[1]:p[2],env*.95);
          else{const pop=phase(life,.84,1);ellipse(x,y,rad*(1+pop*1.3),rad*(1+pop*1.3),p[3],2,(1-pop)*env);}
        }
        for(let i=0,n=low?3:5;i<n;i++){
          const a=t*TAU*.9+i*TAU/n,rr=W*(.95-.1*Math.sin(t*TAU+i))*(.4+.6*grow);
          leaf(cx+Math.cos(a)*rr,cy-H*.15+Math.sin(a)*rr*.3+(i%2?-1:1)*H*.14*Math.sin(t*TAU*.5+i),(9+(i%3)*2)*u*grow,a+Math.PI/2,i%2?p[3]:p[1],env);
        }
      }else if(kind==='bubble'){
        // The sealing bubble: tinted, wobbling, with a bright rim; it bursts when the condition ends.
        const by=cy-H*.04,form=moment==='inflict'?ease(phase(t,0,.36)):1,popAt=.3,pop=cure?phase(t,popAt,.8):0,shaking=cure&&t<popAt;
        const wob=Math.sin(t*TAU*(shaking?6:2))*(shaking?.07:.04),rx=W*1.12*(1+wob)*(.35+.65*form),ry=H*1.1*(1-wob)*(.35+.65*form);
        if(!cure||t<popAt){
          const g=c.createRadialGradient(cx-rx*.3,by-ry*.35,rx*.1,cx,by,Math.max(rx,ry));
          g.addColorStop(0,p[0]+'60');g.addColorStop(.7,p[1]+'38');g.addColorStop(1,p[1]+'90');
          c.save();c.globalAlpha*=env;c.fillStyle=g;c.beginPath();c.ellipse(cx,by,rx,ry,0,0,TAU);c.fill();c.restore();
          ellipse(cx,by,rx,ry,ink,4.2,env*.8);ellipse(cx,by,rx,ry,p[1],2.4,env);ellipse(cx,by,rx*.95,ry*.95,p[0],1.2,env*.7);
          ellipse(cx,by,rx*.76,ry*.76,p[3],4,env*.9,Math.PI*1.08,Math.PI*1.42);mote(cx-rx*.52,by-ry*.55,6*u,p[3],env);
        }else{
          const flash=1-smooth(phase(t,popAt,popAt+.18));glow(cx,by,Math.max(rx,ry)*1.1,flash*.55,p[0]);
          ellipse(cx,by,rx*(1+pop*.55),ry*(1+pop*.55),ink,5,(1-pop)*env*.6);ellipse(cx,by,rx*(1+pop*.55),ry*(1+pop*.55),p[1],3,(1-pop)*env);ellipse(cx,by,rx*(1+pop*.4),ry*(1+pop*.4),p[0],1.6,(1-pop)*env);
          for(let i=0,n=low?8:14;i<n;i++){
            const a=TAU*i/n+random(seed,i)*.4,dist=Math.min(W,H)*(1.05+ease(pop)*.75);
            dot(cx+Math.cos(a)*dist*W/Math.min(W,H),by+Math.sin(a)*dist*H/Math.min(W,H)+pop*pop*H*.4,(5+random(seed,i+7)*4)*u*(1-pop*.35),i%3?p[1]:p[0],(1-pop*.7)*env);
          }
        }
        for(let i=0,n=low?5:9;i<n;i++){
          const r0=random(seed,i+60),life=phase(t,r0*.5,r0*.5+.45);if(life<=0||life>=1||(cure&&t>popAt))continue;
          dot(cx+(random(seed,i+80)-.5)*W*1.3+Math.sin(life*TAU*1.5+i)*W*.05,cy+H*.6-life*H*1.3,(3+random(seed,i+90)*3)*u,p[1],env*(1-life*.6));
        }
      }else if(kind==='scorch'){
        // Flames flicker along the base and up the sides; embers rise off the burn.
        veil(env*.26,p[2]);
        for(let i=0,n=low?4:6;i<n;i++){
          const v=(i+.5)/n,x=cx+(v-.5)*W*1.75,base=foot-H*.08-Math.sin(v*Math.PI)*H*.3;
          const flick=.78+.22*Math.sin(t*TAU*3+i*1.7)+.1*Math.sin(t*TAU*5.3+i);
          flame(x,base,(14+9*Math.sin(v*Math.PI))*u*flick*grow,Math.sin(t*TAU*2+i)*.35,env);
        }
        for(const side of [-1,1]){const flick=.8+.2*Math.sin(t*TAU*3.4+side);flame(cx+side*W*.92,cy+H*.05,13*u*flick*grow,-side*.25,env*.9);}
        for(let i=0,n=low?6:11;i<n;i++){
          const r0=random(seed,i+30),life=phase(t,r0*.5,r0*.5+.45);if(life<=0||life>=1)continue;
          const x=cx+(random(seed,i+50)-.5)*W*1.5+Math.sin(life*TAU*1.5+i)*W*.08,y=foot-H*.3-life*H*1.5;
          star(x,y,(3+random(seed,i+70)*2.5)*u,i%3?p[3]:p[0],life*3,(1-life)*env);
        }
      }else if(kind==='dizzy'){
        // Outlined stars circle the head (the near ones larger) beside two swirls.
        const orbitY=cy-H*.9,orx=W*.68,ory=H*.18,spin=t*TAU*1.6,gather=moment==='inflict'?1+(1-ease(phase(t,0,.4)))*1.1:1;
        const stars=Array.from({length:low?3:4},(_,i)=>spin+i*TAU/(low?3:4)).sort((a,b)=>Math.sin(a)-Math.sin(b));
        for(const a of stars){
          const depth=Math.sin(a),x=cx+Math.cos(a)*orx*gather,y=orbitY+depth*ory*gather;
          star5(x,y,(13+depth*3.5)*u,depth>0?p[1]:p[2],a*1.2,env*(.75+.25*depth));
        }
        for(const side of [-1,1]){
          const points=[],steps=low?16:28;
          for(let j=0;j<=steps;j++){const v=j/steps,a=side*(-spin*1.3)+v*TAU*1.6,r=v*H*.2;points.push([cx+side*W*.72+Math.cos(a)*r,orbitY+H*.05+Math.sin(a)*r*.7]);}
          stroke(points,ink,4.2,env*.7);stroke(points,p[1],2.2,env);
        }
      }else if(kind==='curse'){
        // A round skull-ghost springs up, stretches in the air, then squashes
        // gently on landing. Its hollow face stays readable at mobile sizes.
        veil(env*.15,p[2]);
        const radius=Math.max(10,H*.32)*(.76+.24*grow),depart=cure?ease(phase(t,.2,.9)):0;
        const pose=at=>{
          const hop=reduced?.5:Math.abs(Math.sin(at*TAU*1.5)),spring=reduced?0:Math.cos(at*TAU*3)*.18*Math.exp(-at*.25);
          return {x:clamp(cx+W*.16+(reduced?0:Math.sin(at*TAU)*W*.07),radius*1.2+2,w-radius*1.6-2),
            y:clamp(cy-H*.4-hop*H*.32-depart*H*.65,radius*1.3+2,h-radius*1.8-2),sx:1+spring,sy:1-spring*.9,hop};
        };
        const ghost=(at,alpha,face=true)=>{
          if(alpha<=0)return;const shape=pose(at),r=radius;
          c.save();c.globalAlpha=clamp(alpha);c.translate(shape.x,shape.y);c.scale(shape.sx,shape.sy);c.lineJoin='round';c.lineCap='round';
          const outline=()=>{
            c.beginPath();c.moveTo(-r*.86,r*.43);
            c.bezierCurveTo(-r*1.13,-r*.22,-r*.9,-r*1.04,0,-r*1.06);
            c.bezierCurveTo(r*.94,-r*1.06,r*1.13,-r*.22,r*.84,r*.45);
            c.quadraticCurveTo(r*.7,r*.78,r*.99,r*1.02);c.quadraticCurveTo(r*1.16,r*1.2,r*1.42,r*1.03);
            c.quadraticCurveTo(r*1.13,r*1.75,r*.47,r*1.5);c.quadraticCurveTo(r*.19,r*1.29,-r*.06,r*1.49);
            c.quadraticCurveTo(-r*.33,r*1.64,-r*.53,r*1.31);c.quadraticCurveTo(-r*.9,r*1.12,-r*.86,r*.43);c.closePath();
          };
          outline();c.fillStyle=p[0];c.fill();c.strokeStyle=ink;c.lineWidth=Math.max(1.4,2.7*u);c.stroke();
          if(face){
            // The lavender underside and curling tail keep it a friendly ghost,
            // while two empty sockets, a nose and three short teeth read as a skull.
            c.save();outline();c.clip();c.fillStyle=p[1];c.globalAlpha*=.55;c.beginPath();c.moveTo(-r*.9,r*.44);
            c.quadraticCurveTo(-r*.15,r*.94,r*.74,r*.57);c.quadraticCurveTo(r*.72,r*1.3,r*1.4,r*1.08);
            c.lineTo(r*1.5,r*1.9);c.lineTo(-r,r*1.9);c.closePath();c.fill();c.restore();
            c.fillStyle=ink;
            for(const side of [-1,1]){c.beginPath();c.ellipse(side*r*.34,-r*.13,r*.2,r*.25,side*.12,0,TAU);c.fill();}
            c.beginPath();c.moveTo(0,r*.16);c.lineTo(-r*.12,r*.34);c.quadraticCurveTo(0,r*.4,r*.12,r*.34);c.closePath();c.fill();
            c.beginPath();c.moveTo(-r*.34,r*.48);c.quadraticCurveTo(0,r*.66,r*.34,r*.48);c.lineTo(r*.27,r*.76);c.quadraticCurveTo(0,r*.85,-r*.27,r*.76);c.closePath();c.fill();
            c.fillStyle='#fffaff';for(const x of [-.25,-.065,.12])c.fillRect(x*r,r*.51,r*.13,r*.2);
            c.strokeStyle='#ffffff';c.lineWidth=Math.max(1,3*u);c.beginPath();c.moveTo(-r*.56,-r*.58);c.quadraticCurveTo(-r*.33,-r*.82,-r*.08,-r*.81);c.stroke();
          }
          c.restore();
        };
        if(!reduced)for(let i=low?1:2;i>=1;i--)ghost(Math.max(0,t-i*.055),env*(1-depart)*(.17/i),false);
        const current=pose(t);
        ellipse(current.x,cy+H*.43,radius*(1.12-current.hop*.22),radius*.19,p[1],1.6,env*(1-depart)*.45);
        ghost(t,env*(1-depart));
      }else if(kind==='crystal'){
        // Outlined shards rise around the body inside a pale prism; they scatter when the crystal breaks.
        const form=moment==='inflict'?ease(phase(t,0,.45)):1,burst=cure?ease(phase(t,.16,.85)):0;
        if(cure){const flash=Math.sin(phase(t,.08,.4)*Math.PI);glow(cx,cy-H*.1,H*1.2,flash*.6,p[0]);ellipse(cx,cy-H*.05,W*(.9+burst*.8),H*(.9+burst*.7),p[1],3,(1-burst)*env);}
        const hex=[];for(let j=0;j<6;j++){const a=j*TAU/6+Math.PI/6;hex.push([cx+Math.cos(a)*W*1.08*form*(1+burst*.4),cy-H*.05+Math.sin(a)*H*1.05*form*(1+burst*.4)]);}
        poly(hex,p[1],env*.2*(1-burst));stroke(hex,ink,3.6,env*.6*(1-burst),true);stroke(hex,p[0],1.8,env*.8*(1-burst),true);
        for(let i=0,n=low?5:8;i<n;i++){
          const v=(i+.5)/n,x0=cx+(v-.5)*W*1.95,base=foot-H*.04-Math.sin(v*Math.PI)*H*.12,tall=H*(.5+.5*Math.sin(v*Math.PI))*(.8+.2*random(seed,i))*form;
          if(cure){
            const a=-Math.PI/2+(v-.5)*2.6,dist=burst*H*1.25,mx=x0+Math.cos(a)*dist,my=base-tall*.5+Math.sin(a)*dist,len=Math.max(tall*.42,H*.2)*(1-burst*.3),spin=a+burst*4*(i%2?1:-1);
            shardOutline([[mx+Math.cos(spin)*len,my+Math.sin(spin)*len],[mx-Math.sin(spin)*len*.32,my+Math.cos(spin)*len*.32],[mx-Math.cos(spin)*len*.7,my-Math.sin(spin)*len*.7],[mx+Math.sin(spin)*len*.32,my-Math.cos(spin)*len*.32]],i%2?p[1]:p[2],env*(1-burst*.45));
            continue;
          }
          const lean=(v-.5)*-.4,tipX=x0+lean*tall,tipY=base-tall,w0=W*.13*(.8+.4*random(seed,i+9));
          shardOutline([[x0-w0,base],[x0-w0*.75+(tipX-x0)*.72,base-tall*.72],[tipX,tipY],[x0+w0*.75+(tipX-x0)*.72,base-tall*.72],[x0+w0,base]],(i%2?p[1]:p[0])+'d0',env*.85);
          stroke([[x0,base],[tipX,tipY]],p[3],1.4,env*.9);
        }
        const sweep=phase(t,.25,.85);
        if(sweep>0&&sweep<1)star(cx-W*.6+sweep*W*1.2,cy-H*.25-Math.sin(sweep*Math.PI)*H*.4,12*u,p[3],t*4,env*Math.sin(sweep*Math.PI));
        if(cure)for(let i=0;i<(low?5:9);i++){const a=TAU*i/(low?5:9),r=H*(.4+burst*.95);star(cx+Math.cos(a)*r,cy-H*.1+Math.sin(a)*r*.7,9*u,p[3],a,env*(1-burst*.8));}
      }
      // A short label over the monster: its condition, "can't move", or the damage it took.
      const name=globalThis.LT?.DATA?.statuses?.[kind]?.name||globalThis.LT?.DATA?.volatileConditions?.[kind]?.name||CONDITION_NAMES[kind]||'';
      const label=moment==='tick'?(e.amount?String(e.amount):''):moment==='blocked'?'動けない':cure?'':name;
      if(label&&t>.3){
        const alpha=smooth(phase(t,.3,.42))*(1-smooth(phase(t,.84,1))),yy=Math.max(14*s,cy-H*1.12-ease(phase(t,.3,1))*14*s);
        const text={text:label,x:cx,y:yy,alpha:c.globalAlpha*alpha,font:`900 ${Math.max(12,Math.round(21*s))}px system-ui, sans-serif`,width:4*s,ink,fill:p[0]};
        if(presentation)presentation.labels.push(text);else paintLabel(c,text);
      }
    }
    const attack=!['healing','shield','ascension','capture','miss','faint','arrival'].includes(e.style);
    const charging=smooth(phase(t,0,.1))*(1-smooth(phase(t,.14,.34)));
    const bloom=Math.sin(phase(t,.4,.93)*Math.PI);
    const physical=e.category==='physical'||e.style==='impact';

    // Cast seals are broken into fine luminous segments and paired material
    // ornaments. The creature remains visible through their open centre; the
    // evolving concentric bands carry the charge without a screen flash.
    const seal=(x,y,radius,progress,alpha,ground=false)=>{
      if(alpha<=.01||radius<=0)return;
      const squash=ground?.32:.76,turn=(physical?-.35:.45)*progress;
      for(let i=0;i<budget.ornaments;i++){
        const a=i*TAU/budget.ornaments+turn,span=TAU/budget.ornaments*.68;
        ellipse(x,y,radius,radius*squash,p[i%2],1.25,alpha,a,a+span);
        if(!low)ellipse(x,y,radius*.83,radius*.83*squash,p[2],1,alpha*.6,a+.09,a+span-.09);
        const xx=x+Math.cos(a)*radius,yy=y+Math.sin(a)*radius*squash;
        const rr=(ground?2.6:3.8)*s;
        star(xx,yy,rr,p[0],a,alpha*.9);
      }
    };
    if(attack&&charging>.01){
      const radius=(28+(1-charging)*19)*s*size;
      seal(source.x,source.y+47*s,radius,t,charging*.65,true);
      if(!physical&&!low)seal(source.x,source.y,radius*.68,-t,charging*.38);
    }

    // Atmosphere is local to the two actors. No opaque or strobed full-screen
    // flash: preserve the arena, creature silhouettes and motion throughout.
    if(attack){
      c.save();c.globalCompositeOperation='screen';
      const lift=charging*.22+bloom*.16;
      glow(source.x,source.y,68*s,charging*.15,p[2]);
      glow(cx,cy,115*s*size,bloom*.13,p[2]);
      ellipse(source.x,source.y+46*s,(30+charging*19)*s,8*s,p[1],4,lift);
      ellipse(cx,cy+48*s,(36+bloom*27)*s,11*s,p[1],5,bloom*.22);
      c.restore();
      // A distinct charging motion for physical strikes and cast techniques.
      for(let i=0;i<(low?4:7);i++){
        const a=i*2.39996+random(seed,i+241)*.55;
        const radius=(16+(1-charging)*44)*s;
        const x=source.x+Math.cos(a)*radius,y=source.y+Math.sin(a)*radius*.7;
        if(physical)curvedTrail({x,y},{x:source.x+Math.cos(a)*12*s,y:source.y+Math.sin(a)*9*s},6*s,1.3,p[1],charging*.55);
        else {
          mote(x,y,2*s,p[0],charging*.85);
          curvedTrail({x:x+Math.cos(a+.5)*13*s,y:y+Math.sin(a+.5)*9*s},{x,y},3*s,.9,p[1],charging*.55);
        }
      }
    }

    // Each technique has one smooth illumination envelope, never a strobing full-screen flash.
    if(attack) {
      const charge=(1-smooth(phase(t,.14,.36)))*smooth(t/.12);
      glow(source.x,source.y,35*s,charge*.38);
      ellipse(source.x,source.y,23*s*charge,14*s*charge,p[1],1,charge*.65);
    }
    if((e.element==='earth'||e.element==='stone')&&attack){
      // Share the existing impact/crystal cue families, with soil and rock
      // materials instead of stars or gems. The gameplay clock stays .43.
      const floor=Math.min(h-8*s,cy+54*s),unfurl=ease(phase(t,.14,.43)),decay=1-smooth(phase(t,.68,.98));
      const impact=smooth(phase(t,.38,.47))*decay,scatter=ease(phase(t,.43,.96));
      const pierce=e.move==='atlas_leaf_7'||e.move==='galdoras_crown',drain=e.move==='atlas_crystal_5';
      if(pierce){
        for(let i=0,n=low?3:5;i<n;i++){
          const x=cx+(i-(n-1)/2)*23*s,rise=smooth(phase(t,.19+i*.022,.43+i*.022));
          const height=(43+random(seed,i+151)*35)*s*rise,width=(11+random(seed,i+156)*5)*s;
          const tip=x+(random(seed,i+159)-.5)*15*s;
          poly([[x-width,floor],[x-width*.62,floor-height*.62],[tip,floor-height],[x+width*.62,floor-height*.53],[x+width,floor]],p[1],decay);
          poly([[x,floor],[tip,floor-height],[x+width*.62,floor-height*.53],[x+width,floor]],p[2],decay*.85);
          stroke([[x-width*.62,floor-height*.62],[tip,floor-height],[x+width*.24,floor-height*.48]],p[0],1.8,decay);
        }
      }else if(drain){
        const reach=mixPoint({x:source.x,y:Math.min(h-8*s,source.y+49*s)},{x:cx,y:floor},unfurl);
        const path=[];
        for(let i=0;i<=8;i++){const pt=mixPoint({x:source.x,y:Math.min(h-8*s,source.y+49*s)},reach,i/8);path.push([pt.x,pt.y+(i%2?5:-4)*s]);}
        stroke(path,p[2],6,decay*.6);stroke(path,p[0],1.6,decay*.8);
        for(let i=0,n=low?5:8;i<n;i++){
          const progress=phase(t,.38+i*.025,.85+i*.018),pt=mixPoint({x:cx,y:floor},source,ease(progress));
          const alpha=Math.sin(progress*Math.PI)*decay;
          rock(pt.x,pt.y-Math.sin(progress*Math.PI)*29*s,(4+i%2*2)*s,progress*1.7+i,alpha);
        }
      }else{
        const shot=mixPoint(source,{x:cx,y:cy+12*s},unfurl),radius=(e.power>=40?24:13)*s;
        const alpha=1-smooth(phase(t,.45,.63));
        rock(shot.x,shot.y-Math.sin(unfurl*Math.PI)*23*s,radius,t*3,alpha);
        for(let i=0,n=low?3:5;i<n;i++){
          const tail=mixPoint(source,{x:cx,y:cy+12*s},Math.max(0,unfurl-(i+1)*.065));
          rock(tail.x,tail.y-Math.sin(unfurl*Math.PI)*23*s+(i%2?5:-5)*s,(3.5+i%2)*s,i+t,alpha*(.5-i*.06));
        }
      }
      for(let i=0,n=low?3:5;i<n;i++){
        const a=i*TAU/n+.24,reach=(17+scatter*61)*s;
        const end={x:cx+Math.cos(a)*reach,y:floor+Math.sin(a)*reach*.26};
        const crack=[[cx,floor],[cx+Math.cos(a+.13)*reach*.42,floor+Math.sin(a+.13)*reach*.12],[end.x,end.y]];
        stroke(crack,p[2],3.2,impact);stroke(crack,p[0],.9,impact*.7);
      }
      for(let i=0,n=low?8:14;i<n;i++){
        const a=random(seed,i+171)*TAU,r=(16+scatter*(38+random(seed,i+191)*33))*s;
        const x=cx+Math.cos(a)*r,y=floor+Math.sin(a)*r*.27-scatter*(1-scatter)*(65+random(seed,i+211)*50)*s;
        rock(x,y,(3+random(seed,i+221)*5)*s,scatter*3+i,impact*(1-scatter*.6));
      }
      // Square dust clusters keep the footprint sharp at either screen mode.
      c.save();c.globalAlpha*=impact*.42;c.fillStyle=p[1];
      for(let i=0,n=low?8:16;i<n;i++){
        const x=cx+(random(seed,i+231)-.5)*(58+scatter*120)*s,y=floor-5*s+(random(seed,i+251)-.5)*18*s-scatter*9*s;
        const r=(3+random(seed,i+271)*6)*s;c.fillRect(snap(x),snap(y),Math.max(1,Math.round(r*1.7)),Math.max(1,Math.round(r)));
      }
      c.restore();
    }else switch(e.style) {
      case 'faint': {
        const outward=ease(t),alpha=1-smooth(phase(t,.32,1));
        ellipse(cx,cy+38*s,(22+outward*45)*s,(7+outward*11)*s,p[1],2,alpha*.7);
        for(let i=0;i<(low?8:14);i++){
          const a=TAU*i/(low?8:14),r=(12+outward*(24+random(seed,i)*26))*s;
          mote(cx+Math.cos(a)*r,cy+18*s+Math.sin(a)*r*.4-outward*34*s,(2+random(seed,i+20)*2)*s,p[i%3],alpha);
        }
        break;
      }
      case 'arrival': {
        const expand=ease(t),alpha=Math.sin(t*Math.PI);
        glow(cx,cy,45*s,alpha*.35);
        ellipse(cx,cy+38*s,(12+expand*46)*s,(5+expand*14)*s,p[1],2,alpha);
        for(let i=0;i<(low?6:10);i++){
          const a=TAU*i/(low?6:10),r=(12+expand*42)*s;
          star(cx+Math.cos(a)*r,cy+Math.sin(a)*r*.7,3*s,p[3],a,alpha);
        }
        break;
      }
      case 'astral-rend': {
        // Keep the stable choreography key while showing three golden flame
        // talons: tapered trails with rising embers and a single impact bloom.
        const turn=cx>source.x?1:-1;
        for(let claw=0;claw<3;claw++){
          const progress=ease(phase(t,.13+claw*.05,.48+claw*.05));
          const opacity=smooth(phase(t,.1+claw*.05,.22+claw*.05))*(1-smooth(phase(t,.64,1)));
          const points=[];
          for(let j=0;j<=budget.ribbonSteps;j++){
            const u=j/budget.ribbonSteps*progress,a=(u-.5)*Math.PI;
            points.push([cx+turn*((u-.5)*154+claw*12-12)*s,cy+(Math.sin(a)*59+Math.sin(u*Math.PI)*28+claw*17-17)*s]);
          }
          ribbon(points,10-claw*1.2,p[2],opacity*.24);
          ribbon(points,3.6,p[1],opacity*.85);
          stroke(points,p[0],1.4,opacity);
          const tip=points[points.length-1];
          if(e.element==='leaf')leaf(tip[0],tip[1],13*s,turn>0?-.35:Math.PI+.35,p[1],opacity);
          else if(e.element==='tide')shard(tip[0],tip[1],14*s,turn>0?-.35:Math.PI+.35,p[1],opacity);
          else lampFlame(tip[0],tip[1],9*s,turn*.6,p[1],opacity);
          for(let ember=0;ember<3;ember++){
            const point=points[Math.floor((points.length-1)*(ember+1)/4)];
            if(e.element==='leaf')leaf(point[0],point[1]-phase(t,.4,.95)*25*s,(4+ember)*s,ember+t,p[1],opacity*.55);
            else if(e.element==='tide')pixelMaterial(c,'droplet',point[0],point[1]+phase(t,.4,.95)*25*s,(5+ember)*s,(8+ember)*s,0,p,opacity*.65);
            else lampFlame(point[0],point[1]-phase(t,.4,.95)*25*s,(3+ember)*s,-turn*.3,p[1],opacity*.55);
          }
        }
        impactRing(108*s);sparks(cx,cy,Math.floor(count*.65),102*s);break;
      }
      case 'creation-nova': {
        const charge=smooth(phase(t,.02,.18))*(1-smooth(phase(t,.23,.46)));
        const arrival=ease(phase(t,.18,.46)),center=mixPoint(source,target,arrival);
        const comet=1-smooth(phase(t,.48,.61));
        glow(source.x,source.y,69*s,charge*.4,p[2]);
        for(let orbit=0;orbit<3;orbit++){
          const radius=(24+orbit*10)*s;
          ellipse(source.x,source.y,radius,radius*(.35+orbit*.18),p[orbit],1.5,charge);
        }
        curvedTrail(source,center,25*s,14,p[2],comet*.20);
        curvedTrail(source,center,25*s,4.5,p[1],comet*.8);
        lampFlame(center.x,center.y,22*s,(cx>source.x?-1:1)*.6,p[1],comet);
        const expansion=ease(phase(t,.43,.91)),nova=Math.sin(phase(t,.4,1)*Math.PI);
        glow(cx,cy,(28+expansion*108)*s,nova*.36,p[1]);
        for(let ring=0;ring<3;ring++){
          const radius=(16+expansion*(64+ring*22))*s;
          ellipse(cx,cy,radius,radius*(.44+ring*.16),p[ring],3-ring*.7,nova*(1-ring*.15));
        }
        for(let ray=0;ray<(low?5:8);ray++){
          const a=ray*TAU/(low?5:8)+.2,r=(23+expansion*92)*s;
          const outer={x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r*.7};
          curvedTrail({x:cx,y:cy},outer,18*s,2.4,p[ray%3],nova*.7);
          lampFlame(outer.x,outer.y,(12+ray%3*4)*s,Math.cos(a)*.35,p[1],nova);
        }
        for(let plume=0;plume<(low?3:5);plume++){
          const spread=(plume-(low?1:2))*23*s;
          lampFlame(cx+spread,cy+25*s-expansion*36*s,(22+Math.sin(plume+1)*5)*s,Math.sin(plume)*.4,p[plume%2?2:1],nova*.75);
        }
        sparks(cx,cy,Math.floor(count*.55),120*s);break;
      }
      case 'seed':
      case 'water-orbs':
      case 'flame': {
        if(e.move==='verdant_lance'){
          const blades=low?3:5;
          for(let i=0;i<blades;i++){
            const delay=i*.024,flight=smooth(phase(t,.14+delay,.43+delay)),offset=(i-(blades-1)/2)*17*s;
            const at=u=>{const pos=mixPoint(source,target,u),arc=Math.sin(u*Math.PI)*offset+u*offset*.2;
              return {x:pos.x-Math.sin(direction)*arc,y:pos.y+Math.cos(direction)*arc};};
            const pos=at(flight),tail=at(Math.max(0,flight-.17)),alpha=smooth(phase(t,.1+delay,.2+delay))*(1-smooth(phase(t,.48+delay,.67+delay)));
            curvedTrail(tail,pos,offset*.14,3.8,p[2],alpha*.45);curvedTrail(tail,pos,offset*.14,1.6,p[0],alpha*.8);
            const angle=direction+Math.sin(flight*Math.PI)*.35+(i%2?1:-1)*t*.55;
            if(!low){const echo=at(Math.max(0,flight-.065));leaf(echo.x,echo.y,17*s,angle,p[0],alpha*.23);}
            leaf(pos.x,pos.y,(17+i%2*3)*s,angle,p[1],alpha);
          }
          const cut=smooth(phase(t,.4,.49))*(1-smooth(phase(t,.6,.84))),reach=(24+ease(phase(t,.4,.57))*31)*s;
          for(const sign of [-1,1])curvedTrail({x:cx-reach,y:cy-sign*reach*.66},{x:cx+reach,y:cy+sign*reach*.66},sign*9*s,2.6,p[0],cut);
          for(let i=0;i<(low?5:8);i++){
            const a=i*2.39996,drift=ease(phase(t,.43,.9)),r=(22+drift*52)*s;
            leaf(cx+Math.cos(a)*r,cy+Math.sin(a)*r*.62+drift*15*s,5*s,a+t*2,p[i%2],hitAlpha*.7);
          }
          impactRing(71*s);break;
        }
        const n=e.power>=40?7:5;
        for(let i=0;i<n;i++){
          const tt=ease(phase(t,.09+i*.038,.41+i*.038)),pos=mixPoint(source,target,tt),arc=Math.sin(tt*Math.PI)*(i-n/2)*10*s;
          const xx=pos.x+Math.sin(direction)*arc,yy=pos.y-Math.cos(direction)*arc;
          const alpha=1-smooth(phase(t,.46+i*.025,.66+i*.025));if(alpha<=0)continue;
          const prev=mixPoint(source,target,Math.max(0,tt-.13));trail(prev,{x:xx,y:yy},e.style==='flame'?5:3);
          glow(xx,yy,(e.style==='flame'?19:13)*s,.35*alpha);
          if(e.style==='seed')leaf(xx,yy,7*s,direction,p[1],alpha);
          else if(e.style==='flame'){lampFlame(xx,yy,12*s,Math.cos(direction)*.7,p[1],alpha);}
          else {pixelMaterial(c,'droplet',xx,yy,14*s,19*s,direction+Math.PI/2,p,alpha);ellipse(xx,yy,9*s,9*s,p[0],1,alpha*.65);}
        }impactRing();sparks(cx,cy);break;
      }
      case 'petals': {
        if(e.move==='forest_crown'){
          const spread=ease(phase(t,.36,.78)),gather=smooth(phase(t,.12,.26)),lift=phase(t,.46,.94);
          for(let i=0;i<count;i++){
            const flight=smooth(phase(t,.14+(i%3)*.025,.45+(i%3)*.025)),center=mixPoint(source,target,flight);
            const a=i*2.39996+t*.6,r=(7+spread*(22+random(seed,i)*43))*s;
            const x=center.x+Math.cos(a)*r,y=center.y+Math.sin(a)*r*.64-lift*(10+random(seed,i+34)*26)*s;
            const alpha=gather*(1-smooth(phase(t,.78,.98))),flower=i%(low?4:6)===0;
            if(flower){
              const petal=(6+random(seed,i+22)*3)*s;
              for(let k=0;k<5;k++){const turn=k*TAU/5+t*.8;leaf(x+Math.cos(turn)*petal*.8,y+Math.sin(turn)*petal*.65,petal*.72,turn,p[1],alpha*.9);}
              mote(x,y,petal*.45,p[2],alpha);mote(x-petal*.08,y-petal*.12,petal*.27,p[3],alpha);
            }else{
              const dust=(2.6+random(seed,i+12)*2.3)*s;
              mote(x,y,dust+1.1*s,p[2],alpha*.65);mote(x,y,dust,i%3?p[3]:p[0],alpha);
              if(!low)star(x-dust*.3,y-dust*.4,dust*.45,p[0],0,alpha*.6);
            }
          }
          glow(cx,cy-12*s,76*s,Math.sin(phase(t,.4,.98)*Math.PI)*.18,p[1]);
          ellipse(cx,cy+44*s,(25+spread*40)*s,(8+spread*12)*s,p[1],1.5,hitAlpha*.45);break;
        }
        for(let i=0;i<count;i++){const a=i*2.39996+t*TAU,r=(18+random(seed,i)*74)*s*size;
          const pos=mixPoint(source,target,ease(phase(t,.08,.48)));const spread=.2+.8*ease(phase(t,.28,.8));
          leaf(pos.x+Math.cos(a)*r*spread,pos.y+Math.sin(a)*r*.62*spread,(4+random(seed,i+20)*5)*s,a+t*2,i%4===0?'#ffc7df':i%3===0?p[3]:p[1],.9);
        }impactRing(91*s*size);break;
      }
      case 'roots': {
        if(e.move==='genesis_bloom'){
          const ground=cy+61*s,roots=low?3:5,rumble=smooth(phase(t,.09,.24))*(1-smooth(phase(t,.6,.91)));
          for(let i=0;i<(low?4:6);i++){
            const a=i*TAU/(low?4:6),r=(24+ease(phase(t,.1,.4))*52)*s;
            const crack=[[cx,ground],[cx+Math.cos(a)*r*.48,ground+Math.sin(a)*r*.13],[cx+Math.cos(a+.22)*r*.7,ground+Math.sin(a+.22)*r*.2],[cx+Math.cos(a)*r,ground+Math.sin(a)*r*.3]];
            stroke(crack,'#2b3524',5,rumble);stroke(crack,p[3],1.2,rumble*.7);
          }
          for(let i=0;i<roots;i++){
            const lane=i-(roots-1)/2,delay=Math.abs(lane)*.033,growth=ease(phase(t,.23+delay,.48+delay));
            const height=(171-Math.abs(lane)*21)*s,base=cx+lane*30*s,alpha=smooth(phase(t,.2+delay,.3+delay))*(1-smooth(phase(t,.77,.99)));
            const points=[];
            for(let k=0;k<=budget.ribbonSteps;k++){
              const u=k/budget.ribbonSteps*growth;
              points.push([base+Math.sin(u*3.8+lane*.7)*14*s+lane*u*8*s,ground-u*height]);
            }
            ribbon(points,22-Math.abs(lane)*2,'#283d2d',alpha);ribbon(points,16-Math.abs(lane)*1.4,'#796342',alpha);
            ribbon(points,9-Math.abs(lane)*.7,p[2],alpha);stroke(points,p[1],3.2,alpha*.85);
            const tip=points.at(-1);leaf(tip[0],tip[1]-7*s,15*s,-Math.PI/2+lane*.25,p[1],alpha*growth);
            for(let branch=1;branch<=(low?1:2);branch++){
              const u=(.3+branch*.2)*growth,at=points[Math.min(points.length-1,Math.round(u/Math.max(.001,growth)*budget.ribbonSteps))],sign=(i+branch)%2?-1:1;
              const end={x:at[0]+sign*27*s*growth,y:at[1]-22*s*growth};
              curvedTrail({x:at[0],y:at[1]},end,-sign*8*s,6,p[2],alpha);leaf(end.x,end.y,12*s,sign>0?-.5:Math.PI+.5,p[1],alpha*growth);
            }
          }
          const erupt=ease(phase(t,.46,.88)),soil=Math.sin(phase(t,.43,.97)*Math.PI);
          for(let i=0;i<(low?7:12);i++){
            const sign=i%2?-1:1,x=cx+sign*(12+erupt*(30+random(seed,i)*65))*s,y=ground-Math.sin(erupt*Math.PI)*(25+random(seed,i+40)*55)*s+erupt*16*s,r=(3+random(seed,i+60)*4)*s;
            poly([[x-r,y-r*.6],[x+r*.5,y-r],[x+r,y+r*.5],[x-r*.7,y+r]],i%2?'#7f6845':'#c4ab71',soil);
          }
          ellipse(cx,ground,(26+erupt*78)*s,(7+erupt*21)*s,p[3],3,soil*.6);impactRing(105*s);break;
        }
        const growth=ease(phase(t,.16,.62));
        for(let i=0;i<(low?5:8);i++){
          const offset=(i-(low?5:8)/2)*17*s,xx=cx+offset,base=cy+67*s;
          const points=[];for(let k=0;k<=18;k++){const g=k/18*growth;points.push([xx+Math.sin(g*6+i)*13*s,base-g*(110+random(seed,i)*35)*s]);}
          stroke(points,p[2],7,1-burst*.6);stroke(points,p[1],3,1-burst*.5);
          for(let k=1;k<4;k++){const g=k/4*growth;leaf(xx+Math.sin(g*6+i)*13*s,base-g*116*s,8*s,k%2?-.7:2.4,p[1],growth);}
        }ellipse(cx,cy+64*s,80*s*growth,18*s*growth,p[1],2,.75);impactRing();break;
      }
      case 'wave': {
        const pos=mixPoint(source,target,travel),surge=Math.sin(phase(t,.08,.9)*Math.PI);
        const normal={x:-Math.sin(direction),y:Math.cos(direction)};
        for(let row=3;row>=0;row--){
          const points=[];
          for(let i=0;i<=budget.ribbonSteps;i++){
            const u=i/budget.ribbonSteps,across=(u-.5)*126*s*size;
            const crest=Math.sin(u*Math.PI*1.8+t*2.4+row*.4)*(22+row*3)*s;
            points.push([pos.x+normal.x*across+Math.cos(direction)*(crest-row*13*s),pos.y+normal.y*across+Math.sin(direction)*(crest-row*13*s)]);
          }
          ribbon(points,10-row*1.4,row%2?p[1]:p[2],surge*(.55-row*.08));
          stroke(points,p[0],1.5,surge*.7);
        }
        for(let i=0;i<count;i++){
          const a=random(seed,i)*Math.PI,rr=burst*(45+random(seed,i+51)*74)*s;
          const xx=cx+Math.cos(a)*rr,yy=cy-Math.sin(a)*rr+burst*35*s;
          const droplet=(4+random(seed,i+90)*5)*s;
          pixelMaterial(c,'droplet',xx,yy,droplet*.8,droplet,Math.cos(a)*.45,p,hitAlpha*.85);
          if(i%3===0)curvedTrail({x:xx-6*s,y:yy-10*s},{x:xx,y:yy},2*s,1,p[1],hitAlpha*.45);
        }
        impactRing(90*s);break;
      }
      case 'ripples':
      case 'star-rings': {
        const center=mixPoint(source,target,travel);
        for(let i=0;i<4;i++){const tt=phase(t,.12+i*.07,.75+i*.07),r=(10+tt*88)*s*size,alpha=Math.sin(tt*Math.PI);
          ellipse(center.x,center.y,r,r*(e.style==='ripples'?.4:.74),p[i%3],i===0?4:2,alpha);
          if(e.style==='star-rings')for(let k=0;k<6;k++){const a=k*TAU/6+t*.9+i;star(center.x+Math.cos(a)*r,center.y+Math.sin(a)*r*.74,5*s,p[3],a,alpha);}
        }sparks(cx,cy,Math.floor(count*.6));break;
      }
      case 'ice':
      case 'crystals': {
        const n=low?7:11;
        for(let i=0;i<n;i++){
          const a=i*TAU/n,tt=ease(phase(t,.18+(i%3)*.03,.65)),rr=(1-tt)*120*s;
          const xx=cx+Math.cos(a)*rr,yy=cy+Math.sin(a)*rr*.7;
          shard(xx,yy,(12+tt*12)*s,a+Math.PI,p[i%3],1-smooth(phase(t,.7,1)));
          if(e.style==='ice'){const base=cy+58*s,x=cx+(i-n/2)*17*s;shard(x,base-tt*45*s,(15+tt*26)*s,-Math.PI/2,p[i%3],tt*(1-burst*.6));}
        }impactRing(86*s);sparks(cx,cy);break;
      }
      case 'fire-lance':
      case 'beam': {
        const focused=e.move==='futo_burst';
        const end=mixPoint(source,target,travel),width=Math.sin(phase(t,.08,.9)*Math.PI)*(focused?14:e.style==='beam'?21:15)*s*size;
        if(width>0){trail(source,end,width/s);glow(end.x,end.y,35*s,.45);}
        for(let i=0;i<3;i++){const tt=phase(t,.12+i*.08,.6+i*.08),pos=mixPoint(source,target,tt);
          ellipse(pos.x,pos.y,(13+tt*12)*s,(22+tt*16)*s,p[0],1,Math.sin(tt*Math.PI)*.7);
        }
        if(focused){
          const energy=Math.sin(phase(t,.08,.91)*Math.PI),perp={x:-Math.sin(direction),y:Math.cos(direction)};
          for(const sign of [-1,1]){
            const points=[];for(let j=0;j<=24;j++){const u=j/24,pos=mixPoint(source,end,u),offset=Math.sin(u*Math.PI)*13*s*sign;points.push([pos.x+perp.x*offset,pos.y+perp.y*offset]);}
            stroke(points,p[1],2,energy*.8);
          }
          for(let i=0;i<6;i++){const a=i*TAU/6+t*.5,r=(24+energy*8)*s;shard(source.x+Math.cos(a)*r,source.y+Math.sin(a)*r,5*s,a+Math.PI/2,p[1],energy*.8);}
          star(end.x,end.y,22*s*energy,p[0],direction,.85);
        }
        // Fine side facets stay off the bright spine, so the beam has a
        // readable core and moving edges instead of an opaque white bar.
        const filigree=Math.sin(phase(t,.16,.84)*Math.PI);
        for(let i=0;i<budget.ornaments;i++){
          const u=(t*.72+i/budget.ornaments)%1,pos=mixPoint(source,end,u);
          const side=i%2?-1:1,dist=(e.style==='beam'?17:12)*s*size*filigree;
          const x=pos.x-Math.sin(direction)*dist*side,y=pos.y+Math.cos(direction)*dist*side;
          if(e.style==='fire-lance')lampFlame(x,y,4.5*s,-side*.5,p[1],filigree*Math.sin(u*Math.PI));
          else shard(x,y,5*s,direction,p[0],filigree*Math.sin(u*Math.PI)*.7);
        }
        const current=Math.sin(phase(t,.1,.88)*Math.PI);
        if(current>0){
          c.save();c.globalCompositeOperation='screen';
          for(let strand=0;strand<(low?2:4);strand++){
            const points=[];
            for(let j=0;j<=budget.ribbonSteps;j++){
              const u=j/budget.ribbonSteps,pt=mixPoint(source,end,u);
              const offset=Math.sin(u*Math.PI)*Math.sin(u*TAU*1.5-t*7+strand*Math.PI*.5)*(focused?9:15)*s;
              points.push([pt.x-Math.sin(direction)*offset,pt.y+Math.cos(direction)*offset]);
            }
            ribbon(points,focused?1.8:2.5,strand%2?p[0]:p[1],current*.48);
          }
          c.restore();
          for(let i=0;i<(low?3:5);i++){
            const u=(t*1.6+i/5)%1,pt=mixPoint(source,end,u);
            mote(pt.x,pt.y,2.1*s,p[3],current*Math.sin(u*Math.PI));
          }
        }
        impactRing(95*s);sparks(cx,cy);break;
      }
      case 'fire-vortex':
      case 'vortex': {
        const growth=smooth(phase(t,.07,.32)),collapse=1-smooth(phase(t,.74,1)),r=66*s*size;
        const flame=e.style==='fire-vortex';
        glow(cx,cy-15*s,94*s,growth*collapse*.22,flame?p[1]:p[2]);
        for(let layer=0;layer<(low?4:6);layer++){
          const points=[];
          for(let j=0;j<=budget.ribbonSteps;j++){
            const g=j/budget.ribbonSteps,angle=g*TAU*1.5-t*4.2+layer*TAU/6;
            const rr=r*(.2+.8*g)*growth;
            points.push([cx+Math.cos(angle)*rr,cy+Math.sin(angle)*rr*.32+(g-.6)*118*s]);
          }
          ribbon(points,flame?5:3,layer%2?p[1]:p[2],collapse*(flame?.42:.32));
          stroke(points,p[0],1,collapse*.62);
        }
        for(let i=0;i<count;i++){
          const u=(t*.72+i/count)%1,a=i*2.4-t*4,rr=(15+u*58)*s;
          const x=cx+Math.cos(a)*rr,y=cy+50*s-u*130*s+Math.sin(a)*rr*.22;
          const alpha=Math.sin(u*Math.PI)*growth*collapse;
          if(flame){mote(x,y,(1.5+random(seed,i)*2)*s,p[i%3],alpha);curvedTrail({x:x-5*s,y:y+12*s},{x,y},3*s,1.4,p[1],alpha*.7);}
          else leaf(x,y,(3+random(seed,i)*3)*s,a,p[0],alpha*.7);
        }
        impactRing(95*s);break;
      }
      case 'wind-blades':
      case 'feathers': {
        for(let i=0;i<(e.style==='feathers'?8:3);i++){
          const tt=ease(phase(t,.08+i*.035,.46+i*.035)),pos=mixPoint(source,target,tt),offset=(i-(e.style==='feathers'?3.5:1))*19*s;
          if(e.style==='feathers')leaf(pos.x+Math.sin(direction)*offset,pos.y-Math.cos(direction)*offset,13*s,direction+.2,p[i%3],1-smooth(phase(t,.7,1)));
          else{const points=[];for(let k=0;k<=16;k++){const a=(k/16-.5)*Math.PI;points.push([pos.x+Math.cos(a+direction)*35*s,pos.y+Math.sin(a+direction)*35*s+offset]);}
            stroke(points,p[2],8,.3);stroke(points,p[0],3,.9);}
        }impactRing();sparks(cx,cy,Math.floor(count*.6));break;
      }
      case 'lightning': {
        const conducted=e.element==='thunder'&&e.category==='special';
        const end=phase(t,.08,.44),top=conducted?source:{x:cx-35*s,y:Math.max(0,cy-190*s)},bottom={x:cx,y:cy+(conducted?0:30*s)};
        const points=[],steps=low?8:12,angle=Math.atan2(bottom.y-top.y,bottom.x-top.x);
        for(let i=0;i<=steps;i++){
          const f=i/steps*end,jitter=i===0||i===steps?0:(random(seed,i)-.5)*48*s;
          points.push([top.x+(bottom.x-top.x)*f+(conducted?-Math.sin(angle)*jitter:jitter),top.y+(bottom.y-top.y)*f+(conducted?Math.cos(angle)*jitter:0)]);
        }
        const energy=1-smooth(phase(t,.55,.92));stroke(points,p[2],15,energy*.22);stroke(points,e.element==='thunder'?p[0]:'#f7d9ff',5,energy);stroke(points,p[3],1.3,energy);
        for(let i=0;i<3;i++){const b=points[Math.min(points.length-1,4+i*2)];stroke([b,[b[0]+(i%2?30:-30)*s,b[1]+20*s],[b[0]+(i%2?50:-40)*s,b[1]+43*s]],p[1],2,energy*.7);}
        impactRing(90*s);sparks(cx,cy);break;
      }
      case 'starfall': {
        const n=low?5:8;
        for(let i=0;i<n;i++){const tt=ease(phase(t,.07+i*.04,.48+i*.04)),xx=cx+(random(seed,i)-.5)*95*s,yy=cy+(random(seed,i+10)-.5)*42*s;
          const start={x:xx-85*s,y:Math.max(-40*s,yy-200*s)},pos=mixPoint(start,{x:xx,y:yy},tt),prev=mixPoint(start,{x:xx,y:yy},Math.max(0,tt-.24));
          trail(prev,pos,3);star(pos.x,pos.y,8*s,p[0],.4,1-smooth(phase(t,.64+i*.02,.9+i*.01)));
        }impactRing(105*s);sparks(cx,cy);break;
      }
      case 'healing': {
        if(e.move==='root_drain'){
          const shine=Math.sin(phase(t,.04,.97)*Math.PI),sun={x:cx+(own?-22:22)*s,y:Math.max(22*s,cy-137*s)},radius=18*s;
          for(let i=0;i<3;i++){
            const spread=(i-1)*23*s,top=9*s,bottom=(14+i*4)*s;
            poly([[sun.x-top+spread*.15,sun.y],[sun.x+top+spread*.15,sun.y],[cx+spread+bottom,cy+49*s],[cx+spread-bottom,cy+49*s]],p[3],shine*.14);
          }
          glow(sun.x,sun.y,46*s,shine*.45,p[3]);
          c.save();c.globalAlpha*=shine;c.fillStyle=p[3];c.strokeStyle='#98773a';c.lineWidth=1.5*s;
          c.beginPath();c.arc(sun.x,sun.y,radius,0,TAU);c.fill();c.stroke();c.restore();
          mote(sun.x-4*s,sun.y-4*s,radius*.56,p[0],shine*.8);
          for(let i=0;i<(low?6:8);i++){
            const a=i*TAU/(low?6:8)+t*.12;
            stroke([[sun.x+Math.cos(a)*radius*1.35,sun.y+Math.sin(a)*radius*1.35],[sun.x+Math.cos(a)*radius*1.8,sun.y+Math.sin(a)*radius*1.8]],p[3],2.5,shine*.75);
          }
          glow(cx,cy,66*s,shine*.25,p[1]);seal(cx,cy+49*s,61*s,smooth(t),shine*.55,true);
          for(let i=0;i<(low?8:14);i++){
            const rise=(t*.95+i/(low?8:14))%1,a=i*2.39996+rise*1.3,r=(26+random(seed,i)*27)*s,alpha=Math.sin(rise*Math.PI)*shine;
            leaf(cx+Math.cos(a)*r,cy+49*s-rise*119*s,(6+random(seed,i+24)*4)*s,a-.8,p[i%2],alpha);
          }
          for(const sign of [-1,1])star(cx+sign*26*s,cy-15*s,6*s,p[0],0,shine*.8);
          ellipse(cx,cy+48*s,(32+ease(t)*23)*s,(9+ease(t)*7)*s,p[1],2,shine*.65);break;
        }
        for(let i=0;i<3;i++){const r=(25+i*17)*s*(.8+.2*smooth(t/.3));ellipse(cx,cy+48*s-i*4*s,r,r*.3,p[i],2,.65);}
        glow(cx,cy,65*s,.23);
        seal(cx,cy+48*s,67*s,smooth(t),Math.sin(t*Math.PI)*.58,true);
        for(let i=0;i<count;i++){
          const tt=(t+i/count)%1,xx=cx+(random(seed,i)-.5)*100*s,yy=cy+50*s-tt*125*s,alpha=Math.sin(tt*Math.PI);
          if(e.element==='leaf')leaf(xx,yy,5*s,t+i,p[i%3],alpha);
          else if(e.element==='tide')ellipse(xx,yy,3*s,4*s,p[0],1,alpha);
          else if(e.element==='wind')leaf(xx,yy,8*s,-.6,p[0],alpha);
          else star(xx,yy,(3+random(seed,i+50)*4)*s,p[i%3],t*.4,alpha);
        }
        const r=11*s;stroke([[cx-r,cy],[cx+r,cy]],p[0],5,.75);stroke([[cx,cy-r],[cx,cy+r]],p[0],5,.75);break;
      }
      case 'ascension': {
        const rise=ease(phase(t,.04,.72)),height=130*s,gather=1-smooth(phase(t,.78,1));
        glow(cx,cy-14*s,84*s,.22*gather,p[1]);
        ellipse(cx,cy+52*s,(38+rise*29)*s,(10+rise*9)*s,p[1],3,.7*gather);
        ellipse(cx,cy+52*s,(31+rise*21)*s,(8+rise*6)*s,p[0],1,.8*gather);
        seal(cx,cy+52*s,(46+rise*24)*s,rise,.72*gather,true);
        for(let ribbon=0;ribbon<4;ribbon++){
          const points=[];
          for(let j=0;j<=30;j++){
            const u=j/30*rise,a=u*Math.PI*2.2+t*1.5+ribbon*TAU/4,r=(39-u*20)*s;
            points.push([cx+Math.cos(a)*r,cy+49*s-u*height]);
          }
          stroke(points,p[2],7,.11*gather);stroke(points,ribbon%2?p[1]:p[0],ribbon%2?2:1.5,.6*gather);
        }
        for(let i=0;i<(low?10:18);i++){
          const progress=phase(t,.04+random(seed,i)*.3,.66+random(seed,i)*.25),a=i*2.39996,r=(25+random(seed,i+30)*34)*s;
          const x=cx+Math.cos(a)*r*(1-progress*.35),y=cy+45*s-progress*145*s,alpha=Math.sin(progress*Math.PI)*gather;
          shard(x,y,(4+random(seed,i+60)*4)*s,-Math.PI/2,p[i%3],alpha*.8);
        }
        const crown=smooth(phase(t,.32,.66))*gather;
        star(cx,cy-88*s,14*s*crown,p[3],0,crown);
        for(const sign of [-1,1])star(cx+sign*23*s,cy-76*s,6*s*crown,p[0],.1,crown*.8);
        break;
      }
      case 'shield': {
        const r=66*s*size*smooth(t/.2),alpha=1-smooth(phase(t,.8,1));
        if(r<=0)break;
        c.save();c.globalAlpha*=alpha;c.translate(cx,cy);c.scale(.86,1.08);
        const lens=c.createRadialGradient(-r*.2,-r*.3,r*.05,0,0,r);
        lens.addColorStop(0,p[0]+'05');lens.addColorStop(.62,p[1]+'13');lens.addColorStop(.9,p[2]+'35');lens.addColorStop(1,p[0]+'68');
        c.fillStyle=lens;c.beginPath();c.arc(0,0,r,0,TAU);c.fill();
        c.strokeStyle=p[1];c.lineWidth=2*s;c.stroke();
        c.beginPath();c.arc(-r*.05,-r*.02,r*.91,-2.85,-.65);c.strokeStyle=p[0];c.lineWidth=3*s;c.stroke();
        c.beginPath();c.arc(0,0,r*.82,.18,1.2);c.strokeStyle=p[0]+'88';c.lineWidth=s;c.stroke();
        c.restore();
        ellipse(cx,cy+58*s,r*.83,r*.18,p[1],2,.55*alpha);
        seal(cx,cy,r*1.07,t,alpha*.5);
        for(let i=0;i<(low?4:7);i++){
          const a=i*2.39996+t*.4,x=cx+Math.cos(a)*r*.86,y=cy+Math.sin(a)*r*1.08;
          star(x,y,(2.5+random(seed,i)*2)*s,p[0],0,alpha*.65);
        }
        break;
      }
      case 'capture': {
        // A tuning chime sends woven bands of light between the two partners.
        // The creature stays visible; nothing is thrown or closed around it.
        const envelope=Math.sin(t*Math.PI),radius=(20+48*ease(t))*s;
        for(let i=0;i<3;i++){
          const u=clamp(t*1.5-i*.18),pos=mixPoint(source,{x:cx,y:cy},ease(u));
          const r=(9+i*4)*s,alpha=Math.sin(u*Math.PI)*.85;
          stroke([[pos.x-r,pos.y],[pos.x,pos.y-r],[pos.x+r,pos.y],[pos.x,pos.y+r]],p[i],2,alpha,true);
        }
        for(const sign of [-1,1]){
          stroke([[cx-radius,cy+sign*12*s],[cx-radius*.45,cy+sign*25*s],[cx+radius*.2,cy+sign*12*s],[cx+radius,cy+sign*25*s]],p[sign>0?1:2],2,envelope*.8);
          star(cx+sign*radius,cy,5*s,p[0],Math.PI/4,envelope*.9);
        }
        glow(cx,cy,28*s,envelope*.22);break;
      }
      case 'miss': {
        const missTarget={x:cx+(cx>source.x?55:-55)*s,y:cy-35*s},pos=mixPoint(source,missTarget,ease(phase(t,.08,.7))),prev=mixPoint(source,missTarget,clamp(ease(phase(t,.08,.7))-.09));
        stroke([[prev.x,prev.y],[pos.x,pos.y]],p[1],2,.5);break;
      }
      default: {
        if(t>.22){const tt=ease(phase(t,.22,.58));
          for(let i=0;i<3;i++){const x=cx+(i-1)*14*s,y=cy+(i-1)*8*s;trail({x:x-28*s,y:y-38*s},{x:x-28*s+tt*58*s,y:y-38*s+tt*76*s},4);}
        }impactRing(78*s);sparks(cx,cy);break;
      }
    }
    // Material-specific impact corona. Its deterministic, continuously
    // animated curve avoids the repeated straight-starburst look across moves.
    if(attack&&bloom>0&&t>=.4){
      const expansion=ease(phase(t,.4,1)),radius=(18+expansion*94)*s*size;
      const coronaAlpha=bloom*(1-expansion*.55);
      for(let i=0;i<budget.corona;i++){
        const a=i*TAU/budget.corona+random(seed,i+401)*.35;
        const reach=radius*(.6+random(seed,i+431)*.45);
        const x=cx+Math.cos(a)*reach,y=cy+Math.sin(a)*reach*.62;
        const start={x:cx+Math.cos(a)*reach*.55,y:cy+Math.sin(a)*reach*.34};
        if(e.element==='leaf'){
          leaf(x,y,(3+random(seed,i+441)*4)*s,a+expansion,p[i%3],coronaAlpha*.8);
          if(i%2===0)curvedTrail(start,{x,y},9*s,1,p[2],coronaAlpha*.4);
        }else if(e.element==='tide'){
          curvedTrail(start,{x,y:y+expansion*20*s},(i%2?1:-1)*12*s,2,p[1],coronaAlpha*.55);
          mote(x,y+expansion*20*s,(2+random(seed,i+461)*2)*s,p[0],coronaAlpha);
        }else if(e.element==='ember'){
          curvedTrail(start,{x,y:y-expansion*14*s},(i%2?1:-1)*7*s,2.4,p[i%2],coronaAlpha*.55);
          mote(x,y-expansion*20*s,1.5*s,p[3],coronaAlpha);
        }else if(e.element==='wind'){
          curvedTrail(start,{x,y},(i%2?1:-1)*22*s,1.4,p[0],coronaAlpha*.65);
        }else if(e.element==='crystal'){
          shard(x,y,(3+random(seed,i+451)*5)*s,a+expansion*.4,p[i%3],coronaAlpha*.8);
          if(i%3===0)star(x,y,8*s*coronaAlpha,p[3],0,coronaAlpha*.65);
        }else if(e.element==='thunder'){
          stroke([[start.x,start.y],[(start.x+x)/2+5*s,(start.y+y)/2-6*s],[x,y]],p[i%2],1.5,coronaAlpha*.75);
        }else if(e.element==='ice'){
          shard(x,y,(3+random(seed,i+451)*4)*s,a+expansion*.2,p[i%3],coronaAlpha*.8);
        }else if(e.element==='earth'||e.element==='stone'){
          rock(x,y+expansion*24*s,(3+random(seed,i+451)*4)*s,a+expansion,coronaAlpha*.65);
        }else mote(x,y,3*s,p[1],coronaAlpha*.6);
      }
      if(physical){
        for(let i=0;i<(low?2:3);i++){
          const a=direction+(i-1)*.4,span=(33+expansion*61)*s;
          const start={x:cx-Math.cos(a)*span,y:cy-Math.sin(a)*span*.65};
          const end={x:cx+Math.cos(a)*span*.7,y:cy+Math.sin(a)*span*.45};
          curvedTrail(start,end,(i%2?1:-1)*24*s,3-i*.5,p[0],coronaAlpha*.54);
        }
      }
    }
    if(['healing','ascension'].includes(e.style)){
      const renewal=Math.sin(phase(t,.04,.96)*Math.PI);
      for(let i=0;i<(low?2:3);i++){
        const points=[];
        for(let j=0;j<=budget.ribbonSteps;j++){
          const u=j/budget.ribbonSteps,a=u*TAU-t*2+i*TAU/3,r=(29-u*9)*s;
          points.push([cx+Math.cos(a)*r,cy+49*s-u*123*s]);
        }
        ribbon(points,e.style==='ascension'?2.6:1.7,p[i%2],renewal*.26);
      }
    }
    if(e.kind==='damage'||e.kind==='attack'||e.kind==='recoil') {
      if(e.critical&&t>.4){ellipse(cx,cy,95*s*burst,60*s*burst,p[3],3,hitAlpha*.6);}
    }
    // Damage labels are intentionally localized to their target, not screen-sized flashes.
    const label=e.kind==='miss'?'ミス':e.kind==='guard'?'防御':e.kind==='boost'?(e.move==='arvelion_crown'?(e.raised===false?'護炎':'全能力↑・護炎'):e.move==='forest_crown'?(e.raised===false?'葉の結界':'全能力↑・結界'):e.move==='futo_ascend'?'全能力↑':'能力↑'):e.kind==='heal'?(e.amount?'+'+e.amount:'回復'):e.amount?String(e.amount):'';
    if(label&&t>.42){const alpha=smooth(phase(t,.42,.53))*(1-smooth(phase(t,.84,1))),yy=cy-42*s-ease(phase(t,.42,1))*22*s;
      const text={text:label,x:cx,y:yy,alpha:c.globalAlpha*alpha,font:`900 ${Math.max(13,Math.round((e.critical?27:23)*s))}px system-ui, sans-serif`,width:4*s,ink:'#19253d',
        fill:e.kind==='heal'?'#d5ffad':e.kind==='miss'?'#e5e9f1':e.critical?'#ffe09c':'#ffffff'};
      if(presentation)presentation.labels.push(text);else paintLabel(c,text);
    }
    c.restore();return true;
  }

  // Playback snapshots remain separate from gameplay state. The event visuals
  // contain only team data, so they cannot recursively include their own queue.
  let onlineKey=null,onlineSeed=null,onlineQueue=[],lastOnlineTime=0,onlineEnd=0,onlineStarts=[],onlineTotal=0;
  // Player battles keep a steady rhythm: every message gets its own beat. Moves play
  // their effect and stay up until the line is read; plain messages (conditions,
  // items, the turn header) hold for their reading time; a short pause separates beats.
  const ONLINE_GAP=300,ONLINE_SETTLE=420;
  const readTime=text=>Math.max(900,Math.min(2000,620+Array.from(String(text||'')).length*34));
  function textBeat(item,start){
    const duration=item?.kind==='turn'?850:['result','limit'].includes(item?.kind)?1900:readTime(item?.text);
    return {kind:'text',style:'text',started:start,duration,side:item?.side??0,slot:item?.slot||0,target:0,move:''};
  }
  function queueOnline(state,now) {
    const events=state?.events||[],key=JSON.stringify([state?.seed,state?.round,state?.turn,state?.winner,events.map(item=>[item.kind,item.side,item.slot,item.index,item.move,item.text])]);
    if(key===onlineKey)return;
    const continuing=onlineSeed===state?.seed&&now<onlineEnd;
    onlineKey=key;onlineSeed=state?.seed;
    if(!continuing){onlineQueue=[];onlineEnd=now;}
    let start=continuing?onlineEnd:now;
    onlineStarts=[];onlineTotal=events.length;
    for(const e of planOnline(events,start,{teams:state?.teams})){
      onlineQueue.push(e);onlineStarts.push(e.started);start=e.until;
    }
    onlineEnd=onlineQueue.length?start+120:now;lastOnlineTime=now;
  }
  function sameOnlineMonster(before,after){
    return !!before&&!!after&&before.species===after.species
      &&(before.uid==null&&after.uid==null||before.uid!=null&&before.uid===after.uid);
  }
  function onlineHealthPlans(before,after,item,options){
    const health=LT.BattleHealth;if(!health||item.kind==='switch')return [];
    const move=resolveMove(item,null),plans=[];
    for(const [side,team]of(after?.teams||[]).entries())for(const [index,mon]of(team.monsters||[]).entries()){
      const old=before?.teams?.[side]?.monsters?.[index];
      if(!sameOnlineMonster(old,mon)||old.maxHp!==mon.maxHp||!Number.isFinite(mon.maxHp)||mon.maxHp<=0
        ||!Number.isFinite(old.hp)||!Number.isFinite(mon.hp)||old.hp===mon.hp)continue;
      const plan=health.plan({...options,from:old.hp,to:mon.hp,max:mon.maxHp,def:mon.stats?.def,spDef:mon.stats?.spDef,
        kind:item.kind,category:item.category||move?.category});
      plans.push({side,index,mon,plan});
    }
    return plans;
  }
  // The timeline of one state's messages from `start`: each beat lasts until its
  // message has been read, its effect has played and its HP has settled.
  function planOnline(events,start=0,initial=null){
    const options=settings(),reduced=motionReduced(options),tempo={slow:1.2,normal:1,fast:.72,instant:.5}[options.textSpeed]||1,beats=[];
    let previous=(events||[]).find(item=>item.visual?.teams)?.visual||initial,pendingFaints=[];
    for(const [index,item] of (events||[]).entries()){
      const e=fromEvent(item,null,start)||textBeat(item,start);
      if(reduced&&e.kind!=='text')e.duration=Math.min(e.duration,180);
      if(e.kind==='text')e.duration=Math.round(e.duration*tempo);
      e.before=previous;e.after=item.visual?.teams?item.visual:previous;
      e.healthPlans=onlineHealthPlans(e.before,e.after,item,{reducedMotion:reduced,tempo});
      e.healthStarted=start+(reduced||e.kind==='text'?0:e.duration*(e.impactAt??.45));
      const healthDuration=Math.max(0,...e.healthPlans.map(change=>change.plan.duration));
      // Damage can be followed by a drain, an item or a condition before faint.
      // Keep only the sprite standing until that individual's own faint beat.
      pendingFaints=pendingFaints.filter(change=>{
        const mon=e.after?.teams?.[change.side]?.monsters?.[change.index];
        return sameOnlineMonster(change.mon,mon)&&mon.hp<=0
          &&!(e.kind==='faint'&&e.side===change.side&&e.after.teams[change.side].active?.[e.slot]===change.index);
      });
      if(e.kind!=='faint')for(const change of e.healthPlans)if(change.plan.from>0&&change.plan.to===0){
        pendingFaints.push({side:change.side,index:change.index,mon:change.mon,hp:change.plan.from});
      }
      e.pendingFaints=pendingFaints.slice();
      const beat=Math.max(e.duration,Math.round(readTime(item.text)*tempo),e.healthStarted-start+healthDuration);
      e.index=index;e.until=start+beat+Math.round((['damage','faint','recoil','statusTick'].includes(e.kind)?ONLINE_SETTLE:ONLINE_GAP)*tempo);
      beats.push(e);start=e.until;previous=e.after;
    }
    return beats;
  }
  // For checks and the interface: offsets of every beat and the whole playback length.
  function onlinePlan(state){
    const beats=planOnline(state?.events||[],0,{teams:state?.teams});
    return {beats:beats.map(e=>({kind:e.kind,index:e.index,start:e.started,until:e.until})),total:beats.length?beats.at(-1).until+120:0};
  }
  // How many messages of the current turn have started playing (for the battle log).
  function onlineProgress(state,now=globalThis.performance?.now?.()||0){
    if(!state?.teams)return null;
    queueOnline(state,now);
    return {shown:onlineStarts.filter(start=>now>=start).length,total:onlineTotal};
  }
  function onlineBusy(state,now=globalThis.performance?.now?.()||0){
    if(!state?.teams)return false;
    queueOnline(state,now);return now<onlineEnd;
  }
  function onlineFrame(state,now){
    queueOnline(state,now);
    while(onlineQueue.length&&now>=(onlineQueue[0].until??onlineQueue[0].started+onlineQueue[0].duration+75))onlineQueue.shift();
    return onlineQueue[0];
  }
  // Clone just the changed presentation rows; authoritative snapshots and PP
  // remain untouched even when the HP counter is between two whole numbers.
  function onlineMonsterView(state,changes,update){
    let teams=null;
    for(const change of changes||[]){
      const team=state?.teams?.[change.side],mon=team?.monsters?.[change.index];
      if(!sameOnlineMonster(change.mon,mon))continue;
      teams||=state.teams.slice();
      if(teams[change.side]===team)teams[change.side]={...team,monsters:team.monsters.slice()};
      teams[change.side].monsters[change.index]=update(mon,change);
    }
    return teams?{...state,teams}:state;
  }
  function onlineView(state,now=globalThis.performance?.now?.()||0){
    if(!state?.teams)return state;
    const e=onlineFrame(state,now);
    if(!e)return state;
    const visual=now<e.started?e.before:e.kind==='switch'||e.kind==='text'||now>=e.started+e.duration?e.after:e.before;
    const shown=visual?.teams?{...state,teams:visual.teams}:state,health=LT.BattleHealth;
    if(!health||!e.healthPlans.length)return shown;
    if(motionReduced(settings())&&now>=e.started)e.healthInstant=true;
    return onlineMonsterView(shown,e.healthPlans,(mon,change)=>{
      const elapsed=now-e.healthStarted,hp=e.healthInstant?change.plan.to:elapsed<0?change.plan.from:health.sample(change.plan,elapsed);
      return {...mon,hp,displayHp:health.displayed(change.plan,hp)};
    });
  }
  function settings() {
    let value={};try{value=JSON.parse(globalThis.localStorage?.getItem('lumina-trail-settings-v1')||'{}');}catch(_){}
    return {quality:['high','balanced','low'].includes(value.quality)?value.quality:'balanced',reducedMotion:value.reducedMotion===true,textSpeed:['slow','normal','fast','instant'].includes(value.textSpeed)?value.textSpeed:'normal'};
  }
  function install() {
    if(!LT.Art?.battle||!LT.PixelSprites?.duel||LT.Art.battle._pachiVFX)return false;
    const battle=LT.Art.battle,duel=LT.PixelSprites.duel;
    const wrapped=function(canvas,engine,time=0,options={}) {
      if(options.quality!=='low'&&!motionReduced(options))void preload();
      battle(canvas,engine,time,{...options,hideLegacyEffect:true});
      // Solo sprites receive time=0 in reduced motion. The stationary curse
      // still needs a real clock so it appears for its beat and then expires.
      const quietCurse=!time&&options.effect?.style==='condition'&&options.effect?.condition==='curse'&&motionReduced(options);
      const effectTime=quietCurse?(globalThis.performance?.now?.()??time):time;
      if(canvas&&(time||quietCurse))render(canvas.getContext('2d'),canvas.width,canvas.height,effectTime,options.effect,options);
    };
    wrapped._pachiVFX=true;LT.Art.battle=wrapped;LT.PixelSprites.battle=wrapped;
    LT.PixelSprites.duel=function(canvas,value,side=0,time=0) {
      const state=value?.state||value;
      if(!canvas||!state?.teams)return duel(canvas,value,side,time);
      if(!time||time<lastOnlineTime){onlineQueue=[];onlineKey=null;onlineSeed=null;onlineEnd=0;onlineStarts=[];onlineTotal=0;}
      const e=time?onlineFrame(state,time):undefined,shown=time?onlineView(state,time):state;
      const options={...settings(),effect:e,hideLegacyEffect:true,online:true,double:state.mode==='double',side};
      if(options.quality!=='low'&&!motionReduced(options))void preload();
      const spriteView=onlineMonsterView(shown,e?.pendingFaints,(mon,change)=>({...mon,hp:change.hp}));
      duel(canvas,spriteView,side,time,options);
      if(e&&time>=e.started&&!e.soundPlayed){
        e.soundPlayed=true;
        const move=LT.DATA?.moves?.[e.move];
        if(move&&typeof LT.playMoveSound==='function'){
          try{LT.playMoveSound(move,e,e);}catch(_){}
        }else if(e.kind==='damage'&&typeof LT.playDamageSound==='function'){
          try{LT.playDamageSound(e,e);}catch(_){}
        }else if(e.style==='condition'&&typeof LT.playStatusSound==='function'){
          try{LT.playStatusSound(e);}catch(_){}
        }
      }
      if(e&&time)render(canvas.getContext('2d'),canvas.width,canvas.height,time,e,options);
    };
    globalThis.document?.addEventListener?.('pachi-online-state',()=>{if(!LT.onlineBattle){onlineKey=null;onlineSeed=null;onlineQueue=[];onlineEnd=0;onlineStarts=[];onlineTotal=0;}});
    return true;
  }
  const api={classify,fromEvent,anchors,render,install,preload,artStatus,onlineBusy,onlineView,onlineProgress,onlinePlan,palettes,budgets,effects:MOVE_EFFECTS,effectOf,styles:[...MOVE_EFFECTS,'capture','miss','faint','arrival'],
    conditions:CONDITIONS,volatileConditions:VOLATILE_CONDITIONS,conditionPalettes,conditionOf};
  LT.BattleVFX=api;install();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
