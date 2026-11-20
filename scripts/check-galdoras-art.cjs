#!/usr/bin/env node
'use strict';
// Compatibility entry: v67 replaces the former per-view/per-species files with
// shared atlases. The consolidated real-canvas test retains front/rear, shiny,
// missing-image, delayed recovery, off-dex isolation and save-identity coverage.
// It also checks both unchanged v54 rock forms; retired art is never required.
require('./check-original-art.cjs');
