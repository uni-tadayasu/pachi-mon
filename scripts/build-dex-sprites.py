#!/usr/bin/env python3
"""Cut one small front sprite per species for the static encyclopedia pages.

Reads the per-species atlas coordinates from assets/creatures-individual-catalog.js
plus the three special-creature images, and writes assets/dex/<id>.webp (96x96).
Requires Pillow. Re-run after artwork changes:  python3 scripts/build-dex-sprites.py
"""
import json, re, sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'dex'
SIZE = 96

def fit(img):
    img = img.convert('RGBA')
    box = img.getbbox()
    if box:
        img = img.crop(box)
    scale = min((SIZE - 6) / img.width, (SIZE - 6) / img.height)
    w, h = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    # Two-step reduction keeps the dot texture readable at 96px.
    if scale < .5:
        img = img.resize((w * 2, h * 2), Image.LANCZOS)
    img = img.resize((w, h), Image.LANCZOS)
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    canvas.alpha_composite(img, ((SIZE - w) // 2, SIZE - h - 3))
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
        fit(atlases[path].crop((x, y, x + w, y + h))).save(OUT / f'{sid}.webp', 'WEBP', quality=90, method=6)
        count += 1
    # Special creatures ship as their own images (two-view atlases: left cell is the front view).
    specials = {'arvelion': ('arvelion.png', 'left'), 'floravelle': ('floravelle.png', 'left'), 'futo': ('futo-front-v2.png', 'full')}
    for sid, (name, cell) in specials.items():
        img = Image.open(ROOT / 'assets' / name).convert('RGBA')
        if cell == 'left':
            img = img.crop((0, 0, img.width // 2, img.height))
        fit(img).save(OUT / f'{sid}.webp', 'WEBP', quality=90, method=6)
        count += 1
    print(f'wrote {count} sprites to {OUT.relative_to(ROOT)}')

if __name__ == '__main__':
    sys.exit(main())
