#!/usr/bin/env node
'use strict';
// Keep the self-contained browser runtime and the reviewed catalogue identical.
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),file=path.join(root,'index.html');
const data=JSON.parse(fs.readFileSync(path.join(root,'data/species-abilities.json'),'utf8'));
if(!Number.isSafeInteger(data.version)||data.version<1||!Array.isArray(data.abilities)||!data.abilities.length||!data.species)throw Error('Invalid ability catalogue');
const ids=new Set(data.abilities.map(ability=>ability.id));
if(ids.size!==data.abilities.length||Object.values(data.species).some(id=>!ids.has(id)))throw Error('Duplicate or missing ability ID');
const html=fs.readFileSync(file,'utf8');
const pattern=/\/\* BEGIN GENERATED ABILITY DATA \*\/[\s\S]*?\/\* END GENERATED ABILITY DATA \*\//g;
if([...html.matchAll(pattern)].length!==1)throw Error('Ability data markers must occur exactly once');
const replacement='/* BEGIN GENERATED ABILITY DATA */\n  const ABILITY_DATA='+JSON.stringify(data).replace(/</g,'\\u003c')+';\n  /* END GENERATED ABILITY DATA */';
const updated=html.replace(pattern,()=>replacement);
if(process.argv.includes('--check')){
  if(updated!==html)throw Error('Ability catalogue is out of sync: run node scripts/sync-abilities.cjs');
  console.log(`Ability catalogue synchronized: ${ids.size} abilities, ${Object.keys(data.species).length} species`);
}else{
  if(updated!==html)fs.writeFileSync(file,updated);
  console.log(`Embedded ${ids.size} abilities for ${Object.keys(data.species).length} species`);
}
