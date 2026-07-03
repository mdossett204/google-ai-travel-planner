import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scoreTomTomResultMatch, executeSearchPlace, searchTomTom } from '../../tools/tomtomSearch.js';
import * as redisUtils from '../../utils/redis.js';
import * as apiHelpers from '../../utils/apiHelpers.js';

vi.mock('../../utils/redis.js', () => ({
  getRedisClient: vi.fn(),
  runFixedWindowRateLimit: vi.fn(),
}));

vi.mock('../../utils/apiHelpers.js', () => ({
  sleep: vi.fn(),
}));

describe('tomtomSearch', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    process.env = { ...originalEnv, TOMTOM_SEARCH_API_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('scoreTomTomResultMatch', () => {
    it('returns a high score for an exact match', () => {
      const result = {
        name: 'Eiffel Tower',
        city: 'Paris',
        region: 'Île-de-France',
        country: 'France',
        address: 'Champ de Mars',
      } as any;

      const score = scoreTomTomResultMatch({
        placeName: 'Eiffel Tower',
        locationHint: 'Paris',
        result,
      });

      expect(score).toBeGreaterThan(90);
    });

    it('returns 0 if place name is empty or result is missing', () => {
      expect(scoreTomTomResultMatch({ placeName: '', result: { name: 'Eiffel Tower' } as any })).toBe(0);
      expect(scoreTomTomResultMatch({ placeName: 'Eiffel Tower', result: null })).toBe(0);
    });

    it('returns 0 if geographic location hint does not match', () => {
      const result = {
        name: 'Space Needle',
        city: 'Seattle',
        region: 'WA',
        country: 'USA',
        address: '',
      } as any;

      const score = scoreTomTomResultMatch({
        placeName: 'Space Needle',
        locationHint: 'Paris', // wrong city
        result,
      });

      expect(score).toBe(0);
    });
  });

  describe('executeSearchPlace', () => {
    it('returns an error if name is missing', async () => {
      const result = await executeSearchPlace({}, 'test');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Missing required argument: name');
    });

    it('returns success when a match is found', async () => {
      vi.mocked(redisUtils.runFixedWindowRateLimit).mockResolvedValue(true);
      const mockRedisClient = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') };
      vi.mocked(redisUtils.getRedisClient).mockResolvedValue(mockRedisClient as any);

      const mockResponse = {
        results: [
          {
            id: '1',
            poi: { name: 'Central Park' },
            address: { municipality: 'New York', countrySubdivisionName: 'NY', country: 'USA' },
          }
        ]
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await executeSearchPlace({ name: 'Central Park', locationHint: 'New York' }, 'test');
      
      expect(result.ok).toBe(true);
      expect(result.result).toBeDefined();
      expect((result.result as any).name).toBe('Central Park');
    });
  });

  describe('searchTomTom', () => {
    it('throws if query is empty', async () => {
      await expect(searchTomTom({ query: '   ' })).rejects.toThrow('TomTom search requires a query');
    });

    it('fetches and caches results', async () => {
      vi.mocked(redisUtils.runFixedWindowRateLimit).mockResolvedValue(true);
      const mockRedisClient = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') };
      vi.mocked(redisUtils.getRedisClient).mockResolvedValue(mockRedisClient as any);

      const mockResponse = {
        results: [
          {
            id: '1',
            poi: { name: 'Louvre' },
            address: { municipality: 'Paris', country: 'France' },
          }
        ]
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const results = await searchTomTom({ query: 'Louvre', limit: 1 });
      
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Louvre');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      
      // Second call should hit local cache
      const cachedResults = await searchTomTom({ query: 'Louvre', limit: 1 });
      expect(cachedResults).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledTimes(1); // Fetch not called again
    });

    it('retries on 429 rate limit and logs debug if enabled', async () => {
      vi.mocked(redisUtils.runFixedWindowRateLimit).mockResolvedValue(true);
      const mockRedisClient = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') };
      vi.mocked(redisUtils.getRedisClient).mockResolvedValue(mockRedisClient as any);
      process.env.DEBUG_LLM = 'true';

      (global.fetch as any)
        .mockResolvedValueOnce({ status: 429, ok: false, text: () => Promise.resolve('Rate limit') })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ results: [] })
        });

      const results = await searchTomTom({ query: 'Eiffel Tower' });
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(apiHelpers.sleep).toHaveBeenCalled();
      expect(results).toEqual([]);
      
      delete process.env.DEBUG_LLM;
    });

    it('throws immediately on non-retryable errors like 403', async () => {
      vi.mocked(redisUtils.runFixedWindowRateLimit).mockResolvedValue(true);
      const mockRedisClient = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') };
      vi.mocked(redisUtils.getRedisClient).mockResolvedValue(mockRedisClient as any);

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: vi.fn().mockResolvedValue('Forbidden')
      });
      await expect(searchTomTom({ query: 'cafe', latitude: 1, longitude: 1 })).rejects.toThrow('TomTom search failed with status 403');
      expect((global.fetch as any)).toHaveBeenCalledTimes(1);
    });

    it('logs redis set error if caching fails', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ results: [{ id: '1', poi: { name: 'Redis Cafe' } }] })
      });
      
      const mockRedisClient = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockRejectedValueOnce(new Error('Redis set failed')) };
      vi.mocked(redisUtils.getRedisClient).mockResolvedValue(mockRedisClient as any);
      vi.mocked(redisUtils.runFixedWindowRateLimit).mockResolvedValue(true);
      
      const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await searchTomTom({ query: 'redis failure test', latitude: 1, longitude: 1 });
      
      // Wait a tick for the async catch block to execute
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(consoleWarnMock).toHaveBeenCalledWith('Redis set error:', expect.any(Error));
      consoleWarnMock.mockRestore();
    });

    it('logs debug rate-limit-retry and response if DEBUG_LLM_ROUTER is true', async () => {
      process.env.DEBUG_LLM_ROUTER = 'true';
      vi.mocked(redisUtils.runFixedWindowRateLimit).mockResolvedValue(true);
      const mockRedisClient = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') };
      vi.mocked(redisUtils.getRedisClient).mockResolvedValue(mockRedisClient as any);

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: vi.fn().mockResolvedValue('Rate limited')
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ results: [{ id: '1', poi: { name: 'Debug Cafe' } }] })
        });

      const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await searchTomTom({ query: '  Café  ', latitude: 1, longitude: 1 }); // Tests normalizeUnicode trimming and accents

      expect(consoleWarnMock).toHaveBeenCalledWith('[tomtomSearch] rate-limit-retry', expect.any(Object));
      expect(consoleWarnMock).toHaveBeenCalledWith('[tomtomSearch] response', expect.any(Object));
      consoleWarnMock.mockRestore();
    });

    it('sets countrySet param if countryCode is provided', async () => {
      vi.mocked(redisUtils.runFixedWindowRateLimit).mockResolvedValue(true);
      const mockRedisClient = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') };
      vi.mocked(redisUtils.getRedisClient).mockResolvedValue(mockRedisClient as any);

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ results: [] })
      });

      await searchTomTom({ query: 'cafe', countryCode: 'US' });
      expect((global.fetch as any)).toHaveBeenCalledWith(expect.stringContaining('countrySet=US'), expect.any(Object));
    });

    it('catches network error and redacts API key from logs', async () => {
      vi.mocked(redisUtils.runFixedWindowRateLimit).mockResolvedValue(true);
      const mockRedisClient = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') };
      vi.mocked(redisUtils.getRedisClient).mockResolvedValue(mockRedisClient as any);

      const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const apiKey = process.env.TOMTOM_SEARCH_API_KEY || 'test-key';
      (global.fetch as any).mockRejectedValue(new Error(`Failed to fetch due to ${apiKey}`));

      await expect(searchTomTom({ query: 'super unique cafe query ' + Date.now() })).rejects.toThrow('A network error occurred while connecting to the TomTom API.');
      
      expect(consoleErrorMock).toHaveBeenCalledWith(
        '[tomtomSearch] network error:',
        'Failed to fetch due to ***REDACTED***',
        'for URL:',
        expect.any(String)
      );
      
      consoleErrorMock.mockRestore();
    });
  });
});
