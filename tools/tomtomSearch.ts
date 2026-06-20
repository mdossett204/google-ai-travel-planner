import { getRedisClient, runFixedWindowRateLimit } from "../utils/redis.js";
import { sleep } from "../utils/apiHelpers.js";

export interface TomTomSearchOptions {
  query: string;
  limit?: number;
  latitude?: number;
  longitude?: number;
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
}: TomTomSearchOptions) {
  const normalizedQuery = normalizeUnicode(query).replace(/[^a-z0-9]+/g, " ");

  return JSON.stringify({
    query: normalizedQuery,
    limit: limit ?? 1,
    lat: typeof latitude === "number" ? Number(latitude.toFixed(2)) : null,
    lon: typeof longitude === "number" ? Number(longitude.toFixed(2)) : null,
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

function normalizeForMatch(s: string): string {
  return normalizeUnicode(s).replace(/[^a-z0-9\s]/g, "");
}

export function isTomTomResultMatch({
  placeName,
  locationHint,
  result,
}: TomTomMatchOptions) {
  if (!result || !result.name.trim()) {
    return false;
  }

  const normalizedPlace = normalizeForMatch(placeName);
  const normalizedResult = normalizeForMatch(result.name);

  if (!normalizedPlace) return false;

  const placeTokens = normalizedPlace.split(/\s+/).filter(Boolean);
  const resultTokens = normalizedResult.split(/\s+/).filter(Boolean);

  if (placeTokens.length === 0 || resultTokens.length === 0) return false;

  // 1. Strict Name Match: Token overlap must be strictly > 50%
  const intersection = placeTokens.filter((t) => resultTokens.includes(t));
  const overlapRatio = intersection.length / placeTokens.length;

  let isNameMatch = overlapRatio > 0.5;

  // Substring fallback for single-word queries matching multi-word results
  // e.g. "Louvre" matches "The Louvre Museum"
  if (
    !isNameMatch &&
    placeTokens.length === 1 &&
    normalizedResult.includes(normalizedPlace)
  ) {
    isNameMatch = true;
  }

  if (!isNameMatch) return false;

  // 2. Geographic Match
  if (locationHint) {
    const hintTokens = normalizeForMatch(locationHint)
      .split(/\s+/)
      .filter((t) => t.length > 1); // Ignore single letters

    if (hintTokens.length > 0) {
      const geoString = normalizeForMatch(
        [result.city, result.region, result.country, result.address].join(" "),
      );

      // The result must contain at least one significant word from the location hint
      const hasGeoMatch = hintTokens.some((t) => geoString.includes(t));
      if (!hasGeoMatch) return false;
    }
  }

  return true;
}

export async function executeSearchPlace(
  args: Record<string, unknown>,
  debugLabel: string,
): Promise<Record<string, unknown>> {
  const placeName = typeof args.name === "string" ? args.name.trim() : "";
  const locationHint =
    typeof args.locationHint === "string" ? args.locationHint.trim() : "";

  if (!placeName) {
    return {
      ok: false,
      error: "Missing required argument: name",
    };
  }

  const query = [placeName, locationHint].filter(Boolean).join(" ");
  const results = await searchTomTom({ query, limit: 1 });
  const result = results[0] || null;
  const isMatch = isTomTomResultMatch({ placeName, locationHint, result });

  if (isDebugEnabled()) {
    console.warn(`[${debugLabel}] search_place-result`, {
      query,
      isMatch,
      result,
    });
  }

  if (!isMatch) {
    return {
      ok: false,
      query,
      error:
        "Top search result did not match the requested place closely enough.",
      result: null,
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

  const encodedQuery = encodeURIComponent(trimmedQuery);
  const safeUrl = `https://api.tomtom.com/search/2/poiSearch/${encodedQuery}.json?${safeParams.toString()}`;
  const fetchUrl = `${safeUrl}&key=${apiKey}`;

  if (isDebugEnabled()) {
    console.warn("[tomtomSearch] request", {
      query: trimmedQuery,
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
