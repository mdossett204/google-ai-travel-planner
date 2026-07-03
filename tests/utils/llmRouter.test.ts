import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const { mockOpenAICreate, mockAnthropicCreate, mockGeminiGenerateContent, mockExecuteOpenAITool, mockExecuteAnthropicTool, mockExecuteGeminiTool } = vi.hoisted(() => {
  return {
    mockOpenAICreate: vi.fn(),
    mockAnthropicCreate: vi.fn(),
    mockGeminiGenerateContent: vi.fn(),
    mockExecuteOpenAITool: vi.fn(),
    mockExecuteAnthropicTool: vi.fn(),
    mockExecuteGeminiTool: vi.fn(),
  };
});

vi.mock('openai', () => {
  return {
    default: class {
      chat = {
        completions: {
          create: mockOpenAICreate
        }
      }
    }
  };
});

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class {
      messages = {
        create: mockAnthropicCreate
      }
    }
  };
});

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: mockGeminiGenerateContent
      }
    }
  };
});

vi.mock('../../tools/openaiTools.js', () => ({
  executeOpenAITool: mockExecuteOpenAITool
}));

vi.mock('../../tools/anthropicTools.js', () => ({
  executeAnthropicTool: mockExecuteAnthropicTool
}));

vi.mock('../../tools/geminiTools.js', () => ({
  executeGeminiTool: mockExecuteGeminiTool
}));

vi.mock('../../utils/redis.js', () => {
  return {
    runFixedWindowRateLimit: vi.fn().mockResolvedValue(true)
  };
});

import {
  getProvider,
  assertProviderApiKeyConfigured,
  assertProviderApiKeysConfigured,
  calculateMaxToolCallsForTrip,
  LlmConfigurationError,
  generateText,
} from '../../utils/llmRouter.js';

