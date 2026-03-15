import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

export type LlmProvider = "openai" | "anthropic" | "gemini";

const PROVIDERS: LlmProvider[] = ["openai", "anthropic", "gemini"];

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
}): Promise<string> {
  const provider = getProvider(opts.provider);
  const model = opts.model?.trim();
  console.log(opts.prompt);
  console.log(model);

  if (provider === "openai") {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.responses.create({
      model: model || "gpt-5-nano",
      input: opts.prompt,
      instructions: opts.systemInstruction,
    });
    return normalizeText(response.output_text || "");
  }

  if (provider === "anthropic") {
    const systemPrefix = opts.systemInstruction
      ? `System:\n${opts.systemInstruction}\n\n`
      : "";
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: model || "claude-haiku-4-5",
      max_tokens: 2048,
      messages: [{ role: "user", content: systemPrefix + opts.prompt }],
    });
    return normalizeText(msg);
  }
  const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await gemini.models.generateContent({
    model: model || "gemini-2.5-flash",
    contents: opts.prompt,
    config: {
      tools: opts.useSearchTool ? [{ googleSearch: {} }] : [],
      systemInstruction: opts.systemInstruction,
    },
  });
  return normalizeText(response.text || "");
}
