import { sanitizePromptInput } from "./apiHelpers.js";

interface LodgingPreferencesInput {
  lodgingTypes?: string[];
}

export function formatLodgingPreferences(
  input: LodgingPreferencesInput,
): string {
  const lodgingTypes =
    input?.lodgingTypes && input.lodgingTypes.length > 0
      ? sanitizePromptInput(input.lodgingTypes.join(", "))
      : "No strong preference";

  return `- Lodging Types: ${lodgingTypes}`;
}
