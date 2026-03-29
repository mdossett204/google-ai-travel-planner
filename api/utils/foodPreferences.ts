interface FoodPreferencesInput {
  dietaryRestrictions?: string[];
  cuisineInterests?: string[];
  diningStyle?: string[];
  foodPriority?: string;
}

function formatList(values?: string[]) {
  return values && values.length > 0 ? values.join(", ") : "None specified";
}

export function formatFoodPreferences(input: FoodPreferencesInput): string {
  const dietaryRestrictions = formatList(input?.dietaryRestrictions);
  const cuisineInterests = formatList(input?.cuisineInterests);
  const diningStyle = formatList(input?.diningStyle);
  const foodPriority = input?.foodPriority || "Nice to Have";

  return [
    `- Dietary Restrictions: ${dietaryRestrictions}`,
    `- Cuisine Interests: ${cuisineInterests}`,
    `- Dining Style: ${diningStyle}`,
    `- Food Priority: ${foodPriority}`,
  ].join("\n");
}
