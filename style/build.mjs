/**
 * Generates style/cyberpunk.json: the Cyberpunk 2077 in-game MAP look
 * (the full-screen map menu, patch 2.x) over real OpenStreetMap streets.
 *
 * Colors were MEASURED (PIL pixel medians) from real 2.x map screenshots,
 * not picked by eye: navy ground, wide translucent cyan road ribbons with
 * lighter edges, red 3D building blocks, white dashed metro, yellow GPS
 * route (route-layer.ts), green player chevron (map.ts). No game assets.
 *
 * Roads are translucent on purpose: where two overlap (junctions,
 * overpasses) they get brighter, exactly like the game. Rerun after edits:
 *   node style/build.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CLASS_TO_ICON, FALLBACK_ICON, spriteName } from '../assets/lib/poi-icons.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'cyberpunk.json');

// ---------------------------------------------------------------- palette
//
// Measured values in comments. Where a value deviates, it says why.

const P = {
  bg: '#041129', // game ground, measured
  // Game water is #03142b, i.e. the same as the ground. Slightly darker
  // here so a real coastline is still readable while driving.
  water: '#020a1d',
  park: '#05142f', // the game shows no parks: a barely-there hint
  road: '#2a9ab5', // at 0.6 opacity over bg renders ~#1b637d (game median #1e6c82)
  roadEdge: '#3fd0ee', // the lighter ribbon edges
  buildLow: '#3a070a', // renders ~#4b1319 (game body) once lit and blended
  buildHigh: '#4f0f15', // taller = a bit lighter, like the game's near towers
  buildRim: '#89414a', // game lit rims, measured
  metro: '#b3bcbb', // game white dashed metro line, measured
  red: '#ff6159', // game UI red (MainColors.Red)
  cyan: '#5ef6ff', // game UI cyan (MainColors.Blue)
  textDim: '#5d8ea6',
  halo: '#020814',
};

// ------------------------------------------------- road table
//
// w: [zoom, ribbon_width_px]. The game draws streets as WIDE ribbons, much
// wider than a normal map, so these grow fast with zoom.

const ROADS = [
  { key: 'minor', classes: ['minor', 'service', 'track'], minzoom: 12,
    w: [[12, 0.32], [14, 1.12], [15, 2.8], [17, 7.2], [19, 19.2], [20, 32]] },
  { key: 'tertiary', classes: ['tertiary'], minzoom: 10,
    w: [[10, 0.4], [13, 1.92], [15, 4.8], [17, 11.2], [19, 30.4], [20, 48]] },
  { key: 'secondary', classes: ['secondary'], minzoom: 9,
    w: [[9, 0.48], [13, 2.56], [15, 6], [17, 14.4], [19, 38.4], [20, 60.8]] },
  { key: 'primary', classes: ['primary'], minzoom: 7,
    w: [[7, 0.4], [11, 1.28], [13, 3.2], [15, 7.2], [17, 17.6], [19, 46.4], [20, 73.6]] },
  { key: 'motorway', classes: ['motorway', 'trunk'], minzoom: 5,
    w: [[5, 0.48], [10, 1.6], [13, 4], [15, 8.8], [17, 20.8], [19, 56], [20, 88]] },
];

// ------------------------------------------------------------- helpers

/** [[z,v],...] -> exponential interpolate expression over zoom */
const zoomW = (stops, mul = 1) => [
  'interpolate',
  ['exponential', 1.5],
  ['zoom'],
  ...stops.flatMap(([z, v]) => [z, Number((v * mul).toFixed(2))]),
];

const notTunnel = ['!=', ['get', 'brunnel'], 'tunnel'];

const roadFilter = (classes, extra = []) => [
  'all',
  ['==', ['geometry-type'], 'LineString'],
  ['match', ['get', 'class'], classes, true, false],
  ...extra,
];

/**
 * A road class as the game draws it: a translucent ribbon, plus its two
 * lighter edges. The edges use `line-gap-width` (two thin lines either side
 * of a gap the ribbon's width) because a classic wider "casing" line
 * underneath would show through the translucent fill.
 */
function road(r, part) {
  const base = {
    id: `road-${r.key}-${part}`,
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'transportation',
    minzoom: r.minzoom,
    filter: roadFilter(r.classes, [notTunnel]),
    // Butt caps: translucent round caps overlap where a street's segments
    // meet and draw bright "beads" all along it.
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
  };
  if (part === 'fill') {
    return {
      ...base,
      paint: { 'line-color': P.road, 'line-width': zoomW(r.w), 'line-opacity': 0.6 },
    };
  }
  return {
    ...base,
    minzoom: Math.max(r.minzoom, 13),
    paint: {
      'line-color': P.roadEdge,
      'line-width': zoomW([[13, 0.5], [16, 1], [19, 1.6]]),
      'line-gap-width': zoomW(r.w),
      'line-opacity': 0.55,
    },
  };
}

