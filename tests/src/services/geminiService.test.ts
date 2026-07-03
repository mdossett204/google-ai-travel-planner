import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRecommendations, getItinerary } from '../../../src/services/geminiService.js';

describe('geminiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  const mockTravelData: any = {
    preferredLocation: { country: 'Japan', city: 'Tokyo' },
    durationValue: 5,
    durationUnit: 'days',
  };

  describe('getRecommendations', () => {
    it('fetches recommendations successfully', async () => {
      const mockRecs = [
        { id: '1', title: 'A', description: 'B', highlights: ['C'], estimatedCost: '$100', bestTimeToGo: 'Now' }
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockRecs)
      });

      const result = await getRecommendations(mockTravelData);
      expect(result).toEqual(mockRecs);
      expect(global.fetch).toHaveBeenCalledWith('/api/recommendations', expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockTravelData)
      }));
    });

    it('throws error if response is not ok', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Server exploded' })
      });

      await expect(getRecommendations(mockTravelData)).rejects.toThrow('Server exploded');
    });

    it('throws error if response format is invalid', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ notAnArray: true })
      });

      await expect(getRecommendations(mockTravelData)).rejects.toThrow('Invalid response format: expected an array of recommendations.');
    });

    it('throws 404 error if endpoint is missing', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.reject(new Error('no json'))
      });

      await expect(getRecommendations(mockTravelData)).rejects.toThrow(/endpoint not found|API route not found/i);
    });

    it('throws error if a recommendation is missing required fields', async () => {
      const mockRecs = [
        { id: '1', /* missing title */ description: 'B', highlights: ['C'], estimatedCost: '$100', bestTimeToGo: 'Now' }
      ];

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockRecs)
      });

      await expect(getRecommendations(mockTravelData)).rejects.toThrow('Invalid response format: missing or invalid recommendation fields.');
    });
  });

  describe('getItinerary', () => {
    const mockRec: any = { id: '1' };

    it('fetches itinerary successfully', async () => {
      const mockResponse = { itinerary: 'Markdown content' };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await getItinerary(mockTravelData, mockRec);
      expect(result).toBe('Markdown content');
      expect(global.fetch).toHaveBeenCalledWith('/api/itinerary', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ data: mockTravelData, recommendation: mockRec })
      }));
    });

    it('throws error if itinerary format is invalid', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ noItinerary: true })
      });

      await expect(getItinerary(mockTravelData, mockRec)).rejects.toThrow('Invalid response format: missing or invalid itinerary string.');
    });
  });
});
