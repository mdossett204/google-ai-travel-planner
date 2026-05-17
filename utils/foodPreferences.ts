interface FoodPreferencesInput {
  dietaryRestrictions?: string[];
  cuisineInterests?: string[];
  diningStyle?: string[];
  foodPlaceTypes?: string[];
  foodPriority?: string;
}

function formatList(values?: string[]) {
  return values && values.length > 0 ? values.join(", ") : "None specified";
}

export function formatFoodPreferences(input: FoodPreferencesInput): string {
  const dietaryRestrictions = formatList(input?.dietaryRestrictions);
  const cuisineInterests = formatList(input?.cuisineInterests);
  const diningStyle = formatList(input?.diningStyle);
  const foodPlaceTypes = formatList(input?.foodPlaceTypes);
  const foodPriority = input?.foodPriority || "Nice to Have";

  return [
    `- Food Stops: ${foodPlaceTypes}`,
    `- Dietary Restrictions: ${dietaryRestrictions}`,
    `- Cuisine Interests: ${cuisineInterests}`,
    `- Dining Style: ${diningStyle}`,
    `- Food Priority: ${foodPriority}`,
  ].join("\n");
}
