import { getRedisClient, runFixedWindowRateLimit } from "./redis.js";

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
let tomTomQueue: Promise<void> = Promise.resolve();

const tomTomCache = new Map<
  string,
  { expiresAt: number; results: TomTomSearchResult[] }
>();

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCacheKey({
  query,
  limit,
  latitude,
  longitude,
}: TomTomSearchOptions) {
  const normalizedQuery = query
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

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
    const error: any = new Error("TomTom global rate limit exceeded");
    error.status = 429;
    throw error;
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

function normalizeSearchResult(result: any): TomTomSearchResult {
  return {
    id: result?.id || "",
    name: result?.poi?.name || "",
    address: result?.address?.freeformAddress || "",
    city: result?.address?.municipality || "",
    region: result?.address?.countrySubdivisionName || "",
    country: result?.address?.country || "",
    website: result?.poi?.url || "",
    phone: result?.poi?.phone || "",
    categories: Array.isArray(result?.poi?.categories)
      ? result.poi.categories
      : [],
    lat: typeof result?.position?.lat === "number" ? result.position.lat : null,
    lon: typeof result?.position?.lon === "number" ? result.position.lon : null,
    score: typeof result?.score === "number" ? result.score : null,
  };
}

export function isTomTomResultMatch({
  placeName,
  locationHint = "",
  result,
}: TomTomMatchOptions) {
  void placeName;
  void locationHint;

  if (!result || !result.name.trim()) {
    return false;
  }

  return true;
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
    return cached.results;
  }

  const redis = await getRedisClient();
  try {
    const redisCached = await redis.get(`tomtom:cache:${cacheKey}`);
    if (redisCached) {
      const cachedJson =
        typeof redisCached === "string"
          ? redisCached
          : redisCached.toString("utf8");
      const parsedResults = JSON.parse(cachedJson) as TomTomSearchResult[];
      if (isDebugEnabled()) {
        console.warn("[tomtomSearch] global-redis-cache-hit", {
          query: trimmedQuery,
        });
      }
      if (tomTomCache.size > 1000) tomTomCache.clear();
      tomTomCache.set(cacheKey, {
        expiresAt: Date.now() + TOMTOM_CACHE_TTL_MS,
        results: parsedResults,
      });
      return parsedResults;
    }
  } catch (err) {
    console.warn("[tomtomSearch] redis-cache-read-error", err);
  }

  const params = new URLSearchParams({
    key: assertTomTomApiKeyConfigured(),
    limit: String(limit),
  });

  if (typeof latitude === "number" && typeof longitude === "number") {
    params.set("lat", String(latitude));
    params.set("lon", String(longitude));
  }

  const encodedQuery = encodeURIComponent(trimmedQuery);
  const url = `https://api.tomtom.com/search/2/poiSearch/${encodedQuery}.json?${params.toString()}`;

  if (isDebugEnabled()) {
    console.warn("[tomtomSearch] request", {
      query: trimmedQuery,
      url,
    });
  }
  let results: TomTomSearchResult[] = [];

  for (let attempt = 0; attempt < TOMTOM_MAX_RETRIES; attempt += 1) {
    await waitForTomTomSlot();

    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (response.ok) {
      const payload = (await response.json()) as TomTomSearchResponse;
      const rawResults = Array.isArray(payload.results) ? payload.results : [];
      results = rawResults.map(normalizeSearchResult);

      // Prevent memory leaks in warm serverless containers
      if (tomTomCache.size > 1000) {
        tomTomCache.clear();
      }
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
    if (response.status !== 429 || attempt === TOMTOM_MAX_RETRIES - 1) {
      throw new Error(
        `TomTom search failed with ${response.status}${details ? `: ${details}` : ""}`,
      );
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
