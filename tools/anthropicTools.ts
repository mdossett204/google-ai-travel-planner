import { isTomTomResultMatch, searchTomTom } from "./tomtomSearch.js";
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
    const isMatch = isTomTomResultMatch({
      placeName,
      locationHint,
      result,
    });

    if (process.env.DEBUG_LLM_ROUTER === "true") {
      console.warn("[anthropicTools] search_place-result", {
        query,
        isMatch,
        result,
      });
    }

    if (!isMatch) {
      return {
        ok: false,
        query,
        error:
          "Top search result did not match the requested place closely enough.",
        result: null,
      };
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
