import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import {
  executeGeminiTool,
  type GeminiToolDefinition,
} from "../tools/geminiTools.js";
import { executeOpenAITool } from "../tools/openaiTools.js";
import { executeAnthropicTool } from "../tools/anthropicTools.js";
import { runFixedWindowRateLimit } from "./redis.js";

export type LlmProvider = "openai" | "anthropic" | "gemini";

export class LlmConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigurationError";
  }
}

const PROVIDERS: LlmProvider[] = ["openai", "anthropic", "gemini"];
const MAX_TOOL_CALLS = 10;
const MAX_TOOL_ITERATIONS = 4;
const LLM_MAX_RETRIES = 3;
const LLM_RETRY_BASE_DELAY_MS = 1500;
const DEFAULT_ANTHROPIC_MAX_TOKENS = 8192;
const GEMINI_MIN_INTERVAL_MS = 6000;
const GLOBAL_LLM_RATE_LIMIT_KEY = "llm-call-global-limit";
const GLOBAL_LLM_RATE_LIMIT = 15;
const GLOBAL_LLM_RATE_LIMIT_WINDOW_SEC = 60;

let lastGeminiRequestAt = 0;
let geminiQueue: Promise<void> = Promise.resolve();

interface GeminiFunctionCall {
  name: string;
  args?: Record<string, unknown>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGeminiSlot() {
  const success = await runFixedWindowRateLimit(
    GLOBAL_LLM_RATE_LIMIT_KEY,
    GLOBAL_LLM_RATE_LIMIT,
    GLOBAL_LLM_RATE_LIMIT_WINDOW_SEC,
  );
  if (!success) {
    const error: any = new Error("Global rate limit exceeded");
    error.status = 429;
    throw error;
  }

  const previous = geminiQueue;
  let release!: () => void;

  geminiQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;

  const elapsed = Date.now() - lastGeminiRequestAt;
  const waitMs = Math.max(0, GEMINI_MIN_INTERVAL_MS - elapsed);
  if (waitMs > 0) {
    await sleep(waitMs);
  }

  lastGeminiRequestAt = Date.now();
  release();
}

async function waitForLlmRequestSlot(provider: LlmProvider) {
  if (provider === "gemini") {
    await waitForGeminiSlot();
    return;
  }

  const success = await runFixedWindowRateLimit(
    GLOBAL_LLM_RATE_LIMIT_KEY,
    GLOBAL_LLM_RATE_LIMIT,
    GLOBAL_LLM_RATE_LIMIT_WINDOW_SEC,
  );
  if (!success) {
    const error: any = new Error("Global rate limit exceeded");
    error.status = 429;
    throw error;
  }
}

function isRateLimitError(err: any) {
  return (
    err?.status === 429 ||
    err?.statusCode === 429 ||
    err?.code === 429 ||
    err?.error?.code === 429 ||
    err?.error?.status === "RESOURCE_EXHAUSTED" ||
    err?.status === "RESOURCE_EXHAUSTED"
  );
}

async function withLlmRetry<T>({
  fn,
  provider,
  model,
  isDebug,
}: {
  fn: () => Promise<T>;
  provider: string;
  model: string;
  isDebug: boolean;
}): Promise<T> {
  for (let attempt = 0; attempt < LLM_MAX_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (err: any) {
      const isLastAttempt = attempt === LLM_MAX_RETRIES - 1;
      if (!isRateLimitError(err) || isLastAttempt) {
        throw err;
      }

      const delayMs = LLM_RETRY_BASE_DELAY_MS * 2 ** attempt;
      if (isDebug) {
        console.warn("[llmRouter] rate-limit-retry", {
          provider,
          model,
          attempt: attempt + 1,
          delayMs,
        });
      }

      await sleep(delayMs);
    }
  }

  throw new Error("LLM retry failed unexpectedly.");
}

function getProvider(input?: string): LlmProvider {
  const raw = (input || "").toLowerCase().trim() as LlmProvider;
  if (PROVIDERS.includes(raw)) return raw;
  const env = (process.env.DEFAULT_LLM_PROVIDER || "")
    .toLowerCase()
    .trim() as LlmProvider;
  if (PROVIDERS.includes(env)) return env;
  return "gemini";
}

function getProviderApiKeyEnvVar(provider: LlmProvider) {
  switch (provider) {
    case "openai":
      return "OPENAI_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "gemini":
      return "GEMINI_API_KEY";
  }
}

function getAnthropicMaxTokens() {
  const raw = process.env.ANTHROPIC_MAX_TOKENS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_ANTHROPIC_MAX_TOKENS;
}

export function assertProviderApiKeyConfigured(provider: LlmProvider) {
  const envVar = getProviderApiKeyEnvVar(provider);
  if (!process.env[envVar]?.trim()) {
    throw new LlmConfigurationError(
      `Server configuration error: missing ${envVar} for provider "${provider}".`,
    );
  }
}

export function assertProviderApiKeysConfigured(providers: LlmProvider[]) {
  const uniqueProviders = [...new Set(providers)];
  for (const provider of uniqueProviders) {
    assertProviderApiKeyConfigured(provider);
  }
}

function normalizeText(input: any): string {
  if (typeof input === "string") return input.trim();
  const blocks = Array.isArray(input?.content) ? input.content : [];
  const text = blocks
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b?.text || "")
    .join("\n")
    .trim();
  return text;
}

