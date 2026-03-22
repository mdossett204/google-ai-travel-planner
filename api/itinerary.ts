import { generateText } from "./utils/llmRouter.js";
import { getGeminiVerificationTools } from "./tools/geminiTools.js";
import { getOpenAIVerificationTools } from "./tools/openaiTools.js";
import { getAnthropicVerificationTools } from "./tools/anthropicTools.js";

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
      "You are an elite travel concierge. You must verify factual place details before including them. You are strictly forbidden from guessing or hallucinating addresses or URLs. If you cannot verify an address or URL, you must omit it. Do not provide fake or guessed links.";

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

    TASK:
    Create a day-by-day itinerary of ACTIVITIES ONLY. Do NOT include hotels or restaurants.

    HARD RULES:
    - If a region/state/location is provided, keep the itinerary strictly inside that location.
    - Prioritize a relaxed, realistic trip. Do NOT overschedule.
    - Each day may contain at most 2 major activities and 1 lighter activity.
    - Group activities by the same neighborhood or nearby areas. Avoid backtracking.
    - Do not recommend attractions that are closed, permanently unavailable, or clearly impractical for the trip duration.
    - Include at least one breathing-space or scenic/light block per day when possible.
    - If a must-see location is provided, include it only if it is actually in the requested destination and fits naturally.
    - Use Google Search to verify that each attraction exists and is currently operating.

    OUTPUT FORMAT:
    Return plain text only using this exact planning format for each day:

    DAY 1
    Area Anchor: <main neighborhood or area>
    Morning: <specific activity> | Area: <neighborhood> | Pace: <easy/moderate> | Why it fits: <short reason>
    Afternoon: <specific activity> | Area: <neighborhood> | Pace: <easy/moderate> | Why it fits: <short reason>
    Evening: <specific activity or light free-time block> | Area: <neighborhood> | Pace: <easy/moderate> | Why it fits: <short reason>
    Daily Flow Note: <one sentence explaining why the sequence is geographically and emotionally relaxing>
    Verification Notes: <brief note if anything was excluded or adjusted due to verification>

    Repeat for each day only. Do not include markdown headings, hotels, restaurants, or extra commentary.
  `;

    const activityPlan = await generateText({
      provider: "gemini",
      model: "gemini-2.5-flash-lite",
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
    Recommend lodging and restaurants that fit the already-planned activity flow.

    HARD RULES:
    - Recommend 2-3 lodging options only.
    - Lodging must be central to the activity areas already listed.
    - Restaurant choices must be geographically close to the same day's activities.
    - Respect stated food preferences precisely.
    - Use Google Search to verify that each business exists and is currently operating.
    - Do NOT include any URL unless you are confident it is the official website.
    - If a business cannot be verified, replace it with another verified option.
    - Do NOT repeat the activity itinerary.

    OUTPUT FORMAT:
    Return plain text only in this exact structure:

    LODGING OPTIONS
    - <Hotel Name> | Price: <estimated nightly price> | Area: <neighborhood> | Address: <exact address> | Why convenient: <short reason> | Website: <official website or "Not verified">
    - <Hotel Name> | Price: <estimated nightly price> | Area: <neighborhood> | Address: <exact address> | Why convenient: <short reason> | Website: <official website or "Not verified">

    DAY 1 FOOD
    - Breakfast: <name or "Skip recommendation"> | Cuisine: <type> | Price: <estimated price> | Address: <exact address> | Near: <activity or area> | Diet fit: <short reason> | Website: <official website or "Not verified">
    - Lunch: <name or "Skip recommendation"> | Cuisine: <type> | Price: <estimated price> | Address: <exact address> | Near: <activity or area> | Diet fit: <short reason> | Website: <official website or "Not verified">
    - Dinner: <name or "Skip recommendation"> | Cuisine: <type> | Price: <estimated price> | Address: <exact address> | Near: <activity or area> | Diet fit: <short reason> | Website: <official website or "Not verified">

    Repeat the DAY N FOOD section for each day only. Do not include markdown headings or any other prose.
  `;

    const logisticsPlan = await generateText({
      provider: "gemini",
      model: "gemini-2.5-flash-lite",
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

    Your task is to FACT-CHECK, VERIFY GEOGRAPHY, REMOVE WEAK ITEMS, and FORMAT the final itinerary.

    HARD RULES:
    - You MUST use the search_place tool to verify hotels, restaurants, attractions, and official websites before including them.
    - You MUST call the search_place tool to verify specific hotels, restaurants, and attractions before keeping them in the final itinerary.
    - Keep the trip strictly inside the requested destination or region when one is provided.
    - Verify that every attraction, hotel, and restaurant exists and appears to be currently operating.
    - Remove or replace anything that seems fake, closed, duplicated, too far away, or not meaningfully aligned with the user preferences.
    - Do not include any guessed or unverified website.
    - Only include a website if it comes directly from the search_place tool result.
    - If the search_place tool does not return a website, omit the website entirely.
    - Never invent, infer, rewrite, or supplement a website from model memory or general search.
    - Keep the itinerary relaxed and realistic. Avoid cramming too many stops into one day.
    - Restaurants must make geographic sense for that day.
    - Lodging must make geographic sense for the overall itinerary.
    - If a detail is uncertain, omit it instead of inventing it.
    - If tool results contradict the draft plans, trust the tool results and correct the itinerary.

    CRITICAL:
    - Do NOT output the raw planning notes.
    - Output ONLY the final unified Markdown itinerary.
    - Keep the writing concise, useful, and specific.

    Return the final Markdown using this exact structure:

    ## 🌟 Introduction
    Write a short overview of why this trip fits the travel goals, season, and pace.

    ## 🏨 Lodging Recommendations
    List 2-3 lodging options. For each option include:
    - Name
    - Estimated nightly price
    - Exact physical address
    - Why the location is convenient
    - Official website only if returned by the search_place tool

    ## 🍽️ Food & Restaurant Recommendations
    Organize food suggestions by day. For each day, recommend practical nearby options that match the stated food preferences. Include:
    - Name
    - Cuisine or style
    - Estimated price level
    - Exact physical address
    - Why it fits that day's route
    - Official website only if returned by the search_place tool

    ## 📅 Day-by-Day Itinerary
    For each day include morning, afternoon, and evening.
    - Mention the neighborhood or area for each block
    - Keep pacing realistic
    - Explain transitions naturally where helpful
    - Prefer a calm and geographically coherent sequence over packing in more stops

    ## 💡 Tips and Tricks
    Include concise, destination-specific tips for packing, local etiquette, safety, timing, or reservations.
  `;

    // Verification model options:
    // Gemini:
    const itinerary = await generateText({
      provider: "gemini",
      model: "gemini-2.5-flash",
      prompt: verifyPrompt,
      systemInstruction,
      useSearchTool: false,
      geminiTools: getGeminiVerificationTools(),
    });
    //
    // OpenAI:
    // const itinerary = await generateText({
    //   provider: "openai",
    //   model: "gpt-5.1",
    //   prompt: verifyPrompt,
    //   systemInstruction,
    //   useSearchTool: false,
    //   openaiTools: getOpenAIVerificationTools(),
    // });
    //
    // Anthropic:
    // const itinerary = await generateText({
    //   provider: "anthropic",
    //   model: "claude-haiku-4-5",
    //   prompt: verifyPrompt,
    //   systemInstruction,
    //   useSearchTool: false,
    //   anthropicTools: getAnthropicVerificationTools(),
    // });

    return sendJson(res, 200, {
      itinerary: itinerary || activityPlan,
    });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: "Server error" });
  }
}
