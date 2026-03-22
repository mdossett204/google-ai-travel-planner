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
    Based on the travel preferences below, provide exactly 3 distinct travel recommendations.

    USER PREFERENCES
    Time of Year: ${data.timeOfYear?.length > 0 ? data.timeOfYear.join(", ") : "Not specified. Recommend the best realistic time to visit."}
    Duration: ${data.durationValue} ${data.durationUnit}
    Travelers: ${data.travelers}
    Budget (Treat as upper limit, with +/- 20% flexibility only when clearly justified):
      - Lodging: $${data.budget?.lodging || "Any"} per night
      - Transportation/Flights: $${data.budget?.transportation || "Any"} total
      - Food: $${data.budget?.food || "Any"} per day
      - Miscellaneous/Activities: $${data.budget?.misc || "Any"} total
    Primary Goal(s): ${data.primaryGoal?.length > 0 ? data.primaryGoal.join(", ") : "Any"}
    Food Preferences: ${data.foodPreferences}
    Activity Preferences: ${data.activityPreferences}
    Transportation Preferences: ${data.transportation?.length > 0 ? data.transportation.join(", ") : "Any"}
    Preferred Locations/Regions: ${data.locations || "Not specified"}
    Must-See Locations: ${data.mustSeeLocations || "None specified"}

    DECISION RULES
    - If the user specifies a location or region, you MUST stay strictly inside that location or region.
    - Do NOT recommend any destination outside the requested location.
    - If the user gives multiple location options, choose only from those options.
    - If fewer than 3 destinations are possible within the requested location, create 3 clearly distinct trip styles within that same location.
    - If a must-see location is given, only include it if it is genuinely in the requested destination and fits the trip naturally.
    - Favor realistic, geographically coherent, and seasonally appropriate recommendations.
    - Do not recommend places that are clearly closed, unavailable, or incompatible with the stated budget and travel style.
    - Make the 3 options meaningfully different from one another in pacing, emphasis, or sub-region.

    QUALITY BAR
    - Each option should feel plausible for the stated duration and budget.
    - Each option should match the traveler type, goals, and transport preferences.
    - Highlight specific experiences, not vague tourism phrases.
    - The title should clearly reflect the actual destination.
    - The description should explain why this option is a fit, not just describe the place.

    OUTPUT RULES
    You MUST return valid JSON only. Do not include markdown, commentary, or code fences.
    Return a JSON array of exactly 3 objects.
    Each object must have exactly these keys:
    - "id": unique string identifier
    - "title": destination plus a concise trip style title
    - "description": 2-4 sentences explaining why this trip is a strong match
    - "highlights": array of 3-4 specific highlights, neighborhoods, or activities
    - "estimatedCost": numerical USD range such as "$1,800 - $2,400"
    - "bestTimeToGo": recommended months or season, grounded in the user's timing if possible

    FINAL CHECK BEFORE ANSWERING
    - Confirm all 3 recommendations remain inside the requested location if one was provided.
    - Confirm the options are distinct from one another.
    - Confirm the cost ranges are realistic and not vague.
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
