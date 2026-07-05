import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

vi.mock('redis', () => {
  return {
    createClient: vi.fn().mockReturnValue({
      on: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      isOpen: false,
      get: vi.fn(),
      set: vi.fn().mockResolvedValue('OK'),
      incr: vi.fn().mockResolvedValue(1),
    })
  };
});

describe('redis', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('assertRedisConfigured', () => {
    it('throws error if REDIS_URL is missing in production', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.REDIS_URL;

      const { assertRedisConfigured, RedisConfigurationError } = await import('../../utils/redis.js');
      expect(() => assertRedisConfigured()).toThrow(RedisConfigurationError);
    });

    it('throws error if REDIS_URL is placeholder in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.REDIS_URL = 'YOUR_REDIS_URL';

      const { assertRedisConfigured, RedisConfigurationError } = await import('../../utils/redis.js');
      expect(() => assertRedisConfigured()).toThrow(RedisConfigurationError);
    });

    it('does not throw if REDIS_URL is valid', async () => {
      process.env.NODE_ENV = 'production';
      process.env.REDIS_URL = 'redis://localhost:6379';

      const { assertRedisConfigured } = await import('../../utils/redis.js');
      expect(() => assertRedisConfigured()).not.toThrow();
    });

    it('does not throw for missing REDIS_URL in local development', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.REDIS_URL;

      const { assertRedisConfigured } = await import('../../utils/redis.js');
      expect(() => assertRedisConfigured()).not.toThrow();
    });
  });

  describe('getRedisClient', () => {
    it('returns a working client in production with valid URL', async () => {
      process.env.NODE_ENV = 'production';
      process.env.REDIS_URL = 'redis://localhost:6379';
      const { getRedisClient } = await import('../../utils/redis.js');
      const client = await getRedisClient();
      expect(client).toBeDefined();
    });

    it('throws error in production if URL missing', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.REDIS_URL;
      const { getRedisClient } = await import('../../utils/redis.js');
      await expect(getRedisClient()).rejects.toThrow();
    });

    it('returns local fallback in development if URL missing', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.REDIS_URL;
      const { getRedisClient } = await import('../../utils/redis.js');
      const client = await getRedisClient();
      expect(client).toBeDefined();
      
      // Test the local fallback implementation
      await client.set('foo', 'bar');
      expect(await client.get('foo')).toBe('bar');
      
      await client.set('count', '1');
      expect(await client.incr('count')).toBe(2);
      
      // Test NX behavior
      await client.set('foo', 'baz', { NX: true });
      expect(await client.get('foo')).toBe('bar'); // Should not overwrite
    });

    it('handles expiration correctly in local fallback', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.REDIS_URL;
      const { getRedisClient } = await import('../../utils/redis.js');
      const client = await getRedisClient();
      
      // Set with EX=-1 to expire immediately
      await client.set('expiring_key', 'value', { EX: -1 });
      expect(await client.get('expiring_key')).toBe(null);

      await client.set('expiring_key2', 'value', { EX: -1 });
      const incrResult = await client.incr('expiring_key2');
      expect(incrResult).toBe(1); // Increment treats null as 0
      
      // We can also test NX with an expired key (NX should succeed if the key expired)
      await client.set('expiring_key3', 'value', { EX: -1 });
      await client.set('expiring_key3', 'new_value', { NX: true });
      expect(await client.get('expiring_key3')).toBe('new_value');
    });

    it('returns redisClient directly if it is already open', async () => {
      process.env.NODE_ENV = 'production';
      process.env.REDIS_URL = 'redis://localhost:6379';
      const { createClient } = await import('redis');
      const mockConnect = vi.fn();
      vi.mocked(createClient).mockReturnValueOnce({
        on: vi.fn(),
        connect: mockConnect,
        isOpen: true,
        get: vi.fn(),
        set: vi.fn(),
        incr: vi.fn(),
      } as any);

      const { getRedisClient } = await import('../../utils/redis.js');
      const client = await getRedisClient();
      expect(mockConnect).not.toHaveBeenCalled();
      expect(client.isOpen).toBe(true);
    });

    it('throws RedisConnectionError if connection fails in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.REDIS_URL = 'redis://localhost:6379';
      const { createClient } = await import('redis');
      const mockConnect = vi.fn().mockRejectedValue(new Error('Connection failed'));
      vi.mocked(createClient).mockReturnValueOnce({
        on: vi.fn(),
        connect: mockConnect,
        isOpen: false,
        get: vi.fn(),
        set: vi.fn(),
        incr: vi.fn(),
      } as any);

      const { getRedisClient, RedisConnectionError } = await import('../../utils/redis.js');
      await expect(getRedisClient()).rejects.toThrow(RedisConnectionError);
    });

    it('falls back to local client if connection fails in development', async () => {
      process.env.NODE_ENV = 'development';
      process.env.REDIS_URL = 'redis://localhost:6379';
      const { createClient } = await import('redis');
      const mockConnect = vi.fn().mockRejectedValue(new Error('Connection failed'));
      vi.mocked(createClient).mockReturnValueOnce({
        on: vi.fn(),
        connect: mockConnect,
        isOpen: false,
        get: vi.fn(),
        set: vi.fn(),
        incr: vi.fn(),
      } as any);

      const { getRedisClient } = await import('../../utils/redis.js');
      const client = await getRedisClient();
      expect(client).toBeDefined(); // Local fallback
    });

    it('logs error on redis error event in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.REDIS_URL = 'redis://localhost:6379';
      const { createClient } = await import('redis');
      
      let errorHandler: any;
      vi.mocked(createClient).mockReturnValueOnce({
        on: vi.fn().mockImplementation((event, handler) => {
          if (event === 'error') errorHandler = handler;
        }),
        connect: vi.fn(),
        isOpen: true,
        get: vi.fn(),
        set: vi.fn(),
        incr: vi.fn(),
      } as any);

      await import('../../utils/redis.js');
      expect(errorHandler).toBeDefined();
      
      const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});
      errorHandler(new Error('Test error'));
      expect(consoleErrorMock).toHaveBeenCalled();
      consoleErrorMock.mockRestore();
    });

    it('logs warning on redis error event in development', async () => {
      process.env.NODE_ENV = 'development';
      process.env.REDIS_URL = 'redis://localhost:6379';
      const { createClient } = await import('redis');
      
      let errorHandler: any;
      vi.mocked(createClient).mockReturnValueOnce({
        on: vi.fn().mockImplementation((event, handler) => {
          if (event === 'error') errorHandler = handler;
        }),
        connect: vi.fn(),
        isOpen: true,
      } as any);

      await import('../../utils/redis.js');
      expect(errorHandler).toBeDefined();
      
      const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
      errorHandler(new Error('Test dev error'));
      expect(consoleWarnMock).toHaveBeenCalledWith('Redis error:', expect.any(Error));
      consoleWarnMock.mockRestore();
    });
  });

  describe('runFixedWindowRateLimit', () => {
    it('returns true if within limit', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.REDIS_URL;
      const { runFixedWindowRateLimit } = await import('../../utils/redis.js');
      
      // Limit of 2
      const res1 = await runFixedWindowRateLimit('test_limit', 2, 60);
      expect(res1).toBe(true);
      
      const res2 = await runFixedWindowRateLimit('test_limit', 2, 60);
      expect(res2).toBe(true);
      
      const res3 = await runFixedWindowRateLimit('test_limit', 2, 60);
      expect(res3).toBe(false);
    });
  });
});
