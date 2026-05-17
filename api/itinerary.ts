import crypto from "crypto";
import {
  assertProviderApiKeysConfigured,
  generateText,
  generateTextWithMeta,
  calculateMaxToolCallsForTrip,
  type LlmProvider,
} from "../utils/llmRouter.js";
import { validateItineraryRequest } from "../utils/requestValidation.js";
import { readJsonBody } from "../utils/http.js";
import { getAnthropicVerificationTools } from "../tools/anthropicTools.js";
import { getGeminiVerificationTools } from "../tools/geminiTools.js";
import { getOpenAIVerificationTools } from "../tools/openaiTools.js";
import { assertTomTomApiKeyConfigured } from "../tools/tomtomSearch.js";
import { assertRedisConfigured, getRedisClient } from "../utils/redis.js";
import { formatFoodPreferences } from "../utils/foodPreferences.js";
import { formatLodgingPreferences } from "../utils/lodgingPreferences.js";
import {
  formatPreferredLocation,
  formatTravelerType,
} from "../utils/tripContext.js";

function sendJson(res: any, status: number, data: any) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
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

function sanitize(str: any) {
  return String(str || "").replace(/[<>]/g, (c) =>
    c === "<" ? "&lt;" : "&gt;",
  );
}

function getItineraryVerificationConfig(): {
  provider: LlmProvider;
  model: string;
  geminiTools?: ReturnType<typeof getGeminiVerificationTools>;
  openaiTools?: ReturnType<typeof getOpenAIVerificationTools>;
  anthropicTools?: ReturnType<typeof getAnthropicVerificationTools>;
} {
  const rawProvider = (
    process.env.ITINERARY_VERIFICATION_PROVIDER || "gemini"
  ).toLowerCase();

  if (rawProvider === "gemini") {
    return {
      provider: "gemini",
      model: process.env.ITINERARY_VERIFICATION_MODEL || "gemini-2.5-flash",
      geminiTools: getGeminiVerificationTools(),
    };
  }

  if (rawProvider === "anthropic") {
    return {
      provider: "anthropic",
      model: process.env.ITINERARY_VERIFICATION_MODEL || "claude-haiku-4-5",
      anthropicTools: getAnthropicVerificationTools(),
    };
  }

  return {
    provider: "openai",
    model: process.env.ITINERARY_VERIFICATION_MODEL || "gpt-5-nano",
    openaiTools: getOpenAIVerificationTools(),
  };
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
    assertProviderApiKeysConfigured(["gemini", "anthropic", "openai"]);
    assertTomTomApiKeyConfigured();
    assertRedisConfigured();

    const body = validateItineraryRequest(await readJsonBody(req));
    const data = body.data;
    const recommendation = body.recommendation;
    const foodPreferences = data.includeFood
      ? formatFoodPreferences(data?.foodPreferences || {})
      : "";
    const lodgingPreferences = data.includeLodging
      ? formatLodgingPreferences(data?.lodgingPreferences || {})
      : "";
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

    const durationValue = data.durationValue;
    const verificationConfig = getItineraryVerificationConfig();
    const durationDays =
      data.durationUnit === "weeks" ? Math.round(durationValue * 7) : durationValue;
    const locationRule = [
      "Keep the full trip strictly inside the requested country.",
      data.preferredLocation?.stateOrProvince?.trim()
        ? "If a state/province is provided, stay strictly inside that state/province."
        : null,
      data.preferredLocation?.city?.trim()
        ? "If a city is provided, stay strictly inside that city."
        : null,
    ]
      .filter(Boolean)
      .join(" ");

    const onLocationDays = Math.max(durationDays - 2, 0);
    const tripStructureNote =
      durationDays >= 2
        ? `Trip structure: Day 1 is primarily travel/arrival, Day ${durationDays} is primarily departure travel. Plan on-location activities mainly for Days 2 through ${Math.max(
            durationDays - 1,
            2,
          )} (=${onLocationDays} full activity days).`
        : "Trip structure: Same-day trip (travel + activities in one day). Keep it very light and realistic.";

    const draftTaskLines = [
      "Create one combined trip-planning draft that includes:",
      "1. A day-by-day activity itinerary",
      data.includeLodging ? "2. 2-3 candidate lodging options" : null,
      data.includeFood
        ? `${data.includeLodging ? "3" : "2"}. Practical daily food suggestions near the activity flow`
        : null,
    ]
      .filter(Boolean)
      .join("\n    ");

    const activityLevel = data.activityLevel || "";
    const draftPacingRules = (() => {
      switch (activityLevel) {
        case "Relaxed":
          return [
            "- Pace target: slow and spacious. Build in downtime.",
            "- Each day should have ~1 major activity and 1 lighter activity, plus a clear flexible/free-time block.",
            "- Avoid early starts, long transfers, and back-to-back ticketed items when possible.",
            "- Keep movement tight: one main area anchor per day, minimal cross-city travel.",
          ].join("\n    ");
        case "Very Active":
          return [
            "- Pace target: very active and packed, but still realistic.",
            "- Each day may include up to 3 major activities plus 1 lighter activity when geography allows.",
            "- You MUST keep point-to-point travel reasonable (cluster by neighborhood/region; avoid zig-zagging).",
            "- Do not stack multiple strenuous blocks back-to-back; add short recovery or transit-friendly gaps.",
          ].join("\n    ");
        case "Balanced":
        default:
          return [
            "- Pace target: balanced. Allow some relaxation, but days can feel fairly full.",
            "- Each day may include up to 2 major activities and 1 lighter activity.",
            "- Keep point-to-point travel reasonable by clustering activities geographically.",
          ].join("\n    ");
      }
    })();

    const verifyPacingRules = (() => {
      switch (activityLevel) {
        case "Relaxed":
          return [
            "- Respect the user's Activity Level: Relaxed.",
            "- Keep days spacious; remove any back-to-back major stops that feel rushed.",
            "- Prefer 1-2 major anchors/day max, and keep travel distances short.",
          ].join("\n    ");
        case "Very Active":
          return [
            "- Respect the user's Activity Level: Very Active.",
            "- A packed schedule is allowed, but only if point-to-point travel remains reasonable and coherent.",
            "- If activities are far apart, drop lower-value items rather than forcing unrealistic transfers.",
          ].join("\n    ");
        case "Balanced":
        default:
          return [
            "- Respect the user's Activity Level: Balanced.",
            "- Keep days fairly full but avoid unrealistic transfers or rushed sequencing.",
          ].join("\n    ");
      }
    })();

    const shouldVerifyFoodPlaces =
      data.includeFood &&
      (data.foodPreferences?.foodPriority || "") === "Major Trip Focus";
    const shouldVerifyLodgingPlaces = data.includeLodging;

    const verificationScopeRules = [
      "- Verification priority order:",
      "  1) Itinerary activities + attractions (geography + existence) first",
      shouldVerifyLodgingPlaces
        ? "  2) Lodging places next (lodging enabled)"
        : "  2) Lodging: skip entirely (lodging disabled)",
      shouldVerifyFoodPlaces
        ? "  3) Food places last (food is a Major Trip Focus)"
        : data.includeFood
          ? "  3) Food places: do NOT spend tool calls verifying (not a Major Trip Focus); keep suggestions generalized or omit"
          : "  3) Food places: skip entirely (food disabled)",
      shouldVerifyFoodPlaces
        ? "  - When verifying food and tool calls are limited, prioritize grocery stores/markets/food halls before cafes/restaurants."
        : null,
    ]
      .filter(Boolean)
      .join("\n    ");

    const outputSectionsRule = [
      shouldVerifyLodgingPlaces
        ? "- Include the Lodging Recommendations section."
        : "- Lodging is disabled: omit the Lodging Recommendations section entirely.",
      data.includeFood
        ? "- Include the Food & Restaurant Recommendations section (can be generalized unless food is a Major Trip Focus)."
        : "- Food is disabled: omit the Food & Restaurant Recommendations section entirely.",
    ].join("\n    ");

    const maxToolCalls = calculateMaxToolCallsForTrip({
      durationDays,
      activityLevel: (data.activityLevel || "") as
        | "Relaxed"
        | "Balanced"
        | "Very Active"
        | "",
      includeLodging: data.includeLodging,
      includeFood: data.includeFood,
      isFoodMajorTripFocus: shouldVerifyFoodPlaces,
    });

    const cachePayload = {
      version: 3,
      data,
      recommendation,
    };
    const cacheKey =
      "itinerary:" +
      crypto
        .createHash("sha256")
        .update(JSON.stringify(cachePayload))
        .digest("hex");
    const redis = await getRedisClient();
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return sendJson(res, 200, { itinerary: cached });
    } catch (err) {
      console.warn("[itinerary] Redis read error", err);
    }

    const draftSystemInstruction =
      "You are an elite travel concierge focused on drafting realistic trip plans before final verification. Use general destination knowledge only, avoid web search, and do not include exact addresses, URLs, or opening hours. Favor realistic pacing, geographic coherence, transportation practicality, and budget realism. Never invent precise facts to make a recommendation sound more certain than it is.";

    const ItinerarySystemInstruction =
      "You are an elite travel concierge. You must verify factual place details before including them. You are strictly forbidden from guessing or hallucinating addresses or URLs. If you cannot verify an address or URL, you must omit it. Do not provide fake or guessed links. Prefer options that maximize geographic coherence, preference fit, and realism over simply preserving draft items.";

    const draftPrompt = `
	    You are the 'Trip Planner Draft Agent'.
	    Destination: ${sanitize(recommendation.title)}
	    Preferred Location: ${preferredLocation}
	    Trip Context: ${sanitize(recommendation.description)}
	    Time of Year: ${timeOfYear}
	    Duration: ${durationValue} ${sanitize(data.durationUnit)}
	    ${tripStructureNote}
	    Travel Style: ${travelerType}
	    Primary Goal(s): <goals>${data.primaryGoal?.length > 0 ? sanitize(data.primaryGoal.join(", ")) : "Any"}</goals>
	    Activity Level: ${data.activityLevel || "Not specified"}
	    Attractions of Interest: <attractions>${sanitize(data.attractionInterests) || "None specified"}</attractions>
	    Local Transportation Preferences: ${data.localTransportation?.length > 0 ? data.localTransportation.join(", ") : "Any"}
	    Budget (Treat as upper limit, +/- 20% acceptable):
	      - Lodging: ${data.includeLodging ? `$${data.budget?.lodging || "Any"} per night` : "Not requested (omit lodging)"}
	      - Local Transportation: $${data.budget?.localTransportation || "Any"} total
	      - Food: ${data.includeFood ? `$${data.budget?.food || "Any"} per day` : "Not requested (omit food)"}
	      - Miscellaneous/Activities: $${data.budget?.misc || "Any"} total
	    ${data.includeFood ? `FOOD PREFERENCES\n	    ${foodPreferences}` : "FOOD: Not requested"}
	    ${data.includeLodging ? `\n	    LODGING PREFERENCES\n	    ${lodgingPreferences}` : "\n	    LODGING: Not requested"}

	    TASK:
	    ${draftTaskLines}

	    This is still a draft stage only. Do NOT verify facts, addresses, websites, or operating status.

	    HARD RULES:
	    - ${locationRule}
	    - Do NOT use web search in this stage. Use general destination knowledge and common travel patterns only.
	    - Interpret duration primarily as trip days. Unless the input clearly means something else, assume approximate nights = max(days - 1, 0).
	    - Day 1 should assume travel/arrival: keep plans very light and close to the arrival base area.
	    - The final day should assume departure travel: keep plans very light with a time buffer and avoid far-flung activities.
	    - Produce one itinerary day per trip day when reasonable, but keep each day appropriately light for short trips.
	    - For same-day trips, keep the evening block very light or treat it as an early wrap-up rather than a full third activity block.
	    ${draftPacingRules}
	    - A major activity is usually a primary sightseeing stop, hike, museum, guided visit, or destination anchor that can take roughly 2-4 hours.
	    - A lighter activity is usually a scenic walk, waterfront break, market browsing, park time, viewpoint stop, neighborhood wandering, or flexible free-exploration block that can take roughly 45-90 minutes.
	    - Avoid scheduling two strenuous activity blocks on the same day. If one block is strenuous, the remaining blocks that day should be moderate or easy.
	    - Each day should revolve around one main area anchor with short, practical movement between blocks.
	    - Group activities by the same neighborhood or nearby areas. Avoid backtracking and long cross-region jumps.
    - Each day should feel meaningfully different from the previous day in at least one dimension: area anchor, activity type, or energy level.
    - Let the traveler type shape the tone and pacing. For example, couples may benefit from more scenic, atmospheric, or leisurely transitions, while families or groups may need simpler logistics and lower friction.
    - Local transportation preferences should shape the plan. Favor compact, locally explorable areas and practical movement on foot, transit, or short rides unless longer travel is clearly justified.
    - If the stated local transportation preference is a poor fit for the destination, quietly adapt the daily movement style to the most practical local option without changing the overall trip character.
    - Do not recommend activities that are clearly implausible for the season, trip length, or traveler type.
    - Include at least one breathing-space or scenic/light block per day when possible.
	    - If attraction interests are provided, treat broad categories such as parks, museums, or viewpoints as preference signals, and treat named attractions as specific requests. Only include them if they genuinely fit the requested destination and the daily geography.
	    - Do not force filler attractions. If a day would otherwise feel thin, use a scenic stroll, waterfront time, old-town wandering, park time, market browsing, or free exploration block instead.
	    - If there are not enough strong activities for a full day, reduce intensity and use fewer, better-spaced blocks rather than padding the itinerary.
	    ${
        data.includeLodging
          ? [
              "- Choose lodging after considering the overall attraction geography.",
              "- Lodging should be central to the activity areas already listed and should reduce daily transit friction.",
              "- Recommend 2-3 lodging options only. Across lodging options, vary at least one of: neighborhood, price tier, or property type.",
              "- Lodging should be specific named properties only when they are well-known and plausible.",
              "- Use lodging preferences as soft guidance unless they clearly conflict with geography or budget reality.",
            ].join("\n    ")
          : "- Lodging is disabled: do NOT include lodging options."
      }
		    ${
        data.includeFood
          ? [
              "- Restaurant/cafe/grocery choices must be geographically close to the same day's activities or the stay area for that night.",
              "- Respect dietary restrictions precisely as hard constraints.",
              "- Treat cuisine interests and dining style as soft preferences that should guide the tone of the recommendations.",
              "- Let food priority control how strongly food shapes the plan: if food priority is \"Major Trip Focus\", give food suggestions more weight; if it is \"Nice to Have\", balance food with geography; if it is \"Not Important\", prioritize geography and logistics first.",
            ].join("\n    ")
          : "\n    - Food is disabled: do NOT include food suggestions."
      }
		    ${
          data.includeFood
            ? [
                "- Keep food recommendations general at the venue or style level. Do not describe specific dishes or menu items in this stage.",
                "- Food suggestions may be either specific well-known venues or generalized area-based options when specificity is uncertain.",
                "- If confidence is low on a specific food venue, choose a generalized area-based option rather than inventing precise details.",
                "- Use food price tiers consistently: $ = under $15 per person, $$ = $15-$35 per person, $$$ = over $35 per person.",
                "- Distribute the daily food budget roughly across meals as follows when all three are recommended: 20% breakfast, 35% lunch, 45% dinner.",
                "- Breakfast is the first meal to skip if the day does not support three strong food recommendations.",
                "- You may recommend a local grocery store, market, or specialty food hall when that fits the budget, dietary needs, or logistics better than a restaurant.",
                "- If a meal recommendation is skipped, include a short reason explaining why skipping is more practical.",
                "- If cuisine interests conflict with geography, dietary restrictions, or budget, prioritize geography and dietary safety first.",
                "- If the area has limited strong options, recommend fewer but better-fitting choices rather than forcing weak ones.",
              ].join("\n    ")
            : ""
        }
		    ${
          data.includeLodging
            ? [
                "- If confidence is low on a specific lodging property, choose a best-known plausible named property rather than inventing details.",
                "- If no plausible named lodging property is appropriate, choose a well-known hotel brand or a central, commonly used property type in the area.",
                "- If the budget is tight, prefer simpler but well-located options over aspirational ones that add transit friction.",
                "- If the requested location and budget are in tension, keep the location fixed and move downmarket first: prefer simpler lodging, fewer paid meal recommendations, grocery options, and more transit-efficient choices before drifting outside the requested area.",
              ].join("\n    ")
            : ""
        }
	    - Do not include exact addresses, websites, opening hours, operating-status claims, or verification commentary in this stage.

	    OUTPUT FORMAT:
    Return plain text only in this exact structure:

    ACTIVITY PLAN
    DAY 1
    Area Anchor: <main neighborhood or area>
    Morning: <specific activity> | Area: <neighborhood> | Pace: <easy/moderate/strenuous> | Why it fits: <one short clause>
    Afternoon: <specific activity> | Area: <neighborhood> | Pace: <easy/moderate/strenuous> | Why it fits: <one short clause>
    Evening: <specific activity or light free-time block> | Area: <neighborhood> | Pace: <easy/moderate/strenuous> | Why it fits: <one short clause>
    Daily Flow Note: <one sentence explaining why the sequence is geographically and emotionally relaxing>

    LODGING OPTIONS
    - <Property Name> | Type: <hotel/boutique hotel/vacation rental/etc.> | Price: <estimated nightly price> | Area: <neighborhood> | Why convenient: <=12 words, must reference proximity to key activity area(s)> | Confidence: <high/medium/low>
    - <Property Name> | Type: <hotel/boutique hotel/vacation rental/etc.> | Price: <estimated nightly price> | Area: <neighborhood> | Why convenient: <=12 words, must reference proximity to key activity area(s)> | Confidence: <high/medium/low>

    DAY 1 FOOD
    - Breakfast: <name or "Skip recommendation"> | Cuisine: <type or "N/A"> | Price: <estimated price or "N/A"> | Near: <activity or area> | Diet fit: <≤8 words, explicitly referencing dietary constraint or flexibility> | Skip reason: <short reason, <=12 words, or "N/A"> | Confidence: <high/medium/low>
    - Lunch: <name or "Skip recommendation"> | Cuisine: <type or "N/A"> | Price: <estimated price or "N/A"> | Near: <activity or area> | Diet fit: <≤8 words, explicitly referencing dietary constraint or flexibility> | Skip reason: <short reason, <=12 words, or "N/A"> | Confidence: <high/medium/low>
    - Dinner: <name or "Skip recommendation"> | Cuisine: <type or "N/A"> | Price: <estimated price or "N/A"> | Near: <activity or area> | Diet fit: <≤8 words, explicitly referencing dietary constraint or flexibility> | Skip reason: <short reason, <=12 words, or "N/A"> | Confidence: <high/medium/low>

    Repeat the DAY N blocks as needed. Do not include markdown headings or any other prose.
  `;

    const draftPlan = await generateText({
      provider: "gemini",
      model: "gemini-2.5-flash",
      prompt: draftPrompt,
      systemInstruction: draftSystemInstruction,
      useSearchTool: false,
    });

    const verifyPrompt = `
    You are the 'Verification & Formatting Concierge Agent'.
    Here is the combined trip-planning draft:
    ${draftPlan}

	    Your task is to FACT-CHECK, VERIFY GEOGRAPHY, REMOVE WEAK ITEMS, and FORMAT the final itinerary.

		    HARD RULES:
		    ${verificationScopeRules}
		    - Only use the search_place tool for specific named hotels, restaurants, grocery stores, markets, food halls, or attractions that you are considering keeping in the final answer.
	    - Do NOT call the tool for generalized area-based food suggestions such as "casual cafes near Shinjuku Station". Either replace them with a verified specific place or omit them.
	    - Use the tool only when needed. Do not verify every draft item automatically.
	    - First remove weak, redundant, low-fit, or obviously vague draft items without searching.
	    - Then verify the strongest likely keepers.
	    - Only search for replacements when an important slot still needs a specific verified place.
	    - Use as few tool calls as needed to produce a strong final itinerary.
	    - Keep the trip strictly inside the requested preferred location.
	    - Verify that every final attraction exists and appears to be currently operating.
	    ${
        shouldVerifyFoodPlaces
          ? "- Verify that every final restaurant/cafe/grocery store/market/food hall exists and appears to be currently operating."
          : data.includeFood
            ? "- Food is not a Major Trip Focus: do NOT spend tool calls verifying food venues; keep food suggestions generalized or omit."
            : "- Food is disabled: do not include any food venues."
      }
	    ${
        shouldVerifyLodgingPlaces
          ? "- Verify that every final lodging option exists and appears to be currently operating."
          : "- Lodging is disabled: do not include any lodging options."
      }
	    - Treat a place as verified only if the tool returns a clear, matching entity with consistent name and location. If results are ambiguous or weakly matching, omit or replace.
	    - Prefer verified named properties and venues. Drop anything that remains unverified or too vague after review.
	    - Remove or replace anything that seems fake, closed, duplicated, too far away, or not meaningfully aligned with the user preferences.
	    - Do not include any guessed or unverified website.
    - Only include a website if it comes directly from the search_place tool result.
    - If the search_place tool does not return a website, omit the website entirely.
    - Copy the website exactly as returned by the tool. Do not modify, shorten, or reformat it.
		    - Never invent, infer, rewrite, or supplement a website from model memory or general search.
	    - For verified attractions/activities, you MAY include an official website only if it is returned directly by the search_place tool.
	    - Do NOT include assistant-y closing offers like "If you'd like, I can...". Output only the itinerary.
		    ${verifyPacingRules}
	    - Do not add activities beyond what was in the draft plan.
	    - Only edit activities for clarity, pacing notes, or geographic corrections.
	    - Limit each day to a realistic number of major activities for the chosen Activity Level, prioritizing flow over coverage.
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
	    - Deduplicate across days when possible. However, repeating the same grocery store, market, or food hall across multiple days is acceptable when it is practical for logistics or budget.
	    - Avoid repeating the same hotel rationale unless repetition is clearly the most practical choice.
	    - If a detail is uncertain, omit it instead of inventing it.
	    - If tool results contradict the draft plans, trust the tool results and correct the itinerary.
	    - Clearly label verification status for named places you include:
	      - If you verified via tool, append "(Verified)".
	      - If you did NOT verify, append "(Not verified)" and do not include address/website.

	    INPUT INTERPRETATION:
	    - Lodging entries may include type and confidence. Preserve useful type information when it helps the user compare options.
	    - Food entries may be specific venues, grocery/market options, or generalized area-based suggestions.
	    - Generalized area-based food suggestions should not appear in the final answer unless replaced by a verified specific venue.
	    - Grocery stores, markets, and food halls are allowed in the final answer if they are verified specific places and make practical sense.
	    - Grocery-style recommendations may repeat across days if they are convenient (e.g., near the stay area).
	    - Skip recommendations are allowed in draft planning, but the final answer should prefer verified specific lunch and dinner options when possible.

	    CRITICAL:
	    - Do NOT output the raw planning notes.
	    - Output ONLY the final unified Markdown itinerary.
	    - Keep the writing concise, useful, and specific.
	    ${outputSectionsRule}

	    Return the final Markdown using this exact structure:

	    ## 🌟 Introduction
	    Write 2-3 sentences only explaining why this trip fits the travel goals, season, and pace.

	    ${
        shouldVerifyLodgingPlaces
          ? "## 🏨 Lodging Recommendations"
          : "## 🏨 Lodging Recommendations (Omit — lodging disabled)"
      }
	    List 2-3 lodging options. For each option include:
	    - Name
	    - Property type when useful
	    - Estimated nightly price
	    - Exact physical address
    - Why the location is convenient
		    - Official website only if returned by the search_place tool

		    ${
        data.includeFood
          ? `## 🍽️ Food & Restaurant Recommendations
		    Organize food suggestions by day. For each day, recommend practical nearby options that match the structured food preferences. Include:
		    - Name
		    - Cuisine or style
		    - Estimated price level
		    ${
          shouldVerifyFoodPlaces
            ? [
                "- Exact physical address",
                "- Why it fits that day's route",
                "- Official website only if returned by the search_place tool",
                "- Do not include generalized area-based placeholders in the final answer",
              ].join("\n    ")
            : [
                "- If you did not verify a venue, do NOT include an address or website; keep it generalized by neighborhood/area.",
                "- Prefer grocery/market-style suggestions when they fit budget and logistics.",
              ].join("\n    ")
        }`
          : ""
      }

	    ## 📅 Day-by-Day Itinerary
	    For each day include morning, afternoon, and evening.
	    - Mention the neighborhood or area for each block
	    - Keep pacing realistic
	    - Explain transitions naturally where helpful
	    - Prefer a calm and geographically coherent sequence over packing in more stops
	    - If a specific named attraction is verified and a website is returned by the tool, include it inline as: Website: <official website>
	    - Add a bit more detail per block: 1-2 sentences describing what you'll do, why it fits, and any practical note (timing, reservations, or an easy alternative).

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

	    ${
        data.includeFood
          ? `## 🍽️ Food & Restaurant Recommendations
	    ### Day 1
	    - Lunch: <verified venue> | Cuisine: Casual local lunch | Price: $ | Address: <verified address> | Why it fits: Near the River Arts District stop | Website: <official website only if returned by tool>
	    - Dinner: <verified venue> | Cuisine: Grocery / prepared foods | Price: $-$$ | Address: <verified address> | Why it fits: Easy to pick up near the downtown stay area | Website: <official website only if returned by tool>`
          : ""
      }

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

    const verificationResult = await generateTextWithMeta({
      provider: verificationConfig.provider,
      model: verificationConfig.model,
      prompt: verifyPrompt,
      systemInstruction: ItinerarySystemInstruction,
      useSearchTool: false,
      geminiTools: verificationConfig.geminiTools,
      openaiTools: verificationConfig.openaiTools,
      anthropicTools: verificationConfig.anthropicTools,
      maxToolCalls,
    });

    const verifiedItinerary = verificationResult.text.trim();
    const finalItinerary = verifiedItinerary || draftPlan;

    if (verifiedItinerary && !verificationResult.usedFallback) {
      redis
        .set(cacheKey, verifiedItinerary, {
          EX: 86400 * 7, // Cache successfully verified trips for 7 days
        })
        .catch((err) => console.warn("[itinerary] Redis write error", err));
    }

    return sendJson(res, 200, {
      itinerary: finalItinerary,
    });
  } catch (err: any) {
    console.error(err);
    if (err?.name === "RequestValidationError") {
      return sendJson(res, 400, { error: err.message });
    }
    if (err?.name === "InvalidJsonBodyError") {
      return sendJson(res, 400, { error: err.message });
    }
    if (err?.name === "RequestBodyTooLargeError") {
      return sendJson(res, 413, { error: err.message });
    }
    if (err?.name === "LlmConfigurationError") {
      return sendJson(res, 500, { error: err.message });
    }
    if (err?.name === "TomTomConfigurationError") {
      return sendJson(res, 500, { error: err.message });
    }
    if (
      err?.name === "RedisConfigurationError" ||
      err?.name === "RedisConnectionError"
    ) {
      return sendJson(res, 500, { error: err.message });
    }
    if (err?.status === 429 || err?.message?.includes("rate limit")) {
      return sendJson(res, 429, {
        error: "Our AI is currently busy. Please wait a moment and try again!",
      });
    }
    return sendJson(res, 500, { error: "Server error" });
  }
}
