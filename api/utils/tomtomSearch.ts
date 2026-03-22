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

function getTomTomApiKey() {
  const apiKey = process.env.TOMTOM_SEARCH_API_KEY;
  if (!apiKey) {
    throw new Error("Missing TOMTOM_SEARCH_API_KEY");
  }
  return apiKey;
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
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `TomTom search failed with ${response.status}${details ? `: ${details}` : ""}`,
    );
  }

  const payload = await response.json();
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results.map(normalizeSearchResult);
}
