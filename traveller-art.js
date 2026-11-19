/* Original Pachi Monsters traveller art — © 2026 KASAI SOLUTIONS INC.
 * Generated with OpenAI image generation for this original game: detailed pixel
 * traveller (teal coat, ochre cap, rust scarf), four NPC professions, four views.
 * Revision 33 sheets preserve fine material details and transparent silhouettes.
 * Revision 52 samples the original artwork on a finer 48×64 display grid.
 * Revision 55 adds Kasai's reference-based, four-direction walking sheet.
 * Revision 62 adds a distinct purple-haired secondary administrator sheet.
 * Image atlases are authored for this project. Runtime extraction retains the
 * transparent silhouettes and a shared feet baseline for world depth sorting.
 */
(() => {
  'use strict';
  const LT = globalThis.LT = globalThis.LT || {};
  const directions = ['down', 'left', 'right', 'up'];
  const atlas = { hero: null, female: null, npcs: null, kasai: null, 'sub-admin': null, 'sub-sub-admin': null };
  const dimensions = {};
  const cache = new Map();
  const MAX_CACHE = 160;
  const sourceBase = new URL('.', document.currentScript?.src || document.baseURI);
  const stats = { loaded: 0, failed: 0, generated: 0 };

  function surface(w, h) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    return cv;
  }

  // A cell is sliced from the authored grid, never detected from neighbours.
  // Only nearly invisible alpha dust outside the illustrated contour is removed.
  function split(img, rows) {
    const result = [];
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < 4; col++) {
        const x = Math.round(col * width / 4), y = Math.round(row * height / rows);
        const w = Math.round((col + 1) * width / 4) - x;
        const h = Math.round((row + 1) * height / rows) - y;
        const cv = surface(w, h), ctx = cv.getContext('2d');
        ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
        const pixels = ctx.getImageData(0, 0, w, h);
        let left = w, top = h, right = -1, bottom = -1;
        for (let p = 0; p < w * h; p++) {
          const a = pixels.data[p * 4 + 3];
          if (a < 32) { pixels.data[p * 4 + 3] = 0; continue; }
          if (a < 96) continue;
          const px = p % w, py = Math.floor(p / w);
          left = Math.min(left, px); right = Math.max(right, px);
          top = Math.min(top, py); bottom = Math.max(bottom, py);
        }
        ctx.putImageData(pixels, 0, 0);
        result.push(right < left ? null : {
          cv, x: Math.max(0, left - 2), y: Math.max(0, top - 2),
          w: Math.min(w - Math.max(0, left - 2), right - left + 5),
          h: Math.min(h - Math.max(0, top - 2), bottom - top + 5)
        });
      }
    }
    return result;
  }

  // Kasai's authored sheet has directions in rows and walking poses in columns.
  // Fixed measured crops and foot anchors avoid column-margin drift; metadata
  // is also supplied in assets/kasai-overworld-v55.json for asset tooling.
  function splitKasai(img) {
    const width = img.naturalWidth || img.width, height = img.naturalHeight || img.height;
    if (width !== 1086 || height !== 1448) throw new Error('Unexpected Kasai sheet dimensions');
    const columnX = [110, 442, 774], rowY = [13, 369, 725, 1083];
    const feetY = [339, 336, 336, 338], result = [];
    for (let pose = 0; pose < 3; pose++) for (let direction = 0; direction < 4; direction++) {
      result.push({ cv: img, x: columnX[pose], y: rowY[direction], w: 202, h: 350,
        anchorX: 101, anchorY: feetY[direction], fitWidth: 160, fitHeight: 330 });
    }
    return result;
  }

  // This sheet keeps its original RGBA pixels. Fixed crops include the whole
  // coat and hair; measured support-foot anchors share one ground baseline.
  // The same values are documented in assets/sub-admin-overworld-v62.json.
  function splitSubAdmin(img) {
    const width = img.naturalWidth || img.width, height = img.naturalHeight || img.height;
    if (width !== 1086 || height !== 1448) throw new Error('Unexpected secondary administrator sheet dimensions');
    const columnX = [94, 424, 758], rowY = [20, 382, 740, 1097];
    const anchors = [
      [[109, 331], [120, 331], [105, 331]],
      [[93, 329], [101, 325], [106, 325]],
      [[112, 326], [119, 324], [120, 324]],
      [[109, 327], [104, 327], [109, 327]]
    ], result = [];
    for (let pose = 0; pose < 3; pose++) for (let direction = 0; direction < 4; direction++) {
      const [anchorX, anchorY] = anchors[direction][pose];
      result.push({ cv: img, x: columnX[pose], y: rowY[direction], w: 228, h: 338,
        anchorX, anchorY, fitWidth: 200, fitHeight: 325 });
    }
    return result;
  }

  function splitThirdAdmin(img) {
    const width = img.naturalWidth || img.width, height = img.naturalHeight || img.height;
    if (width !== 1086 || height !== 1448) throw new Error('Unexpected third administrator sheet dimensions');
    const columnX = [110, 442, 774], rowY = [10, 374, 730, 1081];
    const anchors = [
      [[97, 343], [100, 343], [102, 343]],
      [[98, 331], [100, 331], [105, 331]],
      [[99, 328], [100, 327], [106, 326]],
      [[102, 343], [104, 343], [103, 344]]
    ], result = [];
    for (let pose = 0; pose < 3; pose++) for (let direction = 0; direction < 4; direction++) {
      const [anchorX, anchorY] = anchors[direction][pose];
      result.push({ cv: img, x: columnX[pose], y: rowY[direction], w: 220, h: 350,
        anchorX, anchorY, fitWidth: 180, fitHeight: 336 });
    }
    return result;
  }

  function load(name, file, rows, splitter = split) {
    return new Promise(resolve => {
      const img = new Image();
      let settled = false, done = false;
      const release = () => { if (settled) return; settled = true; clearTimeout(timer); resolve(); };
      const finish = success => {
        if (done) return;
        done = true;
        const late = settled;
        img.onload = img.onerror = null;
        if (!success) stats.failed++;
        release();
        if (success && late) document.dispatchEvent(new Event('pachi-art-ready'));
      };
      const timer = setTimeout(release, 12000);
      img.onload = () => {
        if (done) return;
        try {
          const cells = splitter(img, rows);
          if (cells.some(cell => !cell)) throw new Error('An authored traveller view is empty');
          atlas[name] = cells;
          dimensions[name] = { width: Math.max(...cells.map(cell => cell.fitWidth || cell.w)), height: Math.max(...cells.map(cell => cell.fitHeight || cell.h)) };
          // A late or replacement atlas must not keep an older extracted pose.
          cache.clear(); stats.loaded++; finish(true);
        }
        catch (error) { console.warn('Traveller art unavailable:', file, error); finish(false); }
      };
      img.onerror = () => finish(false);
      img.src = new URL('assets/' + file, sourceBase).href;
    });
  }

  function roleFor(kind) {
    if (kind === 'rest') return 0;
    if (kind === 'shop') return 1;
    if (['guardian', 'elite', 'rival', 'tower', 'champion'].includes(kind)) return 2;
    return 3;
  }

  function varyCloth(ctx, role, variant) {
    if (!variant) return;
    const pixels = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    const shifts = [[0, 0, 0], [12, 2, -6], [-7, 5, 10], [7, -6, 12]];
    const shift = shifts[variant];
    for (let i = 0; i < pixels.data.length; i += 4) {
      const r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2];
      if (pixels.data[i + 3] < 32) continue;
      const cloth = role === 2 ? b > g * 1.08 && b >= r : g > r * 1.04 && g >= b * .94;
      if (!cloth) continue;
      for (let c = 0; c < 3; c++) pixels.data[i + c] = Math.max(0, Math.min(255, pixels.data[i + c] + shift[c]));
    }
    ctx.putImageData(pixels, 0, 0);
  }

  function get(kind = 'hero', facing = 'down', frame = 0, id = 0, resolution = 1) {
    const density = resolution >= 2 ? 2 : 1;
    const female = kind === 'hero-female', special = kind === 'kasai' || kind === 'sub-admin' || kind === 'sub-sub-admin', hero = kind === 'hero' || female || special, atlasName = special ? kind : hero ? (female ? 'female' : 'hero') : 'npcs', cells = atlas[atlasName];
    if (!cells) return null;
    const direction = Math.max(0, directions.indexOf(facing));
    const pose = Math.max(0, Math.min(2, Number.isFinite(frame) ? Math.trunc(frame) : 0));
    const role = hero ? 0 : roleFor(kind);
    const variant = hero ? 0 : (Number(id) >>> 0) % 4;
    const key = [hero ? atlasName : role, direction, hero ? pose : 0, variant, density].join(':');
    if (cache.has(key)) return cache.get(key);
    const source = cells[(hero ? pose : role) * 4 + direction];
    if (!source) return null;
    const cv = surface(96 * density, 128 * density), ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    // One measured scale per sheet preserves stride proportions, even when a
    // newly authored sheet has a different source resolution. Portraits keep
    // their existing 2× dimensions and share the field view's logical dot size.
    const extent = dimensions[atlasName];
    const scale = Math.min(112 / extent.height, 88 / extent.width) * density;
    const w = Math.max(1, Math.round(source.w * scale)), h = Math.max(1, Math.round(source.h * scale));
    const x = source.anchorX === undefined ? Math.round((cv.width - w) / 2) : Math.round(48 * density - source.anchorX * scale);
    const y = source.anchorY === undefined ? 122 * density - h : Math.round(122 * density - source.anchorY * scale);
    ctx.fillStyle = '#253f4938';
    // Hard-edged scanlines keep the contact shadow on the same pixel grid.
    for (let row = -3; row <= 3; row++) {
      const half = Math.round(19 * Math.sqrt(1 - row * row / 16));
      ctx.fillRect((48 - half) * density, (121 + row) * density, half * 2 * density, density);
    }
    ctx.drawImage(source.cv, source.x, source.y, source.w, source.h, x, y, w, h);
    if (!hero) varyCloth(ctx, role, variant);
    // Sample only this derived view. Source poses, colours, feet baseline and
    // its output dimensions stay intact; high-density portraits use the same
    // 48×64 logical grid as their 96×128 field counterparts.
    LT.ScenePixels?.apply?.(cv, { step: 2 * density });
    cache.set(key, cv); stats.generated++;
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    return cv;
  }

  LT.TravellerArt = {
    ready: Promise.all([load('hero', 'traveller-hero-v33.png', 3), load('female', 'traveller-female-v33.png', 3), load('npcs', 'traveller-npcs-v33.png', 4), load('kasai', 'kasai-overworld-v55.png', 4, splitKasai), load('sub-admin', 'sub-admin-overworld-v62.png', 4, splitSubAdmin), load('sub-sub-admin', 'sub-sub-admin-overworld-v62.png', 4, splitThirdAdmin)]),
    get, stats, status() { return { loaded: stats.loaded, failed: stats.failed, cached: cache.size, maximum: MAX_CACHE, portraitSize: [192, 256] }; }, clearCache() { cache.clear(); },
    atlasLayout: { columns: directions.slice(), heroRows: ['idle', 'leftStride', 'rightStride'], avatars: ['male','female'], specialAvatars: ['kasai','sub-admin','sub-sub-admin'], npcRows: ['rest', 'shop', 'guardian', 'dialogue'] }
  };
})();
