import { describe, expect, it, vi } from 'vitest';

import { decodePolyline, route } from './routing';
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

describe('route() request', () => {
  const okResponse = {
    trip: { summary: { length: 1, time: 60 }, legs: [{ shape: '', maneuvers: [] }] },
  };
  const sentRequest = async (opts: Parameters<typeof route>[3]) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => okResponse });
    vi.stubGlobal('fetch', fetchMock);
    const r = await route({ lng: 0, lat: 0 }, { lng: 1, lat: 1 }, undefined, opts);
    vi.unstubAllGlobals();
    const url = new URL(fetchMock.mock.calls[0]![0] as URL);
    return { body: JSON.parse(url.searchParams.get('json')!), r };
  };

  it('asks Valhalla to avoid highways and tolls only when chosen', async () => {
    expect((await sentRequest({})).body.costing_options.auto).toEqual({});
    expect(
      (await sentRequest({ avoidHighways: true, avoidTolls: true })).body.costing_options.auto,
    ).toEqual({ use_highways: 0, use_tolls: 0 });
  });

  it('requests miles (for the voice) but returns km', async () => {
    const { body, r } = await sentRequest({});
    expect(body.directions_options.units).toBe('miles');
    expect(r.distanceKm).toBeCloseTo(1.609, 3);
  });
});
