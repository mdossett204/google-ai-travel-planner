import { describe, it, expect, vi } from 'vitest';
import { 
  validateTravelFormData,
  validateRecommendation,
  validateItineraryRequest,
  validateRecommendationsResponse,
  RequestValidationError 
} from '../../utils/requestValidation.js';

describe('requestValidation', () => {


  describe('validateTravelFormData', () => {
    const getValidFormData = () => ({
      timeOfYear: ['Jan'],
      durationValue: 5,
      durationUnit: 'days',
      travelers: 'Solo',
      preferredLocation: { country: 'Japan', city: 'Tokyo' },
      budget: { lodging: 100 },
      includeFood: false,
      includeLodging: false,
    });
    it('validates and parses valid form data', () => {
      const result = validateTravelFormData({
        timeOfYear: ['Jan'],
        durationValue: 5,
        durationUnit: 'days',
        travelers: 'Solo',
        preferredLocation: { country: 'Japan', city: 'Tokyo' },
        budget: { lodging: 100 },
        includeFood: false,
        includeLodging: false,
      });
      expect(result.durationValue).toBe(5);
      expect(result.travelers).toBe('Solo');
      expect(result.preferredLocation.country).toBe('Japan');
    });

    it('validates durationValue positive number constraints', () => {
      const validData = getValidFormData();
      
      // Test negative
      validData.durationValue = -1;
      expect(() => validateTravelFormData(validData)).toThrow('durationValue must be a positive number');
      
      // Test non-finite
      validData.durationValue = Infinity;
      expect(() => validateTravelFormData(validData)).toThrow('durationValue must be a positive number');
      
      // Test max exceed
      validData.durationValue = 100;
      expect(() => validateTravelFormData(validData)).toThrow('durationValue cannot exceed 14');
      
      validData.durationValue = 10;
      
      // Test duration limit with weeks
      validData.durationUnit = 'weeks';
      validData.durationValue = 3;
      expect(() => validateTravelFormData(validData)).toThrow('Duration cannot exceed 2 weeks.');
    });

    it('validates durationUnit enum correctly', () => {
      const validData = getValidFormData();
      validData.durationUnit = 'months';
      expect(() => validateTravelFormData(validData)).toThrow('durationUnit must be one of: days, weeks');
    });

    it('validates optional numbers with min and max', () => {
      const validData = getValidFormData();
      validData.budget = { lodging: -100 };
      expect(() => validateTravelFormData(validData)).toThrow('lodging cannot be less than 0');
      
      validData.budget = { lodging: 100000 };
      expect(() => validateTravelFormData(validData)).toThrow('budget.lodging cannot exceed 20000');
      
      validData.budget = { lodging: NaN };
      expect(() => validateTravelFormData(validData)).toThrow('lodging must be a number');
    });

    it('throws on invalid duration', () => {
      expect(() => validateTravelFormData({ durationValue: -1 })).toThrow(RequestValidationError);
    });

    it('throws if weeks exceed 2', () => {
      expect(() => validateTravelFormData({
        durationValue: 3, durationUnit: 'weeks',
        budget: {}, preferredLocation: { country: 'Japan' }
      })).toThrow(RequestValidationError);
    });

    it('truncates strings if they exceed max length', () => {
      const validData = getValidFormData();
      validData.attractionInterests = 'a'.repeat(200);
      const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = validateTravelFormData(validData);
      expect(result.attractionInterests).toHaveLength(100);
      expect(consoleWarnMock).toHaveBeenCalledWith(expect.stringContaining('exceeds maximum length'));
      consoleWarnMock.mockRestore();
    });

    it('throws if a string array field is not an array', () => {
      const validData = getValidFormData();
      (validData as any).timeOfYear = "Jan";
      expect(() => validateTravelFormData(validData)).toThrow('timeOfYear must be an array');
    });

    it('throws if a string array field exceeds max items', () => {
      const validData = getValidFormData();
      (validData as any).primaryGoal = Array(51).fill('Relaxation');
      expect(() => validateTravelFormData(validData)).toThrow('primaryGoal cannot exceed 50 items');
    });

    it('throws if a string array contains non-strings', () => {
      const validData = getValidFormData();
      (validData as any).primaryGoal = ['Relaxation', 123];
      expect(() => validateTravelFormData(validData)).toThrow('primaryGoal must be an array of strings');
    });

    it('throws if an enum array contains invalid enum values', () => {
      const validData = getValidFormData();
      (validData as any).primaryGoal = ['Relaxation', 'InvalidGoal'];
      expect(() => validateTravelFormData(validData)).toThrow('must contain only');
    });

    it('truncates strings inside an array if they exceed max length', () => {
      // test validateRecommendation with a super long highlight
      const rec = {
        id: 'test', title: 'Test', description: 'test',
        highlights: ['a'.repeat(200), 'b', 'c'],
        estimatedCost: '$100', bestTimeToGo: 'now'
      };
      const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = validateRecommendation(rec);
      expect(result.highlights[0]).toHaveLength(100);
      expect(consoleWarnMock).toHaveBeenCalledWith(expect.stringContaining('exceeded maximum length'));
      consoleWarnMock.mockRestore();
    });

    it('throws if boolean field receives a non-boolean', () => {
      const validData = getValidFormData();
      (validData as any).includeFood = "yes";
      expect(() => validateTravelFormData(validData)).toThrow('includeFood must be a boolean');
    });
  });

  describe('validateRecommendation', () => {
    it('validates a correct recommendation', () => {
      const result = validateRecommendation({
        id: '1', title: 'Test', description: 'Desc', highlights: ['a', 'b', 'c'], estimatedCost: '$1', bestTimeToGo: 'Now'
      });
      expect(result.id).toBe('1');
    });

    it('throws if required string is missing', () => {
      expect(() => validateRecommendation({ title: 'Test' })).toThrow(RequestValidationError);
    });
  });

  describe('validateItineraryRequest', () => {
    it('validates full itinerary request', () => {
      const result = validateItineraryRequest({
        data: {
          durationValue: 5, durationUnit: 'days', travelers: 'Solo',
          budget: {}, preferredLocation: { country: 'Japan' },
          includeFood: false, includeLodging: false
        },
        recommendation: {
          id: '1', title: 'Test', description: 'Desc', highlights: ['a'], estimatedCost: '$1', bestTimeToGo: 'Now'
        }
      });
      expect(result.data.durationValue).toBe(5);
      expect(result.recommendation.id).toBe('1');
    });
  });

  describe('validateRecommendationsResponse', () => {
    it('validates exactly 3 recommendations', () => {
      const rec = { id: '1', title: 'T', description: 'D', highlights: ['a', 'b', 'c'], estimatedCost: '$1', bestTimeToGo: 'Now' };
      const result = validateRecommendationsResponse([rec, rec, rec]);
      expect(result.length).toBe(3);
    });

    it('throws if not an array', () => {
      expect(() => validateRecommendationsResponse({})).toThrow(RequestValidationError);
    });

    it('throws if not exactly 3', () => {
      const rec = { id: '1', title: 'T', description: 'D', highlights: ['a', 'b', 'c'], estimatedCost: '$1', bestTimeToGo: 'Now' };
      expect(() => validateRecommendationsResponse([rec, rec])).toThrow(RequestValidationError);
    });

    it('truncates highlights if more than 3', () => {
      const rec = { id: '1', title: 'T', description: 'D', highlights: ['a', 'b', 'c', 'd'], estimatedCost: '$1', bestTimeToGo: 'Now' };
      const result = validateRecommendationsResponse([rec, rec, rec]);
      expect(result[0].highlights.length).toBe(3);
    });
    
    it('throws if highlights less than 3', () => {
      const rec = { id: '1', title: 'T', description: 'D', highlights: ['a', 'b'], estimatedCost: '$1', bestTimeToGo: 'Now' };
      expect(() => validateRecommendationsResponse([rec, rec, rec])).toThrow(RequestValidationError);
    });

    it('throws if required fields are missing', () => {
      const validRec = { id: '1', title: 'T', description: 'D', highlights: ['a', 'b', 'c'], estimatedCost: '$1', bestTimeToGo: 'Now' };
      expect(() => validateRecommendationsResponse([{ ...validRec, title: undefined } as any, validRec, validRec])).toThrow(RequestValidationError);
      expect(() => validateRecommendationsResponse([{ ...validRec, description: undefined } as any, validRec, validRec])).toThrow(RequestValidationError);
      expect(() => validateRecommendationsResponse([{ ...validRec, estimatedCost: undefined } as any, validRec, validRec])).toThrow(RequestValidationError);
      expect(() => validateRecommendationsResponse([{ ...validRec, bestTimeToGo: undefined } as any, validRec, validRec])).toThrow(RequestValidationError);
      expect(() => validateRecommendationsResponse([{ ...validRec, id: undefined } as any, validRec, validRec])).toThrow(RequestValidationError);
    });
  });
});
