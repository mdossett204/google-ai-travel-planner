import OpenAI from "openai";
import { executeSearchPlace } from "./tomtomSearch.js";

export interface OpenAIToolExecutionContext {
  name: string;
  args: Record<string, unknown>;
}

export function getOpenAIVerificationTools(): OpenAI.Chat.ChatCompletionTool[] {
  return [
    {
      type: "function",
      function: {
        name: "search_place",
        description:
          "Verify a hotel, restaurant, attraction, or business by searching for its official place details before including it in the final answer.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "The exact or best-known name of the place to verify.",
            },
            locationHint: {
              type: "string",
              description:
                "City, region, or destination hint to narrow the search. Use an empty string if unknown.",
            },
          },
          required: ["name"],
        } as Record<string, unknown>,
      },
    },
  ];
}

export async function executeOpenAITool({
  name,
  args,
}: OpenAIToolExecutionContext): Promise<Record<string, unknown>> {
  if (name === "search_place") {
    return executeSearchPlace(args, "openaiTools");
  }

  return {
    ok: false,
    error: `Unknown tool: ${name}`,
  };
}
