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
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    const body = await readJsonBody(req);
    const data = body?.data;
    const recommendation = body?.recommendation;

    if (!data || !recommendation) {
      return sendJson(res, 400, {
        error: "Missing travel form data or recommendation.",
      });
    }

    const systemInstruction =
      "You are an elite travel concierge. You MUST use Google Search to verify every single place, hotel, restaurant, and attraction. You are strictly forbidden from guessing or hallucinating addresses or URLs. If you cannot verify an address or URL via search, you MUST omit the link entirely. Do not provide fake or guessed links.";

    const activityPrompt = `
    You are the 'Activity Planner Agent'.
    Destination: ${recommendation.title}
    Region/State Requested: ${data.locations || "Not specified"}
    Trip Context: ${recommendation.description}
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

    const activityPlan = await generateText({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      prompt: activityPrompt,
      systemInstruction,
      useSearchTool: true,
    });

    const logisticsPrompt = `
    You are the 'Logistics Coordinator Agent'.
    Here is the planned activity itinerary for a trip to ${recommendation.title}:
    ${activityPlan}

    User Preferences:
    Budget (Treat as upper limit, +/- 20% acceptable):
      - Lodging: $${data.budget?.lodging || "Any"} per night
      - Food: $${data.budget?.food || "Any"} per day
    Food Preferences: ${data.foodPreferences}

    TASK:
    1. Recommend 2-3 Hotels/Lodging options that fit the budget and are centrally located to the planned activities. Include exact physical addresses.
    2. Recommend specific Restaurants/Food options for each day that are GEOGRAPHICALLY CLOSE to that day's activities. Pay strict attention to the food preferences (e.g., 'healthy' means nutritious/whole foods). Include exact physical addresses.
    Use Google Search to verify these places exist, fit the budget, match the dietary needs, and CRITICALLY: ensure they are NOT permanently or temporarily closed.

    CRITICAL: Output ONLY the hotel and restaurant recommendations. Do NOT repeat or output the day-by-day activity itinerary.
  `;

    const logisticsPlan = await generateText({
      provider: "openai",
      model: "gpt-5-mini",
      prompt: logisticsPrompt,
      systemInstruction,
      useSearchTool: true,
    });

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

    const itinerary = await generateText({
      provider: "gemini",
      model: "gemini-2.5-flash",
      prompt: verifyPrompt,
      systemInstruction,
      useSearchTool: true,
    });

    return sendJson(res, 200, {
      itinerary: itinerary || activityPlan,
    });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: "Server error" });
  }
}
