import { formatList } from "./apiHelpers.js";

interface LodgingPreferencesInput {
  lodgingTypes?: string[];
}

export function formatLodgingPreferences(
  input: LodgingPreferencesInput,
): string {
  const lodgingTypes = formatList(input?.lodgingTypes, "No strong preference");

  return `- Lodging Types: ${lodgingTypes}`;
}
