import { getRedisClient, runFixedWindowRateLimit } from "../utils/redis.js";
import { sleep } from "../utils/apiHelpers.js";

export interface TomTomSearchOptions {
  query: string;
  limit?: number;
  latitude?: number;
  longitude?: number;
  countryCode?: string;
}

export interface TomTomSearchResult {
  id: string;
  name: string;
  address: string;
  city: string;
  region: string;
  country: string;
  website: string;
  phone: string;
  categories: string[];
  lat: number | null;
  lon: number | null;
  score: number | null;
}

interface TomTomSearchResponse {
  results?: unknown[];
}

interface TomTomMatchOptions {
  placeName: string;
  locationHint?: string;
  result: TomTomSearchResult | null;
}

const TOMTOM_MIN_INTERVAL_MS = 400;
const TOMTOM_MAX_RETRIES = 3;
const TOMTOM_RETRY_BASE_DELAY_MS = 1200;
const TOMTOM_CACHE_TTL_MS = 5 * 60 * 1000;
const TOMTOM_REDIS_CACHE_TTL_SEC = 30 * 24 * 60 * 60; // 30 days

let lastTomTomRequestAt = 0;
// Serverless note: This queue limits concurrency per function instance, not globally across all instances.
let tomTomQueue: Promise<void> = Promise.resolve();

const tomTomCache = new Map<
  string,
  { expiresAt: number; results: TomTomSearchResult[] }
>();

function evictLeastRecentlyUsed() {
  if (tomTomCache.size <= 1000) return;

  const entriesToDelete = Math.ceil(tomTomCache.size * 0.2); // Remove LRU 20%
  let deletedCount = 0;
  for (const key of tomTomCache.keys()) {
    tomTomCache.delete(key);
    deletedCount++;
    if (deletedCount >= entriesToDelete) break;
  }
}

export class TomTomConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TomTomConfigurationError";
  }
}

export function assertTomTomApiKeyConfigured() {
  const apiKey = process.env.TOMTOM_SEARCH_API_KEY;
  if (!apiKey?.trim()) {
    throw new TomTomConfigurationError(
      "Server configuration error: missing TOMTOM_SEARCH_API_KEY.",
    );
  }
  return apiKey;
}

function isDebugEnabled() {
  return process.env.DEBUG_LLM_ROUTER === "true";
}

function normalizeUnicode(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function buildCacheKey({
  query,
  limit,
  latitude,
  longitude,
  countryCode,
}: TomTomSearchOptions) {
  const normalizedQuery = normalizeUnicode(query).replace(/[^a-z0-9]+/g, " ");

  return JSON.stringify({
    query: normalizedQuery,
    limit: limit ?? 1,
    lat: typeof latitude === "number" ? Number(latitude.toFixed(2)) : null,
    lon: typeof longitude === "number" ? Number(longitude.toFixed(2)) : null,
    countryCode: countryCode || null,
  });
}

async function waitForTomTomSlot() {
  const success = await runFixedWindowRateLimit("tomtom-global-limit", 5, 1);
  if (!success) {
    throw Object.assign(new Error("TomTom global rate limit exceeded"), {
      status: 429,
    });
  }

  const previous = tomTomQueue;
  let release!: () => void;
  tomTomQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;

  const elapsed = Date.now() - lastTomTomRequestAt;
  const waitMs = Math.max(0, TOMTOM_MIN_INTERVAL_MS - elapsed);
  if (waitMs > 0) {
    await sleep(waitMs);
  }

  lastTomTomRequestAt = Date.now();
  release();
}

function normalizeSearchResult(rawResult: unknown): TomTomSearchResult {
  const result = rawResult as Record<string, unknown>;
  const poi = (result?.poi || {}) as Record<string, unknown>;
  const address = (result?.address || {}) as Record<string, unknown>;
  const position = (result?.position || {}) as Record<string, unknown>;

  return {
    id: (result?.id as string) || "",
    name: (poi?.name as string) || "",
    address: (address?.freeformAddress as string) || "",
    city: (address?.municipality as string) || "",
    region: (address?.countrySubdivisionName as string) || "",
    country: (address?.country as string) || "",
    website: (poi?.url as string) || "",
    phone: (poi?.phone as string) || "",
    categories: Array.isArray(poi?.categories) ? poi.categories : [],
    lat: typeof position?.lat === "number" ? position.lat : null,
    lon: typeof position?.lon === "number" ? position.lon : null,
    score: typeof result?.score === "number" ? result.score : null,
  };
}

function getLevenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

  for (let i = 0; i <= a.length; i++) {
    matrix[0][i] = i;
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[j][0] = j;
  }

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1, // deletion
        matrix[j - 1][i] + 1, // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }
  return matrix[b.length][a.length];
}

