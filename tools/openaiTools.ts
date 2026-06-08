import OpenAI from "openai";
import {
  SEARCH_PLACE_TOOL,
  SEARCH_PLACE_PROPERTIES,
  executeProviderTool,
} from "./toolDefinitions.js";

export interface OpenAIToolExecutionContext {
  name: string;
  args: Record<string, unknown>;
}

export function getOpenAIVerificationTools(): OpenAI.Chat.ChatCompletionTool[] {
  return [
    {
      type: "function",
      function: {
        name: SEARCH_PLACE_TOOL.name,
        description: SEARCH_PLACE_TOOL.description,
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: SEARCH_PLACE_PROPERTIES.name.description,
            },
            locationHint: {
              type: "string",
              description: SEARCH_PLACE_PROPERTIES.locationHint.description,
            },
          },
          required: SEARCH_PLACE_TOOL.parameters.required,
        } as Record<string, unknown>,
      },
    },
  ];
}

export async function executeOpenAITool({
  name,
  args,
}: OpenAIToolExecutionContext): Promise<Record<string, unknown>> {
  return executeProviderTool(name, args, "openaiTools");
}
