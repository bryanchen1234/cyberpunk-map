import { describe, expect, it } from 'vitest';

import { decodePolyline } from './routing';
import { distanceMeters, formatDistance, formatDuration } from './geo-math';
import { DESTINATION, MADRID_SHAPE, ORIGIN } from './routing.fixture';


describe('decodePolyline', () => {
  it('decodes the route within Madrid at the default precision', () => {
    const coords = decodePolyline(MADRID_SHAPE);

    expect(coords.length).toBeGreaterThan(100);

    // Valhalla snaps the endpoints to the nearest road, so they don't match
    // what was requested: this route's destination shifts by 120 m because
    // the point fell inside the Chamartin complex.
    //
    // The margin is 250 m on purpose. No need to be stricter: a decoding
    // failure doesn't miss by meters, it misses by millions (checked by the
    // precision-5 test below). Tightening it further would only produce
    // false positives when OpenStreetMap's street data changes.
    const first = { lng: coords[0]![0], lat: coords[0]![1] };
    const last = { lng: coords.at(-1)![0], lat: coords.at(-1)![1] };
    expect(distanceMeters(first, ORIGIN)).toBeLessThan(250);
    expect(distanceMeters(last, DESTINATION)).toBeLessThan(250);
  });

  it('returns [lng, lat] pairs, not [lat, lng]', () => {
    // Mixing up the order is easy and silent: the route would show up in the
    // sea off Somalia, which is where swapped coordinates land.
    for (const [lng, lat] of decodePolyline(MADRID_SHAPE)) {
      expect(lng).toBeGreaterThan(-4);
      expect(lng).toBeLessThan(-3.5);
      expect(lat).toBeGreaterThan(40);
      expect(lat).toBeLessThan(41);
    }
  });

  it('with precision 5 the route ends up miles away: the bug this test guards against', () => {
    // Valhalla uses precision 6. Almost every example found out there uses 5,
    // because that's what Google uses. With 5 this doesn't throw any error:
    // it returns coordinates that look perfectly normal, just ten times too
    // small. The route ends up drawn in the middle of the Gulf of Guinea.
    const bad = decodePolyline(MADRID_SHAPE, 5);
    const first = { lng: bad[0]![0], lat: bad[0]![1] };
    expect(distanceMeters(first, ORIGIN)).toBeGreaterThan(1_000_000);
  });

  it('accepts an empty string without breaking', () => {
    expect(decodePolyline('')).toEqual([]);
  });
});

describe('formatting for the UI', () => {
  it('rounds meters and switches to km when appropriate', () => {
    expect(formatDistance(100)).toBe('350 ft');
    expect(formatDistance(834)).toBe('0.5 mi');
    expect(formatDistance(5189)).toBe('3.2 mi');
    expect(formatDistance(42_300)).toBe('26 mi');
  });

  it('switches to hours above 60 minutes', () => {
    expect(formatDuration(443)).toBe('7 min');
    expect(formatDuration(4320)).toBe('1 h 12 min');
  });
});
