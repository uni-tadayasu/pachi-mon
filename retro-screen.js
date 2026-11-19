/* パチモン｜Pachi Monsters — full-detail colour / monochrome display.
 * Live game canvases use the scoped CSS grayscale filter so both modes keep
 * their native resolution without reading every animation frame back to CPU.
 * apply() is the same-size pixel fallback for standalone / offscreen canvases;
 * it does not depend on CanvasRenderingContext2D.filter or SVG filter support.
 * © 2026 KASAI SOLUTIONS INC. */
(() => {
  'use strict';
  const LT = globalThis.LT = globalThis.LT || {};
  if (LT.RetroScreen) return;
  const MODES = Object.freeze({
    color: Object.freeze({ id: 'color', label: 'カラー', short: 'COLOR', long: 0 }),
    mono: Object.freeze({ id: 'mono', label: 'モノクロ', short: 'MONO', long: 0 })
  });
  const ORDER = Object.freeze(['color', 'mono']);
  const DEFAULT = 'color', PREFERENCE_VERSION = 3;
  const isMode = id => id === 'color' || id === 'mono';

  function apply(canvas, id = DEFAULT) {
    if (id !== 'mono' || !canvas || !canvas.width || !canvas.height || typeof canvas.getContext !== 'function') return false;
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height), pixels = image.data;
      // These sRGB luma coefficients match CSS grayscale(1). Each source pixel
      // stays in place, all 256 output shades remain available, and alpha is
      // untouched. No resampling, contrast steps, dithering or palette mapping.
      for (let i = 0; i < pixels.length; i += 4) {
        if (!pixels[i + 3]) continue;
        const shade = Math.round(pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722);
        pixels[i] = pixels[i + 1] = pixels[i + 2] = shade;
      }
      // Browser putImageData ignores drawing state. Save / reset it as well
      // for native canvas implementations that apply a current transform.
      ctx.save();
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'copy';
        ctx.putImageData(image, 0, 0);
      } finally { ctx.restore(); }
      return true;
    } catch (_) {
      // A cross-origin image may make pixel readback unavailable. The live
      // display's CSS monochrome filter does not need access to those pixels.
      return false;
    }
  }

  const next = id => id === 'color' ? 'mono' : DEFAULT;
  // Both display modes use the same authored high-detail portrait raster.
  // Small icons use 128px; larger views use 320–512px. PortraitLoader still
  // releases canvases outside the visible area, keeping the memory bound.
  const portraitRaster = (_id, size) => {
    const pixels = Number.isFinite(Number(size)) && Number(size) > 0 ? Number(size) : 88;
    return pixels <= 60 ? 128 : Math.min(512, Math.max(320, Math.ceil(pixels * 2)));
  };
  function preference(saved) {
    // Only the old monochrome choice survives. Removed presets, hidden glitch
    // mode and unknown values safely become colour, including explicit picks.
    // Return display keys only: the caller retains sound and other settings.
    return {
      screen: saved?.screen === 'mono' ? 'mono' : DEFAULT,
      screenExplicit: saved?.screenExplicit === true,
      screenVersion: PREFERENCE_VERSION
    };
  }
  LT.RetroScreen = Object.freeze({ modes: MODES, order: ORDER, defaultMode: DEFAULT, apply, next, portraitRaster, preference,
    label: id => MODES[isMode(id) ? id : DEFAULT].label, isMode });
})();
