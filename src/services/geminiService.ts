// NOTE: LLM calls are moving behind serverless API routes.

export interface FoodPreferences {
  dietaryRestrictions: string[];
  cuisineInterests: string[];
  diningStyle: string[];
  foodPlaceTypes: string[];
  foodPriority: "Not Important" | "Nice to Have" | "Major Trip Focus" | "";
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
  includeLodging: boolean;
  includeFood: boolean;
  activityLevel: "Relaxed" | "Balanced" | "Very Active" | "";
  budget: {
    lodging: number | "";
    localTransportation: number | "";
    food: number | "";
    misc: number | "";
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

const API_HEADERS = {
  "Content-Type": "application/json",
};

async function getApiErrorMessage(
  res: Response,
  fallbackMessage: string,
): Promise<string> {
  const err = await res.json().catch(() => ({}) as { error?: string });

  if (typeof err?.error === "string" && err?.error.trim()) {
    return err.error;
  }

  if (res.status === 404) {
    if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
      return "API route not found. Start the full app with `npm run dev:vercel` or `npx vercel dev`. `npm run dev` and `npm run dev:frontend` serve only the Vite client, so `/api/*` requests return 404.";
    }
    return "Service endpoint not found. Please try again later.";
  }

  return fallbackMessage;
}

export async function getRecommendations(
  data: TravelFormData,
  signal?: AbortSignal,
): Promise<Recommendation[]> {
  // Previous client-side Gemini call is intentionally removed for security.
  // Keeping this comment to preserve the original flow as reference:
  // - It used GoogleGenAI directly in the browser.
  // - It parsed JSON from the model response.
  // We now call the serverless API instead.
  const res = await fetch("/api/recommendations", {
    method: "POST",
    headers: API_HEADERS,
    body: JSON.stringify(data),
    signal,
  });

  if (!res.ok) {
    throw new Error(
      await getApiErrorMessage(res, "Failed to fetch recommendations."),
    );
  }

  const payload = await res.json();
  if (!Array.isArray(payload)) {
    throw new Error(
      "Invalid response format: expected an array of recommendations.",
    );
  }

  for (const rec of payload) {
    if (
      !rec ||
      typeof rec !== "object" ||
      typeof rec.id !== "string" ||
      typeof rec.title !== "string" ||
      typeof rec.description !== "string" ||
      !Array.isArray(rec.highlights) ||
      !rec.highlights.every(
        (highlight: unknown) => typeof highlight === "string",
      ) ||
      typeof rec.estimatedCost !== "string" ||
      typeof rec.bestTimeToGo !== "string"
    ) {
      throw new Error(
        "Invalid response format: missing or invalid recommendation fields.",
      );
    }
  }

  return payload as Recommendation[];
}

export async function getItinerary(
  data: TravelFormData,
  recommendation: Recommendation,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/itinerary", {
    method: "POST",
    headers: API_HEADERS,
    body: JSON.stringify({ data, recommendation }),
    signal,
  });

  if (!res.ok) {
    throw new Error(
      await getApiErrorMessage(res, "Failed to fetch itinerary."),
    );
  }

  const payload = await res.json();
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.itinerary !== "string"
  ) {
    throw new Error(
      "Invalid response format: missing or invalid itinerary string.",
    );
  }
  return payload.itinerary;
}
