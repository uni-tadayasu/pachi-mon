/* Pachi Monsters — an intentional operator-only secret, not a security bypass. */
(() => {
  'use strict';
  const LT=globalThis.LT;if(!LT?.DATA)return;
  let taps=0,lastTap=0,dialog=null,working=false;
  const notify=message=>LT.adminBridge?.toast?.(message);
  // Use the live catalogue: ordinary, evolved, special and off-dex species all
  // belong here. New species do not require another private encounter list.
  const allSpecies=()=>Object.values(LT.DATA.species);
  const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('ja').replace(/[ぁ-ゖ]/g,char=>String.fromCharCode(char.charCodeAt(0)+0x60));
  const isGenderless=species=>(LT.DATA.genderless||[]).includes(species);
  function speciesLabel(species){
    const types=LT.TypeSystem?.of(species)||[species.element];
    const tags=[];
    if(species.adminOnly||species.id==='futo')tags.push('運営専用');
    if(species.id===LT.DATA.legendary?.species)tags.push('伝説');
    if(species.hiddenDex)tags.push('図鑑外');
    return species.name+' / '+types.map(type=>LT.DATA.elements[type]?.name||type).join('・')+(tags.length?'（'+tags.join('・')+'）':'');
  }
  function matchingSpecies(){
    const query=normalize(dialog?.querySelector('#secret-search')?.value).trim();
    return allSpecies().filter(species=>!query||normalize(speciesLabel(species)+' '+species.id).includes(query));
  }
  function syncGender(){
    if(!dialog)return;
    const select=dialog.querySelector('#secret-species'),gender=dialog.querySelector('#secret-gender'),none=isGenderless(select.value);
    gender.disabled=none||!select.value;gender.options[0].textContent=none?'性別なし':'おまかせ';
    if(none)gender.value='auto';
    dialog.querySelector('[type="submit"]').disabled=working||!select.value;
  }
  function refreshSpecies(){
    const select=dialog.querySelector('#secret-species'),previous=select.value,matches=matchingSpecies();
    select.replaceChildren();
    for(const species of matches){
      const option=document.createElement('option');option.value=species.id;option.textContent=speciesLabel(species);select.append(option);
    }
    if(matches.some(species=>species.id===previous))select.value=previous;
    select.disabled=matches.length===0;
    dialog.querySelector('#secret-count').textContent=matches.length+'種を表示 / 全'+allSpecies().length+'種';
    dialog.querySelector('[data-secret-random]').disabled=matches.length===0||working;
    dialog.querySelector('#secret-status').textContent=matches.length?'':'一致するパチモンがいません。名前やタイプを変えて検索してください。';
    syncGender();
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
        dialog.innerHTML='<header class="pachi-console-head"><h2 id="secret-title">裏技・幻の草むら</h2><button type="button" class="btn" data-secret-close>閉じる</button></header><div class="pachi-console-body"><p>すべてのパチモンから1体を選んで野生バトルへ。最初の相棒・全進化形・伝説・フート・キラシード・図鑑外の特別なパチモンも選べます。パチカプセル1個で必ず仲間になり、カプセルがない場合は1個補充します。</p><form id="secret-form"><label for="secret-search">名前・タイプで探す</label><input id="secret-search" type="search" placeholder="例：キラシード、氷、図鑑外" autocomplete="off" style="display:block;width:100%;font-size:16px;padding:12px;margin:8px 0" aria-describedby="secret-count"><p id="secret-count" role="status" aria-live="polite" style="margin:8px 0 16px"></p><label for="secret-species">出現させるパチモン</label><select id="secret-species" style="display:block;width:100%;font-size:16px;padding:12px;margin:8px 0 12px"></select><button type="button" class="btn btn-small" data-secret-random style="margin:0 0 16px">表示中からおまかせで選ぶ</button><label for="secret-level" style="display:block">レベル（1〜100）</label><input id="secret-level" type="number" min="1" max="100" step="1" value="70" inputmode="numeric" style="display:block;width:100%;font-size:16px;padding:12px;margin:8px 0 16px"><label for="secret-gender">性別</label><select id="secret-gender" style="display:block;width:100%;font-size:16px;padding:12px;margin:8px 0 16px"><option value="auto">おまかせ</option><option value="male">オス ♂</option><option value="female">メス ♀</option></select><label class="secret-shiny" style="display:flex;align-items:center;gap:10px;margin:0 0 16px;font-size:16px"><input id="secret-shiny" type="checkbox" style="width:22px;height:22px"> 色違いで出現させる</label><button type="submit" class="btn btn-primary">野生で出現させる</button><p id="secret-status" role="status"></p></form><small>運営専用。出現は毎回、現在の運営権限を確認してから実行します。</small></div>';
        const select=dialog.querySelector('#secret-species');
        select.onchange=syncGender;
        dialog.querySelector('#secret-search').oninput=refreshSpecies;
        dialog.querySelector('[data-secret-random]').onclick=()=>{
          if(working)return;const matches=matchingSpecies();if(!matches.length)return;
          select.value=matches[Math.floor(Math.random()*matches.length)].id;syncGender();
          dialog.querySelector('#secret-status').textContent=LT.DATA.species[select.value].name+'を選びました。';
        };
        document.body.append(dialog);
        dialog.querySelector('[data-secret-close]').onclick=()=>{if(!working)dialog.close();};
        dialog.addEventListener('cancel',event=>{if(working)event.preventDefault();});
        dialog.querySelector('#secret-form').onsubmit=async event=>{
          event.preventDefault();if(working)return;
          const level=Number(dialog.querySelector('#secret-level').value),species=select.value,shiny=dialog.querySelector('#secret-shiny')?.checked===true,gender=dialog.querySelector('#secret-gender').value,status=dialog.querySelector('#secret-status'),button=dialog.querySelector('[type="submit"]');
          if(!Number.isInteger(level)||level<1||level>100){status.textContent='レベルは1〜100の整数で入力してください。';return;}
          if(!Object.hasOwn(LT.DATA.species,species)){status.textContent='一覧にあるパチモンを選んでください。';return;}
          if(!['auto','male','female'].includes(gender)){status.textContent='性別は一覧から選んでください。';return;}
          if(isGenderless(species)&&gender!=='auto'){status.textContent='このパチモンは性別がないため、性別を指定できません。';return;}
          working=true;button.disabled=true;status.textContent='運営権限を確認しています…';
          try{
            const owner=await authorize();
            const result=LT.adminBridge.startSecretEncounter(species,level,owner,{shiny,gender});
            if(!result?.ok)throw Error(result?.message||'出現できませんでした。');
            dialog.close();
            for(const pane of document.querySelectorAll('dialog.pachi-console[open]'))pane.close();
          }catch(error){status.textContent=error.message;}finally{working=false;syncGender();}
        };
      }
      refreshSpecies();if(!dialog.open)dialog.showModal();
    }catch(error){notify(error.message);}finally{
      working=false;syncGender();
      if(dialog)dialog.querySelector('[data-secret-random]').disabled=matchingSpecies().length===0;
    }
  }
  document.addEventListener('click',event=>{
    if(!event.target.closest?.('#pachi-console-title'))return;
    const now=Date.now();taps=now-lastTap<2500?taps+1:1;lastTap=now;
    if(taps===7){taps=0;void open();}
  });
  LT.SecretEncounter=Object.freeze({open});
})();
