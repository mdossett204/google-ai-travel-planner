import {
  assertTomTomApiKeyConfigured,
  searchTomTom,
  TomTomConfigurationError,
} from "./utils/tomtomSearch.js";
import {
  RequestValidationError,
  validateTomTomPoiSearchRequest,
} from "./utils/requestValidation.js";

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
    if (err instanceof RequestValidationError) {
      return sendJson(res, 400, { error: err.message });
    }
    if (err instanceof TomTomConfigurationError) {
      return sendJson(res, 500, { error: err.message });
    }
    return sendJson(res, 500, {
      error: err?.message || "TomTom search failed.",
    });
  }
}
