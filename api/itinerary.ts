import { generateText } from "./utils/llmRouter.js";
import { getGeminiVerificationTools } from "./tools/geminiTools.js";
import { getOpenAIVerificationTools } from "./tools/openaiTools.js";
import { getAnthropicVerificationTools } from "./tools/anthropicTools.js";
import { formatFoodPreferences } from "./utils/foodPreferences.js";
import { formatLodgingPreferences } from "./utils/lodgingPreferences.js";
import {
  formatPreferredLocation,
  formatTravelerType,
} from "./utils/tripContext.js";

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
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    const body = await readJsonBody(req);
    const data = body?.data;
    const recommendation = body?.recommendation;
    const foodPreferences = formatFoodPreferences(data?.foodPreferences || {});
    const lodgingPreferences = formatLodgingPreferences(
      data?.lodgingPreferences || {},
    );
    const travelerType = formatTravelerType(data?.travelers);
    const preferredLocation = formatPreferredLocation(
      data?.preferredLocation || {},
    );
    const timeOfYear =
      data?.timeOfYear?.length > 0
        ? data.timeOfYear
            .map((month: string) => monthLabels[month] || month)
            .join(", ")
        : "Not specified";

    if (!data || !recommendation) {
      return sendJson(res, 400, {
        error: "Missing travel form data or recommendation.",
      });
    }

    const activitySystemInstruction =
      "You are an elite travel concierge focused on drafting realistic activity flows. This stage is for activity planning only, not final verification. Use general destination knowledge, avoid web search, and do not include hotels, restaurants, exact addresses, URLs, or opening hours. Favor realistic pacing, geographic coherence, and practical local movement. Think briefly before responding but keep your output concise and strictly within the specified format.";

    const logisticsSystemInstruction =
      "You are an elite travel concierge focused on planning practical trip logistics around an existing activity flow. This stage is for drafting candidate lodging and food options only, not final verification. Use general destination knowledge, avoid web search, and do not include exact addresses, URLs, or opening hours. Prioritize geographic fit, transportation practicality, food preference fit, and budget realism. Lodging suggestions should be specific named properties only when they are well-known and plausible. Food suggestions may be either specific well-known venues or generalized area-based options when specificity is uncertain. Never invent precise facts to make a recommendation sound more certain than it is.";

    const ItinerarySystemInstruction =
      "You are an elite travel concierge. You must verify factual place details before including them. You are strictly forbidden from guessing or hallucinating addresses or URLs. If you cannot verify an address or URL, you must omit it. Do not provide fake or guessed links. Prefer options that maximize geographic coherence, preference fit, and realism over simply preserving draft items.";

    const activityPrompt = `
    You are the 'Activity Planner Agent'.
    Destination: ${recommendation.title}
    Preferred Location: ${preferredLocation}
    Trip Context: ${recommendation.description}
    Time of Year: ${timeOfYear}
    Duration: ${data.durationValue} ${data.durationUnit}
    Travel Style: ${travelerType}
    Primary Goal(s): ${data.primaryGoal?.length > 0 ? data.primaryGoal.join(", ") : "Any"}
    Attractions of Interest: ${data.attractionInterests || "None specified"}
    Local Transportation Preferences: ${data.localTransportation?.length > 0 ? data.localTransportation.join(", ") : "Any"}
    LODGING PREFERENCES
    ${lodgingPreferences}

    TASK:
    Create a day-by-day itinerary of ACTIVITIES ONLY.
    Do NOT include hotels, restaurants, cafes, meal planning, or any food suggestions.

    HARD RULES:
    - Keep the itinerary strictly inside the specified preferred location.
    - Do NOT use web search in this stage. Use general destination knowledge and common travel patterns only.
    - Interpret duration primarily as trip days. Unless the input clearly means something else, assume approximate nights = max(days - 1, 0).
    - Produce one itinerary day per trip day when reasonable, but keep each day appropriately light for short trips.
    - For same-day trips, keep the evening block very light or treat it as an early wrap-up rather than a full third activity block.
    - Prioritize a relaxed, realistic trip. Do NOT overschedule.
    - Each day may contain at most 2 major activities and 1 lighter activity.
    - A major activity is usually a primary sightseeing stop, hike, museum, guided visit, or destination anchor that can take roughly 2-4 hours.
    - A lighter activity is usually a scenic walk, waterfront break, market browsing, park time, viewpoint stop, neighborhood wandering, or flexible free-exploration block that can take roughly 45-90 minutes.
    - Avoid scheduling two strenuous activity blocks on the same day. If one block is strenuous, the remaining blocks that day should be moderate or easy.
    - Each day should revolve around one main area anchor with short, practical movement between blocks.
    - Group activities by the same neighborhood or nearby areas. Avoid backtracking and long cross-region jumps.
    - Each day should feel meaningfully different from the previous day in at least one dimension: area anchor, activity type, or energy level.
    - Let the traveler type shape the tone and pacing. For example, couples may benefit from more scenic, atmospheric, or leisurely transitions, while families or groups may need simpler logistics and lower friction.
    - Local transportation preferences should shape the plan. Favor compact, locally explorable areas and practical movement on foot, transit, or short rides unless longer travel is clearly justified.
    - Treat lodging preferences as soft downstream guidance only. They may lightly influence the practicality of daily movement, but they should not override activity geography, pace, or the main trip goals.
    - If the stated local transportation preference is a poor fit for the destination, quietly adapt the daily movement style to the most practical local option without changing the overall trip character.
    - Do not recommend activities that are clearly implausible for the season, trip length, or traveler type.
    - Include at least one breathing-space or scenic/light block per day when possible.
    - If attraction interests are provided, treat broad categories such as parks, museums, or viewpoints as preference signals, and treat named attractions as specific requests. Only include them if they genuinely fit the requested destination and the daily geography.
    - Do not force filler attractions. If a day would otherwise feel thin, use a scenic stroll, waterfront time, old-town wandering, park time, market browsing, or free exploration block instead.
    - If there are not enough strong activities for a full day, reduce intensity and use fewer, better-spaced blocks rather than padding the itinerary.
    - Do not include exact addresses, websites, opening hours, or verification commentary in this stage.

    OUTPUT FORMAT:
    Return plain text only using this exact planning format for each day:

    DAY 1
    Area Anchor: <main neighborhood or area>
    Morning: <specific activity> | Area: <neighborhood> | Pace: <easy/moderate/strenuous> | Why it fits: <one short clause>
    Afternoon: <specific activity> | Area: <neighborhood> | Pace: <easy/moderate/strenuous> | Why it fits: <one short clause>
    Evening: <specific activity or light free-time block> | Area: <neighborhood> | Pace: <easy/moderate/strenuous> | Why it fits: <one short clause>
    Daily Flow Note: <one sentence explaining why the sequence is geographically and emotionally relaxing>

    EXAMPLE OUTPUT
    DAY 1
    Area Anchor: Downtown Asheville
    Morning: Explore downtown Asheville's galleries, bookstores, and walkable blocks | Area: Downtown Asheville | Pace: easy | Why it fits: easy city-center orientation
    Afternoon: Visit the River Arts District studios and nearby creative spaces | Area: River Arts District | Pace: moderate | Why it fits: one focused cultural cluster
    Evening: Sunset walk at a nearby Blue Ridge Parkway overlook | Area: Blue Ridge Parkway edge | Pace: easy | Why it fits: light scenic finish
    Daily Flow Note: This sequence keeps the day centered around Asheville with one natural shift from downtown culture to an easy mountain-view evening.

    Repeat for each day only. Do not include markdown headings, hotels, restaurants, food suggestions, verification notes, or extra commentary.
  `;

    const activityPlan = await generateText({
      provider: "gemini",
      model: "gemini-2.5-flash",
      prompt: activityPrompt,
      systemInstruction: activitySystemInstruction,
      useSearchTool: false,
    });

    const logisticsPrompt = `
    You are the 'Logistics Coordinator Agent'.
    Destination: ${recommendation.title}
    Trip Context: ${recommendation.description}
    Time of Year: ${timeOfYear}
    Preferred Location: ${preferredLocation}
    Travel Style: ${travelerType}
    Local Transportation Preferences: ${data.localTransportation?.length > 0 ? data.localTransportation.join(", ") : "Any"}
    Attractions of Interest: ${data.attractionInterests || "None specified"}

    Here is the planned activity itinerary:
    ${activityPlan}

    User Preferences:
    Budget (Treat as upper limit, +/- 20% acceptable):
      - Lodging: $${data.budget?.lodging || "Any"} per night
      - Local Transportation: $${data.budget?.localTransportation || "Any"} total
      - Food: $${data.budget?.food || "Any"} per day
    FOOD PREFERENCES
    ${foodPreferences}
    LODGING PREFERENCES
    ${lodgingPreferences}

    TASK:
    Use the activity plan as the geographic backbone of the trip.
    First infer the best general stay areas based on where the attractions cluster.
    Then recommend lodging and food options that fit those areas, the food preferences, the local transportation preferences, and the stated budget.

    HARD RULES:
    - Recommend 2-3 lodging options only. Two is acceptable when the area or budget meaningfully limits strong choices; three is better when there are several clear fits.
    - Choose lodging in this order of importance: overall fit to the activity geography, fit to the local transportation mode, budget realism, then fit to the travel style.
    - Lodging must be chosen only after considering the overall attraction geography.
    - Lodging should be central to the activity areas already listed and should reduce daily transit friction.
    - Lodging should be specific named properties.
    - Use lodging preferences as soft guidance unless they clearly conflict with geography or budget reality.
    - Across lodging options, vary at least one of: neighborhood, price tier, or property type.
    - Restaurant or grocery choices must be geographically close to the same day's activities or the stay area for that night.
    - Respect dietary restrictions precisely as hard constraints.
    - Treat cuisine interests and dining style as soft preferences that should guide the tone of the recommendations.
    - Let food priority control how strongly food shapes the plan: if food priority is "Major Trip Focus", give food suggestions more weight; if it is "Nice to Have", balance food with geography; if it is "Not Important", prioritize geography and logistics first.
    - Local transportation preferences must materially shape the recommendations. Favor places that are practical to reach from the planned activity areas using the likely local transport mode.
    - The local transportation budget applies only after arrival at the destination.
    - For walking or biking, keep lodging and food very close to the activity anchors and avoid recommendations that require repeated long transfers.
    - For public transit, favor central stay areas and food options near practical transit corridors or dense walkable areas.
    - For taxis or rideshare, modest dispersal is acceptable, but still avoid inefficient zig-zagging.
    - For rental car or own car, favor lodging with practical driving access and food options that are easy to reach or park near without creating unnecessary detours.
    - If the stated local transportation preference is impractical, switch to the most realistic local mode and optimize for geographic efficiency without explicitly calling out the change.
    - Do NOT use web search in this stage.
    - Do NOT include exact addresses, websites, or operating-status claims in this stage.
    - Never invent unknown details. If you are unsure about a venue, keep the recommendation general rather than fabricating precision.
    - A "well-known" lodging or food venue means a place that is broadly recognizable or highly plausible from general destination knowledge, not a niche business recalled uncertainly.
    - If confidence is low on a specific lodging property, choose a best-known plausible named property rather than inventing details.
    - If no plausible named property is appropriate, choose a well-known hotel brand or a central, commonly used property type in the area.
    - Keep food recommendations general at the venue or style level. Do not describe specific dishes or menu items in this stage.
    - Food <Name> may be either a specific venue OR a descriptive area-based option such as "casual cafes near Shinjuku Station".
    - Food recommendations may be either specific well-known venues or generalized area-based options when specificity is uncertain.
    - If confidence is low on a specific food venue, choose a generalized area-based option rather than inventing precise details.
    - If the budget is tight, prefer simpler but well-located options over aspirational ones that add transit friction.
    - If the requested location and budget are in tension, keep the location fixed and move downmarket first: prefer simpler lodging, fewer paid meal recommendations, grocery options, and more transit-efficient choices before drifting outside the requested area.
    - Use food price tiers consistently: $ = under $15 per person, $$ = $15-$35 per person, $$$ = over $35 per person.
    - Distribute the daily food budget roughly across meals as follows when all three are recommended: 20% breakfast, 35% lunch, 45% dinner.
    - Breakfast is the first meal to skip if the day does not support three strong food recommendations.
    - You may recommend a local grocery store, market, or specialty food hall when that fits the budget, dietary needs, or logistics better than a restaurant.
    - If a meal recommendation is skipped, you MUST include a short reason explaining why skipping is more practical.
    - If cuisine interests conflict with geography, dietary restrictions, or budget, prioritize geography and dietary safety first.
    - If the area has limited strong options, recommend fewer but better-fitting choices rather than forcing weak ones.
    - If the activity itinerary is sparse or geographically unclear, infer a central, practical base area and keep recommendations tightly clustered.
    - Avoid repeating the exact same food venue, grocery option, or lodging rationale across multiple meal slots or days unless repetition is clearly the most practical choice.
    - Do NOT repeat the activity itinerary.

    CONFLICT RESOLUTION ORDER
    When constraints conflict, resolve them in this order:
    1. Stay inside the requested location.
    2. Respect dietary restrictions and basic feasibility.
    3. Keep the activity geography and local transportation flow practical.
    4. Stay close to the lodging and food budgets.
    5. Apply cuisine interests, dining style, and lodging-type preferences.

    OUTPUT FORMAT:
    Return plain text only in this exact structure:

    LODGING OPTIONS
    - <Property Name> | Type: <hotel/boutique hotel/vacation rental/etc.> | Price: <estimated nightly price> | Area: <neighborhood> | Why convenient: <=12 words, must reference proximity to key activity area(s)> | Confidence: <high/medium/low>
    - <Property Name> | Type: <hotel/boutique hotel/vacation rental/etc.> | Price: <estimated nightly price> | Area: <neighborhood> | Why convenient: <=12 words, must reference proximity to key activity area(s)> | Confidence: <high/medium/low>

    DAY 1 FOOD
    - Breakfast: <name or "Skip recommendation"> | Cuisine: <type or "N/A"> | Price: <estimated price or "N/A"> | Near: <activity or area> | Diet fit: <≤8 words, explicitly referencing dietary constraint or flexibility> | Skip reason: <short reason, <=12 words, or "N/A"> | Confidence: <high/medium/low>
    - Lunch: <name or "Skip recommendation"> | Cuisine: <type or "N/A"> | Price: <estimated price or "N/A"> | Near: <activity or area> | Diet fit: <≤8 words, explicitly referencing dietary constraint or flexibility> | Skip reason: <short reason, <=12 words, or "N/A"> | Confidence: <high/medium/low>
    - Dinner: <name or "Skip recommendation"> | Cuisine: <type or "N/A"> | Price: <estimated price or "N/A"> | Near: <activity or area> | Diet fit: <≤8 words, explicitly referencing dietary constraint or flexibility> | Skip reason: <short reason, <=12 words, or "N/A"> | Confidence: <high/medium/low>

    CONFIDENCE GUIDE
    - Use "high" sparingly, only when the venue or property is a clearly strong fit from general knowledge.
    - Use "medium" when selecting a plausible well-known property or venue without strong certainty about fit.
    - Use "low" when relying on general area knowledge rather than a specific known venue.

    EXAMPLE OUTPUT
    LODGING OPTIONS
    - Kimpton Hotel Arras | Type: hotel | Price: $260/night | Area: Downtown Asheville | Why convenient: central for downtown and River Arts access | Confidence: high
    - Haywood Park Hotel | Type: boutique hotel | Price: $240/night | Area: Downtown Asheville | Why convenient: walkable base with low transit friction | Confidence: high
    - Element Asheville Downtown | Type: hotel | Price: $210/night | Area: Downtown Asheville | Why convenient: practical base with easier budget fit | Confidence: medium

    DAY 1 FOOD
    - Breakfast: Skip recommendation | Cuisine: N/A | Price: N/A | Near: Downtown Asheville stay area | Diet fit: keeps the morning flexible | Skip reason: easy to grab near lodging | Confidence: high
    - Lunch: casual counter-service lunch spot in the River Arts District | Cuisine: casual local lunch | Price: $ | Near: River Arts District | Diet fit: flexible and easy to adapt | Skip reason: N/A | Confidence: medium
    - Dinner: local grocery store or prepared-food market near downtown | Cuisine: grocery / prepared foods | Price: $-$$ | Near: Downtown Asheville | Diet fit: useful for dietary flexibility and a lighter evening | Skip reason: N/A | Confidence: medium

    Repeat the DAY N FOOD section for each day only. Do not include markdown headings or any other prose.
  `;

    const logisticsPlan = await generateText({
      provider: "gemini",
      model: "gemini-2.5-flash",
      prompt: logisticsPrompt,
      systemInstruction: logisticsSystemInstruction,
      useSearchTool: false,
    });

    const verifyPrompt = `
    You are the 'Verification & Formatting Concierge Agent'.
    Here are the planned activities:
    ${activityPlan}

    Here are the planned logistics (hotels & food):
    ${logisticsPlan}

    Your task is to FACT-CHECK, VERIFY GEOGRAPHY, REMOVE WEAK ITEMS, and FORMAT the final itinerary.

    HARD RULES:
    - Only use the search_place tool for specific named hotels, restaurants, grocery stores, markets, food halls, or attractions that you are considering keeping in the final answer.
    - Do NOT call the tool for generalized area-based food suggestions such as "casual cafes near Shinjuku Station". Either replace them with a verified specific place or omit them.
    - Use the tool only when needed. Do not verify every draft item automatically.
    - First remove weak, redundant, low-fit, or obviously vague draft items without searching.
    - Then verify the strongest likely keepers.
    - Only search for replacements when an important slot still needs a specific verified place.
    - Use as few tool calls as needed to produce a strong final itinerary.
    - Keep the trip strictly inside the requested preferred location.
    - Verify that every final attraction, hotel, restaurant, grocery store, market, or food hall exists and appears to be currently operating.
    - Treat a place as verified only if the tool returns a clear, matching entity with consistent name and location. If results are ambiguous or weakly matching, omit or replace.
    - Prefer verified named properties and venues. Drop anything that remains unverified or too vague after review.
    - Remove or replace anything that seems fake, closed, duplicated, too far away, or not meaningfully aligned with the user preferences.
    - Do not include any guessed or unverified website.
    - Only include a website if it comes directly from the search_place tool result.
    - If the search_place tool does not return a website, omit the website entirely.
    - Copy the website exactly as returned by the tool. Do not modify, shorten, or reformat it.
    - Never invent, infer, rewrite, or supplement a website from model memory or general search.
    - Keep the itinerary relaxed and realistic. Avoid cramming too many stops into one day.
    - Do not add activities beyond what was in the approved activity plan.
    - Only edit activities for clarity, pacing notes, or geographic corrections.
    - Limit each day to a realistic number of major activities, typically 2-4, prioritizing flow over coverage.
    - Food and activity locations should generally be within a reasonable travel radius for the chosen transport mode, such as walkable clusters, short transit hops, or logical driving routes.
    - Restaurants and grocery-style food options must make geographic sense for that day.
    - Lodging must make geographic sense for the overall itinerary.
    - Use the draft confidence field as a triage signal, not as proof:
      - High: verify first if likely to keep.
      - Medium: verify if the item is a strong geographic and budget fit.
      - Low: replace or omit unless the slot is important and alternatives are limited.
    - If breakfast was skipped in the draft, it is acceptable to keep it skipped if that remains the most practical choice.
    - If lunch or dinner was skipped in the draft, attempt one targeted replacement search. If no strong verified match is found, leave the slot out rather than forcing a weak option.
    - If search_place returns no result for a critical slot, note it as: ⚠️ No verified option found — research locally before booking
    - Deduplicate across days when possible. Do not repeat the same food venue across days unless no verified alternative exists.
    - Avoid repeating the same hotel rationale unless repetition is clearly the most practical choice.
    - If a detail is uncertain, omit it instead of inventing it.
    - If tool results contradict the draft plans, trust the tool results and correct the itinerary.

    INPUT INTERPRETATION:
    - Lodging entries may include type and confidence. Preserve useful type information when it helps the user compare options.
    - Food entries may be specific venues, grocery/market options, or generalized area-based suggestions.
    - Generalized area-based food suggestions should not appear in the final answer unless replaced by a verified specific venue.
    - Grocery stores, markets, and food halls are allowed in the final answer if they are verified specific places and make practical sense.
    - Skip recommendations are allowed in draft planning, but the final answer should prefer verified specific lunch and dinner options when possible.

    CRITICAL:
    - Do NOT output the raw planning notes.
    - Output ONLY the final unified Markdown itinerary.
    - Keep the writing concise, useful, and specific.

    Return the final Markdown using this exact structure:

    ## 🌟 Introduction
    Write 2-3 sentences only explaining why this trip fits the travel goals, season, and pace.

    ## 🏨 Lodging Recommendations
    List 2-3 lodging options. For each option include:
    - Name
    - Property type when useful
    - Estimated nightly price
    - Exact physical address
    - Why the location is convenient
    - Official website only if returned by the search_place tool

    ## 🍽️ Food & Restaurant Recommendations
    Organize food suggestions by day. For each day, recommend practical nearby verified options that match the structured food preferences. Include:
    - Name
    - Cuisine or style
    - Estimated price level
    - Exact physical address
    - Why it fits that day's route
    - Official website only if returned by the search_place tool
    - Do not include generalized area-based placeholders in the final answer

    ## 📅 Day-by-Day Itinerary
    For each day include morning, afternoon, and evening.
    - Mention the neighborhood or area for each block
    - Keep pacing realistic
    - Explain transitions naturally where helpful
    - Prefer a calm and geographically coherent sequence over packing in more stops

    ## 💡 Tips and Tricks
    Write 4-6 bullets.
    Prioritize entry requirements, seasonal conditions, reservation needs, and packing essentials.
    Keep each bullet under 20 words.

    EXAMPLE OUTPUT
    ## 🌟 Introduction
    This trip keeps daily movement compact around central Asheville. It balances a practical downtown base with easy access to scenic mountain stops.

    ## 🏨 Lodging Recommendations
    - Kimpton Hotel Arras
      Type: Hotel
      Price: About $260/night
      Address: <verified address>
      Why it is convenient: Close to downtown Asheville and practical for River Arts District access
      Website: <official website only if returned by tool>
    - Haywood Park Hotel
      Type: Boutique hotel
      Price: About $240/night
      Address: <verified address>
      Why it is convenient: Walkable to central Asheville activities with low transit friction
      Website: <official website only if returned by tool>
    - Element Asheville Downtown
      Type: Hotel
      Price: About $210/night
      Address: <verified address>
      Why it is convenient: Easier budget fit near downtown activity areas
      Website: <official website only if returned by tool>

    ## 🍽️ Food & Restaurant Recommendations
    ### Day 1
    - Lunch: <verified venue> | Cuisine: Casual local lunch | Price: $ | Address: <verified address> | Why it fits: Near the River Arts District stop | Website: <official website only if returned by tool>
    - Dinner: <verified venue> | Cuisine: Grocery / prepared foods | Price: $-$$ | Address: <verified address> | Why it fits: Easy to pick up near the downtown stay area | Website: <official website only if returned by tool>

    ## 📅 Day-by-Day Itinerary
    ### Day 1
    - Morning: Explore downtown Asheville galleries and walkable blocks in Downtown Asheville
    - Afternoon: Visit River Arts District studios and nearby creative spaces
    - Evening: Sunset walk at a Blue Ridge Parkway overlook

    ## 💡 Tips and Tricks
    - Reserve popular downtown restaurants early on spring weekends.
    - Bring a light layer for cooler parkway evenings.
    - Check seasonal parkway closures before heading to overlooks.
    - Book timed-entry attractions early during peak periods.
  `;

    // Verification model options:
    // Gemini:
    // const itinerary = await generateText({
    //   provider: "gemini",
    //   model: "gemini-2.5-flash",
    //   prompt: verifyPrompt,
    //   systemInstruction: ItinerarySystemInstruction,
    //   useSearchTool: false,
    //   geminiTools: getGeminiVerificationTools(),
    // });
    //
    // OpenAI:
    // const itinerary = await generateText({
    //   provider: "openai",
    //   model: "gpt-5.1",
    //   prompt: verifyPrompt,
    //   systemInstruction: ItinerarySystemInstruction,
    //   useSearchTool: false,
    //   openaiTools: getOpenAIVerificationTools(),
    // });
    //
    // Anthropic:
    const itinerary = await generateText({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      prompt: verifyPrompt,
      systemInstruction: ItinerarySystemInstruction,
      useSearchTool: false,
      anthropicTools: getAnthropicVerificationTools(),
    });

    return sendJson(res, 200, {
      itinerary: itinerary || activityPlan,
    });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: "Server error" });
  }
}
