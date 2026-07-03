import { describe, it, expect, vi, beforeEach } from 'vitest';
import itineraryHandler from '../../api/itinerary.js';
import * as llmRouter from '../../utils/llmRouter.js';
import * as redisUtils from '../../utils/redis.js';
import * as tomtomSearch from '../../tools/tomtomSearch.js';
import * as httpUtils from '../../utils/http.js';
import * as apiHelpers from '../../utils/apiHelpers.js';
import { getMockItineraryRequestData } from '../helpers.js';

vi.mock('../../utils/llmRouter.js', () => ({
  getProvider: vi.fn().mockReturnValue('gemini'),
  assertProviderApiKeysConfigured: vi.fn(),
  generateText: vi.fn(),
  generateTextWithMeta: vi.fn(),
  calculateMaxToolCallsForTrip: vi.fn().mockReturnValue(10),
}));

vi.mock('../../utils/redis.js', () => ({
  assertRedisConfigured: vi.fn(),
}));

vi.mock('../../tools/tomtomSearch.js', () => ({
  assertTomTomApiKeyConfigured: vi.fn(),
}));

vi.mock('../../utils/http.js', () => ({
  readJsonBody: vi.fn(),
}));

vi.mock('../../utils/apiHelpers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/apiHelpers.js')>();
  return {
    ...actual,

    sendJson: vi.fn(),
    handleApiError: vi.fn(),
    sanitizePromptInput: vi.fn((val) => val),
  };
});

