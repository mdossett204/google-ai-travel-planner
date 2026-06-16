const MAX_JSON_BODY_BYTES = 32 * 1024;

export class InvalidJsonBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidJsonBodyError";
  }
}

export class RequestBodyTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestBodyTooLargeError";
  }
}

function assertBodySizeWithinLimit(byteLength: number) {
  if (byteLength > MAX_JSON_BODY_BYTES) {
    throw new RequestBodyTooLargeError(
      `Request body must be ${MAX_JSON_BODY_BYTES} bytes or smaller.`,
    );
  }
}

function parseJsonSafely(bodyText: string) {
  if (!bodyText.trim()) {
    throw new InvalidJsonBodyError("Request body is required.");
  }
  try {
    return JSON.parse(bodyText);
  } catch {
    throw new InvalidJsonBodyError("Request body must be valid JSON.");
  }
}

export async function readJsonBody(req: any) {
  const contentLength = req.headers?.["content-length"];
  if (contentLength) {
    const parsedLength = parseInt(contentLength, 10);
    if (isNaN(parsedLength) || parsedLength > MAX_JSON_BODY_BYTES) {
      throw new RequestBodyTooLargeError(
        `Request body must be valid and ${MAX_JSON_BODY_BYTES} bytes or smaller.`,
      );
    }
  }

  if (req.body) {
    if (typeof req.body === "string") {
      assertBodySizeWithinLimit(new TextEncoder().encode(req.body).byteLength);
      return parseJsonSafely(req.body);
    }

    // Body was pre-parsed by middleware (e.g. Vercel/Express). Estimate size
    // via JSON.stringify to enforce the same 32 KB guard as the streaming path.
    assertBodySizeWithinLimit(
      new TextEncoder().encode(JSON.stringify(req.body)).byteLength,
    );
    return req.body;
  }

  let totalBytes = 0;
  let body = "";
  for await (const chunk of req) {
    const chunkString =
      typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    totalBytes += new TextEncoder().encode(chunkString).byteLength;
    assertBodySizeWithinLimit(totalBytes);
    body += chunkString;
  }

  return parseJsonSafely(body);
}
