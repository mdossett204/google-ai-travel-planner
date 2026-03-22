import OpenAI from "openai";
import type { Responses } from "openai/resources/responses/responses";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import {
  executeGeminiTool,
  type GeminiToolDefinition,
} from "../tools/geminiTools.js";
import { executeOpenAITool } from "../tools/openaiTools.js";
import {
  executeAnthropicTool,
} from "../tools/anthropicTools.js";

export type LlmProvider = "openai" | "anthropic" | "gemini";

const PROVIDERS: LlmProvider[] = ["openai", "anthropic", "gemini"];
const MAX_GEMINI_TOOL_ITERATIONS = 15;
const MAX_GEMINI_TOOL_CALLS = 30;
const MAX_OPENAI_TOOL_ITERATIONS = 15;
const MAX_OPENAI_TOOL_CALLS = 30;
const MAX_ANTHROPIC_TOOL_ITERATIONS = 15;
const MAX_ANTHROPIC_TOOL_CALLS = 30;
const LLM_MAX_RETRIES = 3;
const LLM_RETRY_BASE_DELAY_MS = 1500;
const GEMINI_MIN_INTERVAL_MS = 6000;

let lastGeminiRequestAt = 0;
let geminiQueue: Promise<void> = Promise.resolve();

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
          throw new Error(
            `OpenAI exceeded the tool call limit (${MAX_OPENAI_TOOL_CALLS}).`,
          );
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
          throw new Error(
            `Anthropic exceeded the tool call limit (${MAX_ANTHROPIC_TOOL_CALLS}).`,
          );
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
          throw new Error(
            `Gemini exceeded the tool call limit (${MAX_GEMINI_TOOL_CALLS}).`,
          );
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
              response: result,
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
