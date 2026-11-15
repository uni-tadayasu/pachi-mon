/* Original Pachi Monsters traveller art — © 2026 KASAI SOLUTIONS INC.
 * Generated with OpenAI image generation for this original game: detailed pixel
 * traveller (teal coat, ochre cap, rust scarf), four NPC professions, four views.
 * Lossless WebP exports preserve the authored pixels and transparent alpha.
 * Image atlases are authored for this project. Runtime extraction retains the
 * transparent silhouettes and a shared feet baseline for world depth sorting.
 */
(() => {
  'use strict';
  const LT = globalThis.LT = globalThis.LT || {};
  const directions = ['down', 'left', 'right', 'up'];
  const atlas = { hero: null, npcs: null };
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

  function load(name, file, rows) {
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
        try { atlas[name] = split(img, rows); stats.loaded++; finish(true); }
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
    const pixels = ctx.getImageData(0, 0, 96, 128);
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

  function get(kind = 'hero', facing = 'down', frame = 0, id = 0) {
    const hero = kind === 'hero', cells = atlas[hero ? 'hero' : 'npcs'];
    if (!cells) return null;
    const direction = Math.max(0, directions.indexOf(facing));
    const pose = Math.max(0, Math.min(2, Number.isFinite(frame) ? Math.trunc(frame) : 0));
    const role = hero ? 0 : roleFor(kind);
    const variant = hero ? 0 : (Number(id) >>> 0) % 4;
    const key = [hero ? 'hero' : role, direction, hero ? pose : 0, variant].join(':');
    if (cache.has(key)) return cache.get(key);
    const source = cells[(hero ? pose : role) * 4 + direction];
    if (!source) return null;
    const cv = surface(96, 128), ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    // Shared per-atlas scale preserves the authored walking stride proportions.
    const scale = hero ? 112 / 372 : 112 / 295;
    const w = Math.round(source.w * scale), h = Math.round(source.h * scale);
    const x = Math.round((96 - w) / 2), y = 122 - h;
    ctx.fillStyle = '#253f4938';
    ctx.beginPath(); ctx.ellipse(48, 121, 19, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(source.cv, source.x, source.y, source.w, source.h, x, y, w, h);
    if (!hero) varyCloth(ctx, role, variant);
    cache.set(key, cv); stats.generated++;
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    return cv;
  }

  LT.TravellerArt = {
    ready: Promise.all([load('hero', 'traveller-hero.webp', 3), load('npcs', 'traveller-npcs.webp', 4)]),
    get, stats, clearCache() { cache.clear(); },
    atlasLayout: { columns: directions.slice(), heroRows: ['idle', 'leftStride', 'rightStride'], npcRows: ['rest', 'shop', 'guardian', 'dialogue'] }
  };
})();
