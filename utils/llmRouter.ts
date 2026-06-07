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
import { sleep } from "./apiHelpers.js";
import { getOnLocationDays } from "./tripContext.js";

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
const GLOBAL_LLM_RATE_LIMIT_KEY = "llm-call-global-limit";
const GLOBAL_LLM_RATE_LIMIT = 15;
const GLOBAL_LLM_RATE_LIMIT_WINDOW_SEC = 60;

const clients: {
  openai?: OpenAI;
  anthropic?: Anthropic;
  gemini?: GoogleGenAI;
} = {};

interface GeminiFunctionCall {
  name: string;
  args?: Record<string, unknown>;
}

async function waitForLlmRequestSlot() {
  const success = await runFixedWindowRateLimit(
    GLOBAL_LLM_RATE_LIMIT_KEY,
    GLOBAL_LLM_RATE_LIMIT,
    GLOBAL_LLM_RATE_LIMIT_WINDOW_SEC,
  );
  if (!success) {
    throw Object.assign(new Error("Global rate limit exceeded"), {
      status: 429,
    });
  }
}

function isRateLimitError(err: unknown) {
  const e = err as Record<string, unknown>;
  const eError = e?.error as Record<string, unknown> | undefined;
  return (
    e?.status === 429 ||
    e?.statusCode === 429 ||
    e?.code === 429 ||
    eError?.code === 429 ||
    eError?.status === "RESOURCE_EXHAUSTED" ||
    e?.status === "RESOURCE_EXHAUSTED"
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
    } catch (err: unknown) {
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

export function getProvider(input?: string): LlmProvider {
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

const ANTHROPIC_MAX_TOKENS = (() => {
  const raw = process.env.ANTHROPIC_MAX_TOKENS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_ANTHROPIC_MAX_TOKENS;
})();

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

function normalizeText(input: unknown): string {
  if (typeof input === "string") return input.trim();
  const safeInput = input as Record<string, unknown>;
  const blocks = Array.isArray(safeInput?.content) ? safeInput.content : [];
  const text = blocks
    .filter((b: Record<string, unknown>) => b?.type === "text")
    .map((b: Record<string, unknown>) => (b?.text as string) || "")
    .join("\n")
    .trim();
  return text;
}

const TOOL_LIMIT_FALLBACK_PROMPT =
  "Finish the best possible answer using only the information already available. Do not call any more tools. Prefer omission over guessing.";

function getToolLimitFallbackPrompt(provider: string, maxToolCalls: number) {
  return `Tool use has reached the limit (${maxToolCalls}) for ${provider}. ${TOOL_LIMIT_FALLBACK_PROMPT}`;
}

function buildFallbackContent(
  providerLabel?: string,
  maxToolCalls?: number,
): string {
  return providerLabel != null && maxToolCalls != null
    ? getToolLimitFallbackPrompt(providerLabel, maxToolCalls)
    : TOOL_LIMIT_FALLBACK_PROMPT;
}

function appendFallbackToMessages(messages: any[], content: string): any[] {
  const finalMessages = [...messages];
  const last = finalMessages[finalMessages.length - 1];
  if (last && last.role === "user") {
    const newContent = Array.isArray(last.content)
      ? [...last.content, { type: "text", text: content }]
      : `${last.content}\n\n${content}`;
    finalMessages[finalMessages.length - 1] = { ...last, content: newContent };
  } else {
    finalMessages.push({ role: "user", content });
  }
  return finalMessages;
}

function appendFallbackToContents(contents: any[], content: string): any[] {
  const finalContents = [...contents];
  const last = finalContents[finalContents.length - 1];
  if (last && last.role === "user") {
    finalContents[finalContents.length - 1] = {
      ...last,
      parts: [...(last.parts || []), { text: content }],
    };
  } else {
    finalContents.push({ role: "user", parts: [{ text: content }] });
  }
  return finalContents;
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
  const finalMessages = appendFallbackToMessages(
    messages,
    buildFallbackContent(providerLabel, maxToolCalls),
  );
  const response = await withLlmRetry({
    provider: "openai",
    model,
    isDebug,
    fn: async () => {
      await waitForLlmRequestSlot();
      return openai.chat.completions.create({ model, messages: finalMessages });
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
  if (isDebug) {
    console.warn("[llmRouter] anthropic-finalize-without-tools", {
      model,
      providerLabel: providerLabel || "anthropic",
      maxToolCalls: maxToolCalls ?? null,
      messageCount: messages.length,
      reason: reason || "loop-finalize",
    });
  }
  const finalMessages = appendFallbackToMessages(
    messages,
    buildFallbackContent(providerLabel, maxToolCalls),
  );
  const msg = await withLlmRetry({
    provider: "anthropic",
    model,
    isDebug,
    fn: async () => {
      await waitForLlmRequestSlot();
      return anthropic.messages.create({
        model,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        messages: finalMessages,
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
  const finalContents = appendFallbackToContents(
    contents,
    buildFallbackContent(providerLabel, maxToolCalls),
  );
  const response = await withLlmRetry({
    provider: "gemini",
    model,
    isDebug,
    fn: async () => {
      await waitForLlmRequestSlot();
      return gemini.models.generateContent({
        model,
        contents: finalContents,
        config: { systemInstruction },
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
  maxToolCalls?: number;
};

export async function generateText(opts: GenerateTextOptions): Promise<string> {
  const result = await generateTextWithMeta(opts);
  return result.text;
}

export type ToolBudgetInputs = {
  durationDays: number;
  activityLevel: "Relaxed" | "Balanced" | "Very Active" | "";
  includeLodging: boolean;
  includeFood: boolean;
  isFoodMajorTripFocus: boolean;
};

export function calculateMaxToolCallsForTrip(inputs: ToolBudgetInputs): number {
  const onLocationDays = Math.max(getOnLocationDays(inputs.durationDays), 5);
  const dailyLocations =
    inputs.activityLevel === "Very Active"
      ? 4
      : inputs.activityLevel === "Relaxed"
        ? 2
        : 3; // Balanced/default

  const base = onLocationDays * dailyLocations;
  const lodging = inputs.includeLodging ? 3 : 0;
  const food =
    inputs.includeFood && inputs.isFoodMajorTripFocus
      ? 3 * inputs.durationDays
      : 0;

  const raw = (base + lodging + food) * 1.5;
  return Math.max(0, Math.ceil(raw));
}

export async function generateTextWithMeta(
  opts: GenerateTextOptions,
): Promise<GenerateTextResult> {
  const startedAt = Date.now();
  const provider = getProvider(opts.provider) || "gemini";
  assertProviderApiKeyConfigured(provider);
  const model = opts.model?.trim() || "";
  const isDebug = process.env.DEBUG_LLM_ROUTER === "true";
  let text = "";
  let usedFallback = false;
  let resolvedModel = model;
  const maxToolCalls =
    typeof opts.maxToolCalls === "number" && Number.isFinite(opts.maxToolCalls)
      ? Math.max(0, Math.floor(opts.maxToolCalls))
      : MAX_TOOL_CALLS;

  if (isDebug) {
    console.warn("[llmRouter] request", {
      provider,
      model,
      promptLength: opts.prompt.length,
      useSearchTool: opts.useSearchTool ?? false,
    });
    console.warn("[llmRouter] prompt", opts.prompt);
  }

  if (provider === "openai") {
    const openai = (clients.openai ??= new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    }));
    resolvedModel = model || "gpt-5-mini";
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
          await waitForLlmRequestSlot();
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
            await waitForLlmRequestSlot();
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
        if (nextTotalToolCalls > maxToolCalls) {
          if (isDebug) {
            console.warn("[llmRouter] openai-tool-call-limit-hit", {
              iteration: attempt + 1,
              totalToolCalls: nextTotalToolCalls,
              maxToolCalls,
            });
          }
          usedFallback = true;
          text = await finalizeOpenAIWithoutTools({
            openai,
            model: resolvedModel,
            messages,
            providerLabel: "OpenAI",
            maxToolCalls,
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
    const anthropic = (clients.anthropic ??= new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    }));
    resolvedModel = model || "claude-haiku-4-5";
    const hasAnthropicTools = (opts.anthropicTools?.length || 0) > 0;
    const anthropicTools = opts.anthropicTools ?? [];

    if (!hasAnthropicTools) {
      const msg = await withLlmRetry({
        provider,
        model: resolvedModel,
        isDebug,
        fn: async () => {
          await waitForLlmRequestSlot();
          return anthropic.messages.create({
            model: resolvedModel,
            max_tokens: ANTHROPIC_MAX_TOKENS,
            system: opts.systemInstruction,
            messages: [{ role: "user", content: opts.prompt }],
          });
        },
      });
      text = normalizeText(msg);
    } else {
      let messages: Anthropic.MessageParam[] = [
        { role: "user", content: opts.prompt },
      ];
      let totalToolCalls = 0;

      for (let attempt = 0; attempt < MAX_TOOL_ITERATIONS; attempt += 1) {
        const msg = await withLlmRetry({
          provider,
          model: resolvedModel,
          isDebug,
          fn: async () => {
            await waitForLlmRequestSlot();
            return anthropic.messages.create({
              model: resolvedModel,
              max_tokens: ANTHROPIC_MAX_TOKENS,
              system: opts.systemInstruction,
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

        const nextTotalToolCalls = totalToolCalls + toolUses.length;
        if (nextTotalToolCalls > maxToolCalls) {
          if (isDebug) {
            console.warn("[llmRouter] anthropic-tool-call-limit-hit", {
              iteration: attempt + 1,
              totalToolCalls: nextTotalToolCalls,
              maxToolCalls,
            });
          }
          usedFallback = true;
          text = await finalizeAnthropicWithoutTools({
            anthropic,
            model: resolvedModel,
            messages,
            providerLabel: "Anthropic",
            maxToolCalls,
            reason: "tool-limit-hit",
            isDebug,
          });
          break;
        }

        totalToolCalls = nextTotalToolCalls;
        if (isDebug) {
          console.warn("[llmRouter] anthropic-tool-calls", {
            iteration: attempt + 1,
            toolCallsThisIteration: toolUses.length,
            totalToolCalls,
            toolNames: toolUses.map((item) => item.name),
          });
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
    const gemini = (clients.gemini ??= new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    }));
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
          await waitForLlmRequestSlot();
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
            await waitForLlmRequestSlot();
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

        const nextTotalToolCalls = totalToolCalls + functionCalls.length;
        if (nextTotalToolCalls > maxToolCalls) {
          if (isDebug && hasGeminiFunctionTools) {
            console.warn("[llmRouter] gemini-tool-call-limit-hit", {
              iteration: attempt + 1,
              totalToolCalls: nextTotalToolCalls,
              maxToolCalls,
            });
          }
          usedFallback = true;
          text = await finalizeGeminiWithoutTools({
            gemini,
            model: resolvedModel,
            contents,
            systemInstruction: opts.systemInstruction,
            providerLabel: "Gemini",
            maxToolCalls,
            isDebug,
          });
          break;
        }

        totalToolCalls = nextTotalToolCalls;
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

  if (isDebug) {
    console.warn("[llmRouter] response", {
      provider,
      model: resolvedModel,
      durationMs: Date.now() - startedAt,
      outputLength: text.length,
    });
    console.warn("[llmRouter] output", text);
  }

  return {
    text,
    usedFallback,
  };
}