describe('llmRouter', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getProvider', () => {
    it('returns the requested provider if valid', () => {
      expect(getProvider('openai')).toBe('openai');
      expect(getProvider('anthropic')).toBe('anthropic');
      expect(getProvider('gemini')).toBe('gemini');
    });

    it('falls back to environment variable if input is invalid', () => {
      process.env.DEFAULT_LLM_PROVIDER = 'anthropic';
      expect(getProvider('invalid_provider')).toBe('anthropic');
      expect(getProvider()).toBe('anthropic');
    });

    it('falls back to gemini if both input and env are invalid/missing', () => {
      delete process.env.DEFAULT_LLM_PROVIDER;
      expect(getProvider('invalid_provider')).toBe('gemini');
      expect(getProvider()).toBe('gemini');
    });
  });

  describe('assertProviderApiKeyConfigured', () => {
    it('throws error if key is missing', () => {
      delete process.env.OPENAI_API_KEY;
      expect(() => assertProviderApiKeyConfigured('openai')).toThrow(LlmConfigurationError);
    });

    it('does not throw if key is present', () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      expect(() => assertProviderApiKeyConfigured('openai')).not.toThrow();
    });
  });

  describe('calculateMaxToolCallsForTrip', () => {
    it('calculates higher tool calls for longer, more active trips', () => {
      const toolCalls = calculateMaxToolCallsForTrip({
        durationDays: 7,
        activityLevel: 'Very Active',
        includeLodging: true,
        includeFood: true,
        isFoodMajorTripFocus: true,
      });
      // 6 on-location days * 4 daily = 24 base
      // + 3 lodging
      // + 3 * 7 food = 21
      // total raw = 48
      // raw * 1.5 = 72
      expect(toolCalls).toBe(72);
    });

    it('calculates lower tool calls for short, relaxed trips with less features', () => {
      const toolCalls = calculateMaxToolCallsForTrip({
        durationDays: 3,
        activityLevel: 'Relaxed',
        includeLodging: false,
        includeFood: false,
        isFoodMajorTripFocus: false,
      });
      // max(2, 5) on-location days = 5
      // 5 * 2 daily = 10 base
      // 10 * 1.5 = 15
      expect(toolCalls).toBe(15);
    });
  });

  describe('generateText basics', () => {
    beforeEach(() => {
      process.env.OPENAI_API_KEY = 'test-openai';
      process.env.ANTHROPIC_API_KEY = 'test-anthropic';
      process.env.GEMINI_API_KEY = 'test-gemini';
      
      mockOpenAICreate.mockReset().mockResolvedValue({
        choices: [{ message: { content: 'mocked openai response' } }]
      });
      mockAnthropicCreate.mockReset().mockResolvedValue({
        content: [{ type: 'text', text: 'mocked anthropic response' }]
      });
      mockGeminiGenerateContent.mockReset().mockResolvedValue({
        text: 'mocked gemini response'
      });
    });

    it('generates text using openai', async () => {
      const res = await generateText({ provider: 'openai', prompt: 'hello' });
      expect(res).toBe('mocked openai response');
    });

    it('generates text using anthropic', async () => {
      const res = await generateText({ provider: 'anthropic', prompt: 'hello' });
      expect(res).toBe('mocked anthropic response');
    });

    it('generates text using gemini', async () => {
      const res = await generateText({ provider: 'gemini', prompt: 'hello' });
      expect(res).toBe('mocked gemini response');
    });
  });

  describe('generateText tool execution', () => {
    beforeEach(() => {
      process.env.OPENAI_API_KEY = 'test-openai';
      process.env.ANTHROPIC_API_KEY = 'test-anthropic';
      process.env.GEMINI_API_KEY = 'test-gemini';
      mockExecuteOpenAITool.mockReset().mockResolvedValue({ ok: true, result: 'tool success' });
      mockExecuteAnthropicTool.mockReset().mockResolvedValue({ ok: true, result: 'tool success' });
      mockExecuteGeminiTool.mockReset().mockResolvedValue({ ok: true, result: 'tool success' });
    });

    it('executes tools for openai', async () => {
      mockOpenAICreate
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: null,
              tool_calls: [{ id: 'call_1', function: { name: 'testTool', arguments: '{}' } }]
            }
          }]
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'final response after tool' } }]
        });

      const res = await generateText({
        provider: 'openai',
        prompt: 'hello',
        openaiTools: [{ type: 'function', function: { name: 'testTool', description: 'test' } } as any]
      });

      expect(res).toBe('final response after tool');
      expect(mockExecuteOpenAITool).toHaveBeenCalledWith({ name: 'testTool', args: {} });
    });

    it('executes tools for anthropic', async () => {
      mockAnthropicCreate
        .mockResolvedValueOnce({
          content: [
            { type: 'tool_use', id: 'call_1', name: 'testTool', input: {} }
          ]
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'final response after tool' }]
        });

      const res = await generateText({
        provider: 'anthropic',
        prompt: 'hello',
        anthropicTools: [{ name: 'testTool', description: 'test', input_schema: { type: 'object', properties: {} } } as any]
      });

      expect(res).toBe('final response after tool');
      expect(mockExecuteAnthropicTool).toHaveBeenCalledWith({ name: 'testTool', args: {} });
    });

    it('executes tools for gemini', async () => {
      mockGeminiGenerateContent
        .mockResolvedValueOnce({
          candidates: [{
            content: { parts: [{ functionCall: { name: 'testTool', args: {} } }] }
          }]
        })
        .mockResolvedValueOnce({
          text: 'final response after tool'
        });

      const res = await generateText({
        provider: 'gemini',
        prompt: 'hello',
        geminiTools: [{ functionDeclarations: [{ name: 'testTool', description: 'test' }] } as any]
      });

      expect(res).toBe('final response after tool');
    });
    
    it('handles fallback limit for openai', async () => {
      // Return a tool call 15 times to hit the limit (maxToolCalls defaults to 10)
      mockOpenAICreate.mockResolvedValue({
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: 'call_1', function: { name: 'testTool', arguments: '{}' } }]
          }
        }]
      });

      const res = await generateText({
        provider: 'openai',
        prompt: 'hello',
        maxToolCalls: 2,
        openaiTools: [{ type: 'function', function: { name: 'testTool', description: 'test' } } as any]
      });

      // The final fallback call will return what the mock provides, but since we didn't mock valueOnce, it keeps returning tool_calls.
      // Wait, executeFinalFallbackCall extracts the text, which is null, so it becomes empty string.
      expect(res).toBe('');
    });

    it('handles tool execution failures for openai', async () => {
      mockExecuteOpenAITool.mockResolvedValueOnce({ ok: false, error: 'tool error' });
      mockOpenAICreate
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: null,
              tool_calls: [{ id: 'call_1', function: { name: 'testTool', arguments: '{}' } }]
            }
          }]
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'recovered response' } }]
        });

      const res = await generateText({
        provider: 'openai',
        prompt: 'hello',
        openaiTools: [{ type: 'function', function: { name: 'testTool', description: 'test' } } as any]
      });

      expect(res).toBe('recovered response');
    });

    it('handles fallback limit for anthropic', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'call_1', name: 'testTool', input: {} }]
      });

      const res = await generateText({
        provider: 'anthropic',
        prompt: 'hello',
        maxToolCalls: 2,
        anthropicTools: [{ name: 'testTool', description: 'test', input_schema: { type: 'object', properties: {} } } as any]
      });

      expect(res).toBe('');
    });

    it('handles fallback limit for gemini', async () => {
      mockGeminiGenerateContent.mockResolvedValue({
        candidates: [{
          content: { parts: [{ functionCall: { name: 'testTool', args: {} } }] }
        }]
      });

      const res = await generateText({
        provider: 'gemini',
        prompt: 'hello',
        maxToolCalls: 2,
        geminiTools: [{ functionDeclarations: [{ name: 'testTool', description: 'test' }] } as any]
      });

      expect(res).toBe('');
    });

    it('handles tool execution failures for gemini', async () => {
      mockExecuteGeminiTool.mockRejectedValueOnce(new Error('tool error'));
      mockGeminiGenerateContent
        .mockResolvedValueOnce({
          candidates: [{
            content: { parts: [{ functionCall: { name: 'testTool', args: {} } }] }
          }]
        })
        .mockResolvedValueOnce({
          text: 'recovered response'
        });

      const res = await generateText({
        provider: 'gemini',
        prompt: 'hello',
        geminiTools: [{ functionDeclarations: [{ name: 'testTool', description: 'test' }] } as any]
      });

      expect(res).toBe('recovered response');
    });

    it('handles gemini tool call without a name gracefully', async () => {
      mockGeminiGenerateContent
        .mockResolvedValueOnce({
          candidates: [{
            content: { parts: [{ functionCall: { args: {} } }] } // missing name
          }]
        })
        .mockResolvedValueOnce({
          text: 'recovered response without name'
        });

      const res = await generateText({
        provider: 'gemini',
        prompt: 'hello',
        geminiTools: [{ functionDeclarations: [{ name: 'testTool', description: 'test' }] } as any]
      });

      expect(res).toBe('recovered response without name');
    });

    it('logs debug info if DEBUG_LLM_ROUTER is enabled', async () => {
      process.env.DEBUG_LLM_ROUTER = 'true';
      const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'debug response' } }]
      });

      await generateText({ provider: 'openai', prompt: 'hello' });
      
      expect(consoleWarnMock).toHaveBeenCalled();
      consoleWarnMock.mockRestore();
    });

    it('logs gemini tool debug info if DEBUG_LLM_ROUTER is enabled', async () => {
      process.env.DEBUG_LLM_ROUTER = 'true';
      const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      mockGeminiGenerateContent
        .mockResolvedValueOnce({
          candidates: [{
            content: { parts: [{ functionCall: { name: 'testTool', args: {} } }] }
          }]
        })
        .mockResolvedValueOnce({
          text: 'debug response'
        });

      await generateText({
        provider: 'gemini',
        prompt: 'hello',
        geminiTools: [{ functionDeclarations: [{ name: 'testTool', description: 'test' }] } as any]
      });
      
      expect(consoleWarnMock).toHaveBeenCalledWith('[llmRouter] gemini-tool-calls', expect.any(Object));
      expect(consoleWarnMock).toHaveBeenCalledWith('[llmRouter] gemini-tool-response', expect.any(Object));
      consoleWarnMock.mockRestore();
    });

    it('sets responseSchema if provided', async () => {
      mockGeminiGenerateContent.mockResolvedValueOnce({ text: 'schema response' });
      await generateText({
        provider: 'gemini',
        prompt: 'hello',
        responseSchema: { type: 'object' } as any
      });
      expect(mockGeminiGenerateContent).toHaveBeenCalledWith(expect.objectContaining({
        config: expect.objectContaining({
          responseMimeType: 'application/json',
          responseSchema: { type: 'object' }
        })
      }));
    });

    it('logs gemini-tool-call-limit-hit if tool limit is reached and DEBUG_LLM_ROUTER is true', async () => {
      process.env.DEBUG_LLM_ROUTER = 'true';
      const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      // We need to return more than 10 tool calls (which is the mocked calculateMaxToolCallsForTrip = 10)
      const manyCalls = Array.from({ length: 11 }, () => ({ functionCall: { name: 'testTool', args: {} } }));
      
      mockGeminiGenerateContent
        .mockResolvedValueOnce({
          candidates: [{ content: { parts: manyCalls } }]
        })
        .mockResolvedValueOnce({
          text: 'fallback text'
        });

      await generateText({
        provider: 'gemini',
        prompt: 'hello',
        geminiTools: [{ functionDeclarations: [{ name: 'testTool', description: 'test' }] } as any]
      });
      
      expect(consoleWarnMock).toHaveBeenCalledWith('[llmRouter] gemini-tool-call-limit-hit', expect.any(Object));
      consoleWarnMock.mockRestore();
    });

    it('logs rate-limit-retry if DEBUG_LLM_ROUTER is true during rate limit', async () => {
      process.env.DEBUG_LLM_ROUTER = 'true';
      const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const error429 = new Error('Rate limit');
      (error429 as any).status = 429;
      
      mockGeminiGenerateContent
        .mockRejectedValueOnce(error429)
        .mockResolvedValueOnce({ text: 'success after retry' });

      await generateText({ provider: 'gemini', prompt: 'hello' });
      
      expect(consoleWarnMock).toHaveBeenCalledWith('[llmRouter] rate-limit-retry', expect.any(Object));
      consoleWarnMock.mockRestore();
    });
  });
});