const TOOL_LIMIT_FALLBACK_PROMPT =
  "Finish the best possible answer using only the information already available. Do not call any more tools. Prefer omission over guessing.";

function getToolLimitFallbackPrompt(provider: string, maxToolCalls: number) {
  return `Tool use has reached the limit (${maxToolCalls}) for ${provider}. ${TOOL_LIMIT_FALLBACK_PROMPT}`;
}

async function finalizeOpenAIWithoutTools({
  openai,
  model,
  messages,
  providerLabel,
  maxToolCalls,
  isDebug,
}: {
  openai: OpenAI;
  model: string;
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  providerLabel?: string;
  maxToolCalls?: number;
  isDebug: boolean;
}) {
  const content =
    providerLabel && maxToolCalls
      ? getToolLimitFallbackPrompt(providerLabel, maxToolCalls)
      : TOOL_LIMIT_FALLBACK_PROMPT;

  const lastMessage = messages[messages.length - 1];
  const finalMessages = [...messages];

  if (lastMessage && lastMessage.role === "user") {
    const newContent = Array.isArray(lastMessage.content)
      ? [...lastMessage.content, { type: "text", text: content }]
      : `${lastMessage.content}\n\n${content}`;
    finalMessages[finalMessages.length - 1] = {
      ...lastMessage,
      content: newContent as any,
    };
  } else {
    finalMessages.push({ role: "user", content });
  }

  const response = await withLlmRetry({
    provider: "openai",
    model,
    isDebug,
    fn: async () => {
      await waitForLlmRequestSlot("openai");
      return openai.chat.completions.create({
        model,
        messages: finalMessages as any,
      });
    },
  });

  return normalizeText(response.choices[0]?.message?.content || "");
}

