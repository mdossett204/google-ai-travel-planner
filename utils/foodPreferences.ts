import { sanitizePromptInput, formatList } from "./apiHelpers.js";

interface FoodPreferencesInput {
  dietaryRestrictions?: string[];
  cuisineInterests?: string[];
  diningStyle?: string[];
  foodPlaceTypes?: string[];
  foodPriority?: string;
}

export function formatFoodPreferences(input: FoodPreferencesInput): string {
  const dietaryRestrictions = formatList(input?.dietaryRestrictions);
  const cuisineInterests = formatList(input?.cuisineInterests);
  const diningStyle = formatList(input?.diningStyle);
  const foodPlaceTypes = formatList(input?.foodPlaceTypes);
  const foodPriority = sanitizePromptInput(
    input?.foodPriority || "Not specified",
  );

  return [
    `- Food Stops: ${foodPlaceTypes}`,
    `- Dietary Restrictions: ${dietaryRestrictions}`,
    `- Cuisine Interests: ${cuisineInterests}`,
    `- Dining Style: ${diningStyle}`,
    `- Food Priority: ${foodPriority}`,
  ].join("\n");
}
