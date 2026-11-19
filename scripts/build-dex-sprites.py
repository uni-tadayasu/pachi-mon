#!/usr/bin/env python3
"""Cut one small front sprite per species for the static encyclopedia pages.

Reads the per-species atlas coordinates from assets/creatures-individual-catalog.js
plus the three special-creature images, and writes lossless 96x96 WebP thumbnails.
Each original front view is fitted directly within 88px on the final 96x96
canvas with nearest-neighbor sampling, preserving fine details and crisp pixels.
Requires Pillow. Re-run after artwork changes:  python3 scripts/build-dex-sprites.py
"""
import json, re, sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'dex'
SIZE = 96
MARGIN = 4

def fit(img):
    img = img.convert('RGBA')
    box = img.getchannel('A').getbbox()
    if box:
        img = img.crop(box)
    scale = min((SIZE - MARGIN * 2) / img.width,
                (SIZE - MARGIN * 2) / img.height)
    w, h = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    img = img.resize((w, h), Image.NEAREST)
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    # Unmasked paste preserves each sampled RGBA value, including partial alpha.
    canvas.paste(img, ((SIZE - w) // 2, SIZE - h - MARGIN))
    return canvas

def main():
    text = (ROOT / 'assets' / 'creatures-individual-catalog.js').read_text(encoding='utf-8')
    catalog = json.loads(re.search(r'IndividualArtCatalog=(\{.*\});', text, re.S).group(1))
    OUT.mkdir(parents=True, exist_ok=True)
    atlases = {}
    count = 0
    for sid, entry in catalog['species'].items():
        path = ROOT / entry['file']
        if path not in atlases:
            atlases[path] = Image.open(path).convert('RGBA')
        x, y, w, h = entry['front']
        fit(atlases[path].crop((x, y, x + w, y + h))).save(OUT / f'{sid}.webp', 'WEBP', lossless=True, method=6, exact=True)
        count += 1
    # Special creatures ship as their own images (two-view atlases: left cell is the front view).
    specials = {'arvelion': ('arvelion.png', 'left'), 'floravelle': ('floravelle.png', 'left'), 'futo': ('futo-front-v2.png', 'full')}
    for sid, (name, cell) in specials.items():
        img = Image.open(ROOT / 'assets' / name).convert('RGBA')
        if cell == 'left':
            img = img.crop((0, 0, img.width // 2, img.height))
        fit(img).save(OUT / f'{sid}.webp', 'WEBP', lossless=True, method=6, exact=True)
        count += 1
    print(f'wrote {count} sprites to {OUT.relative_to(ROOT)}')

if __name__ == '__main__':
    sys.exit(main())
