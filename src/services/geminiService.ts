import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface TravelFormData {
  timeOfYear: string;
  duration: string;
  travelers: string;
  budget: string;
  primaryGoal: string;
  foodPreferences: string;
  activityPreferences: string;
  transportation: string;
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

export async function getRecommendations(data: TravelFormData): Promise<Recommendation[]> {
  const prompt = `
    Based on the following travel preferences, provide 3 distinct travel recommendations.
    Time of Year: ${data.timeOfYear || "Not specified. Please recommend the best time of year to visit."}
    Duration: ${data.duration}
    Travelers: ${data.travelers}
    Budget: ${data.budget}
    Primary Goal: ${data.primaryGoal}
    Food Preferences: ${data.foodPreferences}
    Activity Preferences: ${data.activityPreferences}
    Transportation: ${data.transportation}
    Preferred Locations/Regions: ${data.locations || "Not specified. Please recommend suitable destinations based on the other criteria."}
    Must-See Locations: ${data.mustSeeLocations || "None specified"}
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING, description: "A unique identifier for this recommendation, e.g., 'rec-1'" },
            title: { type: Type.STRING, description: "The destination and a catchy title" },
            description: { type: Type.STRING, description: "A brief paragraph describing why this is a good fit" },
            highlights: { type: Type.ARRAY, items: { type: Type.STRING }, description: "3-4 key highlights or activities" },
            estimatedCost: { type: Type.STRING, description: "A rough estimate of the total cost" },
            bestTimeToGo: { type: Type.STRING, description: "The recommended time of year or specific months to visit" }
          },
          required: ["id", "title", "description", "highlights", "estimatedCost", "bestTimeToGo"]
        }
      }
    }
  });

  return JSON.parse(response.text || "[]");
}

export async function getItinerary(data: TravelFormData, recommendation: Recommendation): Promise<string> {
  const prompt = `
    Create a detailed, day-by-day itinerary and travel tips for the following trip:
    Destination: ${recommendation.title}
    Duration: ${data.duration}
    Travelers: ${data.travelers}
    Budget: ${data.budget}
    Primary Goal: ${data.primaryGoal}
    Food Preferences: ${data.foodPreferences}
    Activity Preferences: ${data.activityPreferences}
    Transportation: ${data.transportation}
    Must-See Locations: ${data.mustSeeLocations || "None specified"}

    Please format the response in Markdown. Include:
    1. A brief introduction.
    2. Day-by-day itinerary (morning, afternoon, evening).
    3. Tips and tricks (packing, local customs, safety, etc.).
    4. Food recommendations based on their preferences.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }]
    }
  });

  return response.text || "";
}
