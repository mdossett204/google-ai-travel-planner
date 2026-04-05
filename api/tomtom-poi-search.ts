import { assertTomTomApiKeyConfigured, searchTomTom } from "./utils/tomtomSearch.js";
import { readJsonBody } from "./utils/http.js";
import { validateTomTomPoiSearchRequest } from "./utils/requestValidation.js";
import { assertRedisConfigured } from "./utils/redis.js";

function sendJson(res: any, status: number, data: any) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
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
    if (err?.name === "TomTomConfigurationError") {
      return sendJson(res, 500, { error: err.message });
    }
    if (
      err?.name === "RedisConfigurationError" ||
      err?.name === "RedisConnectionError"
    ) {
      return sendJson(res, 500, { error: err.message });
    }
    return sendJson(res, 500, { error: "Server error" });
  }
}
