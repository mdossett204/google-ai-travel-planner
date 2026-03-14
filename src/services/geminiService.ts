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
    "You are an elite travel concierge. You MUST use Google Search to verify every single place, hotel, restaurant, and attraction. You are strictly forbidden from guessing or hallucinating addresses or URLs. If you cannot verify an address or URL via search, you MUST omit the link entirely. Do not provide fake or guessed links.";

  // Agent 1: Activity Planner
  const activityPrompt = `
    You are the 'Activity Planner Agent'.
    Destination: ${recommendation.title}
    Time of Year: ${data.timeOfYear?.length > 0 ? data.timeOfYear.join(", ") : "Not specified"}
    Duration: ${data.durationValue} ${data.durationUnit}
    Travelers: ${data.travelers}
    Primary Goal(s): ${data.primaryGoal?.length > 0 ? data.primaryGoal.join(", ") : "Any"}
    Activity Preferences: ${data.activityPreferences}
    Must-See Locations: ${data.mustSeeLocations || "None specified"}

    TASK: Create a day-by-day itinerary of ACTIVITIES ONLY. Do NOT include hotels or restaurants yet.
    Ensure the activities are geographically logical (do not cross town 4 times a day).
    Include the specific neighborhood or area for each activity.
    Use Google Search to verify these attractions exist and are open.
  `;

  const activityResponse = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: activityPrompt,
    config: { tools: [{ googleSearch: {} }], systemInstruction },
  });
  const activityPlan = activityResponse.text || "";

  // Agent 2: Logistics Coordinator
  const logisticsPrompt = `
    You are the 'Logistics Coordinator Agent'.
    Here is the planned activity itinerary for a trip to ${recommendation.title}:
    ${activityPlan}

    User Preferences:
    Budget (Treat as upper limit, +/- 20% acceptable):
      - Lodging: $${data.budget.lodging || "Any"} per night
      - Food: $${data.budget.food || "Any"} per day
    Food Preferences: ${data.foodPreferences}

    TASK:
    1. Recommend 2-3 Hotels/Lodging options that fit the budget and are centrally located to the planned activities. Include exact physical addresses.
    2. Recommend specific Restaurants/Food options for each day that are GEOGRAPHICALLY CLOSE to that day's activities. Pay strict attention to the food preferences (e.g., 'healthy' means nutritious/whole foods). Include exact physical addresses.
    Use Google Search to verify these places exist, fit the budget, match the dietary needs, and CRITICALLY: ensure they are NOT permanently or temporarily closed.
    
    CRITICAL: Output ONLY the hotel and restaurant recommendations. Do NOT repeat or output the day-by-day activity itinerary.
  `;

  const logisticsResponse = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: logisticsPrompt,
    config: { tools: [{ googleSearch: {} }], systemInstruction },
  });
  const logisticsPlan = logisticsResponse.text || "";

  // Agent 3: Verification & Formatting Concierge
  const verifyPrompt = `
    You are the 'Verification & Formatting Concierge Agent'.
    Here are the planned activities:
    ${activityPlan}

    Here are the planned logistics (hotels & food):
    ${logisticsPlan}

    Your task is to FACT-CHECK, VERIFY GEOGRAPHY, and FORMAT the final itinerary:
    1. Use Google Search to verify that EVERY hotel, restaurant, and attraction actually exists, is currently operational (NOT permanently or temporarily closed), and has the correct physical address.
    2. GEOGRAPHY CHECK: Verify that the recommended restaurants are actually near the day's activities, and the hotels are in a logical location. Fix any geographical impossibilities.
    3. Verify that the estimated costs align with the user's budget.
    4. Add links for EVERY hotel and restaurant ONLY IF you can verify the official website. CRITICAL: DO NOT guess or hallucinate URLs. If you cannot find a verified official website, DO NOT provide a link at all. Omit the link entirely.
    5. URL CLEANING & EXACT MATCHING: For hotel and restaurant links, provide the clean, base URL. Strip out any search dates, booking parameters, session IDs, or tracking codes. CRITICAL: Ensure you provide the EXACT official domain (e.g., do not omit 'www.' or 'the' if it is part of the real URL, like 'www.thecathedralcafe.com').
    6. Correct any hallucinations, wrong addresses, fake places, or closed businesses.
    
    CRITICAL: DO NOT output the raw activity plan or logistics plan. Output ONLY the final, unified Markdown itinerary. Do not repeat sections.

    Return the final, polished Markdown itinerary maintaining this exact structure:
    ## 🌟 Introduction
    (Brief overview of the trip)

    ## 🏨 Lodging Recommendations
    (Provide 2-3 specific hotel/lodging options that fit the budget. Include estimated prices and exact physical addresses. Explain why their location is convenient for the planned activities.)

    ## 🍽️ Food & Restaurant Recommendations
    (Provide specific restaurant names based on their preferences. Include estimated prices and exact physical addresses. Ensure these are geographically close to the daily activities.)

    ## 📅 Day-by-Day Itinerary
    (Morning, afternoon, evening breakdown. Include the neighborhood or area for each activity.)

    ## 💡 Tips and Tricks
    (Packing, local customs, safety)
  `;

  const finalResponse = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: verifyPrompt,
    config: { tools: [{ googleSearch: {} }], systemInstruction },
  });

  return finalResponse.text || activityPlan;
}
