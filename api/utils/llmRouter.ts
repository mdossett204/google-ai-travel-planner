import OpenAI from "openai";
import type { Responses } from "openai/resources/responses/responses";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "redis";
import {
  executeGeminiTool,
  type GeminiToolDefinition,
} from "../tools/geminiTools.js";
import { executeOpenAITool } from "../tools/openaiTools.js";
import { executeAnthropicTool } from "../tools/anthropicTools.js";

export type LlmProvider = "openai" | "anthropic" | "gemini";

export class LlmConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigurationError";
  }
}

const PROVIDERS: LlmProvider[] = ["openai", "anthropic", "gemini"];
const MAX_TOOL_CALLS = 10;
const MAX_GEMINI_TOOL_ITERATIONS = 10;
const MAX_GEMINI_TOOL_CALLS = MAX_TOOL_CALLS;
const MAX_OPENAI_TOOL_ITERATIONS = 10;
const MAX_OPENAI_TOOL_CALLS = MAX_TOOL_CALLS;
const MAX_ANTHROPIC_TOOL_ITERATIONS = 3;
const MAX_ANTHROPIC_TOOL_CALLS = MAX_TOOL_CALLS;
const LLM_MAX_RETRIES = 3;
const LLM_RETRY_BASE_DELAY_MS = 1500;
const GEMINI_MIN_INTERVAL_MS = 6000;

let lastGeminiRequestAt = 0;
let geminiQueue: Promise<void> = Promise.resolve();

const redisUrl = process.env.REDIS_URL;
const redisClient = redisUrl ? createClient({ url: redisUrl }) : null;
let isRedisConnected = false;

async function getRedisClient() {
  if (!redisClient) return null;
  if (!isRedisConnected) {
    redisClient.on("error", (err: any) => console.error("Redis error:", err));
    await redisClient.connect();
    isRedisConnected = true;
  }
  return redisClient;
}

async function checkRateLimit(key: string, limit: number, windowSec: number) {
  const client = await getRedisClient();
  if (!client) return true;

  const currentWindow = Math.floor(Date.now() / (windowSec * 1000));
  const redisKey = `ratelimit:${key}:${currentWindow}`;

  const requests = await client.incr(redisKey);
  if (requests === 1) {
    await client.expire(redisKey, windowSec * 2);
  }

  return requests <= limit;
}

interface GeminiFunctionCall {
  name: string;
  args?: Record<string, unknown>;
}

