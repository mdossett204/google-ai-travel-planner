import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import * as openaiTools from '../../tools/openaiTools.js';
import * as anthropicTools from '../../tools/anthropicTools.js';
import * as geminiTools from '../../tools/geminiTools.js';

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
import { runFixedWindowRateLimit } from '../../utils/redis.js';

import {
  getProvider,
  assertProviderApiKeyConfigured,
  assertProviderApiKeysConfigured,
  calculateMaxToolCallsForTrip,
  LlmConfigurationError,
  generateText,
  generateTextWithMeta,
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
      vi.mocked(runFixedWindowRateLimit).mockResolvedValue(true);
      expect(res).toBe('mocked openai response');
    });

    it('throws 429 if global rate limit is exceeded', async () => {
      vi.useFakeTimers();
      vi.mocked(runFixedWindowRateLimit).mockResolvedValue(false);
      
      const config = { provider: 'openai', model: 'gpt-4o', prompt: 'test' };
      
      const promise = generateTextWithMeta(config as any);
      const expected = expect(promise).rejects.toThrow('Global rate limit exceeded');
      await vi.runAllTimersAsync();
      await expected;
      
      vi.useRealTimers();
      vi.mocked(runFixedWindowRateLimit).mockResolvedValue(true);
    });

    it('generates text using OpenAI natively without fallback if response is valid', async () => {
      const res = await generateText({ provider: 'anthropic', prompt: 'hello' });
      expect(res).toBe('mocked anthropic response');
    });

    it('generates text using gemini', async () => {
      const res = await generateText({ provider: 'gemini', prompt: 'hello' });
      expect(res).toBe('mocked gemini response');
    });

    it('passes systemInstruction to providers', async () => {
      await generateText({ provider: 'openai', prompt: 'hello', systemInstruction: 'system test' });
      expect(mockOpenAICreate).toHaveBeenCalledWith(expect.objectContaining({
        messages: expect.arrayContaining([{ role: 'system', content: 'system test' }])
      }));
    });

    it('throws non-retryable errors immediately', async () => {
      const err = new Error('Bad Request');
      (err as any).status = 400;
      mockOpenAICreate.mockRejectedValueOnce(err);
      
      await expect(generateText({ provider: 'openai', prompt: 'hello' })).rejects.toThrow('Bad Request');
    });

    it('asserts api keys are configured for multiple providers', () => {
      process.env.OPENAI_API_KEY = 'valid';
      process.env.ANTHROPIC_API_KEY = 'valid';
      process.env.GEMINI_API_KEY = '';
      
      expect(() => assertProviderApiKeysConfigured(['openai', 'anthropic'])).not.toThrow();
      expect(() => assertProviderApiKeysConfigured(['openai', 'gemini'])).toThrow(/GEMINI_API_KEY/);
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

    it('handles fallback limit for openai', async () => {
      process.env.DEBUG_LLM_ROUTER = 'true';
      const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockOpenAICreate
        .mockResolvedValueOnce({
          choices: [{ message: { tool_calls: [{ id: '1', function: { name: 'testTool', arguments: '{}' } }] } }]
        })
        .mockResolvedValueOnce({
          choices: [{ message: { tool_calls: [{ id: '2', function: { name: 'testTool', arguments: '{}' } }] } }]
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'recovered via fallback' } }]
        });

      const res = await generateText({
        provider: 'openai',
        prompt: 'hello',
        maxToolCalls: 1,
        openaiTools: [{ type: 'function', function: { name: 'testTool', description: 'test' } } as any]
      });

      expect(res).toBe('recovered via fallback');
      expect(consoleWarnMock).toHaveBeenCalledWith(
        '[llmRouter] openai-tool-call-limit-hit',
        expect.any(Object)
      );

      consoleWarnMock.mockRestore();
      delete process.env.DEBUG_LLM_ROUTER;
    });

    it('handles empty text fallback for openai', async () => {
      mockOpenAICreate
        .mockResolvedValueOnce({
          choices: [{ message: { content: '' } }] // Empty text
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'recovered from empty' } }]
        });

      const res = await generateText({
        provider: 'openai',
        prompt: 'hello',
        openaiTools: [{ type: 'function', function: { name: 'testTool', description: 'test' } }]
      });

      expect(res).toBe('recovered from empty');
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

    it('handles fallback limit for anthropic', async () => {
      process.env.DEBUG_LLM_ROUTER = 'true';
      const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockAnthropicCreate
        .mockResolvedValueOnce({ content: [{ type: 'tool_use', id: '1', name: 'testTool', input: {} }] })
        .mockResolvedValueOnce({ content: [{ type: 'tool_use', id: '2', name: 'testTool', input: {} }] })
        .mockResolvedValueOnce({ content: [{ type: 'text', text: 'recovered via fallback' }] });

      const res = await generateText({
        provider: 'anthropic',
        prompt: 'hello',
        maxToolCalls: 1,
        anthropicTools: [{ name: 'testTool', description: 'test', input_schema: { type: 'object', properties: {} } } as any]
      });

      expect(res).toBe('recovered via fallback');
      expect(consoleWarnMock).toHaveBeenCalledWith(
        '[llmRouter] anthropic-tool-call-limit-hit',
        expect.any(Object)
      );

      consoleWarnMock.mockRestore();
      delete process.env.DEBUG_LLM_ROUTER;
    });

    it('handles empty text fallback for anthropic', async () => {
      mockAnthropicCreate
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: '' }] // Empty text
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'recovered from empty' }]
        });

      const res = await generateText({
        provider: 'anthropic',
        prompt: 'hello',
        anthropicTools: [{ name: 'testTool', description: 'test', input_schema: { type: 'object', properties: {} } }]
      });

      expect(res).toBe('recovered from empty');
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
      const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {}); consoleWarnMock.mockClear();
      
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'debug response' } }]
      });

      await generateText({ provider: 'openai', prompt: 'hello' });
      
      expect(consoleWarnMock).toHaveBeenCalled();
      consoleWarnMock.mockRestore();
    });

    it('logs gemini tool debug info if DEBUG_LLM_ROUTER is enabled', async () => {
      process.env.DEBUG_LLM_ROUTER = 'true';
      const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {}); consoleWarnMock.mockClear();
      
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
      const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {}); consoleWarnMock.mockClear();
      
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
      vi.useFakeTimers();
      process.env.DEBUG_LLM_ROUTER = 'true';
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const error429 = new Error('Rate limit');
      (error429 as any).status = 429;
      
      mockGeminiGenerateContent
        .mockRejectedValueOnce(error429)
        .mockResolvedValueOnce({ text: 'success after retry' });
      
      const promise = generateText({ provider: 'gemini', prompt: 'hello' });
      const expected = expect(promise).resolves.toBeTruthy(); // It resolves successfully
      await vi.runAllTimersAsync();
      await expected;

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[llmRouter] rate-limit-retry'),
        expect.any(Object)
      );
      
      vi.useRealTimers();
      consoleWarnSpy.mockRestore();
      process.env.DEBUG_LLM_ROUTER = 'false';
    });
    it('logs tool error debug info for openai', async () => {
      process.env.DEBUG_LLM_ROUTER = 'true';
      const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});

      const toolError = new Error('Tool failed');
      const mockExecuteOpenAITool = vi.spyOn(openaiTools, 'executeOpenAITool').mockRejectedValueOnce(toolError);

      mockOpenAICreate
        .mockResolvedValueOnce({
          choices: [{
            message: {
              tool_calls: [{
                id: '1',
                function: { name: 'testTool', arguments: '{}' }
              }]
            }
          }]
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'recovered' } }]
        });

      await generateText({
        provider: 'openai',
        prompt: 'hello',
        openaiTools: [{
          type: 'function',
          function: { name: 'testTool', description: 'test' }
        }]
      });

      expect(consoleErrorMock).toHaveBeenCalledWith(
        '[llmRouter] openai-tool-error for testTool:',
        toolError
      );

      consoleErrorMock.mockRestore();
      mockExecuteOpenAITool.mockRestore();
      delete process.env.DEBUG_LLM_ROUTER;
    });

    it('falls back to text generation for Anthropic when no text is returned', async () => {
      mockAnthropicCreate
        .mockResolvedValueOnce({
          content: [] // No text returned
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'fallback text' }]
        });

      const res = await generateText({
        provider: 'anthropic',
        prompt: 'hello',
        anthropicTools: [{ name: 'testTool', description: 'test', input_schema: { type: 'object', properties: {} } }]
      });

      expect(res).toBe('fallback text');
    });

    it('handles anthropic tool errors and logs debug info', async () => {
      process.env.DEBUG_LLM_ROUTER = 'true';
      const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});

      const toolError = new Error('Anthropic tool failed');
      const mockExecuteAnthropicTool = vi.spyOn(anthropicTools, 'executeAnthropicTool').mockRejectedValueOnce(toolError);

      mockAnthropicCreate
        .mockResolvedValueOnce({
          content: [{
            type: 'tool_use',
            id: '1',
            name: 'testTool',
            input: {}
          }]
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'recovered' }]
        });

      await generateText({
        provider: 'anthropic',
        prompt: 'hello',
        anthropicTools: [{ name: 'testTool', description: 'test', input_schema: { type: 'object', properties: {} } }]
      });

      expect(consoleErrorMock).toHaveBeenCalledWith(
        '[llmRouter] anthropic-tool-error for testTool:',
        toolError
      );

      consoleErrorMock.mockRestore();
      mockExecuteAnthropicTool.mockRestore();
      delete process.env.DEBUG_LLM_ROUTER;
    });

    it('handles alternative tool call formats and empty results for Gemini', async () => {
      process.env.DEBUG_LLM_ROUTER = 'true';
      const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});

      const mockExecuteGeminiTool = vi.spyOn(geminiTools, 'executeGeminiTool').mockRejectedValueOnce(new Error('Gemini tool error'));

      mockGeminiGenerateContent
        .mockResolvedValueOnce({
          candidates: [{
            content: {
              parts: [{
                functionCall: { name: 'testTool', args: {} }
              } as any]
            }
          }]
        })
        .mockResolvedValueOnce({
          // Empty text coverage for line 866-882
          text: ''
        });

      const res = await generateText({
        provider: 'gemini',
        prompt: 'hello',
        geminiTools: [{ functionDeclarations: [{ name: 'testTool', description: 'test' }] } as any]
      });

      expect(consoleErrorMock).toHaveBeenCalledWith(
        '[llmRouter] gemini-tool-error for testTool:',
        expect.any(Error)
      );

      expect(res).toBe('');

      consoleErrorMock.mockRestore();
      mockExecuteGeminiTool.mockRestore();
      delete process.env.DEBUG_LLM_ROUTER;
    });

    it('handles openai tool JSON parse errors', async () => {
      mockOpenAICreate
        .mockResolvedValueOnce({
          choices: [{
            message: {
              tool_calls: [{
                id: '1',
                function: { name: 'testTool', arguments: '{invalid json}' }
              }]
            }
          }]
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'recovered' } }]
        });

      const res = await generateText({
        provider: 'openai',
        prompt: 'hello',
        openaiTools: [{
          type: 'function',
          function: { name: 'testTool', description: 'test' }
        }]
      });

      expect(res).toBe('recovered');
      expect(mockExecuteOpenAITool).toHaveBeenCalledWith({ name: 'testTool', args: {} });
    });

    it('logs gemini tool selection debug info', async () => {
      process.env.DEBUG_LLM_ROUTER = 'true';
      const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockGeminiGenerateContent.mockResolvedValueOnce({ text: 'gemini response' });

      await generateText({
        provider: 'gemini',
        prompt: 'hello',
        useSearchTool: true,
        geminiTools: [{ functionDeclarations: [{ name: 'testTool', description: 'test' }] } as any]
      });

      expect(consoleWarnMock).toHaveBeenCalledWith(
        '[llmRouter] gemini-tool-selection',
        expect.any(Object)
      );

      consoleWarnMock.mockRestore();
      delete process.env.DEBUG_LLM_ROUTER;
    });
  });
});
