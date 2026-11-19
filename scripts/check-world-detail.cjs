#!/usr/bin/env node
'use strict';

// Render the shipped art (not fixtures), and keep decorative world changes out
// of collision, arrivals, interaction squares and saved gameplay state.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { runtime, canvas, imageStats } = require('./check-art.cjs');
const root = path.resolve(__dirname, '..');
const directions = ['down', 'left', 'right', 'up'];
const phases = ['idle', 'walk1', 'walk2'];
const adminKinds = ['sub-admin', 'sub-sub-admin'];
const playableKinds = ['hero', 'hero-female', 'kasai', ...adminKinds];

async function checkSubAdminMetadata(kind) {
  const metadata = JSON.parse(fs.readFileSync(path.join(root, `assets/${kind}-overworld-v62.json`), 'utf8'));
  assert.equal(metadata.image, `${kind}-overworld-v62.png`);
  const asset = path.join(root, 'assets', metadata.image);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(asset)).digest('hex'), metadata.sourceSha256,
    'The secondary administrator source image must retain its recorded original bytes');
  const image = await canvas.loadImage(asset);
  assert.equal(image.width, metadata.imageWidth); assert.equal(image.height, metadata.imageHeight);
  assert.deepEqual([image.width, image.height], [1086, 1448]);
  assert.deepEqual(metadata.renderSize, [96, 128]); assert.equal(metadata.renderFeetY, 122);
  assert(metadata.fitExtent.width > 0 && metadata.fitExtent.height > 0);
  assert.equal(metadata.frames.length, 12);
  const source = canvas.createCanvas(image.width, image.height), context = source.getContext('2d');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data, seen = new Set();
  for (const frame of metadata.frames) {
    const row = directions.indexOf(frame.direction), column = phases.indexOf(frame.phase), key = frame.direction + ':' + frame.phase;
    assert(row >= 0 && column >= 0 && !seen.has(key), `${key}: missing or duplicate source pose`); seen.add(key);
    for (const field of ['sx', 'sy', 'sw', 'sh', 'anchorX', 'anchorY']) assert(Number.isInteger(frame[field]), `${key}: non-integer ${field}`);
    assert(frame.sx >= 0 && frame.sy >= 0 && frame.sw > 0 && frame.sh > 0 && frame.sx + frame.sw <= image.width && frame.sy + frame.sh <= image.height,
      `${key}: source crop leaves the atlas`);
    assert(frame.anchorX >= 0 && frame.anchorX < frame.sw && frame.anchorY >= 0 && frame.anchorY < frame.sh, `${key}: anchor leaves the crop`);
    let left = image.width, top = image.height, right = -1, bottom = -1;
    // Independently inspect each authored grid cell: the crop must preserve all
    // visible source pixels, while its ground anchor follows the lowest foot.
    for (let y = row * image.height / 4; y < (row + 1) * image.height / 4; y++)
      for (let x = column * image.width / 3; x < (column + 1) * image.width / 3; x++) {
        if (pixels[(y * image.width + x) * 4 + 3] < 96) continue;
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    assert(right >= left && bottom >= top, `${key}: empty source pose`);
    assert(left > frame.sx && top > frame.sy && right < frame.sx + frame.sw - 1 && bottom < frame.sy + frame.sh - 1,
      `${key}: source crop clips the illustrated silhouette`);
    assert(frame.anchorX >= left - frame.sx && frame.anchorX <= right - frame.sx, `${key}: ground anchor leaves the figure`);
    assert(Math.abs(frame.anchorY - (bottom - frame.sy + 1)) <= 1, `${key}: feet anchor does not match the source baseline`);
  }
  source.width = source.height = 1;
}

