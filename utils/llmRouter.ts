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

function isRetryableApiError(err: unknown) {
  const e = err as Record<string, unknown>;
  const eError = e?.error as Record<string, unknown> | undefined;
  const status =
    e?.status ?? e?.statusCode ?? e?.code ?? eError?.code ?? eError?.status;

  if (status === 429 || status === "RESOURCE_EXHAUSTED") return true;

  const numStatus = Number(status);
  if (numStatus >= 500 && numStatus <= 504) return true;

  return false;
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
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: unknown) {
      if (!isRetryableApiError(err) || attempt >= LLM_MAX_RETRIES - 1) {
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
      attempt += 1;
    }
  }
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
  if (typeof input !== "object" || input === null) return "";
  const safeInput = input as Record<string, unknown>;
  const blocks = Array.isArray(safeInput.content) ? safeInput.content : [];
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

function appendFallbackToHistory(
  history: any[],
  content: string,
  format: "messages" | "contents",
): any[] {
  const finalHistory = [...history];
  const last = finalHistory[finalHistory.length - 1];

  if (last && last.role === "user") {
    if (format === "contents") {
      finalHistory[finalHistory.length - 1] = {
        ...last,
        parts: [...(last.parts || []), { text: content }],
      };
    } else {
      const newContent = Array.isArray(last.content)
        ? [...last.content, { type: "text", text: content }]
        : `${last.content}\n\n${content}`;
      finalHistory[finalHistory.length - 1] = { ...last, content: newContent };
    }
  } else {
    finalHistory.push(
      format === "contents"
        ? { role: "user", parts: [{ text: content }] }
        : { role: "user", content },
    );
  }
  return finalHistory;
}

async function executeFinalFallbackCall(
  provider: string,
  model: string,
  isDebug: boolean,
  apiCall: () => Promise<any>,
  extractResult: (response: any) => unknown,
): Promise<string> {
  const response = await withLlmRetry({
    provider,
    model,
    isDebug,
    fn: async () => {
      await waitForLlmRequestSlot();
      return apiCall();
    },
  });
  return normalizeText(extractResult(response));
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
  const provider = getProvider(opts.provider);
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
          const finalMessages = appendFallbackToHistory(
            messages,
            buildFallbackContent("OpenAI", maxToolCalls),
            "messages",
          );
          text = await executeFinalFallbackCall(
            provider,
            resolvedModel,
            isDebug,
            () =>
              openai.chat.completions.create({
                model: resolvedModel,
                messages: finalMessages,
              }),
            (res) => res.choices[0]?.message?.content || "",
          );
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

          let result: Record<string, unknown>;
          try {
            result = await executeOpenAITool({
              name: toolCall.function.name,
              args: parsedArgs,
            });
          } catch (toolErr) {
            console.error(
              `[llmRouter] openai-tool-error for ${toolCall.function.name}:`,
              toolErr,
            );
            result = {
              ok: false,
              error: "Tool execution failed due to an internal error.",
            };
          }

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
        const finalMessages = appendFallbackToHistory(
          messages,
          buildFallbackContent(),
          "messages",
        );
        text = await executeFinalFallbackCall(
          provider,
          resolvedModel,
          isDebug,
          () =>
            openai.chat.completions.create({
              model: resolvedModel,
              messages: finalMessages,
            }),
          (res) => res.choices[0]?.message?.content || "",
        );
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
          const finalMessages = appendFallbackToHistory(
            messages,
            buildFallbackContent("Anthropic", maxToolCalls),
            "messages",
          );
          text = await executeFinalFallbackCall(
            provider,
            resolvedModel,
            isDebug,
            () =>
              anthropic.messages.create({
                model: resolvedModel,
                max_tokens: ANTHROPIC_MAX_TOKENS,
                system: opts.systemInstruction,
                messages: finalMessages,
              }),
            (res) => res,
          );
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

          let result: Record<string, unknown>;
          try {
            result = await executeAnthropicTool({
              name: toolUse.name,
              args: toolArgs,
            });
          } catch (toolErr) {
            console.error(
              `[llmRouter] anthropic-tool-error for ${toolUse.name}:`,
              toolErr,
            );
            result = {
              ok: false,
              error: "Tool execution failed due to an internal error.",
            };
          }

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
        const finalMessages = appendFallbackToHistory(
          messages,
          buildFallbackContent(),
          "messages",
        );
        text = await executeFinalFallbackCall(
          provider,
          resolvedModel,
          isDebug,
          () =>
            anthropic.messages.create({
              model: resolvedModel,
              max_tokens: ANTHROPIC_MAX_TOKENS,
              system: opts.systemInstruction,
              messages: finalMessages,
            }),
          (res) => res,
        );
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
          const finalContents = appendFallbackToHistory(
            contents,
            buildFallbackContent("Gemini", maxToolCalls),
            "contents",
          );
          text = await executeFinalFallbackCall(
            provider,
            resolvedModel,
            isDebug,
            () =>
              gemini.models.generateContent({
                model: resolvedModel,
                contents: finalContents,
                config: { systemInstruction: opts.systemInstruction },
              }),
            (res) => res.text || "",
          );
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

          let result: Record<string, unknown>;
          try {
            result = await executeGeminiTool({
              name: functionCall.name,
              args: functionCall.args || {},
            });
          } catch (toolErr) {
            console.error(
              `[llmRouter] gemini-tool-error for ${functionCall.name}:`,
              toolErr,
            );
            result = {
              ok: false,
              error: "Tool execution failed due to an internal error.",
            };
          }

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
        const finalContents = appendFallbackToHistory(
          contents,
          buildFallbackContent(),
          "contents",
        );
        text = await executeFinalFallbackCall(
          provider,
          resolvedModel,
          isDebug,
          () =>
            gemini.models.generateContent({
              model: resolvedModel,
              contents: finalContents,
              config: { systemInstruction: opts.systemInstruction },
            }),
          (res) => res.text || "",
        );
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
