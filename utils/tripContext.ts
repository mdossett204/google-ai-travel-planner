import { sanitizePromptInput } from "./apiHelpers.js";

interface PreferredLocationInput {
  country?: string;
  stateOrProvince?: string;
  city?: string;
}

export function formatPreferredLocation(input: PreferredLocationInput): string {
  const parts = [input?.city, input?.stateOrProvince, input?.country]
    .filter(Boolean)
    .map(sanitizePromptInput);

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
