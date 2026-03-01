import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface TravelFormData {
  timeOfYear: string[];
  durationValue: number | "";
  durationUnit: "days" | "weeks";
  travelers: string;
  budget: {
    lodging: string;
    transportation: string;
    food: string;
    misc: string;
  };
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
    Time of Year: ${data.timeOfYear?.length > 0 ? data.timeOfYear.join(", ") : "Not specified. Please recommend the best time of year to visit."}
    Duration: ${data.durationValue} ${data.durationUnit}
    Travelers: ${data.travelers}
    Budget (Treat as upper limit, but options within +/- 20% are acceptable):
      - Lodging: $${data.budget.lodging || "Any"} per night
      - Transportation/Flights: $${data.budget.transportation || "Any"} total
      - Food: $${data.budget.food || "Any"} per day
      - Miscellaneous/Activities: $${data.budget.misc || "Any"} total
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
      systemInstruction:
        "You are an elite travel concierge. You MUST use Google Search to verify that all places, hotels, restaurants, and attractions currently exist, are open, and fit the budget. Provide factual, accurate information.",
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
  const systemInstruction =
    "You are an elite travel concierge. You MUST use Google Search to verify that all places, hotels, restaurants, and attractions currently exist, are open, and fit the budget. Provide factual, accurate information and include real URLs.";

  const draftPrompt = `
    Create a detailed travel itinerary for the following trip:
    Destination: ${recommendation.title}
    Time of Year: ${data.timeOfYear?.length > 0 ? data.timeOfYear.join(", ") : "Not specified"}
    Duration: ${data.durationValue} ${data.durationUnit}
    Travelers: ${data.travelers}
    Budget (Treat as upper limit, but options within +/- 20% are acceptable):
      - Lodging: $${data.budget.lodging || "Any"} per night
      - Transportation/Flights: $${data.budget.transportation || "Any"} total
      - Food: $${data.budget.food || "Any"} per day
      - Miscellaneous/Activities: $${data.budget.misc || "Any"} total
    Primary Goal(s): ${data.primaryGoal?.length > 0 ? data.primaryGoal.join(", ") : "Any"}
    Food Preferences: ${data.foodPreferences}
    Activity Preferences: ${data.activityPreferences}
    Transportation: ${data.transportation?.length > 0 ? data.transportation.join(", ") : "Any"}
    Must-See Locations: ${data.mustSeeLocations || "None specified"}

    Please format the response in Markdown with the following strict structure:
    ## 🌟 Introduction
    (Brief overview of the trip)

    ## 🏨 Lodging Recommendations
    (Provide 2-3 specific hotel/lodging options that fit the budget. Include estimated prices)

    ## 🍽️ Food & Restaurant Recommendations
    (Provide specific restaurant names based on their preferences. Include estimated prices)

    ## 📅 Day-by-Day Itinerary
    (Morning, afternoon, evening breakdown)

    ## 💡 Tips and Tricks
    (Packing, local customs, safety)
  `;

  // Step 1: Generate Draft
  const draftResponse = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: draftPrompt,
    config: {
      tools: [{ googleSearch: {} }],
      systemInstruction,
    },
  });

  const draftText = draftResponse.text || "";

  // Step 2: Fact Check & Add Links
  const verifyPrompt = `
    Review the following travel itinerary draft.
    Your task is to FACT-CHECK and ENHANCE it:
    1. Use Google Search to verify that the mentioned hotels, restaurants, and attractions actually exist and are currently operational.
    2. Verify that the estimated costs align with the user's budget (+/- 20%).
    3. Add REAL website URLs for EVERY hotel and restaurant mentioned, formatted as Markdown links: [Name](URL). 
       CRITICAL: You MUST verify that the URL actually works. If you cannot find a working official website, DO NOT guess or hallucinate a URL. Instead, provide a Google Maps search link (e.g., https://www.google.com/maps/search/?api=1&query=Hotel+Name+City) or omit the link entirely.
    4. Correct any hallucinations or inaccuracies.
    
    Return the final, polished Markdown itinerary maintaining the exact same section structure.

    Draft Itinerary:
    ${draftText}
  `;

  const finalResponse = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: verifyPrompt,
    config: {
      tools: [{ googleSearch: {} }],
      systemInstruction,
    },
  });

  return finalResponse.text || draftText;
}