/**
 * icon-image: picks the icon based on business type.
 *
 * Classes are grouped by icon so the expression comes out compact (15
 * branches instead of 130) and so the table in assets/lib/poi-icons.mjs
 * stays the single place where it's decided which icon each business gets.
 */
const iconExpr = (() => {
  const byIcon = new Map();
  for (const [cls, icon] of CLASS_TO_ICON) {
    if (!byIcon.has(icon)) byIcon.set(icon, []);
    byIcon.get(icon).push(cls);
  }
  const branches = [];
  for (const [icon, classes] of byIcon) branches.push(classes, spriteName(icon));
  return ['match', ['get', 'class'], ...branches, spriteName(FALLBACK_ICON)];
})();

const fillPoly = (id, sourceLayer, color, opacity, extra = {}) => ({
  id,
  type: 'fill',
  source: 'openmaptiles',
  'source-layer': sourceLayer,
  paint: { 'fill-color': color, 'fill-opacity': opacity },
  ...extra,
});

// -------------------------------------------------------------- layers

const layers = [
  { id: 'background', type: 'background', paint: { 'background-color': P.bg } },

  fillPoly('park', 'park', P.park, 0.6, { minzoom: 8 }),

  fillPoly('water', 'water', P.water, 1, {
    filter: ['!=', ['get', 'brunnel'], 'tunnel'],
  }),
  {
    id: 'waterway',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'waterway',
    minzoom: 9,
    paint: {
      'line-color': P.water,
      'line-width': zoomW([[9, 0.5], [14, 1.6], [18, 5]]),
    },
  },

  // --- tunnels: faint dashed ribbon
  {
    id: 'road-tunnel',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'transportation',
    minzoom: 13,
    filter: ['all',
      ['==', ['geometry-type'], 'LineString'],
      ['==', ['get', 'brunnel'], 'tunnel'],
    ],
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': P.road,
      'line-width': zoomW([[13, 1], [16, 4], [20, 16]]),
      'line-dasharray': [2, 2],
      'line-opacity': 0.25,
    },
  },

  // --- roads: all ribbons first (minor at the bottom), then all edges
  ...ROADS.map((r) => road(r, 'fill')),
  ...ROADS.map((r) => road(r, 'edge')),

  // --- metro / rail: white dashed, like the game's metro line
  {
    id: 'rail',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'transportation',
    minzoom: 11,
    filter: roadFilter(['rail', 'transit']),
    paint: {
      'line-color': P.metro,
      'line-width': zoomW([[11, 0.8], [15, 2], [19, 4]]),
      'line-dasharray': [3, 2],
      'line-opacity': 0.75,
    },
  },

  // --- buildings: red translucent 3D blocks. Opacity < 1 because the game's
  // blocks let the roads behind them show through faintly.
  {
    id: 'building-3d',
    type: 'fill-extrusion',
    source: 'openmaptiles',
    'source-layer': 'building',
    minzoom: 13,
    paint: {
      'fill-extrusion-color': [
        'interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 5],
        0, P.buildLow,
        60, P.buildHigh,
      ],
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 5],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.88,
      'fill-extrusion-vertical-gradient': true,
    },
  },
  {
    id: 'building-rim',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'building',
    minzoom: 15,
    paint: {
      'line-color': P.buildRim,
      'line-width': zoomW([[15, 0.3], [18, 0.8], [20, 1.4]]),
      'line-opacity': 0.45,
    },
  },

  {
    id: 'boundary',
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'boundary',
    filter: ['all', ['<=', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
    paint: {
      'line-color': P.red,
      'line-width': zoomW([[3, 0.5], [8, 1.2], [14, 2.5]]),
      'line-dasharray': [4, 3],
      'line-opacity': 0.35,
    },
  },

  // --- labels. Uppercase + letter-spacing = HUD look.
  {
    id: 'water-label',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'water_name',
    minzoom: 8,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': zoomW([[8, 9], [14, 13]]),
      'text-letter-spacing': 0.22,
      'text-transform': 'uppercase',
      'text-max-width': 8,
    },
    paint: {
      'text-color': '#2a6f8f',
      'text-halo-color': P.halo,
      'text-halo-width': 1.2,
      'text-opacity': 0.9,
    },
  },
  {
    id: 'road-label',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'transportation_name',
    minzoom: 13,
    layout: {
      'symbol-placement': 'line',
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': zoomW([[13, 9], [16, 11], [20, 14]]),
      'text-letter-spacing': 0.14,
      'text-transform': 'uppercase',
      'text-rotation-alignment': 'map',
      'text-pitch-alignment': 'viewport',
      'symbol-spacing': 320,
    },
    paint: {
      'text-color': P.cyan,
      'text-opacity': 0.65,
      'text-halo-color': P.halo,
      'text-halo-width': 1.6,
      'text-halo-blur': 0.4,
    },
  },
  {
    // Icon and label in the SAME layer: this way they collide as one unit
    // and a name never ends up orphaned away from its icon.
    id: 'poi',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'poi',
    minzoom: 16,
    filter: [
      'all',
      ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
      // Progressive reveal: important places first, and everything once you
      // zoom in. Low rank = more relevant; no rank gets left for last.
      [
        '<=',
        ['coalesce', ['get', 'rank'], 99],
        ['step', ['zoom'], 4, 15, 8, 16, 14, 17, 25, 18, 100],
      ],
    ],
    layout: {
      'icon-image': iconExpr,
      'icon-size': zoomW([[14, 0.42], [16, 0.6], [18, 0.78], [20, 0.9]]),
      'icon-allow-overlap': false,
      'icon-padding': 2,
      // The most relevant ones win the spot when two icons overlap.
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
      // No names: the game map shows icons only, and names cluttered it.
    },
    paint: {
      'icon-opacity': 0.85,
    },
  },
  {
    id: 'place-minor',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    minzoom: 11,
    filter: ['match', ['get', 'class'],
      ['village', 'hamlet', 'suburb', 'neighbourhood', 'quarter'], true, false],
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Regular'],
      'text-size': zoomW([[11, 10], [16, 13]]),
      'text-letter-spacing': 0.2,
      'text-transform': 'uppercase',
      'text-max-width': 9,
    },
    paint: {
      'text-color': P.red, // game district names are red
      'text-halo-color': P.halo,
      'text-halo-width': 1.5,
      'text-opacity': 0.75,
    },
  },
  {
    id: 'place-town',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    minzoom: 8,
    filter: ['==', ['get', 'class'], 'town'],
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': zoomW([[8, 11], [14, 15]]),
      'text-letter-spacing': 0.22,
      'text-transform': 'uppercase',
      'text-max-width': 9,
    },
    paint: {
      'text-color': P.cyan,
      'text-halo-color': P.halo,
      'text-halo-width': 1.8,
    },
  },
  {
    id: 'place-city',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    minzoom: 4,
    filter: ['match', ['get', 'class'], ['city', 'state', 'country'], true, false],
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': zoomW([[4, 11], [8, 15], [13, 21]]),
      'text-letter-spacing': 0.28,
      'text-transform': 'uppercase',
      'text-max-width': 8,
    },
    paint: {
      'text-color': P.cyan, // the game prints WATSON / KABUKI in cyan
      'text-halo-color': P.halo,
      'text-halo-width': 2,
      'text-halo-blur': 0.6,
    },
  },
];

