import { searchTomTom } from "./utils/tomtomSearch.js";

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
    const body = await readJsonBody(req);
    const query = typeof body?.query === "string" ? body.query : "";
    const limit =
      typeof body?.limit === "number" && body.limit > 0 ? body.limit : 5;
    const latitude =
      typeof body?.latitude === "number" ? body.latitude : undefined;
    const longitude =
      typeof body?.longitude === "number" ? body.longitude : undefined;

    if (!query.trim()) {
      return sendJson(res, 400, { error: "Missing query." });
    }

    const results = await searchTomTom({
      query,
      limit,
      latitude,
      longitude,
    });

    return sendJson(res, 200, { results });
  } catch (err: any) {
    console.error(err);
    return sendJson(res, 500, {
      error: err?.message || "TomTom search failed.",
    });
  }
}