async function main() {
  const { LT, engine, imageErrors, warnings } = await runtime();
  assert.equal(imageErrors.length, 0, imageErrors.join('\n'));
  assert.equal(warnings.length, 0, warnings.join('\n'));
  assert.equal(LT.TravellerArt.status().loaded, 6, 'All six traveller sheets must load');
  assert.equal(LT.TravellerArt.status().failed, 0, 'A traveller atlas failed to decode');
  for (const kind of adminKinds) {
    assert(LT.TravellerArt.atlasLayout.specialAvatars.includes(kind), `${kind} atlas is not registered`);
    await checkSubAdminMetadata(kind);
  }
  assert.equal(LT.FieldArt.status().loaded.length, 4, 'All four new environment sheets must load');
  const maps = Object.values(LT.DATA.maps), before = JSON.stringify(LT.DATA.maps), state = JSON.stringify(engine.state);
  let props = 0, courtyards = 0, portraits = 0;
  for (const map of maps) {
    const plan = LT.FieldArt.layout(map);
    assert(plan.props.length <= 6, `${map.id}: unbounded decorative props`);
    for (const prop of plan.props) {
      assert(['T', 'o'].includes(map.tiles[prop.y][prop.x]), `${map.id}: prop blocks a previously walkable tile`);
      assert.equal(prop.w, 1); assert.equal(prop.h, 1);
      for (const point of [map.spawn, ...(map.npcs || []), ...(map.exits || [])].filter(Boolean))
        assert(Math.abs(point.x - prop.x) + Math.abs(point.y - prop.y) >= 4, `${map.id}: decoration intrudes on an arrival or interaction`);
      for (const furnishing of map.furniture || []) assert(!(prop.x >= furnishing.x - 1 && prop.x < furnishing.x + (furnishing.w || 1) + 1
        && prop.y >= furnishing.y - 1 && prop.y < furnishing.y + (furnishing.h || 1) + 1), `${map.id}: existing furnishing overlapped`);
      props++;
    }
    if (plan.courtyard) {
      courtyards++;
      for (let y = plan.courtyard.y - 1; y <= plan.courtyard.y + 1; y++)
        for (let x = plan.courtyard.x - 1; x <= plan.courtyard.x + 1; x++)
          assert(['=', '_'].includes(map.tiles[y][x]), `${map.id}: courtyard covers encounters, portals or obstacles`);
    }
  }
  assert(props >= 1, 'The town arrangement did not place any decorative objects');
  assert(courtyards >= 1, 'The new courtyard motif is not used');

  // New portrait surfaces must come from the detailed source cells, not from a
  // nearest-neighbour enlargement of the already downsampled field figure.
  const portraitSheet = canvas.createCanvas(8 * 192, playableKinds.length * 256);
  const portraitContext = portraitSheet.getContext('2d');
  const adminSheets = Object.fromEntries(adminKinds.map(kind => {
    const sheet = canvas.createCanvas(3 * 336, 4 * 304), context = sheet.getContext('2d');
    context.fillStyle = '#e8edf0'; context.fillRect(0, 0, sheet.width, sheet.height);
    context.imageSmoothingEnabled = false;
    return [kind, {sheet, context, hashes:[new Set(), new Set()]}];
  }));
  for (const [row, kind] of playableKinds.entries()) {
    for (const [column, facing] of directions.entries()) {
      const walking = new Set(), fieldWalking = new Set();
      for (const frame of [0, 1, 2]) {
        const sprite = LT.TravellerArt.get(kind, facing, frame, 0, 2), bounds = imageStats(sprite);
        assert.equal(sprite.width, 192); assert.equal(sprite.height, 256);
        assert(bounds.fraction > .1 && bounds.fraction < .8, `${kind}/${facing}: transparent silhouette lost`);
        assert(bounds.left >= 4 && bounds.right < 188 && bounds.top >= 4 && bounds.bottom < 252, `${kind}/${facing}: source figure clipped`);
        walking.add(bounds.hash); portraits++;
        if (adminKinds.includes(kind)) {
          const {context:subAdminContext, hashes:subAdminHashes} = adminSheets[kind];
          const field = LT.TravellerArt.get(kind, facing, frame), fieldBounds = imageStats(field);
          assert.equal(field.width, 96); assert.equal(field.height, 128);
          assert(fieldBounds.fraction > .1 && fieldBounds.fraction < .8, `${kind}/${facing}/${frame}: field silhouette lost`);
          assert(fieldBounds.left >= 2 && fieldBounds.right < 94 && fieldBounds.top >= 2 && fieldBounds.bottom < 126,
            `${kind}/${facing}/${frame}: field figure clipped`);
          fieldWalking.add(fieldBounds.hash); subAdminHashes[0].add(fieldBounds.hash); subAdminHashes[1].add(bounds.hash);
          for (const other of playableKinds.filter(value => value !== kind)) {
            assert.notEqual(fieldBounds.hash, imageStats(LT.TravellerArt.get(other, facing, frame)).hash, `${kind}: field reused ${other}`);
            assert.notEqual(bounds.hash, imageStats(LT.TravellerArt.get(other, facing, frame, 0, 2)).hash, `${kind}: portrait reused ${other}`);
          }
          const x = frame * 336, y = column * 304;
          subAdminContext.fillStyle = '#25343c'; subAdminContext.font = '16px sans-serif';
          subAdminContext.fillText(`${facing} · ${phases[frame]} · 96×128 / 192×256`, x + 8, y + 22);
          subAdminContext.drawImage(field, x + 8, y + 158);
          subAdminContext.drawImage(sprite, x + 128, y + 36);
        }
      }
      assert.equal(walking.size, 3, `${kind}/${facing}: missing authored walking poses`);
      if (adminKinds.includes(kind)) assert.equal(fieldWalking.size, 3, `${kind}/${facing}: field walking poses are identical`);
      const field = LT.TravellerArt.get(kind, facing, 0), enlarged = canvas.createCanvas(192, 256);
      const ctx = enlarged.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(field, 0, 0, 192, 256);
      assert.notEqual(imageStats(enlarged).hash, imageStats(LT.TravellerArt.get(kind, facing, 0, 0, 2)).hash,
        `${kind}/${facing}: portrait reuses the low-resolution field figure`);
      portraitContext.drawImage(LT.TravellerArt.get(kind, facing, 0, 0, 2), column * 192, row * 256);
      portraitContext.drawImage(LT.TravellerArt.get(kind, facing, 1, 0, 2), (column + 4) * 192, row * 256);
      enlarged.width = enlarged.height = 1;
    }
  }
  for (const [kind, data] of Object.entries(adminSheets)) for (const hashes of data.hashes) assert.equal(hashes.size, 12, `${kind} needs 12 distinct authored views at each resolution`);
  for (const kind of ['rest', 'shop', 'guardian', 'dialogue']) for (const facing of ['down', 'left', 'right', 'up']) for (let variant = 0; variant < 4; variant++) {
    const sprite = LT.TravellerArt.get(kind, facing, 0, variant, 2), bounds = imageStats(sprite);
    assert(bounds.fraction > .1 && bounds.fraction < .8 && bounds.left >= 4 && bounds.right < 188 && bounds.top >= 4 && bounds.bottom < 252,
      `${kind}/${facing}/${variant}: NPC silhouette is clipped or empty`);
    portraits++;
  }

  const selected = ['village', 'forest', 'coast', 'desert', 'glacier', 'volcano', 'observatory', 'harbor'].map(theme => maps.find(m => !m.interior && m.theme === theme));
  for (const room of ['inn', 'shop', 'lab', 'gym']) selected.push(maps.find(m => m.interior && m.roomKind === room));
  const fieldSheet = canvas.createCanvas(3 * 640, 4 * 420), fieldContext = fieldSheet.getContext('2d');
  for (const [i, map] of selected.entries()) {
    assert(map, 'Missing representative biome or room');
    const view = canvas.createCanvas(640, 400);
    const player = { ...engine.state, map: map.id, x: map.spawn.x, y: map.interior ? 4 : map.spawn.y };
    LT.Art.world(view, { map, state: player }, 0, { dayPhase: 'day' });
    assert(imageStats(view).fraction > .99, `${map.id}: field has transparent gaps`);
    fieldContext.drawImage(view, (i % 3) * 640, Math.floor(i / 3) * 420);
    fieldContext.fillStyle = '#dce9e2'; fieldContext.font = '14px sans-serif';
    fieldContext.fillText(map.id, (i % 3) * 640 + 8, Math.floor(i / 3) * 420 + 416);
    view.width = view.height = 1;
    if (global.gc) { global.gc(); await new Promise(setImmediate); }
  }
  // Verify the actual canvas nameplates alongside all three operator sprites.
  // Encounter dialogs already had deputy names, while the field renderer used
  // to label every operator as Kasai.
  const labelMap=selected[0],labelView=canvas.createCanvas(640,400),labelContext=labelView.getContext('2d'),labels=[];
  const originalWorld=LT.World,contextPrototype=Object.getPrototypeOf(labelContext),nativeFillText=contextPrototype.fillText;
  // World rendering paints to an intermediate logical canvas, then copies it
  // to the output canvas. Observe the shared context method for this draw.
  contextPrototype.fillText=function(text,...args){labels.push(String(text));return nativeFillText.call(this,text,...args);};
  try{
    LT.World={actors:()=>[
      {name:'主運営の登録名',isAdmin:true,adminRole:'main'},
      {name:'紫の管理者',isAdmin:true,adminRole:'sub'},
      {name:'金の管理者',isAdmin:true,adminRole:'sub-sub'},
      {name:'通常の旅人',isAdmin:false,adminRole:null}
    ].map((person,i)=>({...person,id:'P'+String(i+1).padStart(16,'0'),x:labelMap.spawn.x,y:labelMap.spawn.y,facing:'down',avatar:'female',status:'idle'}))};
    LT.Art.world(labelView,{map:labelMap,state:{...engine.state,map:labelMap.id,x:labelMap.spawn.x,y:labelMap.spawn.y}},0,{dayPhase:'day'});
    for(const expected of ['謎のトレーナー カサイ','サカイ','イサカ','通常の旅人'])assert(labels.includes(expected),`Missing field nameplate: ${expected}`);
    assert.equal(labels.filter(label=>label==='謎のトレーナー カサイ').length,1,'Deputy nameplates must not reuse Kasai');
    for(const registeredName of ['主運営の登録名','紫の管理者','金の管理者'])assert(!labels.includes(registeredName),'Operator nameplates keep their assigned role names');
  }finally{LT.World=originalWorld;contextPrototype.fillText=nativeFillText;labelView.width=labelView.height=1;}
  assert.equal(JSON.stringify(LT.DATA.maps), before, 'Rendering mutated world topology or object coordinates');
  assert.equal(JSON.stringify(engine.state), state, 'Rendering changed saved player state');
  for (const [name, value] of Object.entries(LT.FieldArt.status().cached))
    assert(value <= LT.FieldArt.status().maximum[name], `Unbounded ${name} cache`);
  assert(LT.TravellerArt.status().cached <= LT.TravellerArt.status().maximum, 'Unbounded portrait cache');

  const output = process.argv.find(arg => arg.startsWith('--snapshots='))?.slice('--snapshots='.length);
  if (output) {
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'world-detail-v33.png'), fieldSheet.toBuffer('image/png'));
    fs.writeFileSync(path.join(output, 'travellers-v33.png'), portraitSheet.toBuffer('image/png'));
    for (const [kind, data] of Object.entries(adminSheets)) fs.writeFileSync(path.join(output, `${kind}-v62.png`), data.sheet.toBuffer('image/png'));
  }
  console.log(JSON.stringify({ ok: true, maps: maps.length, decoratedProps: props, courtyards, checkedPortraits: portraits,
    checkedOperatorViews: Object.fromEntries(Object.entries(adminSheets).map(([kind, data]) => [kind, data.hashes.reduce((total, hashes) => total + hashes.size, 0)])),
    renderedBiomesAndRooms: selected.length, caches: LT.FieldArt.status().cached }, null, 2));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
