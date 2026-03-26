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

const monthLabels: Record<string, string> = {
  Jan: "January (winter)",
  Feb: "February (late winter)",
  Mar: "March (early spring)",
  Apr: "April (early spring)",
  May: "May (spring)",
  Jun: "June (early summer)",
  Jul: "July (midsummer)",
  Aug: "August (late summer)",
  Sep: "September (early fall)",
  Oct: "October (fall)",
  Nov: "November (late fall)",
  Dec: "December (winter)",
};

export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "POST")
    return sendJson(res, 405, { error: "Method not allowed" });

  try {
    const data = await readJsonBody(req);
    const timeOfYear =
      data.timeOfYear?.length > 0
        ? data.timeOfYear
            .map((month: string) => monthLabels[month] || month)
            .join(", ")
        : "Not specified. Recommend the best realistic time to visit.";

    const prompt = `
    Based on the travel preferences below, provide exactly 3 travel recommendations.

    USER PREFERENCES
    Time of Year: ${timeOfYear}
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
    - Do NOT use web search in this stage. Use general knowledge about the area, travel patterns, seasonality, and destination fit.
    - Interpret duration primarily as trip days. Unless the input clearly means something else, assume approximate nights = max(days - 1, 0).
    - If fewer than 3 materially different destinations are possible within the requested location, return 3 variants within that same destination and make the differences explicit.
    - If a must-see location is given, only include it if it is genuinely in the requested destination and fits the trip naturally.
    - Favor realistic, geographically coherent, and seasonally appropriate recommendations.
    - Do not recommend places that are clearly closed, unavailable, or incompatible with the stated budget and travel style.
    - Each recommendation must differ in at least one primary dimension: sub-region, activity emphasis, or pacing.
    - Treat food preferences mainly as a downstream planning constraint for the itinerary/logistics agent, not as the main driver of destination selection unless the user explicitly makes food a primary goal.
    - Transportation preferences and budget must materially shape the recommendation. Favor compact, locally explorable areas and avoid long-distance travel or dispersed itineraries unless explicitly requested.
    - If the stated transportation preference is a poor fit for the destination, recommend the most practical local transportation mode for that area while keeping the overall trip aligned with the user's travel style and budget.
    - Prefer a geographically compact recommendation where most highlights can be experienced from one base area with limited daily transit.

    BUDGET ESTIMATION RULES
    - Estimate trip cost using the user's inputs as the primary guide.
    - Lodging estimate: nightly lodging budget multiplied by the approximate number of nights.
    - Transportation estimate: use the provided transportation budget as the default ceiling, adjusted only when the destination or transport preference clearly makes that unrealistic.
    - Food estimate: daily food budget multiplied by the approximate number of trip days.
    - Activities and miscellaneous estimate: use the provided miscellaneous/activities budget as the default baseline, adjusted only when clearly justified by the trip style.
    - If a budget category is "Any", estimate conservatively based on the destination, season, and trip style.
    - Keep the total estimate within the user's implied overall budget envelope whenever reasonably possible.
    - If an option is slightly above budget, keep it only if it is still plausibly attainable and explain the tradeoff briefly in the description.
    - If the stated budget is too restrictive for the requested destination, duration, or season, prefer lower-cost variants in that same area before changing the destination.
    - If you still cannot fully satisfy the budget, return the most budget-conscious plausible option and clearly state the main cost pressure in the description.

    BUDGET CALCULATION EXAMPLE
    - Example only: for a 4-night trip with lodging budget $250/night, transportation budget $400 total, food budget $80/day, and miscellaneous budget $300 total:
      estimated total = ($250 x 4) + $400 + ($80 x 5 days) + $300 = $2,100
    - Treat duration as days by default, and derive nights realistically. Example: 5 days usually implies about 4 nights; 2 days usually implies about 1 night.
    - For short trips of 1 to 3 days, keep total estimated costs proportional to the shorter duration and close to the user's stated daily budget levels.
    - Use this style of calculation to ground your estimate, but adapt nights versus days realistically from the trip duration.

    QUALITY BAR
    - Each option should feel plausible for the stated duration and budget.
    - Each option should match the traveler type, goals, and transport preferences.
    - Highlight specific experiences, neighborhoods, landmark-level attractions, or activity clusters, not vague tourism phrases.
    - Keep each highlight concise, ideally a short phrase rather than a full sentence.
    - Do NOT include hotels, restaurants, exact addresses, opening hours, or URLs in this stage.
    - The title should clearly reflect the actual destination.
    - The description should explain why this option is a fit, not just describe the place.

    OUTPUT RULES
    You MUST return valid JSON only. Do not include markdown, commentary, or code fences.
    Return a JSON array of exactly 3 objects.
    Each object must have exactly these keys:
    - "id": unique lowercase kebab-case identifier based on destination and trip style
    - "title": destination plus a concise trip style title
    - "description": 2-4 sentences explaining why this trip is a strong match
    - "highlights": array of 3-4 specific highlights, neighborhoods, or activities
    - "estimatedCost": numerical USD range such as "$1,800 - $2,400"
    - "bestTimeToGo": recommended months or season, grounded in the user's timing if possible

    JSON OUTPUT EXAMPLE
    [
      {
        "id": "charleston-slow-historic-waterfront",
        "title": "Charleston Slow Historic Waterfront",
        "description": "This option suits travelers who want a compact, walkable city break with historic streets, waterfront views, and an easy pace. It keeps transportation simple and works well for a short to medium domestic trip.",
        "highlights": ["historic district", "waterfront park", "south of broad", "harbor views"],
        "estimatedCost": "$1,200 - $1,700",
        "bestTimeToGo": "March to May (spring)"
      },
      {
        "id": "charleston-neighborhood-culture-weekend",
        "title": "Charleston Neighborhood Culture Weekend",
        "description": "This option puts more emphasis on neighborhood character, local culture, and a slower day structure. It is a good fit when the traveler wants a grounded, compact itinerary instead of trying to cover too much.",
        "highlights": ["king street", "historic homes", "market area", "local galleries"],
        "estimatedCost": "$1,100 - $1,600",
        "bestTimeToGo": "April to May (spring)"
      },
      {
        "id": "barcelona-scenic-active-city-escape",
        "title": "Barcelona Scenic Active City Escape",
        "description": "This option leans more active, with longer walks, scenic overlooks, and a more energetic daily rhythm. It still remains geographically coherent and plausible within a moderate city-trip budget.",
        "highlights": ["Montjuic", "Park Guell area", "waterfront biking", "Ciutadella area"],
        "estimatedCost": "$1,700 - $2,200",
        "bestTimeToGo": "April to June (spring to early summer)"
      }
    ]

    FINAL CHECK BEFORE ANSWERING
    - Confirm all 3 recommendations remain inside the requested location if one was provided.
    - Confirm the options are meaningfully differentiated, even if they are variants within the same narrow destination.
    - Confirm the cost ranges are realistic and not vague.
    - Confirm the transportation assumptions are practical for the stated budget and transport preferences.
    - Confirm the recommendation is geographically compact enough to feel realistic for the trip length.
  `;

    const text = await generateText({
      provider: "gemini",
      model: "gemini-2.5-flash",
      prompt,
      systemInstruction:
        "You are an elite travel concierge. At this stage, your job is to recommend destination concepts, not verified bookings. Use general destination knowledge and avoid web search in this stage. Do not include hotels, restaurants, exact addresses, opening hours, or official websites. Food preferences should usually be treated as a downstream itinerary constraint unless food is a primary travel goal. Provide factual, realistic recommendations grounded in the user's budget and travel goals.",
      useSearchTool: false,
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
