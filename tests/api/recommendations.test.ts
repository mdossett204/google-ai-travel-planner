import { describe, it, expect, vi, beforeEach } from 'vitest';
import recommendationsHandler from '../../api/recommendations.js';
import * as llmRouter from '../../utils/llmRouter.js';
import * as redisUtils from '../../utils/redis.js';
import * as httpUtils from '../../utils/http.js';
import * as apiHelpers from '../../utils/apiHelpers.js';
import { getMockTravelFormData } from '../helpers.js';

vi.mock('../../utils/llmRouter.js', () => ({
  getProvider: vi.fn().mockReturnValue('gemini'),
  assertProviderApiKeysConfigured: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock('../../utils/redis.js', () => ({
  assertRedisConfigured: vi.fn(),
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
  };
});

describe('recommendations API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });



  it('handles a valid recommendations request', async () => {
    vi.mocked(httpUtils.readJsonBody).mockResolvedValue(getMockTravelFormData());
    
    const mockLlmResponse = {
      recommendations: [
        {
          id: 'tokyo-food',
          title: 'Tokyo Food Tour',
          description: 'A great food tour.',
          highlights: ['Sushi', 'Ramen', 'Tempura'],
          estimatedCost: '$1,500',
          bestTimeToGo: 'Spring',
        },
        {
          id: 'kyoto-culture',
          title: 'Kyoto Culture',
          description: 'Explore ancient temples.',
          highlights: ['Kinkaku-ji', 'Fushimi Inari', 'Arashiyama'],
          estimatedCost: '$1,200',
          bestTimeToGo: 'Autumn',
        },
        {
          id: 'osaka-nightlife',
          title: 'Osaka Nightlife',
          description: 'Experience the vibrant nightlife.',
          highlights: ['Dotonbori', 'Umeda', 'Namba'],
          estimatedCost: '$1,300',
          bestTimeToGo: 'Summer',
        }
      ]
    };
    
    vi.mocked(llmRouter.generateText).mockResolvedValue(JSON.stringify(mockLlmResponse));

    const req = { method: 'POST' } as any;
    const res = {} as any;

    await recommendationsHandler(req, res);

    expect(llmRouter.assertProviderApiKeysConfigured).toHaveBeenCalled();
    expect(redisUtils.assertRedisConfigured).toHaveBeenCalled();
    expect(llmRouter.generateText).toHaveBeenCalled();
    expect(apiHelpers.sendJson).toHaveBeenCalledWith(res, 200, mockLlmResponse.recommendations);
  });

  it('handles JSON parsing errors from the LLM gracefully', async () => {
    vi.mocked(httpUtils.readJsonBody).mockResolvedValue(getMockTravelFormData());
    vi.mocked(llmRouter.generateText).mockResolvedValue('invalid json');

    const req = { method: 'POST' } as any;
    const res = {} as any;

    await recommendationsHandler(req, res);

    // It should retry up to 2 times, and then return a 502 error
    expect(llmRouter.generateText).toHaveBeenCalledTimes(2);
    expect(apiHelpers.sendJson).toHaveBeenCalledWith(res, 502, expect.objectContaining({
      error: 'Failed to parse recommendations from AI after retries.'
    }));
  });

  it('handles JSON parsing errors from the LLM gracefully in production', async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    vi.mocked(httpUtils.readJsonBody).mockResolvedValue(getMockTravelFormData());
    vi.mocked(llmRouter.generateText).mockResolvedValue('invalid json');

    const req = { method: 'POST' } as any;
    const res = {} as any;

    await recommendationsHandler(req, res);

    expect(llmRouter.generateText).toHaveBeenCalledTimes(2);
    expect(apiHelpers.sendJson).toHaveBeenCalledWith(res, 502, expect.objectContaining({
      error: 'Failed to parse recommendations from AI after retries.'
    }));
    process.env.NODE_ENV = origEnv;
  });

  it('handles general errors gracefully', async () => {
    vi.mocked(httpUtils.readJsonBody).mockRejectedValue(new Error('Network error'));

    const req = { method: 'POST' } as any;
    const res = {} as any;

    await recommendationsHandler(req, res);

    expect(apiHelpers.handleApiError).toHaveBeenCalled();
  });

  it('rejects non-POST requests', async () => {
    const req = { method: 'GET' } as any;
    const res = { setHeader: vi.fn(), end: vi.fn() } as any;

    await recommendationsHandler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Method not allowed' }));
  });
});
