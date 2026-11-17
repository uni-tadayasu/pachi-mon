/* パチモン｜Pachi Monsters — retro screen modes.
 * Re-samples each rendered frame onto a coarse pixel grid and, for the LCD
 * modes, maps it to four shades through an SVG colour table. Everything stays
 * on the drawing pipeline (drawImage + ctx.filter); no pixels are read back.
 * © 2026 KASAI SOLUTIONS INC. */
(() => {
  'use strict';
  const LT = globalThis.LT = globalThis.LT || {};
  if (LT.RetroScreen) return;
  // `long` is the length of the frame's long side on the virtual LCD, in dots.
  const MODES = Object.freeze({
    pocket: Object.freeze({ id: 'pocket', label: '携帯機風（240ドット・32768色）', short: 'POCKET', long: 240, levels: 32, saturate: 1.16 }),
    dot: Object.freeze({ id: 'dot', label: '16ビット風（384ドット）', short: 'DOT', long: 384, levels: 12 }),
    leaf: Object.freeze({ id: 'leaf', label: '若葉液晶（4階調）', short: 'LEAF', long: 300, palette: ['#13280f', '#3b5a24', '#87a438', '#c6d681'] }),
    sepia: Object.freeze({ id: 'sepia', label: 'セピア液晶（4階調）', short: 'SEPIA', long: 300, palette: ['#29180c', '#6c4426', '#c08a4b', '#f3daa5'] }),
    night: Object.freeze({ id: 'night', label: '月夜液晶（4階調）', short: 'NIGHT', long: 300, palette: ['#0c0f2d', '#2e3c7b', '#7e9dda', '#e0e8ff'] }),
    mono: Object.freeze({ id: 'mono', label: 'モノクロ液晶（4階調）', short: 'MONO', long: 300, palette: ['#1b1b1b', '#585858', '#a8a8a8', '#ebebeb'] }),
    color: Object.freeze({ id: 'color', label: 'フルカラー（高精細）', short: 'HD', long: 0 })
  });
  const ORDER = Object.freeze(['pocket', 'dot', 'leaf', 'sepia', 'night', 'mono', 'color']);
  const DEFAULT = 'pocket';
  const surfaces = new Map();
  let filtersReady = false, filterSupport = null, ditherPattern = null;

  const hex = value => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255);
  const table = values => values.map(v => v.toFixed(4)).join(' ');

  function supportsCanvasFilter() {
    if (filterSupport !== null) return filterSupport;
    try {
      const probe = document.createElement('canvas').getContext('2d');
      probe.filter = 'url(#pm-retro-probe)';
      filterSupport = typeof probe.filter === 'string' && probe.filter.includes('url');
    } catch (_) { filterSupport = false; }
    return filterSupport;
  }

  function installFilters() {
    if (filtersReady || typeof document === 'undefined' || !document.body) return filtersReady;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    const defs = document.createElementNS(ns, 'defs');
    for (const mode of Object.values(MODES)) {
      if (!mode.palette && !mode.levels) continue;
      const filter = document.createElementNS(ns, 'filter');
      filter.setAttribute('id', 'pm-retro-' + mode.id);
      filter.setAttribute('color-interpolation-filters', 'sRGB');
      filter.setAttribute('x', '0'); filter.setAttribute('y', '0');
      filter.setAttribute('width', '1'); filter.setAttribute('height', '1');
      if (mode.palette) {
        // Luminance → slight contrast lift → four discrete shades of the palette.
        const matrix = document.createElementNS(ns, 'feColorMatrix');
        matrix.setAttribute('type', 'matrix');
        // Green carries less weight than in broadcast luma so foliage and stone land on different shades.
        matrix.setAttribute('values', '0.5 0.3 0.2 0 0 0.5 0.3 0.2 0 0 0.5 0.3 0.2 0 0 0 0 0 1 0');
        const contrast = document.createElementNS(ns, 'feComponentTransfer');
        for (const channel of ['R', 'G', 'B']) {
          const fn = document.createElementNS(ns, 'feFunc' + channel);
          fn.setAttribute('type', 'linear'); fn.setAttribute('slope', '1.3'); fn.setAttribute('intercept', '-0.12');
          contrast.appendChild(fn);
        }
        const shades = mode.palette.map(hex);
        const map = document.createElementNS(ns, 'feComponentTransfer');
        ['R', 'G', 'B'].forEach((channel, index) => {
          const fn = document.createElementNS(ns, 'feFunc' + channel);
          fn.setAttribute('type', 'discrete');
          fn.setAttribute('tableValues', table(shades.map(rgb => rgb[index])));
          map.appendChild(fn);
        });
        filter.append(matrix, contrast, map);
      } else {
        // Optional handheld-style saturation, then coarse colour steps per channel.
        if (mode.saturate) {
          const saturate = document.createElementNS(ns, 'feColorMatrix');
          saturate.setAttribute('type', 'saturate'); saturate.setAttribute('values', String(mode.saturate));
          filter.appendChild(saturate);
        }
        const steps = Array.from({ length: mode.levels }, (_, i) => i / (mode.levels - 1));
        const post = document.createElementNS(ns, 'feComponentTransfer');
        for (const channel of ['R', 'G', 'B']) {
          const fn = document.createElementNS(ns, 'feFunc' + channel);
          fn.setAttribute('type', 'discrete'); fn.setAttribute('tableValues', table(steps));
          post.appendChild(fn);
        }
        filter.appendChild(post);
      }
      defs.appendChild(filter);
    }
    svg.appendChild(defs);
    document.body.appendChild(svg);
    filtersReady = true;
    return true;
  }

  function surface(key, width, height) {
    let entry = surfaces.get(key);
    if (!entry) {
      const canvas = document.createElement('canvas');
      entry = { canvas, ctx: canvas.getContext('2d') };
      surfaces.set(key, entry);
    }
    if (entry.canvas.width !== width || entry.canvas.height !== height) {
      entry.canvas.width = width; entry.canvas.height = height;
    }
    return entry;
  }

  function dither(ctx) {
    if (ditherPattern) return ditherPattern;
    const tile = document.createElement('canvas');
    tile.width = tile.height = 4;
    const t = tile.getContext('2d'), image = t.createImageData(4, 4);
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    bayer.forEach((value, i) => { const v = Math.round(128 + (value / 15 - .5) * 16); image.data.set([v, v, v, 255], i * 4); });
    t.putImageData(image, 0, 0);
    ditherPattern = ctx.createPattern(tile, 'repeat');
    return ditherPattern;
  }

  function apply(canvas, id = DEFAULT) {
    const mode = MODES[id] || MODES[DEFAULT];
    if (!canvas || !mode.long || canvas.width < 64 || canvas.height < 40) return false;
    if (typeof document === 'undefined') return false;
    installFilters();
    const scale = Math.min(1, mode.long / Math.max(canvas.width, canvas.height));
    const width = Math.max(32, Math.round(canvas.width * scale)), height = Math.max(20, Math.round(canvas.height * scale));
    // Two-step reduction averages fine texture instead of aliasing it into noise.
    const mid = surface('mid', Math.max(width, Math.ceil(canvas.width / 2)), Math.max(height, Math.ceil(canvas.height / 2)));
    const raw = surface('raw', width, height), out = surface('out', width, height);
    mid.ctx.save();
    mid.ctx.setTransform(1, 0, 0, 1, 0, 0);
    mid.ctx.imageSmoothingEnabled = true;
    try { mid.ctx.imageSmoothingQuality = 'high'; } catch (_) {}
    mid.ctx.globalCompositeOperation = 'copy';
    mid.ctx.drawImage(canvas, 0, 0, mid.canvas.width, mid.canvas.height);
    mid.ctx.restore();
    raw.ctx.save();
    raw.ctx.setTransform(1, 0, 0, 1, 0, 0);
    raw.ctx.imageSmoothingEnabled = true;
    try { raw.ctx.imageSmoothingQuality = 'high'; } catch (_) {}
    raw.ctx.globalCompositeOperation = 'copy';
    raw.ctx.drawImage(mid.canvas, 0, 0, width, height);
    raw.ctx.globalCompositeOperation = 'source-over';
    if (mode.palette) {
      raw.ctx.globalCompositeOperation = 'overlay';
      raw.ctx.fillStyle = dither(raw.ctx);
      raw.ctx.fillRect(0, 0, width, height);
      raw.ctx.globalCompositeOperation = 'source-over';
    }
    raw.ctx.restore();
    let source = raw.canvas;
    if ((mode.palette || mode.levels) && supportsCanvasFilter()) {
      out.ctx.save();
      out.ctx.setTransform(1, 0, 0, 1, 0, 0);
      out.ctx.globalCompositeOperation = 'copy';
      out.ctx.filter = `url(#pm-retro-${mode.id})`;
      out.ctx.drawImage(raw.canvas, 0, 0);
      out.ctx.restore();
      source = out.canvas;
    }
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'copy';
    ctx.filter = 'none';
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, width, height, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    return true;
  }

  const next = id => ORDER[(Math.max(0, ORDER.indexOf(id)) + 1) % ORDER.length];
  // Menu portraits follow the same era: 64-dot sprites (40 for small icons) unless HD is chosen.
  const portraitRaster = (id, size) => (MODES[id] || MODES[DEFAULT]).long ? (size <= 60 ? 40 : 64) : Math.max(256, Math.ceil(size * 2));
  LT.RetroScreen = Object.freeze({ modes: MODES, order: ORDER, defaultMode: DEFAULT, apply, next, portraitRaster,
    label: id => (MODES[id] || MODES[DEFAULT]).label, isMode: id => Object.hasOwn(MODES, id) });
})();
