/* Original Pachi Monsters battle landscape atlas, commissioned for this project.
 * ImageGen prompt: sixteen independent finely detailed pixel-art environments in
 * a strict 4x4 atlas, clear foreground, no characters, labels or franchise assets.
 * Row-major themes: village meadow forest coast / harbor grotto ruins desert /
 * glacier volcano observatory tower / league autumn moonlake highland.
 */
(() => {
  'use strict';
  const LT = globalThis.LT = globalThis.LT || {};
  const themes = ['village','meadow','forest','coast','harbor','grotto','ruins','desert',
    'glacier','volcano','observatory','tower','league','autumn','moonlake','highland'];
  const cache = new Map();
  const atlas = new Image();
  let loaded = false;
  const ready = new Promise(resolve => {
    let settled = false, done = false;
    const release = ok => { if (settled) return; settled = true; clearTimeout(timer); resolve(ok); };
    const finish = ok => {
      if (done) return;
      done = true;
      const late = settled;
      atlas.onload = atlas.onerror = null;
      loaded = ok && atlas.naturalWidth >= 16 && atlas.naturalHeight >= 16;
      release(loaded);
      if (loaded && late) document.dispatchEvent(new Event('pachi-art-ready'));
    };
    const timer = setTimeout(() => release(false), 15000);
    atlas.onload = () => finish(true);
    atlas.onerror = () => finish(false);
    atlas.src = 'assets/battle-landscapes-v7.webp';
  });
  function get(theme, width, height) {
    if (!loaded || !Number.isFinite(width) || !Number.isFinite(height)) return null;
    const w = Math.round(width), h = Math.round(height);
    if (w < 1 || h < 1 || w > 4096 || h > 4096) return null;
    const index = Math.max(0, themes.indexOf(theme));
    const key = `${index}:${w}:${h}`;
    if (cache.has(key)) {
      const result = cache.get(key);
      cache.delete(key); cache.set(key,result);
      return result;
    }
    const col = index % 4, row = Math.floor(index / 4);
    // Inset one source pixel keeps adjacent cells outside the sampling rectangle.
    let sx = Math.round(col * atlas.naturalWidth / 4) + 1;
    let sy = Math.round(row * atlas.naturalHeight / 4) + 1;
    let sw = Math.round((col + 1) * atlas.naturalWidth / 4) - sx - 1;
    let sh = Math.round((row + 1) * atlas.naturalHeight / 4) - sy - 1;
    const ratio = w / h;
    if (sw / sh > ratio) { const cw = sh * ratio; sx += (sw - cw) / 2; sw = cw; }
    else { const ch = sw / ratio; sy += (sh - ch) * .4; sh = ch; }
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
    c.drawImage(atlas,sx,sy,sw,sh,0,0,w,h);
    // Apply the scene's display grid before caching, keeping the original
    // atlas, crop and output size. The text/HUD is rendered independently.
    LT.ScenePixels?.apply?.(cv, { long: 384 });
    cache.set(key,cv);
    while (cache.size > 4) cache.delete(cache.keys().next().value);
    return cv;
  }
  LT.BattleArt = {ready,get,clearCache(){cache.clear();},themes:Object.freeze(themes)};
})();
