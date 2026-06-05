import { assertTomTomApiKeyConfigured, searchTomTom } from "./tomtomSearch.js";
import { readJsonBody } from "../utils/http.js";
import { validateTomTomPoiSearchRequest } from "../utils/requestValidation.js";
import { assertRedisConfigured } from "../utils/redis.js";
import {
  handleApiError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../utils/apiHelpers.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    assertTomTomApiKeyConfigured();
    assertRedisConfigured();
    const { query, limit, latitude, longitude } =
      validateTomTomPoiSearchRequest(await readJsonBody(req));

    const results = await searchTomTom({
      query,
      limit,
      latitude,
      longitude,
    });

    return sendJson(res, 200, { results });
  } catch (err: unknown) {
    return handleApiError(res, err);
  }
}