function getStringSimilarity(a: string, b: string): number {
  const distance = getLevenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);
  return maxLength === 0 ? 1 : (maxLength - distance) / maxLength;
}

function normalizeForMatch(s: string): string {
  const SYNONYMS: Record<string, string> = {
    mt: "mount",
    ave: "avenue",
    rd: "road",
    blvd: "boulevard",
    hwy: "highway",
    pkwy: "parkway",
    dr: "drive",
    ln: "lane",
  };

  const normalized = normalizeUnicode(s)
    .replace(/'/g, "") // Strip apostrophes first
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized
    .split(/\s+/)
    .map((token) => SYNONYMS[token] || token)
    .join(" ");
}

const STOP_WORDS = new Set(["the", "a", "an", "of", "at", "in", "on", "and", "to", "for"]);

export function scoreTomTomResultMatch({
  placeName,
  locationHint,
  result,
}: TomTomMatchOptions): number {
  if (!result || !result.name.trim()) return 0;

  const normalizedPlace = normalizeForMatch(placeName);
  const normalizedResult = normalizeForMatch(result.name);
  if (!normalizedPlace) return 0;

  const placeTokens = Array.from(new Set(normalizedPlace.split(/\s+/).filter((t) => t && !STOP_WORDS.has(t))));
  const resultTokens = Array.from(new Set(normalizedResult.split(/\s+/).filter((t) => t && !STOP_WORDS.has(t))));
  if (placeTokens.length === 0 || resultTokens.length === 0) return 0;

  const hintTokens = locationHint
    ? normalizeForMatch(locationHint)
        .split(/\s+/)
        .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
    : [];

  // 1. Geographic Match (Must Pass first)
  if (hintTokens.length > 0) {
    const geoTokens = normalizeForMatch(
      [result.city, result.region, result.country, result.address].join(" "),
    ).split(/\s+/).filter(Boolean);

    // Require at least 60% of hint tokens to be found (via exact match, substring, or high similarity)
    let geoMatchCount = 0;
    for (const ht of hintTokens) {
      if (geoTokens.some((gt) => {
        const isSubstring = gt.includes(ht) || ht.includes(gt);
        const validSubstring = isSubstring && Math.min(gt.length, ht.length) >= 2;
        return getStringSimilarity(ht, gt) >= 0.8 || validSubstring;
      })) {
        geoMatchCount++;
      }
    }
    
    const hasGeoMatch = (geoMatchCount / hintTokens.length) >= 0.6;
    if (!hasGeoMatch) return 0;
  }

  // 2. Name Score Calculation (Fuzzy Sørensen–Dice coefficient)
  let matchScoreSum = 0;
  for (const pt of placeTokens) {
    let bestSim = 0;
    for (const rt of resultTokens) {
      let sim = getStringSimilarity(pt, rt);
      // Boost substring matches if the matching portion is long enough
      if (rt.includes(pt) || pt.includes(rt)) {
        if (Math.min(pt.length, rt.length) >= 4) {
          sim = Math.max(sim, 0.9);
        }
      }
      if (sim > bestSim) bestSim = sim;
    }
    matchScoreSum += bestSim;
  }

  let fuzzyDice = (2 * matchScoreSum) / (placeTokens.length + resultTokens.length);
  
  // If user's entire query is found in the result strongly, ensure score passes threshold.
  // To prevent false positives on short queries (e.g., "Belleville" matching "Garage Mecanique Belleville Paris"),
  // we only apply this boost if the result doesn't have an excessive number of extra words.
  if (matchScoreSum / placeTokens.length > 0.8) {
    const allowedResultTokens = placeTokens.length * 2 + 1;
    if (resultTokens.length <= allowedResultTokens) {
      fuzzyDice = Math.max(fuzzyDice, (matchScoreSum / placeTokens.length) * 0.8);
    }
  }

  let score = fuzzyDice * 100;

  // Tie-breaker: If results tie on the main name (e.g. all score 0), 
  // give a tiny bonus for locationHint words that appear in the result's name.
  let tieBreaker = 0;
  if (hintTokens.length > 0) {
    const hintOverlap = hintTokens.filter((t) => resultTokens.some((rt) => getStringSimilarity(t, rt) >= 0.8));
    
    // Penalize the result if it adds extra words (like "North") that weren't in the hint or name
    const resultHintUnique = resultTokens.filter(
      (rt) => !hintTokens.some((t) => getStringSimilarity(t, rt) >= 0.8) && !placeTokens.some((pt) => getStringSimilarity(pt, rt) >= 0.8),
    );

    // +0.1 for overlapping words, -0.2 for conflicting extra words
    tieBreaker = hintOverlap.length * 0.1 - resultHintUnique.length * 0.2; 
  }

  score = Math.max(0, score);
  return score + tieBreaker;
}

export async function executeSearchPlace(
  args: Record<string, unknown>,
  debugLabel: string,
): Promise<Record<string, unknown>> {
  const placeName = typeof args.name === "string" ? args.name.trim() : "";
  const locationHint =
    typeof args.locationHint === "string" ? args.locationHint.trim() : "";
  const countryCode =
    typeof args.countryCode === "string" ? args.countryCode.trim() : undefined;

  if (!placeName) {
    return {
      ok: false,
      error: "Missing required argument: name",
    };
  }

  const query = [placeName, locationHint].filter(Boolean).join(" ");
  const results = await searchTomTom({ query, limit: 3, countryCode });
  
  let matchResult = null;
  let bestPassingScore = -1;
  const MIN_SCORE = 60;

  let absoluteBestResult = results[0] || null;
  let absoluteBestScore = -1;

  for (const res of results) {
    const score = scoreTomTomResultMatch({ placeName, locationHint, result: res });
    
    // Track the absolute best result even if it fails the threshold, to use as a smarter fallback
    if (score > absoluteBestScore) {
      absoluteBestScore = score;
      absoluteBestResult = res;
    }

    if (score > bestPassingScore && score >= MIN_SCORE) {
      bestPassingScore = score;
      matchResult = res;
    }
  }

  const isMatch = matchResult !== null;
  // If we found a passing match, use it. Otherwise, fallback to the highest scoring failure.
  const result = matchResult || absoluteBestResult;

  if (isDebugEnabled()) {
    console.warn(`[${debugLabel}] search_place-result`, {
      query,
      isMatch,
      matchedResult: matchResult,
      top3Results: results.map((r) => r.name),
      bestResult: result,
    });
  }

  if (!isMatch) {
    return {
      ok: false,
      query,
      error:
        "None of the top search results matched the requested place closely enough.",
      result: null,
      bestFallbackResult: result,
    };
  }

  return {
    ok: true,
    query,
    result,
  };
}

export async function searchTomTom({
  query,
  limit = 1,
  latitude,
  longitude,
  countryCode,
}: TomTomSearchOptions): Promise<TomTomSearchResult[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error("TomTom search requires a query.");
  }

  const cacheKey = buildCacheKey({
    query: trimmedQuery,
    limit,
    latitude,
    longitude,
  });
  const cached = tomTomCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (isDebugEnabled()) {
      console.warn("[tomtomSearch] local-cache-hit", {
        query: trimmedQuery,
        countryCode,
      });
    }
    // LRU Trick: Delete and immediately re-set to bump it to the end of the Map
    tomTomCache.delete(cacheKey);
    tomTomCache.set(cacheKey, cached);
    return cached.results;
  }

  const redis = await getRedisClient();
  try {
    const redisCached = await redis.get(`tomtom:cache:${cacheKey}`);
    if (redisCached) {
      const cachedJson = String(redisCached);
      const parsedResults = JSON.parse(cachedJson) as TomTomSearchResult[];
      if (isDebugEnabled()) {
        console.warn("[tomtomSearch] global-redis-cache-hit", {
          query: trimmedQuery,
          countryCode,
        });
      }
      evictLeastRecentlyUsed();
      tomTomCache.set(cacheKey, {
        expiresAt: Date.now() + TOMTOM_CACHE_TTL_MS,
        results: parsedResults,
      });
      return parsedResults;
    }
  } catch (err) {
    console.warn("[tomtomSearch] redis-cache-read-error", err);
  }

  const apiKey = assertTomTomApiKeyConfigured();
  const safeParams = new URLSearchParams({
    limit: String(limit),
  });

  if (typeof latitude === "number" && typeof longitude === "number") {
    safeParams.set("lat", String(latitude));
    safeParams.set("lon", String(longitude));
  }

  if (countryCode) {
    safeParams.set("countrySet", countryCode);
  }

  const encodedQuery = encodeURIComponent(trimmedQuery);
  const safeUrl = `https://api.tomtom.com/search/2/poiSearch/${encodedQuery}.json?${safeParams.toString()}`;
  const fetchUrl = `${safeUrl}&key=${apiKey}`;

  if (isDebugEnabled()) {
    console.warn("[tomtomSearch] request", {
      query: trimmedQuery,
      countryCode,
      url: safeUrl,
    });
  }
  let results: TomTomSearchResult[] = [];

  for (let attempt = 0; attempt < TOMTOM_MAX_RETRIES; attempt += 1) {
    await waitForTomTomSlot();

    let response: Response;
    try {
      response = await fetch(fetchUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
    } catch (networkError) {
      const errorMessage =
        networkError instanceof Error
          ? networkError.message
          : String(networkError);
      const safeMessage = errorMessage.split(apiKey).join("***REDACTED***");

      console.error(
        "[tomtomSearch] network error:",
        safeMessage,
        "for URL:",
        safeUrl,
      );

      // Catch low-level crashes to prevent the raw URL and API key from leaking into stack traces
      throw new Error(
        "A network error occurred while connecting to the TomTom API.",
      );
    }

    if (response.ok) {
      const payload = (await response.json()) as TomTomSearchResponse;
      const rawResults = Array.isArray(payload.results) ? payload.results : [];
      results = rawResults.map((r) => normalizeSearchResult(r));

      evictLeastRecentlyUsed();
      tomTomCache.set(cacheKey, {
        expiresAt: Date.now() + TOMTOM_CACHE_TTL_MS,
        results,
      });

      redis
        .set(`tomtom:cache:${cacheKey}`, JSON.stringify(results), {
          EX: TOMTOM_REDIS_CACHE_TTL_SEC,
        })
        .catch((err) => console.warn("Redis set error:", err));
      break;
    }

    const details = await response.text().catch(() => "");
    const isRetryable =
      response.status === 429 ||
      (response.status >= 500 && response.status <= 504);
    if (!isRetryable || attempt === TOMTOM_MAX_RETRIES - 1) {
      console.error(`[tomtomSearch] API Error ${response.status}:`, details);
      throw new Error(`TomTom search failed with status ${response.status}`);
    }

    const delayMs = TOMTOM_RETRY_BASE_DELAY_MS * 2 ** attempt;
    if (isDebugEnabled()) {
      console.warn("[tomtomSearch] rate-limit-retry", {
        query: trimmedQuery,
        attempt: attempt + 1,
        delayMs,
      });
    }
    await sleep(delayMs);
  }

  if (isDebugEnabled()) {
    console.warn("[tomtomSearch] response", {
      query: trimmedQuery,
      resultCount: results.length,
      firstResultName: results[0]?.name || null,
    });
  }

  return results;
}
