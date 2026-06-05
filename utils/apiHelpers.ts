export interface ApiRequest {
  method?: string;
  [key: string]: unknown;
}

export interface ApiResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(data?: string): void;
}

export const monthLabels: Record<string, string> = {
  Jan: "January (winter)",
  Feb: "February (late winter)",
  Mar: "March (early spring)",
  Apr: "April (early spring)",
  May: "May (spring)",
  Jun: "June (early summer)",
  Jul: "July (midsummer)",
  Aug: "August (late summer)",
  Sep: "September (early fall)",
  Oct: "October (fall)",
  Nov: "November (late fall)",
  Dec: "December (winter)",
};

export function sanitizePromptInput(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n?|\n/g, " ")
    .replace(/[<>]/g, (char) => (char === "<" ? "&lt;" : "&gt;"))
    .replace(/`{2,}/g, "`")
    .replace(/"{3,}/g, '"')
    .replace(/#{2,}/g, "#")
    .replace(/-{3,}/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sendJson(res: ApiResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

export function handleApiError(res: ApiResponse, err: unknown) {
  console.error(err);

  const errorRecord = err as Record<string, unknown>;
  const name = err instanceof Error ? err.name : errorRecord?.name;
  const message = err instanceof Error ? err.message : errorRecord?.message;
  const status = errorRecord?.status;

  if (name === "RequestValidationError") {
    return sendJson(res, 400, { error: message });
  }
  if (name === "InvalidJsonBodyError") {
    return sendJson(res, 400, { error: message });
  }
  if (name === "RequestBodyTooLargeError") {
    return sendJson(res, 413, { error: message });
  }
  if (
    name === "LlmConfigurationError" ||
    name === "TomTomConfigurationError" ||
    name === "RedisConfigurationError" ||
    name === "RedisConnectionError"
  ) {
    return sendJson(res, 500, { error: message });
  }
  if (status === 429 || String(message).includes("rate limit")) {
    return sendJson(res, 429, {
      error: "Our AI is currently busy. Please wait a moment and try again!",
    });
  }

  return sendJson(res, 500, { error: "Server error" });
}
