#!/usr/bin/env node
'use strict';

// Render the shipped art (not fixtures), and keep decorative world changes out
// of collision, arrivals, interaction squares and saved gameplay state.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runtime, canvas, imageStats } = require('./check-art.cjs');

async function main() {
  const { LT, engine, imageErrors, warnings } = await runtime();
  assert.equal(imageErrors.length, 0, imageErrors.join('\n'));
  assert.equal(warnings.length, 0, warnings.join('\n'));
  assert.equal(LT.TravellerArt.status().loaded, 4, 'All four traveller sheets must load');
  assert.equal(LT.TravellerArt.status().failed, 0, 'A traveller atlas failed to decode');
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
  const portraitSheet = canvas.createCanvas(8 * 192, 3 * 256);
  const portraitContext = portraitSheet.getContext('2d');
  for (const [row, kind] of ['hero', 'hero-female', 'kasai'].entries()) {
    for (const [column, facing] of ['down', 'left', 'right', 'up'].entries()) {
      const walking = new Set();
      for (const frame of [0, 1, 2]) {
        const sprite = LT.TravellerArt.get(kind, facing, frame, 0, 2), bounds = imageStats(sprite);
        assert.equal(sprite.width, 192); assert.equal(sprite.height, 256);
        assert(bounds.fraction > .1 && bounds.fraction < .8, `${kind}/${facing}: transparent silhouette lost`);
        assert(bounds.left >= 4 && bounds.right < 188 && bounds.top >= 4 && bounds.bottom < 252, `${kind}/${facing}: source figure clipped`);
        walking.add(bounds.hash); portraits++;
      }
      assert.equal(walking.size, 3, `${kind}/${facing}: missing authored walking poses`);
      const field = LT.TravellerArt.get(kind, facing, 0), enlarged = canvas.createCanvas(192, 256);
      const ctx = enlarged.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(field, 0, 0, 192, 256);
      assert.notEqual(imageStats(enlarged).hash, imageStats(LT.TravellerArt.get(kind, facing, 0, 0, 2)).hash,
        `${kind}/${facing}: portrait reuses the low-resolution field figure`);
      portraitContext.drawImage(LT.TravellerArt.get(kind, facing, 0, 0, 2), column * 192, row * 256);
      portraitContext.drawImage(LT.TravellerArt.get(kind, facing, 1, 0, 2), (column + 4) * 192, row * 256);
      enlarged.width = enlarged.height = 1;
    }
  }
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
  }
  console.log(JSON.stringify({ ok: true, maps: maps.length, decoratedProps: props, courtyards, checkedPortraits: portraits,
    renderedBiomesAndRooms: selected.length, caches: LT.FieldArt.status().cached }, null, 2));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
