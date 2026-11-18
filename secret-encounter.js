/* Pachi Monsters — an intentional operator-only secret, not a security bypass. */
(() => {
  'use strict';
  const LT=globalThis.LT;if(!LT?.DATA)return;
  let taps=0,lastTap=0,dialog=null,working=false;
  const notify=message=>LT.adminBridge?.toast?.(message);
  const selectable=species=>(!species.hiddenDex&&!species.glitchOnly)||LT.DATA.glitchLine?.ids.includes(species.id);
  const isGenderless=species=>(LT.DATA.genderless||[]).includes(species);
  function syncGender(){
    const gender=dialog.querySelector('#secret-gender'),none=isGenderless(dialog.querySelector('#secret-species').value);
    gender.disabled=none;gender.options[0].textContent=none?'性別なし':'おまかせ';
    if(none)gender.value='auto';
  }
  async function authorize(){
    if(typeof LT.Admin?.authorizeSecretEncounter!=='function')throw Error('運営確認を読み込めません。再読み込みしてください。');
    const owner=await LT.Admin.authorizeSecretEncounter();
    if(owner?.isAdmin!==true||!/^P[0-9a-f]{16}$/.test(owner.id||''))throw Error('運営専用の裏技です。');
    return owner;
  }
  async function open(){
    if(working)return;working=true;
    try{
      await authorize();
      if(!LT.adminBridge?.isPlaying?.())throw Error('冒険を再開してから使ってください。');
      if(!dialog){
        dialog=document.createElement('dialog');dialog.className='pachi-console';dialog.setAttribute('aria-labelledby','secret-title');
        dialog.innerHTML='<header class="pachi-console-head"><h2 id="secret-title">裏技・幻の草むら</h2><button type="button" class="btn" data-secret-close>閉じる</button></header><div class="pachi-console-body"><p>図鑑に登録されたパチモンと、図鑑外の無属性3体から1体を選んで野生バトルへ。パチカプセル1個で必ず仲間になります。カプセルがない場合は1個補充します。</p><form id="secret-form"><label for="secret-species">出現させるパチモン</label><select id="secret-species" style="display:block;width:100%;font-size:16px;padding:12px;margin:8px 0 16px"></select><label for="secret-level">レベル（1〜100）</label><input id="secret-level" type="number" min="1" max="100" step="1" value="70" inputmode="numeric" style="display:block;width:100%;font-size:16px;padding:12px;margin:8px 0 16px"><label for="secret-gender">性別</label><select id="secret-gender" style="display:block;width:100%;font-size:16px;padding:12px;margin:8px 0 16px"><option value="auto">おまかせ</option><option value="male">オス ♂</option><option value="female">メス ♀</option></select><label class="secret-shiny" style="display:flex;align-items:center;gap:10px;margin:0 0 16px;font-size:16px"><input id="secret-shiny" type="checkbox" style="width:22px;height:22px"> 色違いで出現させる</label><button type="submit" class="btn btn-primary">野生で出現させる</button><p id="secret-status" role="status"></p></form><small>運営専用。通常の出現率・一般プレイヤーの入手範囲は変わりません。</small></div>';
        const select=dialog.querySelector('#secret-species');
        for(const species of Object.values(LT.DATA.species).filter(selectable)){
          const option=document.createElement('option');option.value=species.id;option.textContent=species.name+' / '+LT.DATA.elements[species.element].name+(species.hiddenDex?'（図鑑外）':'');select.append(option);
        }
        select.onchange=syncGender;
        document.body.append(dialog);
        dialog.querySelector('[data-secret-close]').onclick=()=>{if(!working)dialog.close();};
        dialog.addEventListener('cancel',event=>{if(working)event.preventDefault();});
        dialog.querySelector('#secret-form').onsubmit=async event=>{
          event.preventDefault();if(working)return;
          const level=Number(dialog.querySelector('#secret-level').value),species=select.value,shiny=dialog.querySelector('#secret-shiny')?.checked===true,gender=dialog.querySelector('#secret-gender').value,status=dialog.querySelector('#secret-status'),button=dialog.querySelector('[type="submit"]');
          if(!Number.isInteger(level)||level<1||level>100){status.textContent='レベルは1〜100の整数で入力してください。';return;}
          if(!Object.hasOwn(LT.DATA.species,species)||!selectable(LT.DATA.species[species])){status.textContent='一覧にあるパチモンを選んでください。';return;}
          if(!['auto','male','female'].includes(gender)){status.textContent='性別は一覧から選んでください。';return;}
          if(isGenderless(species)&&gender!=='auto'){status.textContent='このパチモンは性別がないため、性別を指定できません。';return;}
          working=true;button.disabled=true;status.textContent='運営権限を確認しています…';
          try{
            const owner=await authorize();
            const result=LT.adminBridge.startSecretEncounter(species,level,owner,{shiny,gender});
            if(!result?.ok)throw Error(result?.message||'出現できませんでした。');
            dialog.close();
            for(const pane of document.querySelectorAll('dialog.pachi-console[open]'))pane.close();
          }catch(error){status.textContent=error.message;}finally{working=false;button.disabled=false;}
        };
      }
      syncGender();dialog.querySelector('#secret-status').textContent='';if(!dialog.open)dialog.showModal();
    }catch(error){notify(error.message);}finally{working=false;}
  }
  document.addEventListener('click',event=>{
    if(!event.target.closest?.('#pachi-console-title'))return;
    const now=Date.now();taps=now-lastTap<2500?taps+1:1;lastTap=now;
    if(taps===7){taps=0;void open();}
  });
})();
