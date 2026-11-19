/* Pachi Monsters — publish the current administrator's saved party for solo visitors. */
(() => {
  'use strict';
  const root=globalThis,LT=root.LT=root.LT||{};
  const copy=value=>JSON.parse(JSON.stringify(value));
  // Challenge entry heals both sides. Walking damage and spent PP therefore do
  // not create a new opponent roster; individual identity and build changes do.
  const fingerprint=party=>JSON.stringify(party.map(({hp,pp,status,...mon})=>mon));
  class KasaiPartyController {
    constructor({identify,getEngine,getParty=()=>getEngine()?.state.party,canSync,request,normalizeParty,clock=()=>Date.now()}){
      Object.assign(this,{identify,getEngine,getParty,canSync,request,normalizeParty,clock});
      this.running=null;this.queued=false;this.forceQueued=false;this.syncedOwner=null;this.syncedFingerprint=null;this.syncedAt=0;this.error='';
    }
    state(){return {busy:!!this.running,updatedAt:this.syncedAt||null,error:this.error};}
    async current(){
      if(!this.canSync())return null;
      const engine=this.getEngine(),player=await this.identify();
      if(!player?.isAdmin||!/^P[0-9a-f]{16}$/.test(player.id||'')||!this.canSync()||engine!==this.getEngine())return null;
      const savedParty=this.getParty();if(!Array.isArray(savedParty))return null;
      const party=this.normalizeParty(savedParty);
      return {owner:player.id,engine,party,fingerprint:fingerprint(party)};
    }
    sync({force=false}={}){
      this.queued=true;this.forceQueued=this.forceQueued||force===true;
      if(this.running)return this.running;
      const task=(async()=>{
        let result={ok:true,skipped:true};
        while(this.queued){
          this.queued=false;const forced=this.forceQueued;this.forceQueued=false;
          try{
            const next=await this.current();if(!next){result={ok:!forced,skipped:true,...(forced?{message:'冒険を保存してから更新してください。バトルや通信中、別のタブで記録が更新された場合は同期できません。'}:{})};continue;}
            if(!forced&&next.owner===this.syncedOwner&&next.fingerprint===this.syncedFingerprint&&this.clock()-this.syncedAt<60000){result={ok:true,unchanged:true};continue;}
            const response=await this.request('/world/kasai/party',{method:'POST',body:{party:copy(next.party)}});
            const latest=await this.current();
            if(!latest||latest.owner!==next.owner||latest.engine!==next.engine){result={ok:true,stale:true};continue;}
            this.syncedOwner=next.owner;this.syncedFingerprint=next.fingerprint;this.syncedAt=this.clock();this.error='';
            // A save made during this upload gets the next serial request, so an
            // older response can never overwrite the most recent saved party.
            if(latest.fingerprint!==next.fingerprint)this.queued=true;
            result={ok:true,updatedAt:response.updatedAt??this.syncedAt,message:'現在の手持ちを、あなたに挑戦するプレイヤーとの対戦に反映しました。'};
          }catch(error){this.error=error?.message||'運営の手持ちを同期できませんでした。';result={ok:false,message:this.error};}
        }
        return result;
      })();
      this.running=task;
      void task.finally(()=>{if(this.running===task)this.running=null;});
      return task;
    }
  }
  LT.KasaiPartyController=KasaiPartyController;
  if(typeof module!=='undefined'&&module.exports)module.exports={KasaiPartyController,fingerprint};
  if(!root.document?.addEventListener)return;
  const controller=new KasaiPartyController({
    identify:()=>LT.Admin.tradeIdentity(),getEngine:()=>LT.adminBridge?.getEngine?.(),getParty:()=>LT.adminBridge?.getSavedKasaiParty?.(),
    canSync:()=>!document.hidden&&LT.Admin?.player?.isAdmin===true&&LT.adminBridge?.canSyncKasaiParty?.()===true,
    request:(path,options)=>LT.Admin.worldRequest(path,options),normalizeParty:party=>LT.KasaiRules.normalizeParty(party)
  });
  let debounce=null;
  function schedule(){clearTimeout(debounce);debounce=setTimeout(()=>{void controller.sync();},300);}
  for(const event of ['pachi-game-ready','pachi-admin-state','pachi-party-changed'])document.addEventListener(event,schedule);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
  root.addEventListener('online',schedule);
  setInterval(()=>{if(!document.hidden)schedule();},15000);
  LT.KasaiParty={sync:options=>controller.sync(options),status:()=>controller.state()};
  schedule();
})();
