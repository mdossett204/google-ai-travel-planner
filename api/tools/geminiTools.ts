import { searchTomTom } from "../utils/tomtomSearch.js";

export interface GeminiToolDefinition {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

export interface GeminiToolExecutionContext {
  name: string;
  args: Record<string, unknown>;
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
                description: "The exact or best-known name of the place to verify.",
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
}: GeminiToolExecutionContext): Promise<Record<string, unknown>> {
  if (name === "search_place") {
    const placeName =
      typeof args.name === "string" ? args.name.trim() : "";
    const locationHint =
      typeof args.locationHint === "string" ? args.locationHint.trim() : "";

    if (!placeName) {
      return {
        ok: false,
        error: "Missing required argument: name",
      };
    }

    const query = [placeName, locationHint].filter(Boolean).join(" ");
    const results = await searchTomTom({
      query,
      limit: 1,
    });
    const result = results[0] || null;

    if (process.env.DEBUG_LLM_ROUTER === "true") {
      console.warn("[geminiTools] search_place-result", {
        query,
        result,
      });
    }

    return {
      ok: true,
      query,
      result,
    };
  }

  return {
    ok: false,
    error: `Unknown tool: ${name}`,
  };
}
