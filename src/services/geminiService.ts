// NOTE: LLM calls are moving behind serverless API routes.

export interface FoodPreferences {
  dietaryRestrictions: string[];
  cuisineInterests: string[];
  diningStyle: string[];
  foodPriority: "Not Important" | "Nice to Have" | "Major Trip Focus";
}

export interface PreferredLocation {
  country: string;
  stateOrProvince: string;
  city: string;
}

export interface LodgingPreferences {
  lodgingTypes: string[];
}

export interface TravelFormData {
  timeOfYear: string[];
  durationValue: number | "";
  durationUnit: "days" | "weeks";
  travelers: "Solo" | "Couple" | "Family" | "Friends" | "";
  budget: {
    lodging: string;
    localTransportation: string;
    food: string;
    misc: string;
  };
  primaryGoal: string[];
  foodPreferences: FoodPreferences;
  lodgingPreferences: LodgingPreferences;
  localTransportation: string[];
  preferredLocation: PreferredLocation;
  attractionInterests: string;
}

export interface Recommendation {
  id: string;
  title: string;
  description: string;
  highlights: string[];
  estimatedCost: string;
  bestTimeToGo: string;
}

export async function getRecommendations(
  data: TravelFormData,
): Promise<Recommendation[]> {
  // Previous client-side Gemini call is intentionally removed for security.
  // Keeping this comment to preserve the original flow as reference:
  // - It used GoogleGenAI directly in the browser.
  // - It parsed JSON from the model response.
  // We now call the serverless API instead.
  const res = await fetch("/api/recommendations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to fetch recommendations.");
  }

  return (await res.json()) as Recommendation[];
}

export async function getItinerary(
  data: TravelFormData,
  recommendation: Recommendation,
): Promise<string> {
  const res = await fetch("/api/itinerary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, recommendation }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to fetch itinerary.");
  }

  const payload = (await res.json()) as { itinerary: string };
  return payload.itinerary;
}
