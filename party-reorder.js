/* Slide the party strip to change its order; the adventure owns validation/save. */
(() => {
  'use strict';
  class PartyReorder {
    constructor({element,canStart,snapshot,onCommit,threshold=10}) {
      this.element=element;this.canStart=canStart;this.snapshot=snapshot;this.onCommit=onCommit;
      this.threshold=threshold;this.gesture=null;this.suppressPointerClick=false;this.listeners=[];
      this.listen(element,'pointerdown',event=>this.down(event));
      this.listen(window,'pointermove',event=>this.move(event),{passive:false});
      this.listen(window,'pointerup',event=>this.up(event),{passive:false});
      this.listen(window,'pointercancel',event=>{if(this.gesture?.pointerId===event.pointerId)this.cancel();});
      this.listen(element,'lostpointercapture',event=>{if(this.gesture?.pointerId===event.pointerId)this.cancel();});
      this.listen(element,'click',event=>{
        // A fresh press clears suppression. Keyboard/assistive clicks have no
        // pointer gesture and must remain available immediately after a drag.
        if(event.detail!==0&&this.suppressPointerClick){event.preventDefault();event.stopImmediatePropagation();}
      },true);
      this.listen(element,'dragstart',event=>event.preventDefault());
      this.listen(document,'pointerdown',event=>{
        if(this.gesture&&event.pointerId!==this.gesture.pointerId)this.cancel();
      },true);
      for(const type of ['blur','pagehide','resize','orientationchange'])this.listen(window,type,()=>this.cancel());
      for(const type of ['visibilitychange','pachi-viewport-change','pachi-online-state'])this.listen(document,type,()=>this.cancel());
      this.listen(document,'focusin',()=>{if(this.gesture&&!this.canStart())this.cancel();});
    }
    listen(target,type,handler,options){target?.addEventListener?.(type,handler,options);this.listeners.push([target,type,handler,options]);}
    cards(){return [...this.element.querySelectorAll('button[data-party-uid]')];}
    valid(gesture){
      if(!gesture||!this.canStart()||!this.element.contains(gesture.card)||gesture.card.disabled)return false;
      const latest=this.snapshot();
      return latest?.engine===gesture.snapshot.engine&&Array.isArray(latest.order)&&latest.order.length===gesture.snapshot.order.length&&latest.order.every((uid,i)=>uid===gesture.snapshot.order[i]);
    }
    down(event){
      if(this.gesture){if(event.pointerId!==this.gesture.pointerId)this.cancel();return;}
      if(event.isPrimary===false||(event.button!==undefined&&event.button!==0))return;
      const card=event.target?.closest?.('button[data-party-uid]');
      if(!card||!this.element.contains(card)||card.disabled||!this.canStart())return;
      this.suppressPointerClick=false;
      const snapshot=this.snapshot(),cards=this.cards(),from=cards.indexOf(card);
      if(!snapshot||!Array.isArray(snapshot.order)||snapshot.order.length<2||from<0||snapshot.order[from]!==card.dataset.partyUid)return;
      const rects=cards.map(item=>item.getBoundingClientRect()),strip=this.element.getBoundingClientRect();
      const multirow=rects.some(rect=>Math.abs(rect.top-rects[0].top)>this.threshold);
      this.gesture={pointerId:event.pointerId,pointerType:event.pointerType||'mouse',card,cards,rects,strip,multirow,from,to:from,uid:card.dataset.partyUid,snapshot,startX:event.clientX,startY:event.clientY,active:false};
      try{card.setPointerCapture(event.pointerId);}catch(_){}
    }
    move(event){
      const gesture=this.gesture;if(!gesture||gesture.pointerId!==event.pointerId)return;
      if(!this.valid(gesture)||(gesture.pointerType!=='touch'&&event.buttons===0)){this.cancel();return;}
      const dx=event.clientX-gesture.startX,dy=event.clientY-gesture.startY;
      if(!gesture.active){
        // A vertical slip is a cancelled tap, never a reorder or detail click.
        if(!gesture.multirow&&Math.abs(dy)>this.threshold&&Math.abs(dy)>Math.abs(dx)*1.25){this.cancel();return;}
        if((gesture.multirow?Math.hypot(dx,dy):Math.abs(dx))<this.threshold)return;
        gesture.active=true;this.element.classList.add('party-reordering');gesture.card.classList.add('party-dragging');
      }
      event.preventDefault();
      const source=gesture.rects[gesture.from],bounded=Math.max(gesture.strip.left-source.left,Math.min(gesture.strip.right-source.right,dx));
      const boundedY=gesture.multirow?Math.max(gesture.strip.top-source.top,Math.min(gesture.strip.bottom-source.bottom,dy)):0;
      gesture.card.style.setProperty('--party-drag-x',bounded+'px');gesture.card.style.setProperty('--party-drag-y',boundedY+'px');
      let closest=gesture.from,distance=Infinity;
      gesture.rects.forEach((rect,index)=>{const value=Math.hypot(event.clientX-(rect.left+rect.width/2),event.clientY-(rect.top+rect.height/2));if(value<distance){distance=value;closest=index;}});
      gesture.to=closest;this.element.dataset.reorderTarget=String(closest);
      gesture.cards.forEach((card,index)=>{
        const selected=index===closest&&closest!==gesture.from;card.classList.toggle('party-drop-target',selected);
        if(selected)card.dataset.dropSide=closest<gesture.from?'before':'after';else delete card.dataset.dropSide;
      });
    }
    up(event){
      const gesture=this.gesture;if(!gesture||gesture.pointerId!==event.pointerId)return;
      // Some touch devices coalesce the final move with release. Process that
      // position too, without mistaking pointerup's buttons=0 for capture loss.
      this.move({...event,clientX:event.clientX,clientY:event.clientY,pointerId:event.pointerId,buttons:1,preventDefault:()=>event.preventDefault()});
      if(this.gesture!==gesture)return;
      const valid=this.valid(gesture),inside=event.clientY>=gesture.strip.top-24&&event.clientY<=gesture.strip.bottom+24&&event.clientX>=gesture.strip.left-24&&event.clientX<=gesture.strip.right+24;
      const commit=gesture.active&&valid&&inside&&gesture.to!==gesture.from;
      if(gesture.active)event.preventDefault();
      this.finish(gesture.active||!valid);
      if(commit)this.onCommit({uid:gesture.uid,from:gesture.from,to:gesture.to,snapshot:gesture.snapshot});
    }
    finish(suppress=false){
      const gesture=this.gesture;if(!gesture)return;
      this.gesture=null;
      if(suppress)this.suppressPointerClick=true;
      this.element.classList.remove('party-reordering');delete this.element.dataset.reorderTarget;
      for(const card of gesture.cards){card.classList.remove('party-dragging','party-drop-target');card.style.removeProperty('--party-drag-x');card.style.removeProperty('--party-drag-y');delete card.dataset.dropSide;}
      try{if(gesture.card.hasPointerCapture(gesture.pointerId))gesture.card.releasePointerCapture(gesture.pointerId);}catch(_){}
    }
    cancel(){this.finish(true);}
    destroy(){this.cancel();for(const [target,type,handler,options]of this.listeners)target?.removeEventListener?.(type,handler,options);this.listeners=[];}
  }
  (globalThis.LT||={}).PartyReorder=PartyReorder;
})();
