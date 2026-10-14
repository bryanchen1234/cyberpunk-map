import maplibregl, { Map, Marker, type LngLat, type StyleSpecification } from 'maplibre-gl';

import { angleDelta } from '../services/compass';
import {
  compassWins,
  gpsHeadingUsable,
  GPS_HEADING_TTL_MS,
} from '../services/heading';
import type { Fix } from '../services/geolocation';

/**
 * How many pixels the map has to pan to count as a deliberate drag and drop
 * the camera. A resting thumb moves it a few; a real gesture clears this by
 * far.
 */
const PAN_INTENT_PX = 32;

/** Fixed zoom while navigating: it never zooms in or out based on the trip. */
const NAV_ZOOM = 17;

/** Pitch while navigating: looking ahead, not top-down. */
const NAV_PITCH = 60;

/**
 * What fraction of the screen height your marker sits below center.
 *
 * Centered wastes half the screen looking at where you've already been.
 * Every navigation app puts you in the lower third for this reason.
 */
const NAV_OFFSET_RATIO = 0.22;

/** Minimum degrees before bothering to turn the camera with the compass. */
const CAMERA_TURN_DEG = 4;

/** Player chevron: cyan with a glow, pointing at the heading. */
function playerMarkerEl(): HTMLElement {
  const el = document.createElement('div');
  el.style.willChange = 'transform';
  el.innerHTML = `
    <svg width="46" height="46" viewBox="0 0 46 46" style="overflow:visible">
      <defs>
        <filter id="pglow" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="3.2" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <circle cx="23" cy="23" r="17" fill="#00f0ff" opacity="0.07" />
      <g filter="url(#pglow)">
        <path d="M23 6 L34 34 L23 27 L12 34 Z"
              fill="#00f0ff" stroke="#d6feff" stroke-width="1.3"
              stroke-linejoin="round" />
      </g>
    </svg>`;
  return el;
}

// `Fix` is defined by whoever produces it: services/geolocation.ts. Re-exported
// so consumers of the map don't need to know where it comes from.
export type { Fix } from '../services/geolocation';

export class MapView {
  readonly map: Map;
  private marker: Marker | null = null;
  private markerInner = playerMarkerEl();
  private lastHeading = 0;
  private _following = true;
  /** Until when the GPS heading takes priority over the compass. */
  private gpsHeadingUntil = 0;
  private compassActive = false;
  private navMode = false;

  /**
   * Announces changes to `following` so the UI can reflect them.
   *
   * Without this, following silently turned off and the app looked broken:
   * the map stopped tracking you with nothing on screen saying why.
   */
  onFollowingChange: ((following: boolean) => void) | null = null;

  /** If true, the camera follows the player. */
  get following(): boolean {
    return this._following;
  }

  set following(value: boolean) {
    if (this._following === value) return;
    this._following = value;
    this.onFollowingChange?.(value);
  }

  constructor(container: HTMLElement, style: StyleSpecification) {
    this.map = new maplibregl.Map({
      container,
      style,
      center: [-117.2340, 32.8801], // San Diego, until the first fix arrives
      zoom: 15,
      pitch: 55,
      bearing: 0,
      attributionControl: { compact: true },
      // Without these two the map feels like a website, not a game.
      dragRotate: true,
      pitchWithRotate: true,
    });

    this.map.touchZoomRotate.enableRotation();

    // MapLibre measures the container ONCE, at construction. If it measures 0
    // at that point (backgrounded tab, PWA cold start, screen rotation, mobile
    // keyboard), the canvas gets stuck at its emergency size and the map never
    // paints again. It needs to be nudged.
    new ResizeObserver(() => this.map.resize()).observe(container);

    this.watchForIntentionalPan();
  }

  /**
   * Releases the camera only on a DELIBERATE drag.
   *
   * It used to be enough to listen for `dragstart`, which fires on the first
   * pixel: a thumb resting on the screen would turn off following for the
   * rest of the session, with nothing indicating it. Now it measures how much
   * the map has actually panned and only lets go past the threshold; a brush
   * of the screen doesn't count.
   *
   * Two-finger zoom does NOT release it (it fires `zoomstart`, not
   * `dragstart`), so you can zoom in and out without losing following.
   */
  private watchForIntentionalPan() {
    let anchor: LngLat | null = null;

    this.map.on('dragstart', () => {
      anchor = this.map.getCenter();
    });

    this.map.on('drag', () => {
      if (!this.following || !anchor) return;
      // project() of the current center always returns the canvas center, so
      // this distance is literally how many pixels the map has moved.
      const from = this.map.project(anchor);
      const to = this.map.project(this.map.getCenter());
      if (Math.hypot(from.x - to.x, from.y - to.y) > PAN_INTENT_PX) {
        this.following = false;
      }
    });

    this.map.on('dragend', () => {
      anchor = null;
    });
  }

