import { describe, it, expect } from 'vitest';
import { 
  getOnLocationDays, 
  buildLocationRules,
  formatPreferredLocation,
  formatTravelerType,
  buildUserPreferencesContext
} from '../../utils/tripContext.js';

describe('tripContext', () => {
  describe('getOnLocationDays', () => {
    it('returns durationDays - 1', () => {
      expect(getOnLocationDays(5)).toBe(4);
    });

    it('returns minimum 1 for 1-day trip', () => {
      expect(getOnLocationDays(1)).toBe(1);
    });
  });

  describe('buildLocationRules', () => {
    it('builds rules based on city and state', () => {
      const rules = buildLocationRules({ city: 'Seattle', stateOrProvince: 'WA' });
      expect(rules).toContain('stay strictly inside the requested country');
      expect(rules).toContain('stay strictly inside WA');
      expect(rules).toContain('stay strictly inside Seattle');
    });

    it('skips rules for undefined properties', () => {
      const rules = buildLocationRules({});
      expect(rules).toContain('stay strictly inside the requested country');
      expect(rules).not.toContain('state/province');
      expect(rules).not.toContain('city');
    });
  });

  describe('formatPreferredLocation', () => {
    it('formats a full location correctly', () => {
      expect(formatPreferredLocation({ city: 'Paris', stateOrProvince: 'Ile-de-France', country: 'France' }))
        .toBe('Paris, Ile-de-France, France');
    });

    it('skips missing fields', () => {
      expect(formatPreferredLocation({ country: 'Japan' })).toBe('Japan');
      expect(formatPreferredLocation({ city: 'Tokyo', country: 'Japan' })).toBe('Tokyo, Japan');
    });

    it('returns "Not specified" if empty', () => {
      expect(formatPreferredLocation({})).toBe('Not specified');
    });
  });

  describe('formatTravelerType', () => {
    it('returns descriptions for known traveler types', () => {
      expect(formatTravelerType('Solo')).toContain('Solo traveler');
      expect(formatTravelerType('Couple')).toContain('Couple:');
      expect(formatTravelerType('Family')).toContain('Family:');
      expect(formatTravelerType('Friends')).toContain('Friends:');
    });

    it('returns fallback for unknown or missing traveler type', () => {
      expect(formatTravelerType('Business')).toBe('Business');
      expect(formatTravelerType(undefined)).toBe('Not specified');
    });
  });

  describe('buildUserPreferencesContext', () => {
    it('builds a comprehensive context string', () => {
      const context = buildUserPreferencesContext({
        timeOfYear: ['Jan'],
        durationValue: 5,
        durationUnit: 'days',
        travelers: 'Solo',
        activityLevel: 'Balanced',
        primaryGoal: ['Relaxation'],
        attractionInterests: 'Museums',
        preferredLocation: { country: 'France', stateOrProvince: '', city: 'Paris' },
        localTransportation: ['Public Transit'],
        budget: { lodging: 100, localTransportation: 50, food: 50, misc: 50 },
        includeLodging: true,
        includeFood: true,
        foodPreferences: {
          dietaryRestrictions: [],
          cuisineInterests: [],
          diningStyle: [],
          foodPlaceTypes: [],
          foodPriority: 'Nice to Have',
        },
        lodgingPreferences: {
          lodgingTypes: ['Hotel'],
        },
      });

      expect(context).toContain('Time of Year: January (winter)');
      expect(context).toContain('Duration: 5 days');
      expect(context).toContain('Travel Style: Solo traveler');
      expect(context).toContain('Activity Level: Balanced');
      expect(context).toContain('Primary Goal(s): <goals>Relaxation</goals>');
      expect(context).toContain('Attractions of Interest: <attractions>Museums</attractions>');
      expect(context).toContain('Preferred Location: Paris, France');
      expect(context).toContain('Local Transportation Preferences: Public Transit');
      expect(context).toContain('- Lodging: $100 per night');
      expect(context).toContain('FOOD PREFERENCES');
      expect(context).toContain('LODGING PREFERENCES');
    });

    it('handles omitting food and lodging', () => {
      const context = buildUserPreferencesContext({
        timeOfYear: [],
        durationValue: 5,
        durationUnit: 'days',
        travelers: 'Solo',
        activityLevel: '',
        primaryGoal: [],
        attractionInterests: '',
        preferredLocation: { country: 'France', stateOrProvince: '', city: 'Paris' },
        localTransportation: [],
        budget: {},
        includeLodging: false,
        includeFood: false,
        foodPreferences: { dietaryRestrictions: [], cuisineInterests: [], diningStyle: [], foodPlaceTypes: [], foodPriority: '' },
        lodgingPreferences: { lodgingTypes: [] },
      });

      expect(context).toContain('Not requested (omit lodging)');
      expect(context).toContain('Not requested (omit food)');
      expect(context).toContain('FOOD: Not requested');
      expect(context).toContain('LODGING: Not requested');
    });
    it('handles missing budget values when included', () => {
      const context = buildUserPreferencesContext({
        timeOfYear: [],
        durationValue: 5,
        durationUnit: 'days',
        travelers: 'Solo',
        activityLevel: '',
        primaryGoal: [],
        attractionInterests: '',
        preferredLocation: { country: 'France', stateOrProvince: '', city: 'Paris' },
        localTransportation: [],
        budget: {}, // Empty budget, so it should fallback to "Any"
        includeLodging: true,
        includeFood: true,
        foodPreferences: { dietaryRestrictions: [], cuisineInterests: [], diningStyle: [], foodPlaceTypes: [], foodPriority: '' },
        lodgingPreferences: { lodgingTypes: [] },
      });

      expect(context).toContain('- Lodging: $Any per night');
      expect(context).toContain('- Food: $Any per day');
      expect(context).toContain('- Local Transportation: $Any total');
      expect(context).toContain('- Miscellaneous/Activities: $Any total');
    });
  });
});