async function finalizeAnthropicWithoutTools({
  anthropic,
  model,
  messages,
  providerLabel,
  maxToolCalls,
  reason,
  isDebug,
}: {
  anthropic: Anthropic;
  model: string;
  messages: Anthropic.MessageParam[];
  providerLabel?: string;
  maxToolCalls?: number;
  reason?: "tool-limit-hit" | "iteration-limit-hit" | "loop-finalize";
  isDebug: boolean;
}) {
  const content =
    providerLabel && maxToolCalls
      ? getToolLimitFallbackPrompt(providerLabel, maxToolCalls)
      : TOOL_LIMIT_FALLBACK_PROMPT;

  if (isDebug) {
    console.warn("[llmRouter] anthropic-finalize-without-tools", {
      model,
      providerLabel: providerLabel || "anthropic",
      maxToolCalls: maxToolCalls ?? null,
      messageCount: messages.length,
      reason: reason || "loop-finalize",
    });
  }

  const lastMessage = messages[messages.length - 1];
  const finalMessages = [...messages];

  if (lastMessage && lastMessage.role === "user") {
    const newContent = Array.isArray(lastMessage.content)
      ? [...lastMessage.content, { type: "text", text: content }]
      : `${lastMessage.content}\n\n${content}`;
    finalMessages[finalMessages.length - 1] = {
      ...lastMessage,
      content: newContent as any,
    };
  } else {
    finalMessages.push({ role: "user", content });
  }

  const msg = await withLlmRetry({
    provider: "anthropic",
    model,
    isDebug,
    fn: async () => {
      await waitForLlmRequestSlot("anthropic");
      return anthropic.messages.create({
        model,
        max_tokens: getAnthropicMaxTokens(),
        messages: finalMessages as any,
      });
    },
  });

  return normalizeText(msg);
}

async function finalizeGeminiWithoutTools({
  gemini,
  model,
  contents,
  systemInstruction,
  providerLabel,
  maxToolCalls,
  isDebug,
}: {
  gemini: GoogleGenAI;
  model: string;
  contents: any[];
  systemInstruction?: string;
  providerLabel?: string;
  maxToolCalls?: number;
  isDebug: boolean;
}) {
  const content =
    providerLabel && maxToolCalls
      ? getToolLimitFallbackPrompt(providerLabel, maxToolCalls)
      : TOOL_LIMIT_FALLBACK_PROMPT;

  const lastContent = contents[contents.length - 1];
  const finalContents = [...contents];

  if (lastContent && lastContent.role === "user") {
    const newParts = [...(lastContent.parts || []), { text: content }];
    finalContents[finalContents.length - 1] = {
      ...lastContent,
      parts: newParts,
    };
  } else {
    finalContents.push({ role: "user", parts: [{ text: content }] });
  }

  const response = await withLlmRetry({
    provider: "gemini",
    model,
    isDebug,
    fn: async () => {
      await waitForLlmRequestSlot("gemini");
      return gemini.models.generateContent({
        model,
        contents: finalContents,
        config: {
          systemInstruction,
        },
      });
    },
  });

  return normalizeText(response.text || "");
}

export interface GenerateTextResult {
  text: string;
  usedFallback: boolean;
}

type GenerateTextOptions = {
  provider?: string;
  model?: string;
  prompt: string;
  systemInstruction?: string;
  useSearchTool?: boolean;
  geminiTools?: GeminiToolDefinition[];
  openaiTools?: OpenAI.Chat.ChatCompletionTool[];
  anthropicTools?: Anthropic.Tool[];
};

export async function generateText(opts: GenerateTextOptions): Promise<string> {
  const result = await generateTextWithMeta(opts);
  return result.text;
}

