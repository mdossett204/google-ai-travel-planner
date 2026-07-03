import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOpenAIVerificationTools, executeOpenAITool } from '../../tools/openaiTools.js';
import * as toolDefinitions from '../../tools/toolDefinitions.js';

vi.mock('../../tools/toolDefinitions.js', () => ({
  SEARCH_PLACE_TOOL: { name: 'search_place', description: 'mock search place', parameters: { required: ['name'] } },
  SEARCH_PLACE_PROPERTIES: { name: { description: 'name desc' }, locationHint: { description: 'hint desc' } },
  executeProviderTool: vi.fn(),
}));

describe('openaiTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getOpenAIVerificationTools', () => {
    it('returns the correct tool definitions for OpenAI', () => {
      const tools = getOpenAIVerificationTools();
      expect(tools.length).toBe(1);
      expect(tools[0].type).toBe('function');
      expect(tools[0].function.name).toBe('search_place');
    });
  });

  describe('executeOpenAITool', () => {
    it('delegates to executeProviderTool with openaiTools label', async () => {
      const mockResult = { ok: true };
      vi.mocked(toolDefinitions.executeProviderTool).mockResolvedValueOnce(mockResult);

      const args = { location: 'Berlin' };
      const context = { name: 'search_place', args };

      const result = await executeOpenAITool(context);

      expect(toolDefinitions.executeProviderTool).toHaveBeenCalledWith(
        'search_place',
        args,
        'openaiTools'
      );
      expect(result).toBe(mockResult);
    });
  });
});
