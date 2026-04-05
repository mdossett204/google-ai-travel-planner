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

export async function readJsonBody(req: any) {
  if (req.body) {
    if (typeof req.body === "string") {
      assertBodySizeWithinLimit(Buffer.byteLength(req.body, "utf8"));
      try {
        return JSON.parse(req.body || "{}");
      } catch {
        throw new InvalidJsonBodyError("Request body must be valid JSON.");
      }
    }

    const serializedBody = JSON.stringify(req.body ?? {});
    assertBodySizeWithinLimit(Buffer.byteLength(serializedBody, "utf8"));
    return req.body;
  }

  let totalBytes = 0;
  let body = "";
  for await (const chunk of req) {
    const chunkString =
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    totalBytes += Buffer.byteLength(chunkString, "utf8");
    assertBodySizeWithinLimit(totalBytes);
    body += chunkString;
  }

  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new InvalidJsonBodyError("Request body must be valid JSON.");
  }
}
