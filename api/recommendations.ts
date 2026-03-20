import { generateText } from "./utils/llmRouter.js";

function sendJson(res: any, status: number, data: any) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

async function readJsonBody(req: any) {
  if (req.body) {
    if (typeof req.body === "string") {
      return JSON.parse(req.body || "{}");
    }
    return req.body;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || "{}");
}

export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "POST")
    return sendJson(res, 405, { error: "Method not allowed" });

  try {
    const data = await readJsonBody(req);

    const prompt = `
    Based on the following travel preferences, provide 3 distinct travel recommendations.
    Time of Year: ${data.timeOfYear?.length > 0 ? data.timeOfYear.join(", ") : "Not specified. Please recommend the best time of year to visit."}
    Duration: ${data.durationValue} ${data.durationUnit}
    Travelers: ${data.travelers}
    Budget (Treat as upper limit, but options within +/- 20% are acceptable):
      - Lodging: $${data.budget?.lodging || "Any"} per night
      - Transportation/Flights: $${data.budget?.transportation || "Any"} total
      - Food: $${data.budget?.food || "Any"} per day
      - Miscellaneous/Activities: $${data.budget?.misc || "Any"} total
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

    const text = await generateText({
      provider: "gemini",
      model: "gemini-2.5-flash",
      prompt,
      systemInstruction:
        "You are an elite travel concierge. You MUST use Google Search to verify that all places, hotels, restaurants, and attractions currently exist, are open, and fit the budget. Provide factual, accurate information.",
      useSearchTool: true,
    });

    let parsedText = text || "[]";
    const firstBracket = text.indexOf("[");
    const lastBracket = text.lastIndexOf("]");

    if (
      firstBracket !== -1 &&
      lastBracket !== -1 &&
      lastBracket > firstBracket
    ) {
      parsedText = text.substring(firstBracket, lastBracket + 1);
    }

    try {
      const parsed = JSON.parse(parsedText);
      return sendJson(res, 200, parsed);
    } catch {
      return sendJson(res, 502, {
        error: "Failed to parse recommendations from AI.",
      });
    }
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: "Server error" });
  }
}
