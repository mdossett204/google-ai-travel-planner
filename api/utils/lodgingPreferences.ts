interface LodgingPreferencesInput {
  lodgingTypes?: string[];
}

export function formatLodgingPreferences(
  input: LodgingPreferencesInput,
): string {
  const lodgingTypes =
    input?.lodgingTypes && input.lodgingTypes.length > 0
      ? input.lodgingTypes.join(", ")
      : "No strong preference";

  return `- Lodging Types: ${lodgingTypes}`;
}