describe('itinerary API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles a valid itinerary request', async () => {

    vi.mocked(httpUtils.readJsonBody).mockResolvedValue(getMockItineraryRequestData());
    
    const mockDraft = 'ACTIVITY PLAN\nDAY 1...';
    vi.mocked(llmRouter.generateText).mockResolvedValue(mockDraft);

    const mockVerified = '## 🌟 Introduction\nHere is your trip...';
    vi.mocked(llmRouter.generateTextWithMeta).mockResolvedValue({
      text: mockVerified,
      usedFallback: false,
    });

    const req = { method: 'POST' } as any;
    const res = {} as any;

    await itineraryHandler(req, res);


    expect(llmRouter.assertProviderApiKeysConfigured).toHaveBeenCalled();
    expect(tomtomSearch.assertTomTomApiKeyConfigured).toHaveBeenCalled();
    expect(redisUtils.assertRedisConfigured).toHaveBeenCalled();
    expect(llmRouter.generateText).toHaveBeenCalled();
    expect(llmRouter.generateTextWithMeta).toHaveBeenCalled();
    expect(apiHelpers.sanitizePromptInput).toHaveBeenCalled();
    expect(apiHelpers.sendJson).toHaveBeenCalledWith(res, 200, { itinerary: mockVerified });
  });

  it('strips preamble from verified itinerary', async () => {

    
    const mockRequestData = getMockItineraryRequestData();
    mockRequestData.data.includeLodging = false;
    mockRequestData.data.includeFood = false;
    
    vi.mocked(httpUtils.readJsonBody).mockResolvedValue(mockRequestData);
    vi.mocked(llmRouter.generateText).mockResolvedValue('draft');

    const rawVerified = 'Here is what I found for you:\n# 🌟 Introduction\nTrip...';
    vi.mocked(llmRouter.generateTextWithMeta).mockResolvedValue({
      text: rawVerified,
      usedFallback: false,
    });

    const req = { method: 'POST' } as any;
    const res = {} as any;

    await itineraryHandler(req, res);

    expect(apiHelpers.sendJson).toHaveBeenCalledWith(res, 200, {
      itinerary: '# 🌟 Introduction\nTrip...'
    });
  });

  it('handles general errors gracefully', async () => {

    vi.mocked(httpUtils.readJsonBody).mockRejectedValue(new Error('Network error'));

    const req = { method: 'POST' } as any;
    const res = {} as any;

    await itineraryHandler(req, res);

    expect(apiHelpers.handleApiError).toHaveBeenCalled();
  });

  it('handles trip structure notes for different durations', async () => {
    process.env.ITINERARY_VERIFICATION_PROVIDER = 'gemini';
    vi.mocked(llmRouter.generateText).mockResolvedValue('draft');
    vi.mocked(llmRouter.generateTextWithMeta).mockResolvedValue({ text: 'result', usedFallback: false });

    const durationsToTest = [1, 2, 4]; // Covers 1, 2, and the `else` (>3) branch.

    for (const duration of durationsToTest) {
      const mockRequestData = getMockItineraryRequestData();
      mockRequestData.data.durationValue = duration;
      mockRequestData.data.durationUnit = 'days';
      
      vi.mocked(httpUtils.readJsonBody).mockResolvedValueOnce(mockRequestData);
      
      const req = { method: 'POST' } as any;
      const res = {} as any;
      
      await itineraryHandler(req, res);
      
      expect(apiHelpers.sendJson).toHaveBeenCalledWith(res, 200, { itinerary: 'result' });

      // Assert draft prompt contained trip structure notes
      expect(llmRouter.generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('Trip structure:')
        })
      );
      
      // Assert verification fallback provider was correctly passed
      expect(llmRouter.generateTextWithMeta).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini'
        })
      );
    }
  });

  it('throws an error for invalid ITINERARY_VERIFICATION_PROVIDER', async () => {
    process.env.ITINERARY_VERIFICATION_PROVIDER = 'invalid';
    vi.mocked(httpUtils.readJsonBody).mockResolvedValueOnce(getMockItineraryRequestData());
    
    const req = { method: 'POST' } as any;
    const res = {} as any;
    
    await itineraryHandler(req, res);
    
    expect(apiHelpers.handleApiError).toHaveBeenCalledWith(
      res,
      expect.objectContaining({
        message: 'Invalid ITINERARY_VERIFICATION_PROVIDER: invalid. Provider not found.'
      })
    );
  });

  it('uses anthropic for verification if configured', async () => {

    process.env.ITINERARY_VERIFICATION_PROVIDER = 'anthropic';
    vi.mocked(llmRouter.generateText).mockResolvedValue('draft');
    vi.mocked(llmRouter.generateTextWithMeta).mockResolvedValue({ text: 'anthropic result', usedFallback: false });

    vi.mocked(httpUtils.readJsonBody).mockResolvedValueOnce(getMockItineraryRequestData());
    const req = { method: 'POST' } as any;
    const res = {} as any;
    
    await itineraryHandler(req, res);
    expect(apiHelpers.sendJson).toHaveBeenCalledWith(res, 200, { itinerary: 'anthropic result' });
  });

  it('uses openai for verification if configured explicitly', async () => {

    process.env.ITINERARY_VERIFICATION_PROVIDER = 'openai';
    vi.mocked(llmRouter.generateText).mockResolvedValue('draft');
    vi.mocked(llmRouter.generateTextWithMeta).mockResolvedValue({ text: 'openai result', usedFallback: false });

    vi.mocked(httpUtils.readJsonBody).mockResolvedValueOnce(getMockItineraryRequestData());
    const req = { method: 'POST' } as any;
    const res = {} as any;
    
    await itineraryHandler(req, res);
    expect(apiHelpers.sendJson).toHaveBeenCalledWith(res, 200, { itinerary: 'openai result' });
  });

  it('rejects non-POST requests', async () => {
    const req = { method: 'GET' } as any;
    const res = { setHeader: vi.fn(), end: vi.fn() } as any;

    await itineraryHandler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Method not allowed' }));
  });

  it('handles a valid itinerary request with food and lodging excluded', async () => {
    const customData = getMockItineraryRequestData({ includeLodging: false, includeFood: false, foodPreferences: { foodPriority: 'Not a Priority' } });
    vi.mocked(httpUtils.readJsonBody).mockResolvedValue(customData);
    
    vi.mocked(llmRouter.generateText).mockResolvedValue('draft');
    vi.mocked(llmRouter.generateTextWithMeta).mockResolvedValue({
      text: 'verified result',
      usedFallback: false,
    });

    const req = { method: 'POST' } as any;
    const res = {} as any;
    
    await itineraryHandler(req, res);
    
    expect(llmRouter.generateText).toHaveBeenCalled();
    // The prompt generation is inside the handler, but this asserts the branch is covered without crashing
    expect(apiHelpers.sendJson).toHaveBeenCalledWith(res, 200, { itinerary: 'verified result' });
  });

  it('handles a valid itinerary request with food priority not being major', async () => {
    const customData = getMockItineraryRequestData({ 
      includeFood: true, 
      foodPreferences: { 
        dietaryRestrictions: [], 
        cuisineInterests: [], 
        diningStyle: [], 
        foodPlaceTypes: [], 
        foodPriority: 'Not Important' 
      } 
    });
    vi.mocked(httpUtils.readJsonBody).mockResolvedValue(customData);
    
    vi.mocked(llmRouter.generateText).mockResolvedValue('draft');
    vi.mocked(llmRouter.generateTextWithMeta).mockResolvedValue({
      text: 'verified result',
      usedFallback: false,
    });

    const req = { method: 'POST' } as any;
    const res = {} as any;
    
    await itineraryHandler(req, res);

    expect(apiHelpers.sendJson).toHaveBeenCalledWith(res, 200, { itinerary: 'verified result' });
  });

  it('handles empty verification result by falling back to draft', async () => {
    vi.mocked(httpUtils.readJsonBody).mockResolvedValueOnce(getMockItineraryRequestData());
    vi.mocked(llmRouter.generateText).mockResolvedValue('draft');
    vi.mocked(llmRouter.generateTextWithMeta).mockResolvedValue({ text: '', usedFallback: false });

    const req = { method: 'POST' } as any;
    const res = {} as any;
    
    await itineraryHandler(req, res);
    expect(apiHelpers.sendJson).toHaveBeenCalledWith(res, 200, { itinerary: 'draft' });
  });
});
