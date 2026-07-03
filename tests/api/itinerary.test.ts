import { describe, it, expect, vi, beforeEach } from 'vitest';
import itineraryHandler from '../../api/itinerary.js';
import * as llmRouter from '../../utils/llmRouter.js';
import * as redisUtils from '../../utils/redis.js';
import * as tomtomSearch from '../../tools/tomtomSearch.js';
import * as httpUtils from '../../utils/http.js';
import * as apiHelpers from '../../utils/apiHelpers.js';

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
    enforcePostMethod: vi.fn(),
    sendJson: vi.fn(),
    handleApiError: vi.fn(),
    sanitizePromptInput: vi.fn((val) => val),
  };
});

describe('itinerary API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const getValidMockData = () => ({
    data: {
      timeOfYear: [],
      durationValue: 3,
      durationUnit: 'days',
      travelers: 'Solo',
      preferredLocation: { country: 'Japan', city: 'Tokyo' },
      primaryGoal: [],
      activityLevel: 'Balanced',
      foodPreferences: { dietaryRestrictions: [], cuisineInterests: [], diningStyle: [], foodPlaceTypes: [], foodPriority: 'Major Trip Focus' },
      budget: { lodging: 100, localTransportation: 50, food: 50, misc: 50 },
      lodgingPreferences: { lodgingTypes: [] },
      localTransportation: [],
      includeLodging: true,
      includeFood: true,
      attractionInterests: '',
    },
    recommendation: {
      id: 'tokyo-food',
      title: 'Tokyo Food Tour',
      description: 'A great food tour.',
      highlights: ['Sushi', 'Ramen', 'Tempura'],
      estimatedCost: '$1,500',
      bestTimeToGo: 'Spring',
    }
  });

  it('handles a valid itinerary request', async () => {
    vi.mocked(apiHelpers.enforcePostMethod).mockReturnValue(true);
    vi.mocked(httpUtils.readJsonBody).mockResolvedValue(getValidMockData());
    
    const mockDraft = 'ACTIVITY PLAN\nDAY 1...';
    vi.mocked(llmRouter.generateText).mockResolvedValue(mockDraft);

    const mockVerified = '## 🌟 Introduction\nHere is your trip...';
    vi.mocked(llmRouter.generateTextWithMeta).mockResolvedValue({
      text: mockVerified,
      usedFallback: false,
    });

    const req = {} as any;
    const res = {} as any;

    await itineraryHandler(req, res);

    expect(apiHelpers.enforcePostMethod).toHaveBeenCalledWith(req, res);
    expect(llmRouter.assertProviderApiKeysConfigured).toHaveBeenCalled();
    expect(tomtomSearch.assertTomTomApiKeyConfigured).toHaveBeenCalled();
    expect(redisUtils.assertRedisConfigured).toHaveBeenCalled();
    expect(llmRouter.generateText).toHaveBeenCalled();
    expect(llmRouter.generateTextWithMeta).toHaveBeenCalled();
    expect(apiHelpers.sendJson).toHaveBeenCalledWith(res, 200, { itinerary: mockVerified });
  });

  it('strips preamble from verified itinerary', async () => {
    vi.mocked(apiHelpers.enforcePostMethod).mockReturnValue(true);
    
    const mockRequestData = getValidMockData();
    mockRequestData.data.includeLodging = false;
    mockRequestData.data.includeFood = false;
    
    vi.mocked(httpUtils.readJsonBody).mockResolvedValue(mockRequestData);
    vi.mocked(llmRouter.generateText).mockResolvedValue('draft');

    const rawVerified = 'Here is what I found for you:\n# 🌟 Introduction\nTrip...';
    vi.mocked(llmRouter.generateTextWithMeta).mockResolvedValue({
      text: rawVerified,
      usedFallback: false,
    });

    const req = {} as any;
    const res = {} as any;

    await itineraryHandler(req, res);

    expect(apiHelpers.sendJson).toHaveBeenCalledWith(res, 200, {
      itinerary: '# 🌟 Introduction\nTrip...'
    });
  });

  it('handles general errors gracefully', async () => {
    vi.mocked(apiHelpers.enforcePostMethod).mockReturnValue(true);
    vi.mocked(httpUtils.readJsonBody).mockRejectedValue(new Error('Network error'));

    const req = {} as any;
    const res = {} as any;

    await itineraryHandler(req, res);

    expect(apiHelpers.handleApiError).toHaveBeenCalled();
  });

  it('handles trip structure notes for different durations and verifies with openai fallback', async () => {
    vi.mocked(apiHelpers.enforcePostMethod).mockReturnValue(true);
    
    // Test verification fallback provider logic
    process.env.ITINERARY_VERIFICATION_PROVIDER = 'invalid';
    vi.mocked(llmRouter.generateText).mockResolvedValue('draft');
    vi.mocked(llmRouter.generateTextWithMeta).mockResolvedValue({ text: 'result', usedFallback: false });

    const durationsToTest = [1, 2, 4]; // Covers 1, 2, and the `else` (>3) branch.

    for (const duration of durationsToTest) {
      const mockRequestData = getValidMockData();
      mockRequestData.data.durationValue = duration;
      mockRequestData.data.durationUnit = 'days';
      
      vi.mocked(httpUtils.readJsonBody).mockResolvedValueOnce(mockRequestData);
      
      const req = {} as any;
      const res = {} as any;
      
      await itineraryHandler(req, res);
      
      expect(apiHelpers.sendJson).toHaveBeenCalledWith(res, 200, { itinerary: 'result' });
    }
  });

  it('uses anthropic for verification if configured', async () => {
    vi.mocked(apiHelpers.enforcePostMethod).mockReturnValue(true);
    process.env.ITINERARY_VERIFICATION_PROVIDER = 'anthropic';
    vi.mocked(llmRouter.generateText).mockResolvedValue('draft');
    vi.mocked(llmRouter.generateTextWithMeta).mockResolvedValue({ text: 'anthropic result', usedFallback: false });

    vi.mocked(httpUtils.readJsonBody).mockResolvedValueOnce(getValidMockData());
    const req = {} as any;
    const res = {} as any;
    
    await itineraryHandler(req, res);
    expect(apiHelpers.sendJson).toHaveBeenCalledWith(res, 200, { itinerary: 'anthropic result' });
  });

  it('uses openai for verification if configured explicitly', async () => {
    vi.mocked(apiHelpers.enforcePostMethod).mockReturnValue(true);
    process.env.ITINERARY_VERIFICATION_PROVIDER = 'openai';
    vi.mocked(llmRouter.generateText).mockResolvedValue('draft');
    vi.mocked(llmRouter.generateTextWithMeta).mockResolvedValue({ text: 'openai result', usedFallback: false });

    vi.mocked(httpUtils.readJsonBody).mockResolvedValueOnce(getValidMockData());
    const req = {} as any;
    const res = {} as any;
    
    await itineraryHandler(req, res);
    expect(apiHelpers.sendJson).toHaveBeenCalledWith(res, 200, { itinerary: 'openai result' });
  });
});
