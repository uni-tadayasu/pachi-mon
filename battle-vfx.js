/* Pachi Monsters — layered, deterministic battle choreography.
 * © 2026 KASAI SOLUTIONS INC. No external resources or gameplay mutations.
 */
(() => {
  'use strict';
  const LT = globalThis.LT = globalThis.LT || {};
  const TAU = Math.PI * 2;
  // Fixed budgets keep the high-resolution passes bounded on touch devices.
  const budgets = Object.freeze({low:Object.freeze({particles:12,ribbonSteps:14,corona:7}),balanced:Object.freeze({particles:20,ribbonSteps:20,corona:11}),high:Object.freeze({particles:28,ribbonSteps:26,corona:15})});
  const palettes = {
    leaf: ['#e5ffb1', '#8bdd71', '#328d70', '#fff6cd'],
    tide: ['#d9ffff', '#59dce9', '#287ec4', '#f1fdff'],
    ember: ['#fff2bc', '#ffb247', '#ed5b64', '#fffaf0'],
    wind: ['#f0ffe3', '#aae6c5', '#69a9da', '#ffffff'],
    crystal: ['#fff2ff', '#d6acff', '#7685ec', '#fff9cf'],
    neutral: ['#fff4d6', '#f1c891', '#b58a8e', '#ffffff']
  };
  const direct = {
    sprout:'seed', vine:'petals', lifeline:'roots', evergreen:'roots', thorn:'roots',
    wave:'water-orbs', surge:'wave', riptide:'wave', ripple:'ripples', frost:'ice',
    spark:'flame', blaze:'fire-vortex', sunburst:'sunburst', cinder:'fire-lance',
    gust:'wind-blades', storm:'feathers', tempest:'vortex', whisper:'feathers', sirocco:'wind-blades',
    glint:'crystals', prism:'star-rings', supernova:'starfall', moonbeam:'beam', facet:'crystals',
    nudge:'impact', pulse:'ripples', struggle:'impact',
    futo_breaker:'fracture-punch', futo_burst:'focus-beam', futo_ascend:'ascension', futo_restore:'healing'
  };
  const movePalettes = {
    futo_breaker:['#fff1fb','#ff8bcf','#913eb7','#ffecbd'],
    futo_burst:['#fff5ff','#ee7bda','#873ed4','#ffd6ed'],
    futo_ascend:['#fff1fb','#ffa1db','#a050cb','#ffe6ae'],
    futo_restore:['#fffaff','#efb7ed','#ab8ed1','#e2ffeb']
  };
  const atlas = {
    leaf:['seed','petals','roots','petals','seed','roots','roots','roots'],
    tide:['water-orbs','ripples','wave','wave','water-orbs','ripples','water-orbs','ice'],
    ember:['flame','flame','fire-lance','sunburst','flame','fire-vortex','fire-lance','meteor'],
    wind:['wind-blades','feathers','wind-blades','vortex','vortex','feathers','wind-blades','lightning'],
    crystal:['crystals','crystals','beam','star-rings','crystals','star-rings','crystals','beam']
  };
  const clamp = (n,a=0,b=1) => Math.max(a,Math.min(b,n));
  const ease = n => 1-Math.pow(1-clamp(n),3);
  const smooth = n => { n=clamp(n); return n*n*(3-2*n); };
  const phase = (t,a,b) => clamp((t-a)/(b-a));
  const hash = text => { let h=2166136261; for(const s of String(text))h=Math.imul(h^s.charCodeAt(0),16777619); return h>>>0; };
  const random = (seed,i) => { let n=Math.imul((seed+i*374761393)>>>0,668265263);n=(n^(n>>>13))>>>0;return n/4294967296; };
  const mixPoint = (a,b,t) => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  function resolveMove(event,fallback) {
    const moves=LT.DATA?.moves||{};
    if(event?.move&&moves[event.move])return moves[event.move];
    if(event?.moveId&&moves[event.moveId])return moves[event.moveId];
    const quoted=/「([^」]+)」/.exec(event?.text||'')?.[1];
    if(quoted){const found=Object.values(moves).find(m=>m.name===quoted);if(found)return found;}
    return event?.side==='enemy'||typeof event?.side==='number'?null:fallback;
  }
  function classify(move={},kind=move.kind) {
    if(kind==='miss')return 'miss';
    if(kind==='capture'||kind==='caught'||kind==='resonate')return 'capture';
    if(kind==='heal')return 'healing';
    if(kind==='guard')return 'shield';
    if(kind==='boost')return 'ascension';
    if(kind==='recoil')return 'impact';
    if(direct[move.id])return direct[move.id];
    const a=/^atlas_(leaf|tide|ember|wind|crystal)_(\d+)$/.exec(move.id||'');
    if(a){const n=Number(a[2]);return n<=8?atlas[a[1]][n-1]:n<=10?'healing':'shield';}
    const name=move.name||'';
    if(/雷|電/.test(name))return 'lightning';
    if(/氷|雪|霜/.test(name))return 'ice';
    if(/光線|ビーム|月虹|レーザー/.test(name))return 'beam';
    if(/流星|隕石/.test(name))return 'meteor';
    if(/星|銀河/.test(name))return 'starfall';
    if(/渦|竜巻|奔流/.test(name))return move.element==='ember'?'fire-vortex':'vortex';
    if(/花|華/.test(name))return 'petals';
    if(/根|茨|樹/.test(name))return 'roots';
    if(/波|潮|海/.test(name))return 'wave';
    return {leaf:'seed',tide:'water-orbs',ember:'flame',wind:'wind-blades',crystal:'crystals'}[move.element]||'impact';
  }
  function fromEvent(event,fallback=null,now=globalThis.performance?.now?.()||0) {
    if(!event||!['damage','attack','heal','guard','boost','miss','capture','caught','resonate','recoil'].includes(event.kind))return null;
    if(event.kind==='heal' && (event.amount===0||/効果がなかった|満タン|満ちている/.test(event.text||'')))return null;
    if(event.kind==='boost' && event.changed===false)return null;
    const move=resolveMove(event,fallback)||{element:event.element};
    const style=classify(move,event.kind),large=(move.power||0)>=40;
    const amount=Number.isFinite(event.amount)?event.amount:Number(/(\d+)(?:のダメージ|ダメージ)/.exec(event.text||'')?.[1]||/(?:体力が|HPが)(\d+)/.exec(event.text||'')?.[1]||0);
    return {kind:event.kind,style,move:move.id||event.move||'',element:event.element||move.element||'neutral',
      power:move.power||25,category:move.category||(['heal','guard','boost'].includes(event.kind)?'status':'special'),
      releaseAt:.14,impactAt:.43,side:event.side??'ally',slot:event.slot||0,target:event.target||0,
      amount,critical:event.critical===true||/鮮やかな一撃|急所/.test(event.text||''),
      started:now,duration:event.kind==='miss'?720:event.kind==='boost'?1400:event.kind==='heal'||event.kind==='guard'?1050:large?1180:940,
      seed:hash((move.id||event.text||style)+':'+(event.side??'ally')+':'+(event.slot||0))};
  }
  function anchors(width,height,e,options={}) {
    const online=options.online===true,me=options.side===1?1:0,doubled=options.double===true;
    const own=online?(e.side===me):(e.side!=='enemy');
    function at(ours,slot=0) {
      return {x:width*(doubled?(ours?(slot===1?.47:.19):(slot===1?.82:.57)):(ours?.28:.73)),
        y:height*(doubled?(ours?.75:.37):(ours?.71:.42))};
    }
    const source=at(own,e.slot),self=['heal','guard','boost','recoil'].includes(e.kind);
    return {source,target:self?source:at(!own,e.target),own};
  }
  function motionReduced(options) {
    return options.reducedMotion===true || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true
      || globalThis.document?.documentElement?.classList?.contains('reduce-motion')===true
      || globalThis.document?.body?.classList?.contains('reduce-motion')===true;
  }
  function render(c,w,h,time,event,options={}) {
    if(!c||!event||!Number.isFinite(time)||motionReduced(options))return false;
    const duration=clamp(Number(event.duration)||940,300,2400),t=(time-event.started)/duration;
    if(t<0||t>1)return false;
    const e=event.style?event:{...event,style:classify(resolveMove(event)||{element:event.element},event.kind)};
    const {source,target}=anchors(w,h,e,options),p=movePalettes[e.move]||palettes[e.element]||palettes.neutral;
    const quality=options.quality||'balanced',low=quality==='low'||w<600;
    const budget=budgets[low?'low':quality==='high'?'high':'balanced'];
    const count=budget.particles,seed=e.seed||hash(e.move||e.style);
    const unit=Math.min(w/768,h/440),s=Math.max(.4,unit),size=(e.power>=40?1.28:1)*(e.critical?1.08:1);
    const fade=smooth(t/.1)*(1-smooth((t-.78)/.22)),travel=ease(phase(t,.12,.46)),burst=ease(phase(t,.42,1));
    const hitAlpha=Math.sin(phase(t,.4,1)*Math.PI),cx=target.x,cy=target.y;
    const direction=Math.atan2(cy-source.y,cx-source.x);
    const point=mixPoint(source,target,travel),q=low?2:1;
    const snap=n=>Math.round(n/q)*q;
    c.save();c.setTransform(1,0,0,1,0,0);c.beginPath();c.rect(0,0,w,h);c.clip();
    c.globalAlpha=fade;c.lineCap='round';c.lineJoin='round';
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
      const points=[];for(let i=0;i<8;i++){const a=i*Math.PI/4+rotation,rr=i%2?r*.25:r;points.push([x+Math.cos(a)*rr,y+Math.sin(a)*rr]);}poly(points,color,alpha);
    };
    const shard=(x,y,len,angle,color=p[1],alpha=1)=>{
      const dx=Math.cos(angle),dy=Math.sin(angle),rr=len*.24;
      poly([[x+dx*len,y+dy*len],[x-dy*rr,y+dx*rr],[x-dx*len*.7,y-dy*len*.7],[x+dy*rr,y-dx*rr]],color,alpha);
      stroke([[x-dx*len*.55,y-dy*len*.55],[x+dx*len*.75,y+dy*len*.75]],p[3],1,alpha*.8);
    };
    const leaf=(x,y,r,angle,color=p[1],alpha=1)=>{
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
    const attack=!['healing','shield','ascension','capture','miss'].includes(e.style);
    const charging=smooth(phase(t,0,.1))*(1-smooth(phase(t,.14,.34)));
    const bloom=Math.sin(phase(t,.4,.93)*Math.PI);
    const physical=e.category==='physical'||e.style==='fracture-punch'||e.style==='impact';

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
    if(!['healing','shield','ascension','capture','miss'].includes(e.style)) {
      const charge=(1-smooth(phase(t,.14,.36)))*smooth(t/.12);
      glow(source.x,source.y,35*s,charge*.38);
      ellipse(source.x,source.y,23*s*charge,14*s*charge,p[1],1,charge*.65);
    }
    switch(e.style) {
      case 'seed':
      case 'water-orbs':
      case 'flame': {
        const n=e.power>=40?7:5;
        for(let i=0;i<n;i++){
          const tt=ease(phase(t,.09+i*.038,.41+i*.038)),pos=mixPoint(source,target,tt),arc=Math.sin(tt*Math.PI)*(i-n/2)*10*s;
          const xx=pos.x+Math.sin(direction)*arc,yy=pos.y-Math.cos(direction)*arc;
          const alpha=1-smooth(phase(t,.46+i*.025,.66+i*.025));if(alpha<=0)continue;
          const prev=mixPoint(source,target,Math.max(0,tt-.13));trail(prev,{x:xx,y:yy},e.style==='flame'?5:3);
          glow(xx,yy,(e.style==='flame'?19:13)*s,.35*alpha);
          if(e.style==='seed')leaf(xx,yy,7*s,direction,p[1],alpha);
          else if(e.style==='flame'){shard(xx,yy,13*s,direction,p[1],alpha);shard(xx+3*s,yy,6*s,direction,p[0],alpha);}
          else {ellipse(xx,yy,6*s,6*s,p[0],2,alpha);star(xx-2*s,yy-2*s,3*s,p[3],0,alpha);}
        }impactRing();sparks(cx,cy);break;
      }
      case 'petals': {
        for(let i=0;i<count;i++){const a=i*2.39996+t*TAU,r=(18+random(seed,i)*74)*s*size;
          const pos=mixPoint(source,target,ease(phase(t,.08,.48)));const spread=.2+.8*ease(phase(t,.28,.8));
          leaf(pos.x+Math.cos(a)*r*spread,pos.y+Math.sin(a)*r*.62*spread,(4+random(seed,i+20)*5)*s,a+t*2,i%4===0?'#ffc7df':i%3===0?p[3]:p[1],.9);
        }impactRing(91*s*size);break;
      }
      case 'roots': {
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
          mote(xx,yy,(1.5+random(seed,i+90)*2.3)*s,p[0],hitAlpha*.85);
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
      case 'focus-beam':
      case 'beam': {
        const focused=e.style==='focus-beam';
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
      case 'fracture-punch': {
        const flight=ease(phase(t,.13,.43)),pos=mixPoint(source,target,flight),strike=1-smooth(phase(t,.47,.67));
        const dx=Math.cos(direction),dy=Math.sin(direction),scale=15*s*size;
        const transform=(x,y)=>[pos.x+(x*dx-y*dy)*scale,pos.y+(x*dy+y*dx)*scale];
        for(let i=-2;i<=2;i++){
          const offset=i*8*s,tail=42*s*(1-Math.abs(i)*.14);
          stroke([[pos.x-dx*tail-dy*offset,pos.y-dy*tail+dx*offset],[pos.x-dx*9*s-dy*offset,pos.y-dy*9*s+dx*offset]],i%2?p[1]:p[0],i===0?5:2,strike*.75);
        }
        const fist=[[-1.65,-.5],[-.6,-.5],[-.36,-.94],[.72,-.94],[1.04,-.65],[1.04,.45],[.65,.88],[-.25,.88],[-.55,.48],[-1.65,.48]].map(([x,y])=>transform(x,y));
        glow(pos.x,pos.y,35*s,strike*.33);poly(fist,p[2],strike*.88);stroke(fist,p[1],3,strike,true);
        stroke([transform(-.25,-.64),transform(.7,-.64),transform(.7,.35),transform(.45,.58)],p[0],2,strike);
        for(let i=0;i<3;i++)stroke([transform(i*.27,-.65),transform(i*.27,-.22)],p[0],1,strike*.8);
        if(t>.4){
          const fracture=ease(phase(t,.4,.68)),opacity=1-smooth(phase(t,.69,1));
          for(let i=0;i<(low?7:10);i++){
            const a=i*TAU/(low?7:10)+.22,r=(47+random(seed,i)*47)*s*size*fracture;
            const point=(rr,angle)=>[cx+Math.cos(angle)*rr,cy+Math.sin(angle)*rr*.76];
            const middle=point(r*.56,a+.13),end=point(r,a-.06);
            const crack=[point(12*s,a),middle,point(r*.76,a-.11),end];
            stroke(crack,p[2],5,opacity*.28);stroke(crack,p[0],1.8,opacity*.9);
            stroke([middle,point(r*.73,a+.35)],p[1],1,opacity*.8);
            shard(end[0],end[1],5*s,a,p[i%3],opacity*.8);
          }
          star(cx,cy,24*s*(1-fracture*.55),p[0],direction,opacity*.85);
        }
        impactRing(106*s);sparks(cx,cy,Math.floor(count*.6),85*s,p[1]);break;
      }
      case 'sunburst': {
        const rise=ease(phase(t,.08,.45)),radius=(12+rise*44)*s*size;
        const energy=1-smooth(phase(t,.69,1));
        glow(cx,cy,radius*2.2,.38*energy);
        for(let i=0;i<(low?9:15);i++){
          const a=i*TAU/(low?9:15)+t*.15,reach=radius*(1.4+random(seed,i+90)*.45+burst*.4);
          const start={x:cx+Math.cos(a)*radius*.6,y:cy+Math.sin(a)*radius*.6};
          const end={x:cx+Math.cos(a+.14)*reach,y:cy+Math.sin(a+.14)*reach};
          curvedTrail(start,end,12*s,3.6,p[i%2],energy*.5);
        }
        ellipse(cx,cy,radius,radius,p[0],3,.8*energy);
        ellipse(cx,cy,radius*.78,radius*.78,p[1],7,.3*energy);
        star(cx,cy,radius*.54,p[0],t*.2,.27*energy);
        impactRing(112*s);break;
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
        const end=phase(t,.08,.44),top={x:cx-35*s,y:Math.max(0,cy-190*s)},bottom={x:cx,y:cy+30*s};
        const points=[];for(let i=0;i<=12;i++){const f=i/12*end;points.push([top.x+(bottom.x-top.x)*f+(i===0||i===12?0:(random(seed,i)-.5)*48*s),top.y+(bottom.y-top.y)*f]);}
        const energy=1-smooth(phase(t,.55,.92));stroke(points,p[2],15,energy*.22);stroke(points,'#f7d9ff',5,energy);stroke(points,'#ffffff',1.3,energy);
        for(let i=0;i<3;i++){const b=points[Math.min(points.length-1,4+i*2)];stroke([b,[b[0]+(i%2?30:-30)*s,b[1]+20*s],[b[0]+(i%2?50:-40)*s,b[1]+43*s]],p[1],2,energy*.7);}
        impactRing(90*s);sparks(cx,cy);break;
      }
      case 'meteor':
      case 'starfall': {
        const n=low?5:8;
        for(let i=0;i<n;i++){const tt=ease(phase(t,.07+i*.04,.48+i*.04)),xx=cx+(random(seed,i)-.5)*95*s,yy=cy+(random(seed,i+10)-.5)*42*s;
          const start={x:xx-85*s,y:Math.max(-40*s,yy-200*s)},pos=mixPoint(start,{x:xx,y:yy},tt),prev=mixPoint(start,{x:xx,y:yy},Math.max(0,tt-.24));
          trail(prev,pos,e.style==='meteor'?7:3);star(pos.x,pos.y,(e.style==='meteor'?12:8)*s,p[0],.4,1-smooth(phase(t,.64+i*.02,.9+i*.01)));
        }impactRing(105*s);sparks(cx,cy);break;
      }
      case 'healing': {
        for(let i=0;i<3;i++){const r=(25+i*17)*s*(.8+.2*smooth(t/.3));ellipse(cx,cy+48*s-i*4*s,r,r*.3,p[i],2,.65);}
        glow(cx,cy,65*s,.23);
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
        for(let i=0;i<(low?4:7);i++){
          const a=i*2.39996+t*.4,x=cx+Math.cos(a)*r*.86,y=cy+Math.sin(a)*r*1.08;
          star(x,y,(2.5+random(seed,i)*2)*s,p[0],0,alpha*.65);
        }
        break;
      }
      case 'capture': {
        const radius=(80-55*ease(t))*s;
        for(let i=0;i<3;i++){const a=t*2+i*TAU/3;ellipse(cx,cy,radius,radius*(.35+i*.18),p[i],2,.8,a,a+Math.PI*1.75);}
        for(let i=0;i<12;i++){const a=i*TAU/12+t*1.5;star(cx+Math.cos(a)*radius,cy+Math.sin(a)*radius,4*s,p[i%3],a,.9);}
        glow(cx,cy,36*s,smooth(t)*.4);break;
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
    const label=e.kind==='miss'?'ミス':e.kind==='guard'?'防御':e.kind==='boost'?(e.move==='futo_ascend'?'全能力↑':'能力↑'):e.kind==='heal'?(e.amount?'+'+e.amount:'回復'):e.amount?String(e.amount):'';
    if(label&&t>.42){const alpha=smooth(phase(t,.42,.53))*(1-smooth(phase(t,.84,1)));c.save();c.globalAlpha*=alpha;
      c.font=`900 ${Math.max(13,Math.round((e.critical?27:23)*s))}px system-ui, sans-serif`;c.textAlign='center';c.textBaseline='middle';c.lineWidth=4*s;c.strokeStyle='#19253d';
      c.fillStyle=e.kind==='heal'?'#d5ffad':e.kind==='miss'?'#e5e9f1':e.critical?'#ffe09c':'#ffffff';
      const yy=cy-42*s-ease(phase(t,.42,1))*22*s;c.strokeText(label,cx,yy);c.fillText(label,cx,yy);c.restore();
    }
    c.restore();return true;
  }

  // Observer state is separate from game snapshots and never enters battle checksums.
  let onlineKey=null,onlineQueue=[],lastOnlineTime=0;
  function queueOnline(state,now) {
    const events=state?.events||[],key=JSON.stringify([state?.seed,state?.turn,state?.winner,events]);
    if(key===onlineKey)return;
    onlineKey=key;onlineQueue=[];
    let start=now;
    for(const item of events){const e=fromEvent(item,null,start);if(!e)continue;onlineQueue.push(e);start+=e.duration+35;}
    // Current engine emits at most 8 technique/drain events for a doubles turn.
    onlineQueue=onlineQueue.slice(0,12);lastOnlineTime=now;
  }
  function settings() {
    let value={};try{value=JSON.parse(globalThis.localStorage?.getItem('lumina-trail-settings-v1')||'{}');}catch(_){}
    return {quality:['high','balanced','low'].includes(value.quality)?value.quality:'balanced',reducedMotion:value.reducedMotion===true};
  }
  function install() {
    if(!LT.Art?.battle||!LT.PixelSprites?.duel||LT.Art.battle._pachiVFX)return false;
    const battle=LT.Art.battle,duel=LT.PixelSprites.duel;
    const wrapped=function(canvas,engine,time=0,options={}) {
      battle(canvas,engine,time,{...options,hideLegacyEffect:true});
      if(canvas&&time)render(canvas.getContext('2d'),canvas.width,canvas.height,time,options.effect,options);
    };
    wrapped._pachiVFX=true;LT.Art.battle=wrapped;LT.PixelSprites.battle=wrapped;
    LT.PixelSprites.duel=function(canvas,value,side=0,time=0) {
      const state=value?.state||value;
      if(!canvas||!state?.teams)return duel(canvas,value,side,time);
      if(!time||time<lastOnlineTime){onlineQueue=[];onlineKey=null;}
      if(time)queueOnline(state,time);
      while(onlineQueue.length&&time>onlineQueue[0].started+onlineQueue[0].duration)onlineQueue.shift();
      const e=onlineQueue[0],options={...settings(),effect:e,hideLegacyEffect:true,online:true,double:state.mode==='double',side};
      duel(canvas,value,side,time,options);
      if(e&&time>=e.started&&!e.soundPlayed){
        // Sound follows the event that actually becomes visible. Mark it in
        // observer-only queue state, never in the synchronized duel snapshot.
        e.soundPlayed=true;
        const move=LT.DATA?.moves?.[e.move];
        if(move&&typeof LT.playMoveSound==='function'){
          try{LT.playMoveSound(move,e);}catch(_){} // audio must never stop battle drawing
        }
      }
      if(e&&time)render(canvas.getContext('2d'),canvas.width,canvas.height,time,e,options);
    };
    globalThis.document?.addEventListener?.('pachi-online-state',()=>{if(!LT.onlineBattle){onlineKey=null;onlineQueue=[];}});
    return true;
  }
  const api={classify,fromEvent,anchors,render,install,palettes,budgets,styles:[...new Set([...Object.values(direct),...Object.values(atlas).flat(),'healing','shield','capture','miss'])]};
  LT.BattleVFX=api;install();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
