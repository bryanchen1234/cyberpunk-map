import { describe, expect, it } from 'vitest';

import { photonLabel } from './geocoding';

describe('photonLabel', () => {
  it('joins name, street address, city and state', () => {
    expect(
      photonLabel({
        name: 'Petco Park',
        housenumber: '100',
        street: 'Park Boulevard',
        city: 'San Diego',
        state: 'California',
      }),
    ).toBe('Petco Park, 100 Park Boulevard, San Diego, California');
  });

  it('does not repeat a street result whose name is the street', () => {
    expect(photonLabel({ name: 'Voigt Drive', street: 'Voigt Drive', city: 'San Diego' })).toBe(
      'Voigt Drive, San Diego',
    );
  });

  it('never returns an empty label', () => {
    expect(photonLabel({})).toBe('No name');
  });
});
