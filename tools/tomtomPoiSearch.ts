import { assertTomTomApiKeyConfigured, searchTomTom } from "./tomtomSearch.js";
import { readJsonBody } from "../utils/http.js";
import { validateTomTomPoiSearchRequest } from "../utils/requestValidation.js";
import { assertRedisConfigured } from "../utils/redis.js";
import {
  handleApiError,
  sendJson,
  enforcePostMethod,
  type ApiRequest,
  type ApiResponse,
} from "../utils/apiHelpers.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!enforcePostMethod(req, res)) return;

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
