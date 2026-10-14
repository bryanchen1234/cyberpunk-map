import type { Point } from './geo-math';
import { getJson } from './http';

/**
 * A route maneuver. Valhalla already drafts the text to be read aloud, in
 * whatever language is requested; phase 3 will only need to decide WHEN to
 * speak it, not what to say.
 */
export interface Maneuver {
  instruction: string;
  /**
   * Valhalla's maneuver type, a numeric enum: 15 left, 10 right,
   * 9 slight right, 16 slight left, 26/27 roundabout, 1 exit, 6 destination...
   * Used to pick the arrow.
   */
  type: number;
  /** Street(s) being turned onto. May be empty on ramps and roundabouts. */
  streetNames: string[];
  /** Drafted for speech synthesis, or undefined if Valhalla didn't provide it */
  verbal: string | undefined;
  /** Shorter early warning. */
  verbalAlert: string | undefined;
  /**
   * Whether `verbal` already chains in the instruction for the NEXT maneuver
   * (maneuvers that follow each other closely). When this is the case, that
   * next maneuver's early warning is skipped: it was already said, and
   * repeating it duplicates the instruction.
   */
  multiCue: boolean;
  /** index within `coordinates` where the maneuver begins */
  beginIndex: number;
  lengthKm: number;
  timeS: number;
}

export interface Route {
  /** [lng, lat][], ready to drop into a GeoJSON */
  coordinates: [number, number][];
  distanceKm: number;
  durationS: number;
  maneuvers: Maneuver[];
  /** [[west, south], [east, north]] */
  bounds: [[number, number], [number, number]];
}

interface ValhallaResponse {
  trip: {
    summary: { length: number; time: number };
    legs: {
      shape: string;
      maneuvers: {
        instruction?: string;
        type?: number;
        street_names?: string[];
        verbal_pre_transition_instruction?: string;
        verbal_transition_alert_instruction?: string;
        verbal_multi_cue?: boolean;
        begin_shape_index: number;
        length: number;
        time: number;
      }[];
    }[];
  };
}

/**
 * Decodes a Google/Valhalla encoded polyline.
 *
 * WATCH OUT FOR `precision`: Valhalla uses **6**, not 5. Google Maps and
 * almost every example found out there uses 5, and with 5 this doesn't fail —
 * something worse happens: it returns coordinates that look normal but are
 * ten times too small, so the route ends up drawn hundreds of kilometers away
 * from the actual place. That's why this function has a test.
 *
 * @returns [lng, lat] pairs in GeoJSON order, not [lat, lng]
 */
export function decodePolyline(encoded: string, precision = 6): [number, number][] {
  const factor = 10 ** precision;
  const out: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const nextValue = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    // Low bit set to 1 = negative, in one's complement.
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += nextValue();
    lng += nextValue();
    out.push([lng / factor, lat / factor]);
  }
  return out;
}

function boundsOf(coords: [number, number][]): Route['bounds'] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [
    [w, s],
    [e, n],
  ];
}

const MI_TO_KM = 1.609344;

export interface RouteOptions {
  avoidHighways?: boolean;
  avoidTolls?: boolean;
}

/** Computes a driving route between two points. */
export async function route(
  from: Point,
  to: Point,
  signal?: AbortSignal,
  opts: RouteOptions = {},
): Promise<Route> {
  const request = {
    locations: [
      { lat: from.lat, lon: from.lng },
      { lat: to.lat, lon: to.lng },
    ],
    costing: 'auto',
    // Valhalla preferences, 0 = avoid as much as possible (not a hard ban:
    // if the only way there is a highway, it still uses one).
    costing_options: {
      auto: {
        ...(opts.avoidHighways && { use_highways: 0 }),
        ...(opts.avoidTolls && { use_tolls: 0 }),
      },
    },
    // Miles so the spoken directions say "in a quarter mile", not "in 400
    // meters". Every length in the response is then in miles: converted
    // back to km below, because the rest of the app works in km/meters.
    directions_options: { language: 'en-US', units: 'miles' },
  };

  // FOSSGIS's public Valhalla demo: same API Stadia hosts, no key, fair use.
  const data = await getJson<ValhallaResponse>(
    'https://valhalla1.openstreetmap.de/route',
    { json: JSON.stringify(request) },
    signal,
  );

  // With two points there's always a single leg, but concatenating is just as
  // cheap and leaves the door open for intermediate stops without touching
  // anything.
  const coordinates: [number, number][] = [];
  const maneuvers: Maneuver[] = [];
  for (const leg of data.trip.legs) {
    const offset = coordinates.length;
    coordinates.push(...decodePolyline(leg.shape));
    for (const m of leg.maneuvers) {
      maneuvers.push({
        instruction: m.instruction ?? '',
        type: m.type ?? 0,
        streetNames: m.street_names ?? [],
        verbal: m.verbal_pre_transition_instruction,
        verbalAlert: m.verbal_transition_alert_instruction,
        multiCue: m.verbal_multi_cue ?? false,
        beginIndex: offset + m.begin_shape_index,
        lengthKm: m.length * MI_TO_KM,
        timeS: m.time,
      });
    }
  }

  return {
    coordinates,
    distanceKm: data.trip.summary.length * MI_TO_KM,
    durationS: data.trip.summary.time,
    maneuvers,
    bounds: boundsOf(coordinates),
  };
}
