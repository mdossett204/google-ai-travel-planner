import type Anthropic from "@anthropic-ai/sdk";
import {
  SEARCH_PLACE_TOOL,
  SEARCH_PLACE_PROPERTIES,
  executeProviderTool,
} from "./toolDefinitions.js";

export interface AnthropicToolExecutionContext {
  name: string;
  args: Record<string, unknown>;
}

export function getAnthropicVerificationTools(): Anthropic.Tool[] {
  return [
    {
      name: SEARCH_PLACE_TOOL.name,
      description: SEARCH_PLACE_TOOL.description,
      input_schema: {
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
      },
    },
  ];
}

export async function executeAnthropicTool({
  name,
  args,
}: AnthropicToolExecutionContext): Promise<Record<string, unknown>> {
  return executeProviderTool(name, args, "anthropicTools");
}
