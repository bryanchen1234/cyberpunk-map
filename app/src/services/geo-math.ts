/**
 * Geographic math. Pure logic with no dependencies, so it can be tested
 * without a browser. Phase 3 (snapToRoute, distance to the next maneuver)
 * will build on this.
 */

export interface Point {
  lng: number;
  lat: number;
}

const R = 6_371_008.8; // mean Earth radius in meters
const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Distance over the sphere between two points, in meters (haversine).
 *
 * This is more than enough for what this app does: at city scale, the error
 * versus an ellipsoid is below the GPS's own error margin.
 */
export function distanceMeters(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** US units: "500 ft" under ~0.1 mi, then "3.2 mi" / "42 mi" */
export function formatDistance(meters: number): string {
  const mi = meters / 1609.344;
  if (mi < 0.1) return `${Math.round((meters * 3.28084) / 50) * 50} ft`;
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}

/** "7 min" / "1 h 12 min" */
export function formatDuration(seconds: number): string {
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}