// -------------------------------------------------------------- style

const style = {
  version: 8,
  name: 'Cyberpunk Maps',
  metadata: {
    'games-map:generated-by': 'style/build.mjs',
    'games-map:note': 'Do not edit by hand. Edit build.mjs and rerun it.',
  },
  // API-key-free tiles, OpenMapTiles schema: the same one Stadia Maps serves,
  // so switching providers just means changing these two URLs.
  sources: {
    openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
  },
  // TODO phase 0b: point to our own SDF glyphs (Rajdhani / Chakra Petch)
  // generated with MapLibre Font Maker. OpenFreeMap only serves Noto Sans.
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  // Our own sprite, generated by assets/make-sprite.mjs. Path relative to the
  // site root, so it works the same in development and on Netlify.
  sprite: '/sprites/poi-sprite',
  // Neutral light: a colored one skews the extrusion colors (the shader
  // clamps from below with 0.3 * (1 - lightColor)). Tint lives in the
  // building colors; this only gives the red blocks lit and shaded sides.
  light: { anchor: 'viewport', color: '#ffffff', intensity: 0.5, position: [1.2, 210, 35] },
  layers,
};

writeFileSync(OUT, JSON.stringify(style, null, 2) + '\n');
console.log(`ok  ${OUT}  (${layers.length} layers)`);
