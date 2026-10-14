import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import type { StyleSpecification } from 'maplibre-gl';

import styleJson from '../../style/cyberpunk.json';
import { MapView } from './map/map';
import { Hud } from './hud/hud';
import { mountDiagnostics } from './diag/probe';
import { Compass } from './services/compass';
import { GeoWatcher, type Fix } from './services/geolocation';
import { KeepAwake } from './services/keep-awake';
import { route as calculateRoute, type RouteOptions } from './services/routing';
import type { Place } from './services/geocoding';
import { ApiError } from './services/http';
import { ManeuverCard } from './nav/maneuver-card';
import { NavSession, type Destination, type NavPhase } from './nav/session';
import { RouteLayer } from './route/route-layer';
import { RouteCard } from './route/route-card';
import { SearchOverlay } from './search/search-overlay';
import { VoiceGuide } from './services/voice';

/**
 * MapLibre REQUIRES the sprite URL to be absolute, unlike tile and glyph
 * URLs, which accept relative ones ("Invalid sprite URL, must be absolute").
 * The style keeps a root-relative path to stay portable between localhost
 * and production, so it's resolved here before handing it to the map.
 */
function resolveSprite(s: StyleSpecification): StyleSpecification {
  if (typeof s.sprite !== 'string' || /^[a-z]+:/i.test(s.sprite)) return s;
  // Against the app's base, not the origin: on GitHub Pages it lives under
  // /<repo>/, so "/sprites/x" must become "/<repo>/sprites/x".
  const base = new URL(import.meta.env.BASE_URL, location.origin);
  return { ...s, sprite: new URL(s.sprite.replace(/^\//, ''), base).href };
}

const style = resolveSprite(styleJson as unknown as StyleSpecification);

const mapEl = document.getElementById('map')!;
const ui = document.getElementById('ui')!;

const view = new MapView(mapEl, style);
const hud = new Hud();
const routeLayer = new RouteLayer(view.map);
const routeCard = new RouteCard();
const maneuverCard = new ManeuverCard();
const nav = new NavSession();
const voice = new VoiceGuide();

// MapLibre emits style and tile failures through this event instead of
// throwing, so without this an invalid style just looks like a black map.
view.map.on('error', (e) => console.error('[map]', e.error?.message ?? e));

// ------------------------------------------------------------- position

const geo = new GeoWatcher();
const compass = new Compass();
const keepAwake = new KeepAwake();
const diag = mountDiagnostics(geo, compass, keepAwake);

geo.onFix((fix) => {
  view.update(fix);
  hud.update(fix);
  nav.consume(fix);
});

// The map decides whether to listen: moving, GPS wins; stopped, the compass wins.
compass.onHeading((deg) => view.setCompassHeading(deg));

geo.start();

// On Android and desktop the orientation event arrives without asking for
// permission, so the compass starts on its own. On iOS it needs a user
// gesture, and that's what the DIAG panel button is for.
if (compass.supported && !compass.needsPermission) void compass.enable();

// The screen, kept on while the app is in the foreground. Retried on
// pressing GO: being a real user gesture, that's when iOS is most likely to
// grant it, so if this first attempt fails there will be another chance
// right when it's actually needed.
void keepAwake.enable();

if (import.meta.env.DEV) {
  Object.assign(window as unknown as Record<string, unknown>, {
    __map: view.map,
    __view: view,
    __geo: geo,
    __nav: nav,
    __style: style,
  });
}

// -------------------------------------------------------- search and route

const search = new SearchOverlay(() => geo.last);
// Outside #ui on purpose: in there the pointer-events rule would kill it.
document.body.appendChild(search.el);

let inFlight: AbortController | null = null;
/** Reroute request in flight. Declared here because onClear uses it. */
let reroute: AbortController | null = null;

/** Avoid highways / tolls, remembered per browser (best-effort storage). */
const routeOpts: RouteOptions = {};
try {
  Object.assign(routeOpts, JSON.parse(localStorage.getItem('routeOpts') ?? '{}'));
} catch {
  /* defaults */
}
let lastPlace: Place | null = null;

search.onPick = async (place) => {
  lastPlace = place;
  const from = geo.last;
  if (!from) return;

  inFlight?.abort();
  const ctrl = new AbortController();
  inFlight = ctrl;

  routeCard.showPending(place.label);

  try {
    const route = await calculateRoute(from, place, ctrl.signal, routeOpts);
    if (ctrl.signal.aborted) return;
    routeLayer.show(route);
    // Preview: frame the whole trip to decide. The driving camera is a
    // different one, and it kicks in when GO is pressed.
    nav.preview(route, { label: place.label, lng: place.lng, lat: place.lat });
    routeCard.show(place.label, route);
    view.fitRoute(route.bounds);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    routeCard.showError(
      place.label,
      err instanceof ApiError ? err.message : 'Could not calculate the route',
    );
  }
};

routeCard.onGo = () => {
  nav.start();
  view.startNavigation();
  // Second attempt at the screen lock, from a real gesture.
  void keepAwake.enable();

  // The session's first speak() has to come from a real user gesture or iOS
  // discards it (docs/findings.md §6): this button is that gesture. It's
  // also the ONLY maneuver that session.ts's automatic announcement never
  // gets to announce: the departure one (index 0) is already "behind" you
  // as soon as there's a first GPS fix.
  const departure = nav.route?.maneuvers[0];
  if (departure) voice.speak(departure.verbal ?? departure.instruction);
};

routeCard.onClear = () => {
  inFlight?.abort();
  reroute?.abort();
  nav.stop();
  voice.cancel();
};

/**
 * Automatic reroute. The session decides WHEN it's needed (off route, no
 * other request in flight, and at least 15 s between attempts); this only
 * requests the route, which is where the dealings with the network already live.
 */
nav.onNeedsReroute = async (from: Fix, to: Destination) => {
  reroute?.abort();
  const ctrl = new AbortController();
  reroute = ctrl;

  try {
    const newRoute = await calculateRoute(from, to, ctrl.signal, routeOpts);
    if (ctrl.signal.aborted) return;
    routeLayer.show(newRoute);
    nav.replaceRoute(newRoute);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    // Without coverage the old route stays drawn and the card goes back to
    // OFF ROUTE. The session will retry after the interval.
    nav.rerouteFailed();
  }
};

nav.onAnnounce = (text) => voice.speak(text);

nav.onUpdate = ({ progress, offRoute, rerouting }) => {
  if (rerouting) {
    maneuverCard.showRerouting(progress.remainingM, progress.remainingS);
  } else if (offRoute) {
    maneuverCard.showOffRoute(progress.remainingM, progress.remainingS);
  } else {
    maneuverCard.show(
      progress.next,
      progress.distanceToNextM,
      progress.remainingM,
      progress.remainingS,
    );
  }
};

nav.onArrived = () => {
  // `stop()` has already cleared the UI; this stays on top for a while.
  maneuverCard.showArrived();
  window.setTimeout(() => maneuverCard.hide(), 8_000);
};

// ------------------------------------------------------------------- UI

const controls = document.createElement('div');
controls.className = 'row';

const button = (text: string, ghost: boolean, onClick: () => void) => {
  const b = document.createElement('button');
  b.className = ghost ? 'btn btn--ghost' : 'btn';
  b.textContent = text;
  b.addEventListener('click', onClick);
  controls.appendChild(b);
  return b;
};

// Without a position there's no origin for the route, so the button starts
// disabled instead of failing when pressed.
const searchBtn = button('Search', false, () => search.open());
searchBtn.disabled = true;
geo.onFix(() => {
  searchBtn.disabled = false;
});

const stopBtn = button('Stop', false, () => nav.stop());
stopBtn.classList.add('btn--stop');

const recenterBtn = button('Recenter', true, () => view.recenter());

// This button is the ONLY indicator of whether the camera is following you:
// off (ghosted) while it tracks you, lit up amber as soon as you let go of
// the camera by dragging. Without this, following would turn off silently
// and the app would look broken.
const paintFollowState = (following: boolean) =>
  recenterBtn.classList.toggle('btn--ghost', following);

view.onFollowingChange = paintFollowState;
paintFollowState(view.following);

const pitchBtn = button('2D / 3D', true, () => view.togglePitch());

// Route preferences. Changing one while previewing a route recomputes it;
// during navigation they apply from the next reroute.
const optionBtn = (label: string, key: keyof RouteOptions) => {
  const b = button(label, true, () => {
    routeOpts[key] = !routeOpts[key];
    try {
      localStorage.setItem('routeOpts', JSON.stringify(routeOpts));
    } catch {
      /* not remembered, still applies */
    }
    paint();
    if (nav.phase === 'preview' && lastPlace) void search.onPick?.(lastPlace);
  });
  const paint = () => b.classList.toggle('btn--ghost', !routeOpts[key]);
  paint();
  return b;
};
const hwyBtn = optionBtn('Avoid hwy', 'avoidHighways');
const tollBtn = optionBtn('Avoid tolls', 'avoidTolls');

// Neon on/off: cyberpunk style vs OpenFreeMap's ordinary street map (same
// free tiles, no key). Remembered per browser; storage can throw in private
// mode, so it's best-effort.
const PLAIN_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const NEON_KEY = 'neon';
let neon = true;
try {
  neon = localStorage.getItem(NEON_KEY) !== 'off';
} catch {
  /* default on */
}

/**
 * The plain style is fetched here, not handed to setStyle as a URL: if
 * MapLibre's own fetch fails (no signal) it never retries and the map stays
 * blank for the session. Fetching it ourselves lets a failure fall back to
 * the bundled neon style, and a later tap retries.
 */
let plainStyle: StyleSpecification | null = null;
async function loadPlain(): Promise<StyleSpecification> {
  if (!plainStyle) {
    const res = await fetch(PLAIN_STYLE);
    if (!res.ok) throw new Error(`plain style ${res.status}`);
    plainStyle = (await res.json()) as StyleSpecification;
  }
  return plainStyle;
}

const scanlines = document.getElementById('scanlines')!;
const neonBtn = button('', false, () => {
  neon = !neon;
  try {
    localStorage.setItem(NEON_KEY, neon ? 'on' : 'off');
  } catch {
    /* not remembered, still toggles */
  }
  void applyNeon();
});
function paintNeon() {
  scanlines.hidden = !neon;
  neonBtn.textContent = neon ? 'Night City: on' : 'Night City: off';
  neonBtn.classList.toggle('btn--ghost', !neon);
}
/** Which style is actually on the map: re-applying the same one would
 * still throw away every loaded tile (setStyle with diff=false). */
let applied: 'neon' | 'plain' = 'neon';
function show(which: 'neon' | 'plain', s: StyleSpecification) {
  if (applied === which) return;
  applied = which;
  view.setStyle(s, false);
}
async function applyNeon() {
  paintNeon();
  if (neon) {
    show('neon', style);
    return;
  }
  try {
    const plain = await loadPlain();
    // A second tap while fetching may have turned neon back on.
    if (!neon) show('plain', plain);
  } catch {
    // Offline: stay on (or go back to) the bundled neon style.
    neon = true;
    paintNeon();
    show('neon', style);
  }
}
// The map was built with the neon style; only swap if the saved choice is off.
if (neon) paintNeon();
else void applyNeon();

diag.el.hidden = true;
const diagBtn = button('Diag', true, () => {
  diag.el.hidden = !diag.el.hidden;
  diagBtn.classList.toggle('btn--ghost', !diag.el.hidden);
});

const spacer = document.createElement('div');
spacer.className = 'spacer';

ui.append(hud.el, spacer, diag.el, maneuverCard.el, routeCard.el, controls);

// --------------------------------------------------- state machine
//
// Each phase decides what's shown. Keeping it in one place avoids the UI
// ending up in impossible states, like STOP showing with no route.

let previousPhase: NavPhase = 'idle';

function paintPhase(phase: NavPhase) {
  const navigating = phase === 'navigating';

  searchBtn.hidden = navigating;
  stopBtn.hidden = !navigating;
  pitchBtn.hidden = navigating; // while navigating the session drives the camera
  hwyBtn.hidden = navigating;
  tollBtn.hidden = navigating;

  if (phase === 'idle') {
    routeLayer.clear();
    routeCard.hide();
    maneuverCard.hide();
    // Only when LEAVING navigation, to avoid animating the camera on app startup.
    if (previousPhase === 'navigating') view.stopNavigation();
  } else if (phase === 'preview') {
    maneuverCard.hide();
  } else {
    routeCard.hide();
    // Until the first fix there's no progress to show.
    maneuverCard.showWaiting();
  }

  previousPhase = phase;
}

nav.onPhase = paintPhase;
paintPhase('idle');

// --------------------------------------------------- lab mode
//
// ?lab -> desktop controls for tuning the style: jumps between cities and a
// zoom sweep, which is how it's verified that no line width goes out of
// control. It's not intrusive on mobile because it never gets enabled.

if (new URLSearchParams(location.search).has('lab')) {
  const PLACES: [string, number, number, number][] = [
    ['Madrid', -3.7038, 40.4168, 15],
    ['Barcelona', 2.1734, 41.3851, 15],
    ['Valencia', -0.3763, 39.4699, 15],
    ['Bilbao', -2.935, 43.263, 15],
    ['Hong Kong', 114.1694, 22.3193, 15],
    ['Tokyo', 139.6917, 35.6895, 15],
    ['Manhattan', -73.9857, 40.7484, 15],
  ];

  const lab = document.createElement('div');
  lab.className = 'panel row';
  lab.style.marginTop = '10px';

  for (const [name, lng, lat, zoom] of PLACES) {
    const b = document.createElement('button');
    b.className = 'btn btn--ghost';
    b.textContent = name;
    b.addEventListener('click', () => {
      view.following = false;
      view.map.jumpTo({ center: [lng, lat], zoom, pitch: 55 });
    });
    lab.appendChild(b);
  }

  const sweep = document.createElement('button');
  sweep.className = 'btn';
  sweep.textContent = 'Sweep 8 → 18';
  sweep.addEventListener('click', () => {
    view.following = false;
    view.map.jumpTo({ zoom: 8 });
    view.map.easeTo({ zoom: 18, duration: 14_000, easing: (t) => t });
  });
  lab.appendChild(sweep);

  const readout = document.createElement('span');
  readout.className = 'num';
  readout.style.alignSelf = 'center';
  const sync = () =>
    (readout.textContent =
      `z${view.map.getZoom().toFixed(2)}  ` +
      `p${view.map.getPitch().toFixed(0)}  ` +
      `b${view.map.getBearing().toFixed(0)}`);
  view.map.on('move', sync);
  sync();
  lab.appendChild(readout);

  ui.appendChild(lab);
}

// -------------------------------------------------------------- HMR
//
// Editing style/build.mjs -> the Vite plugin regenerates cyberpunk.json ->
// this reapplies the style without reloading the page or losing the camera.
// RouteLayer repaints itself on hearing 'style.load'.

if (import.meta.hot) {
  import.meta.hot.accept('../../style/cyberpunk.json', (mod) => {
    if (mod?.default) {
      view.setStyle(resolveSprite(mod.default as unknown as StyleSpecification));
      console.info('[style] reloaded');
    }
  });
}
