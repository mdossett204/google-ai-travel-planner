interface PreferredLocationInput {
  country?: string;
  stateOrProvince?: string;
  city?: string;
}

export function formatPreferredLocation(input: PreferredLocationInput): string {
  const parts = [input?.city, input?.stateOrProvince, input?.country].filter(
    Boolean,
  );

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
