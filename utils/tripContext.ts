import { sanitizePromptInput, formatTimeOfYear } from "./apiHelpers.js";
import { formatFoodPreferences } from "./foodPreferences.js";
import { formatLodgingPreferences } from "./lodgingPreferences.js";
import type { ValidatedTravelFormData } from "./requestValidation.js";

interface PreferredLocationInput {
  country?: string;
  stateOrProvince?: string;
  city?: string;
}

export function formatPreferredLocation(input: PreferredLocationInput): string {
  const parts = [input?.city, input?.stateOrProvince, input?.country]
    .filter(Boolean)
    .map((part) => sanitizePromptInput(part));

  return parts.length > 0 ? parts.join(", ") : "Not specified";
}

export function formatTravelerType(travelerType?: string): string {
  switch (travelerType) {
    case "Solo":
      return "Solo traveler: independent, flexible pacing, comfortable with self-directed exploration.";
    case "Couple":
      return "Couple: shared experiences, scenic atmosphere, smooth transitions, and lower-friction pacing.";
    case "Family":
      return "Family: simpler logistics, broader appeal, easier transitions, and lower-friction daily planning.";
    case "Friends":
      return "Friends: social energy, group-friendly pacing, and activities that work well for shared experiences.";
    default:
      return travelerType || "Not specified";
  }
}

/**
 * Returns the number of full on-location days for a trip.
 * Travel typically takes half a day, so on-location days = durationDays - 1.
 * Minimum of 1 so that even a 1-day trip has at least one real activity day.
 */
export function getOnLocationDays(durationDays: number): number {
  return Math.max(durationDays - 1, 1);
}

export function buildLocationRules(preferredLocation: {
  stateOrProvince?: string;
  city?: string;
}): string {
  return [
    "- You MUST stay strictly inside the requested country.",
    preferredLocation.stateOrProvince?.trim()
      ? `- If a state/province is provided, stay strictly inside ${sanitizePromptInput(preferredLocation.stateOrProvince)}.`
      : null,
    preferredLocation.city?.trim()
      ? `- If a city is provided, stay strictly inside ${sanitizePromptInput(preferredLocation.city)}.`
      : null,
  ]
    .filter(Boolean)
    .join("\n    ");
}

export function buildUserPreferencesContext(
  data: ValidatedTravelFormData,
  timeOfYearFallback?: string,
): string {
  const foodPreferences = data.includeFood
    ? formatFoodPreferences(data.foodPreferences)
    : "";
  const lodgingPreferences = data.includeLodging
    ? formatLodgingPreferences(data.lodgingPreferences)
    : "";
  const travelerType = formatTravelerType(data.travelers);
  const preferredLocation = formatPreferredLocation(data.preferredLocation);
  const timeOfYear = formatTimeOfYear(data.timeOfYear, timeOfYearFallback);

  return `Time of Year: ${timeOfYear}
Duration: ${data.durationValue} ${sanitizePromptInput(data.durationUnit)}
Travel Style: ${travelerType}
Activity Level: ${data.activityLevel || "Not specified"}
Primary Goal(s): <goals>${data.primaryGoal?.length > 0 ? sanitizePromptInput(data.primaryGoal.join(", ")) : "Any"}</goals>
Attractions of Interest: <attractions>${sanitizePromptInput(data.attractionInterests) || "None specified"}</attractions>
Preferred Location: ${preferredLocation}
Local Transportation Preferences: ${data.localTransportation?.length > 0 ? sanitizePromptInput(data.localTransportation.join(", ")) : "Any"}
Budget (Treat as upper limit, +/- 20% acceptable):
  - Lodging: ${data.includeLodging ? `$${data.budget.lodging ?? "Any"} per night` : "Not requested (omit lodging)"}
  - Local Transportation: $${data.budget.localTransportation ?? "Any"} total
  - Food: ${data.includeFood ? `$${data.budget.food ?? "Any"} per day` : "Not requested (omit food)"}
  - Miscellaneous/Activities: $${data.budget.misc ?? "Any"} total
${data.includeFood ? `FOOD PREFERENCES\n    ${foodPreferences}` : "FOOD: Not requested"}
${data.includeLodging ? `\n    LODGING PREFERENCES\n    ${lodgingPreferences}` : "\n    LODGING: Not requested"}`;
}
