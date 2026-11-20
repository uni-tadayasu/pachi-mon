#!/usr/bin/env python3
"""Compatibility entry point for the shared game-renderer thumbnail exporter.

Canonical command: node scripts/build-dex-sprites.cjs
The Node exporter uses the game's CreatureArt and MonsterPixels modules and
writes lossless 96x96 WebP files for the public encyclopedia only.
"""
from pathlib import Path
import subprocess
import sys

if __name__ == '__main__':
    script = Path(__file__).resolve().with_suffix('.cjs')
    sys.exit(subprocess.call(['node', str(script), *sys.argv[1:]]))
