import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface TravelFormData {
  timeOfYear: string;
  duration: string;
  travelers: string;
  budget: string;
  primaryGoal: string[];
  foodPreferences: string;
  activityPreferences: string;
  transportation: string[];
  locations: string;
  mustSeeLocations: string;
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
  const prompt = `
    Based on the following travel preferences, provide 3 distinct travel recommendations.
    Time of Year: ${data.timeOfYear || "Not specified. Please recommend the best time of year to visit."}
    Duration: ${data.duration}
    Travelers: ${data.travelers}
    Budget: ${data.budget}
    Primary Goal(s): ${data.primaryGoal?.length > 0 ? data.primaryGoal.join(", ") : "Any"}
    Food Preferences: ${data.foodPreferences}
    Activity Preferences: ${data.activityPreferences}
    Transportation: ${data.transportation?.length > 0 ? data.transportation.join(", ") : "Any"}
    Preferred Locations/Regions: ${data.locations || "Not specified."}
    (CRITICAL: If the user specifies locations, you MUST ONLY recommend from those exact locations. Do NOT suggest alternative destinations. If they provide multiple options with 'or', evaluate and recommend the best ones. If they provide fewer than 3 locations, create distinct trip styles for those specific locations to reach 3 recommendations.)
    Must-See Locations: ${data.mustSeeLocations || "None specified"}

    You MUST return your response as a valid JSON array of objects. Do not include any other text or markdown formatting outside the JSON array.
    Each object in the array must have exactly these keys:
    - "id": a unique string identifier
    - "title": string, the destination and a catchy title
    - "description": string, a brief paragraph describing why this is a good fit
    - "highlights": array of strings, 3-4 key highlights or activities
    - "estimatedCost": string, a numerical estimated cost range in USD (e.g., "$2,000 - $3,000"). Do NOT use vague terms like "low" or "moderate".
    - "bestTimeToGo": string, the recommended time of year or specific months to visit
  `;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  let text = response.text || "[]";

  // Extract JSON array using fast string operations instead of regex
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");

  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    text = text.substring(firstBracket, lastBracket + 1);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse JSON response:", text);
    throw new Error("Failed to parse recommendations from AI.");
  }
}

export async function getItinerary(
  data: TravelFormData,
  recommendation: Recommendation,
): Promise<string> {
  const prompt = `
    Create a detailed, day-by-day itinerary and travel tips for the following trip:
    Destination: ${recommendation.title}
    Duration: ${data.duration}
    Travelers: ${data.travelers}
    Budget: ${data.budget}
    Primary Goal(s): ${data.primaryGoal?.length > 0 ? data.primaryGoal.join(", ") : "Any"}
    Food Preferences: ${data.foodPreferences}
    Activity Preferences: ${data.activityPreferences}
    Transportation: ${data.transportation?.length > 0 ? data.transportation.join(", ") : "Any"}
    Must-See Locations: ${data.mustSeeLocations || "None specified"}

    Please format the response in Markdown. Include:
    1. A brief introduction.
    2. Day-by-day itinerary (morning, afternoon, evening).
    3. Tips and tricks (packing, local customs, safety, etc.).
    4. Food recommendations based on their preferences.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  return response.text || "";
}