export async function generateTextWithMeta(
  opts: GenerateTextOptions,
): Promise<GenerateTextResult> {
  const provider = getProvider(opts.provider) || "gemini";
  assertProviderApiKeyConfigured(provider);
  const model = opts.model?.trim() || "gemini-2.5-flash";
  const isDebug = process.env.DEBUG_LLM_ROUTER === "true";
  let text = "";
  let usedFallback = false;
  let resolvedModel = model;

  // if (isDebug) {
  //   console.warn("[llmRouter] request", {
  //     provider,
  //     model,
  //     promptLength: opts.prompt.length,
  //     useSearchTool: opts.useSearchTool ?? false,
  //   });
  //   console.warn("[llmRouter] prompt", opts.prompt);
  // }

  if (provider === "openai") {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    resolvedModel = model || "gpt-5-nano";
    const hasOpenAITools = (opts.openaiTools?.length || 0) > 0;
    const openaiTools = opts.openaiTools ?? [];

    let messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (opts.systemInstruction) {
      messages.push({ role: "system", content: opts.systemInstruction });
    }
    messages.push({ role: "user", content: opts.prompt });

    if (!hasOpenAITools) {
      const response = await withLlmRetry({
        provider,
        model: resolvedModel,
        isDebug,
        fn: async () => {
          await waitForLlmRequestSlot("openai");
          return openai.chat.completions.create({
            model: resolvedModel,
            messages,
          });
        },
      });
      text = normalizeText(response.choices[0]?.message?.content || "");
    } else {
      let totalToolCalls = 0;

      for (let attempt = 0; attempt < MAX_TOOL_ITERATIONS; attempt += 1) {
        const response = await withLlmRetry({
          provider,
          model: resolvedModel,
          isDebug,
          fn: async () => {
            await waitForLlmRequestSlot("openai");
            return openai.chat.completions.create({
              model: resolvedModel,
              tools: openaiTools,
              messages,
            });
          },
        });

        const responseMessage = response.choices[0]?.message;
        if (!responseMessage) break;

        const toolCalls = responseMessage.tool_calls || [];

        if (toolCalls.length === 0) {
          text = normalizeText(responseMessage.content || "");
          if (isDebug) {
            console.warn("[llmRouter] openai-tool-loop-complete", {
              iterationsUsed: attempt + 1,
              totalToolCalls,
            });
          }
          break;
        }

        const nextTotalToolCalls = totalToolCalls + toolCalls.length;

        if (isDebug) {
          console.warn("[llmRouter] openai-tool-calls", {
            iteration: attempt + 1,
            toolCallsThisIteration: toolCalls.length,
            totalToolCalls: nextTotalToolCalls,
            toolNames: toolCalls.map((call) => call.function.name),
          });
        }
        if (nextTotalToolCalls > MAX_TOOL_CALLS) {
          if (isDebug) {
            console.warn("[llmRouter] openai-tool-call-limit-hit", {
              iteration: attempt + 1,
              totalToolCalls: nextTotalToolCalls,
              maxToolCalls: MAX_TOOL_CALLS,
            });
          }
          usedFallback = true;
          text = await finalizeOpenAIWithoutTools({
            openai,
            model: resolvedModel,
            messages,
            providerLabel: "OpenAI",
            maxToolCalls: MAX_TOOL_CALLS,
            isDebug,
          });
          break;
        }

        messages.push(responseMessage);
        totalToolCalls = nextTotalToolCalls;

        for (const toolCall of toolCalls) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = toolCall.function.arguments
              ? JSON.parse(toolCall.function.arguments)
              : {};
          } catch {
            parsedArgs = {};
          }

          const result = await executeOpenAITool({
            name: toolCall.function.name,
            args: parsedArgs,
          });

          if (isDebug) {
            console.warn("[llmRouter] openai-tool-response", {
              iteration: attempt + 1,
              toolName: toolCall.function.name,
              ok: result?.ok ?? null,
            });
          }

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        }
      }

      if (!text) {
        usedFallback = true;
        text = await finalizeOpenAIWithoutTools({
          openai,
          model: resolvedModel,
          messages,
          isDebug,
        });
      }
    }
  } else if (provider === "anthropic") {
    const systemPrefix = opts.systemInstruction
      ? `System:\n${opts.systemInstruction}\n\n`
      : "";
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    resolvedModel = model || "claude-haiku-4-5";
    const hasAnthropicTools = (opts.anthropicTools?.length || 0) > 0;
    const anthropicTools = opts.anthropicTools ?? [];

    if (!hasAnthropicTools) {
      const msg = await withLlmRetry({
        provider,
        model: resolvedModel,
        isDebug,
        fn: async () => {
          await waitForLlmRequestSlot("anthropic");
          return anthropic.messages.create({
            model: resolvedModel,
            max_tokens: getAnthropicMaxTokens(),
            messages: [{ role: "user", content: systemPrefix + opts.prompt }],
          });
        },
      });
      text = normalizeText(msg);
    } else {
      let messages: Anthropic.MessageParam[] = [
        { role: "user", content: systemPrefix + opts.prompt },
      ];
      let totalToolCalls = 0;

      for (let attempt = 0; attempt < MAX_TOOL_ITERATIONS; attempt += 1) {
        const msg = await withLlmRetry({
          provider,
          model: resolvedModel,
          isDebug,
          fn: async () => {
            await waitForLlmRequestSlot("anthropic");
            return anthropic.messages.create({
              model: resolvedModel,
              max_tokens: getAnthropicMaxTokens(),
              tools: anthropicTools,
              messages,
            });
          },
        });

        const contentBlocks = Array.isArray(msg.content) ? msg.content : [];
        const toolUses = contentBlocks.filter(
          (block: any) => block?.type === "tool_use",
        ) as Anthropic.ToolUseBlock[];

        if (toolUses.length === 0) {
          text = normalizeText(msg);
          if (isDebug) {
            console.warn("[llmRouter] anthropic-tool-loop-complete", {
              iterationsUsed: attempt + 1,
              totalToolCalls,
            });
          }
          break;
        }

        totalToolCalls += toolUses.length;
        if (isDebug) {
          console.warn("[llmRouter] anthropic-tool-calls", {
            iteration: attempt + 1,
            toolCallsThisIteration: toolUses.length,
            totalToolCalls,
            toolNames: toolUses.map((item) => item.name),
          });
        }
        if (totalToolCalls > MAX_TOOL_CALLS) {
          if (isDebug) {
            console.warn("[llmRouter] anthropic-tool-call-limit-hit", {
              iteration: attempt + 1,
              totalToolCalls,
              maxToolCalls: MAX_TOOL_CALLS,
            });
          }
          usedFallback = true;
          text = await finalizeAnthropicWithoutTools({
            anthropic,
            model: resolvedModel,
            messages,
            providerLabel: "Anthropic",
            maxToolCalls: MAX_TOOL_CALLS,
            reason: "tool-limit-hit",
            isDebug,
          });
          break;
        }

        const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
        for (const toolUse of toolUses) {
          const toolArgs =
            toolUse.input && typeof toolUse.input === "object"
              ? (toolUse.input as Record<string, unknown>)
              : {};

          const result = await executeAnthropicTool({
            name: toolUse.name,
            args: toolArgs,
          });

          if (isDebug) {
            console.warn("[llmRouter] anthropic-tool-response", {
              iteration: attempt + 1,
              toolName: toolUse.name,
              ok: result?.ok ?? null,
            });
          }

          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(result),
          });
        }

        messages = [
          ...messages,
          {
            role: "assistant",
            content: contentBlocks,
          },
          {
            role: "user",
            content: toolResultBlocks,
          },
        ];
      }

      if (!text) {
        usedFallback = true;
        text = await finalizeAnthropicWithoutTools({
          anthropic,
          model: resolvedModel,
          messages,
          reason: totalToolCalls > 0 ? "iteration-limit-hit" : "loop-finalize",
          isDebug,
        });
      }
    }
  } else {
    const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    resolvedModel = model || "gemini-2.5-flash";
    const hasGeminiFunctionTools = (opts.geminiTools?.length || 0) > 0;
    const tools = hasGeminiFunctionTools
      ? [...(opts.geminiTools || [])]
      : [...(opts.useSearchTool ? [{ googleSearch: {} }] : [])];

    if (isDebug && hasGeminiFunctionTools && opts.useSearchTool) {
      console.warn("[llmRouter] gemini-tool-selection", {
        message:
          "Custom Gemini function tools are enabled, so built-in googleSearch is disabled for this request.",
      });
    }

    if (tools.length === 0) {
      const response = await withLlmRetry({
        provider,
        model: resolvedModel,
        isDebug,
        fn: async () => {
          await waitForLlmRequestSlot("gemini");
          return gemini.models.generateContent({
            model: resolvedModel,
            contents: opts.prompt,
            config: {
              systemInstruction: opts.systemInstruction,
            },
          });
        },
      });
      text = normalizeText(response.text || "");
    } else {
      let contents: any = [{ role: "user", parts: [{ text: opts.prompt }] }];
      let totalToolCalls = 0;

      for (let attempt = 0; attempt < MAX_TOOL_ITERATIONS; attempt += 1) {
        const response = await withLlmRetry({
          provider,
          model: resolvedModel,
          isDebug,
          fn: async () => {
            await waitForLlmRequestSlot("gemini");
            return gemini.models.generateContent({
              model: resolvedModel,
              contents,
              config: {
                tools,
                systemInstruction: opts.systemInstruction,
              },
            });
          },
        });

        const candidates = Array.isArray(response.candidates)
          ? response.candidates
          : [];
        const parts = Array.isArray(candidates[0]?.content?.parts)
          ? candidates[0].content.parts
          : [];

        const functionCalls = parts.filter((part: any) => part.functionCall);
        if (functionCalls.length === 0) {
          text = normalizeText(response.text || "");
          if (isDebug && hasGeminiFunctionTools) {
            console.warn("[llmRouter] gemini-tool-loop-complete", {
              iterationsUsed: attempt + 1,
              totalToolCalls,
            });
          }
          break;
        }

        totalToolCalls += functionCalls.length;
        if (isDebug && hasGeminiFunctionTools) {
          console.warn("[llmRouter] gemini-tool-calls", {
            iteration: attempt + 1,
            toolCallsThisIteration: functionCalls.length,
            totalToolCalls,
            toolNames: functionCalls
              .map((part: any) => part.functionCall?.name)
              .filter(Boolean),
          });
        }
        if (totalToolCalls > MAX_TOOL_CALLS) {
          if (isDebug && hasGeminiFunctionTools) {
            console.warn("[llmRouter] gemini-tool-call-limit-hit", {
              iteration: attempt + 1,
              totalToolCalls,
              maxToolCalls: MAX_TOOL_CALLS,
            });
          }
          usedFallback = true;
          text = await finalizeGeminiWithoutTools({
            gemini,
            model: resolvedModel,
            contents,
            systemInstruction: opts.systemInstruction,
            providerLabel: "Gemini",
            maxToolCalls: MAX_TOOL_CALLS,
            isDebug,
          });
          break;
        }

        const toolResponses = [];
        for (const part of functionCalls) {
          const functionCall = part.functionCall as
            | GeminiFunctionCall
            | undefined;
          if (!functionCall?.name) {
            continue;
          }

          const result = await executeGeminiTool({
            name: functionCall.name,
            args: functionCall.args || {},
          });

          if (isDebug && hasGeminiFunctionTools) {
            console.warn("[llmRouter] gemini-tool-response", {
              iteration: attempt + 1,
              toolName: functionCall.name,
              ok: result?.ok ?? null,
            });
          }

          toolResponses.push({
            functionResponse: {
              name: functionCall.name,
              response:
                typeof result === "object" && result !== null
                  ? result
                  : { value: result },
            },
          });
        }

        contents = [
          ...contents,
          {
            role: "model",
            parts,
          },
          {
            role: "user",
            parts: toolResponses,
          },
        ];
      }

      if (!text) {
        usedFallback = true;
        text = await finalizeGeminiWithoutTools({
          gemini,
          model: resolvedModel,
          contents,
          systemInstruction: opts.systemInstruction,
          isDebug,
        });
      }
    }
  }

  // if (isDebug) {
  //   console.warn("[llmRouter] response", {
  //     provider,
  //     model: resolvedModel,
  //     durationMs: Date.now() - startedAt,
  //     outputLength: text.length,
  //   });
  //   console.warn("[llmRouter] output", text);
  // }

  return {
    text,
    usedFallback,
  };
}
