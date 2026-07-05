import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeProviderTool, SEARCH_PLACE_TOOL } from '../../tools/toolDefinitions.js';
import * as tomtomSearch from '../../tools/tomtomSearch.js';

// Mock the executeSearchPlace function
vi.mock('../../tools/tomtomSearch.js', () => ({
  executeSearchPlace: vi.fn(),
}));

describe('toolDefinitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executeProviderTool', () => {
    it('calls executeSearchPlace when name is search_place', async () => {
      const mockResult = { ok: true, data: 'some data' };
      vi.mocked(tomtomSearch.executeSearchPlace).mockResolvedValueOnce(mockResult);

      const args = { name: 'Eiffel Tower', locationHint: 'Paris', countryCode: 'FR' };
      const result = await executeProviderTool('search_place', args, 'test_label');

      expect(tomtomSearch.executeSearchPlace).toHaveBeenCalledWith(args, 'test_label');
      expect(result).toBe(mockResult);
    });

    it('returns an error when tool name is unknown', async () => {
      const result = await executeProviderTool('unknown_tool', {}, 'test_label');

      expect(tomtomSearch.executeSearchPlace).not.toHaveBeenCalled();
      expect(result).toEqual({
        ok: false,
        error: 'Unknown tool: unknown_tool',
      });
    });
  });

  describe('SEARCH_PLACE_TOOL', () => {
    it('has the correct name and parameters defined', () => {
      expect(SEARCH_PLACE_TOOL.name).toBe('search_place');
      expect(SEARCH_PLACE_TOOL.parameters.type).toBe('OBJECT');
      expect(SEARCH_PLACE_TOOL.parameters.required).toContain('name');
      expect(SEARCH_PLACE_TOOL.parameters.required).toContain('locationHint');
      expect(SEARCH_PLACE_TOOL.parameters.required).toContain('countryCode');
    });
  });
});
