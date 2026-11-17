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
    verdant_lance:'astral-rend',root_drain:'roots',sig_leaf:'petals',sig_tide:'astral-rend',sig_ember:'creation-nova'};
  const movePalettes = {
    futo_breaker:['#fff1fb','#ff8bcf','#913eb7','#ffecbd'],
    futo_burst:['#fff5ff','#ee7bda','#873ed4','#ffd6ed'],
    futo_ascend:['#fff1fb','#ffa1db','#a050cb','#ffe6ae'],
    futo_restore:['#fffaff','#efb7ed','#ab8ed1','#e2ffeb'],
    arvelion_rend:['#fff4ca','#ffc34c','#e65e24','#fff8e3'],
    arvelion_nova:['#fff3bd','#ffae32','#d94416','#fff8df'],
    arvelion_crown:['#fff2b2','#ffd159','#dc7c22','#fff8de'],
    arvelion_renewal:['#fff4ca','#ffc963','#e08a32','#fff9e9'],
    sig_leaf:['#fbffe0','#b6f26a','#2f9e4f','#ffe9a3'],
    sig_tide:['#eefcff','#7ee3ff','#1f6fd1','#fff2b8'],
    sig_ember:['#fff3d6','#ff9a3d','#c8331c','#ffe08a']
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
  function effectOf(move={}) {
    if(move.kind==='heal')return 'healing';
    if(move.kind==='guard')return 'shield';
    if(move.kind==='boost')return 'ascension';
    if(NAMED_EFFECTS[move.id])return NAMED_EFFECTS[move.id];
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
  function fromEvent(event,fallback=null,now=globalThis.performance?.now?.()||0) {
    if(!event||!['damage','attack','heal','guard','boost','miss','capture','caught','resonate','recoil','faint','switch'].includes(event.kind))return null;
    if(event.kind==='heal' && (event.amount===0||/効果がなかった|満タン|満ちている/.test(event.text||'')))return null;
    if(event.kind==='boost' && event.changed===false)return null;
    const move=['faint','switch'].includes(event.kind)?{element:event.element}:resolveMove(event,fallback)||{element:event.element};
    const style=classify(move,event.kind),large=(move.power||0)>=40;
    const amount=Number.isFinite(event.amount)?event.amount:Number(/(\d+)(?:のダメージ|ダメージ)/.exec(event.text||'')?.[1]||/(?:体力が|HPが)(\d+)/.exec(event.text||'')?.[1]||0);
    return {kind:event.kind,style,move:move.id||event.move||'',element:event.element||move.element||'neutral',
      raised:event.raised,power:move.power||25,category:move.category||(['heal','guard','boost'].includes(event.kind)?'status':'special'),
      releaseAt:.14,impactAt:.43,side:event.side??'ally',slot:event.slot||0,target:event.target||0,
      amount,critical:event.critical===true||/鮮やかな一撃|急所/.test(event.text||''),
      started:now,duration:event.kind==='faint'?950:event.kind==='switch'?650:event.kind==='miss'?720:event.kind==='boost'?1400:event.kind==='heal'||event.kind==='guard'?1050:large?1180:940,
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
    const source=at(own,e.slot),self=['heal','guard','boost','recoil','faint','switch'].includes(e.kind);
    return {source,target:self?source:at(!own,e.target),own};
  }
  function motionReduced(options) {
    return options.reducedMotion===true || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true
      || globalThis.document?.documentElement?.classList?.contains('reduce-motion')===true
      || globalThis.document?.body?.classList?.contains('reduce-motion')===true;
  }
  function render(c,w,h,time,event,options={}) {
    if(!c||!event||event.kind==='text'||!Number.isFinite(time)||motionReduced(options))return false;
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
    // Rounded, tapering tongues distinguish Arvelion's living lamp-fire from
    // crystalline shards. The same deterministic path serves all four moves.
    const lampFlame=(x,y,r,lean=0,color=p[1],alpha=1)=>{
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
    const attack=!['healing','shield','ascension','capture','miss'].includes(e.style);
    const charging=smooth(phase(t,0,.1))*(1-smooth(phase(t,.14,.34)));
    const bloom=Math.sin(phase(t,.4,.93)*Math.PI);
    const physical=e.category==='physical'||e.style==='impact';

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
    switch(e.style) {
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
          const tip=points[points.length-1];lampFlame(tip[0],tip[1],9*s,turn*.6,p[1],opacity);
          for(let ember=0;ember<3;ember++){
            const point=points[Math.floor((points.length-1)*(ember+1)/4)];
            lampFlame(point[0],point[1]-phase(t,.4,.95)*25*s,(3+ember)*s,-turn*.3,p[1],opacity*.55);
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
        const end=phase(t,.08,.44),top={x:cx-35*s,y:Math.max(0,cy-190*s)},bottom={x:cx,y:cy+30*s};
        const points=[];for(let i=0;i<=12;i++){const f=i/12*end;points.push([top.x+(bottom.x-top.x)*f+(i===0||i===12?0:(random(seed,i)-.5)*48*s),top.y+(bottom.y-top.y)*f]);}
        const energy=1-smooth(phase(t,.55,.92));stroke(points,p[2],15,energy*.22);stroke(points,'#f7d9ff',5,energy);stroke(points,'#ffffff',1.3,energy);
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
    const label=e.kind==='miss'?'ミス':e.kind==='guard'?'防御':e.kind==='boost'?(e.move==='arvelion_crown'?(e.raised===false?'護炎':'全能力↑・護炎'):e.move==='forest_crown'?(e.raised===false?'葉の結界':'全能力↑・結界'):e.move==='futo_ascend'?'全能力↑':'能力↑'):e.kind==='heal'?(e.amount?'+'+e.amount:'回復'):e.amount?String(e.amount):'';
    if(label&&t>.42){const alpha=smooth(phase(t,.42,.53))*(1-smooth(phase(t,.84,1)));c.save();c.globalAlpha*=alpha;
      c.font=`900 ${Math.max(13,Math.round((e.critical?27:23)*s))}px system-ui, sans-serif`;c.textAlign='center';c.textBaseline='middle';c.lineWidth=4*s;c.strokeStyle='#19253d';
      c.fillStyle=e.kind==='heal'?'#d5ffad':e.kind==='miss'?'#e5e9f1':e.critical?'#ffe09c':'#ffffff';
      const yy=cy-42*s-ease(phase(t,.42,1))*22*s;c.strokeText(label,cx,yy);c.fillText(label,cx,yy);c.restore();
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
    let start=continuing?onlineEnd:now,previous=events.find(item=>item.visual?.teams)?.visual||{teams:state?.teams};
    const options=settings(),reduced=motionReduced(options),tempo={slow:1.2,normal:1,fast:.72,instant:.5}[options.textSpeed]||1;
    onlineStarts=[];onlineTotal=events.length;
    for(const [index,item] of events.entries()){
      const after=item.visual?.teams?item.visual:previous,e=fromEvent(item,null,start)||textBeat(item,start);
      if(reduced&&e.kind!=='text')e.duration=Math.min(e.duration,180);
      // The beat lasts until its message has been read, then pauses before the next.
      if(e.kind==='text')e.duration=Math.round(e.duration*tempo);
      const beat=Math.max(e.duration,Math.round(readTime(item.text)*tempo));
      e.index=index;e.before=previous;e.after=after;e.until=start+beat+Math.round((['damage','faint','recoil'].includes(e.kind)?ONLINE_SETTLE:ONLINE_GAP)*tempo);
      onlineQueue.push(e);onlineStarts.push(start);start=e.until;
      previous=after;
    }
    onlineEnd=onlineQueue.length?start+120:now;lastOnlineTime=now;
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
  function onlineView(state,now=globalThis.performance?.now?.()||0){
    if(!state?.teams)return state;
    const e=onlineFrame(state,now);
    if(!e)return state;
    const visual=now<e.started?e.before:e.kind==='switch'||e.kind==='text'||now>=e.started+e.duration?e.after:e.before;
    return visual?.teams?{...state,teams:visual.teams}:state;
  }
  function settings() {
    let value={};try{value=JSON.parse(globalThis.localStorage?.getItem('lumina-trail-settings-v1')||'{}');}catch(_){}
    return {quality:['high','balanced','low'].includes(value.quality)?value.quality:'balanced',reducedMotion:value.reducedMotion===true,textSpeed:['slow','normal','fast','instant'].includes(value.textSpeed)?value.textSpeed:'normal'};
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
      if(!time||time<lastOnlineTime){onlineQueue=[];onlineKey=null;onlineSeed=null;onlineEnd=0;onlineStarts=[];onlineTotal=0;}
      const e=time?onlineFrame(state,time):undefined,shown=time?onlineView(state,time):state;
      const options={...settings(),effect:e,hideLegacyEffect:true,online:true,double:state.mode==='double',side};
      duel(canvas,shown,side,time,options);
      if(e&&time>=e.started&&!e.soundPlayed){
        e.soundPlayed=true;
        const move=LT.DATA?.moves?.[e.move];
        if(move&&typeof LT.playMoveSound==='function'){
          try{LT.playMoveSound(move,e);}catch(_){}
        }
      }
      if(e&&time)render(canvas.getContext('2d'),canvas.width,canvas.height,time,e,options);
    };
    globalThis.document?.addEventListener?.('pachi-online-state',()=>{if(!LT.onlineBattle){onlineKey=null;onlineSeed=null;onlineQueue=[];onlineEnd=0;onlineStarts=[];onlineTotal=0;}});
    return true;
  }
  const api={classify,fromEvent,anchors,render,install,onlineBusy,onlineView,onlineProgress,palettes,budgets,effects:MOVE_EFFECTS,effectOf,styles:[...MOVE_EFFECTS,'capture','miss','faint','arrival']};
  LT.BattleVFX=api;install();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
