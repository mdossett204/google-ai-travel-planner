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

const TOMTOM_MIN_INTERVAL_MS = 400;
const TOMTOM_MAX_RETRIES = 3;
const TOMTOM_RETRY_BASE_DELAY_MS = 1200;
const TOMTOM_CACHE_TTL_MS = 5 * 60 * 1000;

let lastTomTomRequestAt = 0;
let tomTomQueue: Promise<void> = Promise.resolve();

const tomTomCache = new Map<
  string,
  { expiresAt: number; results: TomTomSearchResult[] }
>();

function getTomTomApiKey() {
  const apiKey = process.env.TOMTOM_SEARCH_API_KEY;
  if (!apiKey) {
    throw new Error("Missing TOMTOM_SEARCH_API_KEY");
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
  return JSON.stringify({
    query: query.trim().toLowerCase(),
    limit: limit ?? 1,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
  });
}

async function waitForTomTomSlot() {
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
    lat:
      typeof result?.position?.lat === "number" ? result.position.lat : null,
    lon:
      typeof result?.position?.lon === "number" ? result.position.lon : null,
    score: typeof result?.score === "number" ? result.score : null,
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
      console.warn("[tomtomSearch] cache-hit", {
        query: trimmedQuery,
      });
    }
    return cached.results;
  }

  const params = new URLSearchParams({
    key: getTomTomApiKey(),
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
      const payload = await response.json();
      const rawResults = Array.isArray(payload?.results) ? payload.results : [];
      results = rawResults.map(normalizeSearchResult);
      tomTomCache.set(cacheKey, {
        expiresAt: Date.now() + TOMTOM_CACHE_TTL_MS,
        results,
      });
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
