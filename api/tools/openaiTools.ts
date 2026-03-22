import type { Responses } from "openai/resources/responses/responses";
import { searchTomTom } from "../utils/tomtomSearch.js";

export interface OpenAIToolExecutionContext {
  name: string;
  args: Record<string, unknown>;
}

export function getOpenAIVerificationTools(): Responses.FunctionTool[] {
  return [
    {
      type: "function",
      name: "search_place",
      description:
        "Verify a hotel, restaurant, attraction, or business by searching for its official place details before including it in the final answer.",
      parameters: {
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
        required: ["name", "locationHint"],
        additionalProperties: false,
      },
      strict: true,
    },
  ];
}

export async function executeOpenAITool({
  name,
  args,
}: OpenAIToolExecutionContext): Promise<Record<string, unknown>> {
  if (name === "search_place") {
    const placeName = typeof args.name === "string" ? args.name.trim() : "";
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
      console.warn("[openaiTools] search_place-result", {
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
