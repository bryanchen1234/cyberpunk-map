import { distanceMeters, type Point } from './geo-math';
import { getJson } from './http';

/** A search result, already massaged for the UI. */
export interface Place {
  id: string;
  /** "Gran Via, Madrid, Spain" */
  label: string;
  lng: number;
  lat: number;
  /** meters from where you are, or null if there's no position yet */
  distanceM: number | null;
}

interface PhotonResponse {
  features: {
    properties: {
      osm_type?: string;
      osm_id?: number;
      name?: string;
      housenumber?: string;
      street?: string;
      city?: string;
      state?: string;
      country?: string;
    };
    geometry: { coordinates: [number, number] };
  }[];
}

/**
 * Photon returns address parts, not a ready label (Pelias did), so it's
 * assembled here: "Petco Park, 100 Park Boulevard, San Diego, California".
 */
export function photonLabel(p: PhotonResponse['features'][number]['properties']): string {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const parts = [p.name, street, p.city, p.state].filter(Boolean);
  // Dedup: a street result has name === street.
  return [...new Set(parts)].join(', ') || 'No name';
}

/** Below this, results are just noise and waste requests. */
export const MIN_QUERY_LENGTH = 3;

/**
 * Destination autocomplete.
 *
 * `near` biases results toward where you are: without it, searching "gran
 * via" returns streets with that name from the whole country instead of the
 * one in your city.
 *
 * The `signal` is essential, not decoration: the caller must cancel the
 * previous request on every keystroke. Otherwise responses arrive out of
 * order and the list flickers showing results from stale queries.
 */
export async function autocomplete(
  text: string,
  near: Point | null,
  signal?: AbortSignal,
): Promise<Place[]> {
  const params: Record<string, string | number> = { q: text, lang: 'en', limit: 8 };
  if (near) {
    params.lat = near.lat;
    params.lon = near.lng;
  }

  // Photon (komoot): OSM search built for search-as-you-type, no key.
  const data = await getJson<PhotonResponse>('https://photon.komoot.io/api/', params, signal);

  return (data.features ?? []).map((f, i) => {
    const [lng, lat] = f.geometry.coordinates;
    return {
      id: f.properties.osm_id ? `${f.properties.osm_type}${f.properties.osm_id}` : `${lng},${lat},${i}`,
      label: photonLabel(f.properties),
      lng,
      lat,
      distanceM: near ? distanceMeters(near, { lng, lat }) : null,
    };
  });
}
