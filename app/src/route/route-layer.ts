import type { Map } from 'maplibre-gl';

import type { Route } from '../services/routing';

const SOURCE = 'route';

/**
 * The game's GPS route: a solid yellow line with a soft warm edge. Core
 * measured from a real 2.x map screenshot (#fffa53); the halo is the game's
 * UI yellow (#ffd741). Nothing else on the basemap is yellow, so it pops.
 */
const GLOW = '#ffd741';
const CORE = '#fffa53';

/** Below the labels, so the line doesn't cover them. */
const BEFORE = 'road-label';

const width = (mul: number) => [
  'interpolate',
  ['exponential', 1.5],
  ['zoom'],
  10,
  2 * mul,
  14,
  5 * mul,
  18,
  11 * mul,
  20,
  20 * mul,
];

/**
 * Draws the route with the same three-layer trick as the map style: a wide
 * blurred halo, a body, and a thin lightened filament. That way the route
 * visually belongs to the same world as the streets.
 */
export class RouteLayer {
  private current: Route | null = null;

  constructor(private readonly map: Map) {
    // `setStyle` wipes out hand-added sources and layers. This happens on
    // every hot reload of the style during development. Instead of making
    // main.ts remember to repaint, the layer recomposes itself.
    this.map.on('style.load', () => this.render());
  }

  show(route: Route) {
    this.current = route;
    this.render();
  }

  clear() {
    this.current = null;
    this.teardown();
  }

  get route(): Route | null {
    return this.current;
  }

  private teardown() {
    for (const id of ['route-core', 'route-mid', 'route-glow']) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    if (this.map.getSource(SOURCE)) this.map.removeSource(SOURCE);
  }

  private render() {
    // Not gated on isStyleLoaded(): that stays false while ANY tile or the
    // sprite is still loading, which is most of the time while driving, and
    // a reroute arriving then would be silently dropped (old line on screen,
    // voice on the new route). Adding layers is allowed as soon as the style
    // JSON is parsed; before that addSource throws, and the 'style.load'
    // listener repaints once it's ready.
    try {
      this.draw();
    } catch {
      /* style not parsed yet: 'style.load' will call render() again */
    }
  }

  private draw() {
    this.teardown();
    if (!this.current) return;

    this.map.addSource(SOURCE, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: this.current.coordinates },
      },
    });

    const before = this.map.getLayer(BEFORE) ? BEFORE : undefined;
    const base = {
      type: 'line' as const,
      source: SOURCE,
      layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    };

    this.map.addLayer(
      {
        ...base,
        id: 'route-glow',
        paint: {
          'line-color': GLOW,
          'line-width': width(2.6) as never,
          'line-blur': width(2.2) as never,
          'line-opacity': 0.35,
        },
      },
      before,
    );

    this.map.addLayer(
      {
        ...base,
        id: 'route-mid',
        paint: {
          'line-color': GLOW,
          'line-width': width(1.7) as never,
          'line-blur': width(0.5) as never,
          'line-opacity': 0.75,
        },
      },
      before,
    );

    this.map.addLayer(
      {
        ...base,
        id: 'route-core',
        paint: { 'line-color': CORE, 'line-width': width(1) as never },
      },
      before,
    );
  }
}
