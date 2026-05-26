import { executeSearchPlace } from "./tomtomSearch.js";

export interface GeminiToolDefinition {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

export interface GeminiToolExecutionContext {
  name: string;
  args: any;
}

export function getGeminiVerificationTools(): GeminiToolDefinition[] {
  return [
    {
      functionDeclarations: [
        {
          name: "search_place",
          description:
            "Verify a hotel, restaurant, attraction, or business by searching for its official place details. Use this before including a place in the final answer.",
          parameters: {
            type: "OBJECT",
            properties: {
              name: {
                type: "STRING",
                description:
                  "The exact or best-known name of the place to verify.",
              },
              locationHint: {
                type: "STRING",
                description:
                  "Optional city, region, or destination hint to narrow the search.",
              },
            },
            required: ["name"],
          },
        },
      ],
    },
  ];
}

export async function executeGeminiTool({
  name,
  args,
}: GeminiToolExecutionContext): Promise<any> {
  if (name === "search_place") {
    return executeSearchPlace(args, "geminiTools");
  }

  return {
    ok: false,
    error: `Unknown tool: ${name}`,
  };
}
