import { describe, it, expect } from 'vitest';
import { formatLodgingPreferences } from '../../utils/lodgingPreferences.js';

describe('formatLodgingPreferences', () => {
  it('formats lodging types correctly', () => {
    const input = { lodgingTypes: ['Hotel', 'Hostel'] };
    const result = formatLodgingPreferences(input);
    expect(result).toBe('- Lodging Types: Hotel, Hostel');
  });

  it('provides a fallback if lodgingTypes is empty', () => {
    const input = { lodgingTypes: [] };
    const result = formatLodgingPreferences(input);
    expect(result).toBe('- Lodging Types: No strong preference');
  });

  it('provides a fallback if lodgingTypes is undefined', () => {
    const input = {};
    const result = formatLodgingPreferences(input);
    expect(result).toBe('- Lodging Types: No strong preference');
  });
});
