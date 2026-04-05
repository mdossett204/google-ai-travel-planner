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

const redisUrl = process.env.REDIS_URL;
const redisClient = redisUrl ? createClient({ url: redisUrl }) : null;

if (redisClient) {
  redisClient.on("error", (err: unknown) => {
    console.error("Redis error:", err);
  });
}

export function assertRedisConfigured() {
  if (!redisUrl?.trim()) {
    throw new RedisConfigurationError(
      "Server configuration error: missing REDIS_URL.",
    );
  }
}

export async function getRedisClient() {
  assertRedisConfigured();

  if (!redisClient) {
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
