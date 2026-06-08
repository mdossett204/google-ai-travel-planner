import { executeSearchPlace } from "./tomtomSearch.js";

export const SEARCH_PLACE_PROPERTIES = {
  name: {
    type: "STRING",
    description: "The exact or best-known name of the place to verify.",
  },
  locationHint: {
    type: "STRING",
    description:
      "Optional city, region, or destination hint to narrow the search.",
  },
};

export async function executeProviderTool(
  name: string,
  args: Record<string, unknown>,
  debugLabel: string,
): Promise<Record<string, unknown>> {
  if (name === "search_place") {
    return executeSearchPlace(args, debugLabel);
  }

  return {
    ok: false,
    error: `Unknown tool: ${name}`,
  };
}

export const SEARCH_PLACE_TOOL = {
  name: "search_place",
  description:
    "Verify a hotel, restaurant, attraction, or business by searching for its official place details. Use this before including a place in the final answer.",
  parameters: {
    type: "OBJECT",
    properties: SEARCH_PLACE_PROPERTIES,
    required: ["name"],
  },
};