  /**
   * Applies a new style while keeping the camera. HMR diffs (same style,
   * tweaked); the neon toggle swaps between unrelated styles, so no diff.
   */
  setStyle(style: StyleSpecification | string, diff = true) {
    this.map.setStyle(style, { diff });
  }

  update(fix: Fix) {
    const lngLat: [number, number] = [fix.lng, fix.lat];

    if (!this.marker) {
      this.marker = new maplibregl.Marker({ element: this.markerInner, rotationAlignment: 'map' })
        .setLngLat(lngLat)
        .addTo(this.map);
      // First fix: jump without animating, so we don't see a flight from Madrid.
      this.map.jumpTo({ center: lngLat, zoom: 16.5 });
    } else {
      this.marker.setLngLat(lngLat);
    }

    // coords.heading is null while stopped; we keep the last good value.
    if (fix.heading !== null && !Number.isNaN(fix.heading)) {
      const moving = gpsHeadingUsable(fix.heading, fix.speed);
      // With the compass active, at low speed it's preferred. Without a
      // compass, the GPS heading is all there is, even if it's bad.
      if (moving || !this.compassActive) this.lastHeading = fix.heading;
      if (moving) this.gpsHeadingUntil = performance.now() + GPS_HEADING_TTL_MS;
    }
    this.marker.setRotation(this.lastHeading);

    if (this.following) {
      this.map.easeTo({
        center: lngLat,
        bearing: this.lastHeading,
        duration: 900,
        easing: (t) => t * (2 - t),
        // In a navigation app camera motion isn't decorative: without this,
        // iOS's "Reduce Motion" would drop it.
        essential: true,
        ...(this.navMode
          ? { zoom: NAV_ZOOM, pitch: NAV_PITCH, offset: this.navOffset() }
          : {}),
      });
    }
  }

  /**
   * Device compass heading. Only applied when the GPS has nothing better to
   * say: while moving the GPS wins, because with the phone in a mount the
   * device's orientation isn't the car's direction.
   */
  setCompassHeading(deg: number) {
    this.compassActive = true;
    if (!compassWins(performance.now(), this.gpsHeadingUntil)) return;

    this.lastHeading = deg;
    this.marker?.setRotation(deg);

    // The compass fires up to 10 times a second. Turning the camera on every
    // reading would leave it shaking, so it only moves on a real turn.
    if (this.following && angleDelta(this.map.getBearing(), deg) > CAMERA_TURN_DEG) {
      this.map.easeTo({ bearing: deg, duration: 450, essential: true });
    }
  }

  recenter() {
    this.following = true;
    const ll = this.marker?.getLngLat();
    if (ll) {
      this.map.easeTo({
        center: ll,
        bearing: this.lastHeading,
        zoom: this.navMode ? NAV_ZOOM : 16.5,
        duration: 600,
        essential: true,
        ...(this.navMode ? { pitch: NAV_PITCH, offset: this.navOffset() } : {}),
      });
    }
  }

  /** Shifts the center to leave your marker in the lower third. */
  private navOffset(): [number, number] {
    return [0, this.map.getContainer().clientHeight * NAV_OFFSET_RATIO];
  }

  /**
   * Enters navigation mode: drops to street level and stays there.
   *
   * This is the fix for the complaint "the farther the destination, the less
   * it zooms in". The preview camera (`fitRoute`) and this one are two
   * distinct cameras on purpose, because they serve two incompatible
   * purposes.
   */
  startNavigation() {
    this.navMode = true;
    this.following = true;
    const ll = this.marker?.getLngLat();
    this.map.easeTo({
      ...(ll ? { center: ll } : {}),
      zoom: NAV_ZOOM,
      pitch: NAV_PITCH,
      bearing: this.lastHeading,
      offset: this.navOffset(),
      duration: 900,
      essential: true,
    });
  }

  stopNavigation() {
    this.navMode = false;
    this.map.easeTo({ pitch: 55, offset: [0, 0], duration: 500, essential: true });
  }

  /**
   * Frames the whole route. Releases the camera on purpose: you want to see
   * where it goes before starting, and RECENTER brings it back to following.
   *
   * The bottom padding is bigger than the top because the route card and
   * buttons live down there; without that the route would be hidden behind
   * the HUD.
   */
  fitRoute(bounds: [[number, number], [number, number]]) {
    this.following = false;
    this.map.fitBounds(bounds, {
      padding: { top: 110, bottom: 240, left: 50, right: 50 },
      pitch: 0,
      bearing: 0,
      duration: 900,
      essential: true,
    });
  }

  togglePitch() {
    const flat = this.map.getPitch() < 20;
    this.map.easeTo({ pitch: flat ? 60 : 0, duration: 500, essential: true });
  }
}
