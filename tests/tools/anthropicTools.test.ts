import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAnthropicVerificationTools, executeAnthropicTool } from '../../tools/anthropicTools.js';
import * as toolDefinitions from '../../tools/toolDefinitions.js';

vi.mock('../../tools/toolDefinitions.js', () => ({
  SEARCH_PLACE_TOOL: { name: 'search_place', description: 'mock search place', parameters: { required: ['name'] } },
  SEARCH_PLACE_PROPERTIES: { name: { description: 'name desc' }, locationHint: { description: 'hint desc' } },
  executeProviderTool: vi.fn(),
}));

describe('anthropicTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAnthropicVerificationTools', () => {
    it('returns the correct tool definitions for Anthropic', () => {
      const tools = getAnthropicVerificationTools();
      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe('search_place');
      expect(tools[0].input_schema.type).toBe('object');
    });
  });

  describe('executeAnthropicTool', () => {
    it('delegates to executeProviderTool with anthropicTools label', async () => {
      const mockResult = { ok: true };
      vi.mocked(toolDefinitions.executeProviderTool).mockResolvedValueOnce(mockResult);

      const args = { location: 'London' };
      const context = { name: 'search_place', args };

      const result = await executeAnthropicTool(context);

      expect(toolDefinitions.executeProviderTool).toHaveBeenCalledWith(
        'search_place',
        args,
        'anthropicTools'
      );
      expect(result).toBe(mockResult);
    });
  });
});
