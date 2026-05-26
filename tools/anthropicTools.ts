import { executeSearchPlace } from "./tomtomSearch.js";
import type Anthropic from "@anthropic-ai/sdk";

export interface AnthropicToolExecutionContext {
  name: string;
  args: any;
}

export function getAnthropicVerificationTools(): Anthropic.Tool[] {
  return [
    {
      name: "search_place",
      description:
        "Verify a hotel, restaurant, attraction, or business by searching for its official place details before including it in the final answer.",
      input_schema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The exact or best-known name of the place to verify.",
          },
          locationHint: {
            type: "string",
            description:
              "City, region, or destination hint to narrow the search. Use an empty string if unknown.",
          },
        },
        required: ["name"],
      },
    },
  ];
}

export async function executeAnthropicTool({
  name,
  args,
}: AnthropicToolExecutionContext): Promise<any> {
  if (name === "search_place") {
    return executeSearchPlace(args, "anthropicTools");
  }

  return {
    ok: false,
    error: `Unknown tool: ${name}`,
  };
}
