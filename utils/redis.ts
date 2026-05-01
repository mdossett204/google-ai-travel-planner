import { createClient } from "redis";

export class RedisConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedisConfigurationError";
  }
}

export class RedisConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedisConnectionError";
  }
}

interface RedisClientLike {
  get(key: string): Promise<string | Buffer | null>;
  set(
    key: string,
    value: string,
    options?: {
      EX?: number;
    },
  ): Promise<unknown>;
  incr(key: string): Promise<number | `${number}`>;
  expire(key: string, seconds: number): Promise<number | `${number}`>;
}

type MemoryEntry = {
  value: string;
  expiresAt: number | null;
};

const redisUrl = process.env.REDIS_URL?.trim();
const isLocalDevelopment = process.env.NODE_ENV !== "production";
const hasPlaceholderRedisUrl =
  !redisUrl || /^YOUR_[A-Z0-9_]+$/i.test(redisUrl);
const memoryStore = new Map<string, MemoryEntry>();
let hasLoggedLocalFallback = false;

function pruneExpiredEntry(key: string) {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return entry;
}

function getMemoryExpiration(seconds?: number) {
  return typeof seconds === "number" ? Date.now() + seconds * 1000 : null;
}

function logLocalFallback(reason: string) {
  if (hasLoggedLocalFallback) return;
  hasLoggedLocalFallback = true;
  console.warn(
    `[redis] ${reason} Falling back to in-memory storage for local development.`,
  );
}

function shouldUseLocalRedisFallback() {
  return isLocalDevelopment;
}

const localRedisClient: RedisClientLike = {
  async get(key) {
    return pruneExpiredEntry(key)?.value ?? null;
  },
  async set(key, value, options) {
    memoryStore.set(key, {
      value,
      expiresAt: getMemoryExpiration(options?.EX),
    });
    return "OK";
  },
  async incr(key) {
    const entry = pruneExpiredEntry(key);
    const nextValue = Number(entry?.value ?? 0) + 1;
    memoryStore.set(key, {
      value: String(nextValue),
      expiresAt: entry?.expiresAt ?? null,
    });
    return nextValue;
  },
  async expire(key, seconds) {
    const entry = pruneExpiredEntry(key);
    if (!entry) return 0;
    memoryStore.set(key, {
      value: entry.value,
      expiresAt: getMemoryExpiration(seconds),
    });
    return 1;
  },
};

const redisClient =
  redisUrl && !hasPlaceholderRedisUrl ? createClient({ url: redisUrl }) : null;

if (redisClient) {
  redisClient.on("error", (err: unknown) => {
    if (shouldUseLocalRedisFallback()) {
      console.warn("Redis error:", err);
      return;
    }
    console.error("Redis error:", err);
  });
}

export function assertRedisConfigured() {
  if (shouldUseLocalRedisFallback() && hasPlaceholderRedisUrl) {
    return;
  }

  if (!redisUrl?.trim() || hasPlaceholderRedisUrl) {
    throw new RedisConfigurationError(
      "Server configuration error: missing REDIS_URL.",
    );
  }
}

export async function getRedisClient(): Promise<RedisClientLike> {
  assertRedisConfigured();

  if (!redisClient) {
    if (shouldUseLocalRedisFallback()) {
      logLocalFallback("REDIS_URL is missing or uses the placeholder value.");
      return localRedisClient;
    }

    throw new RedisConfigurationError(
      "Server configuration error: missing REDIS_URL.",
    );
  }

  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
    return redisClient;
  } catch (err) {
    if (shouldUseLocalRedisFallback()) {
      logLocalFallback("Redis is unavailable.");
      return localRedisClient;
    }

    console.error("Redis connection error:", err);
    throw new RedisConnectionError("Failed to connect to Redis.");
  }
}

export async function runFixedWindowRateLimit(
  key: string,
  limit: number,
  windowSec: number,
) {
  const client = await getRedisClient();
  const currentWindow = Math.floor(Date.now() / (windowSec * 1000));
  const redisKey = `ratelimit:${key}:${currentWindow}`;

  const requests = Number(await client.incr(redisKey));
  if (requests === 1) {
    await client.expire(redisKey, windowSec * 2);
  }

  return requests <= limit;
}