interface OpenAIFunctionCallOutputInputItem {
  type: "function_call_output";
  call_id: string;
  output: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGeminiSlot() {
  if (redisUrl) {
    const success = await checkRateLimit("gemini-global-limit", 1, 60);
    if (!success) {
      const error: any = new Error("Global rate limit exceeded");
      error.status = 429;
      throw error;
    }
    return;
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
  instructions,
  input,
  providerLabel,
  maxToolCalls,
  isDebug,
}: {
  openai: OpenAI;
  model: string;
  instructions?: string;
  input: Responses.ResponseInputItem[];
  providerLabel?: string;
  maxToolCalls?: number;
  isDebug: boolean;
}) {
  const content =
    providerLabel && maxToolCalls
      ? getToolLimitFallbackPrompt(providerLabel, maxToolCalls)
      : TOOL_LIMIT_FALLBACK_PROMPT;

  const response = await withLlmRetry({
    provider: "openai",
    model,
    isDebug,
    fn: () =>
      openai.responses.create({
        model,
        instructions,
        input: [
          ...input,
          {
            role: "user",
            content,
          },
        ],
      }),
  });

  return normalizeText(response.output_text || "");
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

  const msg = await withLlmRetry({
    provider: "anthropic",
    model,
    isDebug,
    fn: () =>
      anthropic.messages.create({
        model,
        max_tokens: 2048,
        messages: [
          ...messages,
          {
            role: "user",
            content,
          },
        ],
      }),
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

  const response = await withLlmRetry({
    provider: "gemini",
    model,
    isDebug,
    fn: async () => {
      await waitForGeminiSlot();
      return gemini.models.generateContent({
        model,
        contents: [
          ...contents,
          {
            role: "user",
            parts: [{ text: content }],
          },
        ],
        config: {
          systemInstruction,
        },
      });
    },
  });

  return normalizeText(response.text || "");
}

export async function generateText(opts: {
  provider?: string;
  model?: string;
  prompt: string;
  systemInstruction?: string;
  useSearchTool?: boolean;
  geminiTools?: GeminiToolDefinition[];
  openaiTools?: Responses.FunctionTool[];
  anthropicTools?: Anthropic.Tool[];
}): Promise<string> {
  const provider = getProvider(opts.provider) || "gemini";
  assertProviderApiKeyConfigured(provider);
  const model = opts.model?.trim() || "gemini-2.5-flash";
  const isDebug = process.env.DEBUG_LLM_ROUTER === "true";
  const startedAt = Date.now();
  let text = "";
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

    if (!hasOpenAITools) {
      const response = await withLlmRetry({
        provider,
        model: resolvedModel,
        isDebug,
        fn: () =>
          openai.responses.create({
            model: resolvedModel,
            input: opts.prompt,
            instructions: opts.systemInstruction,
          }),
      });
      text = normalizeText(response.output_text || "");
    } else {
      let inputItems: Responses.ResponseInputItem[] = [
        { role: "user", content: opts.prompt },
      ];
      let totalToolCalls = 0;

      for (
        let attempt = 0;
        attempt < MAX_OPENAI_TOOL_ITERATIONS;
        attempt += 1
      ) {
        const response = await withLlmRetry({
          provider,
          model: resolvedModel,
          isDebug,
          fn: () =>
            openai.responses.create({
              model: resolvedModel,
              instructions: opts.systemInstruction,
              tools: openaiTools,
              input: inputItems,
            }),
        });

        const outputItems = Array.isArray(response.output)
          ? response.output
          : [];
        const functionCalls = outputItems.filter(
          (item: any) => item?.type === "function_call",
        ) as Responses.ResponseFunctionToolCall[];

        if (functionCalls.length === 0) {
          text = normalizeText(response.output_text || "");
          if (isDebug) {
            console.warn("[llmRouter] openai-tool-loop-complete", {
              iterationsUsed: attempt + 1,
              totalToolCalls,
            });
          }
          break;
        }

        totalToolCalls += functionCalls.length;
        if (isDebug) {
          console.warn("[llmRouter] openai-tool-calls", {
            iteration: attempt + 1,
            toolCallsThisIteration: functionCalls.length,
            totalToolCalls,
            toolNames: functionCalls.map((item) => item.name),
          });
        }
        if (totalToolCalls > MAX_OPENAI_TOOL_CALLS) {
          if (isDebug) {
            console.warn("[llmRouter] openai-tool-call-limit-hit", {
              iteration: attempt + 1,
              totalToolCalls,
              maxToolCalls: MAX_OPENAI_TOOL_CALLS,
            });
          }
          text = await finalizeOpenAIWithoutTools({
            openai,
            model: resolvedModel,
            instructions: opts.systemInstruction,
            input: inputItems,
            providerLabel: "OpenAI",
            maxToolCalls: MAX_OPENAI_TOOL_CALLS,
            isDebug,
          });
          break;
        }

        const toolOutputs: OpenAIFunctionCallOutputInputItem[] = [];
        for (const functionCall of functionCalls) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = functionCall.arguments
              ? JSON.parse(functionCall.arguments)
              : {};
          } catch {
            parsedArgs = {};
          }

          const result = await executeOpenAITool({
            name: functionCall.name,
            args: parsedArgs,
          });

          if (isDebug) {
            console.warn("[llmRouter] openai-tool-response", {
              iteration: attempt + 1,
              toolName: functionCall.name,
              ok: result?.ok ?? null,
            });
          }

          toolOutputs.push({
            type: "function_call_output",
            call_id: functionCall.call_id,
            output: JSON.stringify(result),
          });
        }

        inputItems = [...inputItems, ...outputItems, ...toolOutputs];
      }

      if (!text) {
        text = await finalizeOpenAIWithoutTools({
          openai,
          model: resolvedModel,
          instructions: opts.systemInstruction,
          input: inputItems,
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
        fn: () =>
          anthropic.messages.create({
            model: resolvedModel,
            max_tokens: 2048,
            messages: [{ role: "user", content: systemPrefix + opts.prompt }],
          }),
      });
      text = normalizeText(msg);
    } else {
      let messages: Anthropic.MessageParam[] = [
        { role: "user", content: systemPrefix + opts.prompt },
      ];
      let totalToolCalls = 0;

      for (
        let attempt = 0;
        attempt < MAX_ANTHROPIC_TOOL_ITERATIONS;
        attempt += 1
      ) {
        const msg = await withLlmRetry({
          provider,
          model: resolvedModel,
          isDebug,
          fn: () =>
            anthropic.messages.create({
              model: resolvedModel,
              max_tokens: 2048,
              tools: anthropicTools,
              messages,
            }),
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
        if (totalToolCalls > MAX_ANTHROPIC_TOOL_CALLS) {
          if (isDebug) {
            console.warn("[llmRouter] anthropic-tool-call-limit-hit", {
              iteration: attempt + 1,
              totalToolCalls,
              maxToolCalls: MAX_ANTHROPIC_TOOL_CALLS,
            });
          }
          text = await finalizeAnthropicWithoutTools({
            anthropic,
            model: resolvedModel,
            messages,
            providerLabel: "Anthropic",
            maxToolCalls: MAX_ANTHROPIC_TOOL_CALLS,
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
          await waitForGeminiSlot();
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

      for (
        let attempt = 0;
        attempt < MAX_GEMINI_TOOL_ITERATIONS;
        attempt += 1
      ) {
        const response = await withLlmRetry({
          provider,
          model: resolvedModel,
          isDebug,
          fn: async () => {
            await waitForGeminiSlot();
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
        if (totalToolCalls > MAX_GEMINI_TOOL_CALLS) {
          if (isDebug && hasGeminiFunctionTools) {
            console.warn("[llmRouter] gemini-tool-call-limit-hit", {
              iteration: attempt + 1,
              totalToolCalls,
              maxToolCalls: MAX_GEMINI_TOOL_CALLS,
            });
          }
          text = await finalizeGeminiWithoutTools({
            gemini,
            model: resolvedModel,
            contents,
            systemInstruction: opts.systemInstruction,
            providerLabel: "Gemini",
            maxToolCalls: MAX_GEMINI_TOOL_CALLS,
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

  return text;
}
