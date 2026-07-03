import { describe, it, expect, vi, beforeEach } from 'vitest';
import tomtomPoiSearchHandler from '../../tools/tomtomPoiSearch.js';
import * as tomtomSearch from '../../tools/tomtomSearch.js';
import * as httpUtils from '../../utils/http.js';
import * as apiHelpers from '../../utils/apiHelpers.js';
import * as redisUtils from '../../utils/redis.js';

vi.mock('../../tools/tomtomSearch.js', () => ({
  assertTomTomApiKeyConfigured: vi.fn(),
  searchTomTom: vi.fn(),
}));

vi.mock('../../utils/redis.js', () => ({
  assertRedisConfigured: vi.fn(),
}));

vi.mock('../../utils/http.js', () => ({
  readJsonBody: vi.fn(),
}));

vi.mock('../../utils/apiHelpers.js', () => ({
  enforcePostMethod: vi.fn(),
  sendJson: vi.fn(),
  handleApiError: vi.fn(),
}));

describe('tomtomPoiSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles a valid POI search request', async () => {
    vi.mocked(apiHelpers.enforcePostMethod).mockReturnValue(true);
    vi.mocked(httpUtils.readJsonBody).mockResolvedValue({ query: 'Central Park' });
    vi.mocked(tomtomSearch.searchTomTom).mockResolvedValue([{ id: '1', name: 'Central Park' } as any]);

    const req = {} as any;
    const res = {} as any;

    await tomtomPoiSearchHandler(req, res);

    expect(apiHelpers.enforcePostMethod).toHaveBeenCalledWith(req, res);
    expect(tomtomSearch.assertTomTomApiKeyConfigured).toHaveBeenCalled();
    expect(redisUtils.assertRedisConfigured).toHaveBeenCalled();
    expect(tomtomSearch.searchTomTom).toHaveBeenCalledWith({
      query: 'Central Park',
      limit: 5, // default
      latitude: undefined,
      longitude: undefined,
    });
    expect(apiHelpers.sendJson).toHaveBeenCalledWith(res, 200, { results: [{ id: '1', name: 'Central Park' }] });
  });

  it('handles errors gracefully via handleApiError', async () => {
    vi.mocked(apiHelpers.enforcePostMethod).mockReturnValue(true);
    vi.mocked(httpUtils.readJsonBody).mockRejectedValue(new Error('Test error'));

    const req = {} as any;
    const res = {} as any;

    await tomtomPoiSearchHandler(req, res);

    expect(apiHelpers.handleApiError).toHaveBeenCalled();
    expect(apiHelpers.sendJson).not.toHaveBeenCalled();
  });

  it('does nothing if enforcePostMethod returns false', async () => {
    vi.mocked(apiHelpers.enforcePostMethod).mockReturnValue(false);

    const req = {} as any;
    const res = {} as any;

    await tomtomPoiSearchHandler(req, res);

    expect(tomtomSearch.assertTomTomApiKeyConfigured).not.toHaveBeenCalled();
  });
});
