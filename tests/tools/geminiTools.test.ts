import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getGeminiVerificationTools, executeGeminiTool } from '../../tools/geminiTools.js';
import * as toolDefinitions from '../../tools/toolDefinitions.js';

vi.mock('../../tools/toolDefinitions.js', () => ({
  SEARCH_PLACE_TOOL: { name: 'search_place', description: 'mock search place' },
  executeProviderTool: vi.fn(),
}));

describe('geminiTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getGeminiVerificationTools', () => {
    it('returns the correct tool definitions for Gemini', () => {
      const tools = getGeminiVerificationTools();
      expect(tools.length).toBe(1);
      expect(tools[0].functionDeclarations).toBeDefined();
      expect(tools[0].functionDeclarations[0].name).toBe('search_place');
    });
  });

  describe('executeGeminiTool', () => {
    it('delegates to executeProviderTool with geminiTools label', async () => {
      const mockResult = { ok: true };
      vi.mocked(toolDefinitions.executeProviderTool).mockResolvedValueOnce(mockResult);

      const args = { location: 'Tokyo' };
      const context = { name: 'search_place', args };

      const result = await executeGeminiTool(context);

      expect(toolDefinitions.executeProviderTool).toHaveBeenCalledWith(
        'search_place',
        args,
        'geminiTools'
      );
      expect(result).toBe(mockResult);
    });
  });
});
