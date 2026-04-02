// src/plugins/cache.ts
import fp from "fastify-plugin";

// redis
import { redis } from "#/db/redis.ts";

// types
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    cache: {
      get<T>(key: string): Promise<T | null>;
      set(key: string, value: unknown, ttl?: number): Promise<void>;
      del(key: string): Promise<void>;
      wrap<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T>;
    };
  }
}

export default fp(async (fastify: FastifyInstance) => {
  fastify.decorate("cache", {
    async get<T>(key: string): Promise<T | null> {
      const cached = await redis.get(key);
      return cached ? JSON.parse(cached) : null;
    },

    async set(key: string, value: unknown, ttl = 300) {
      await redis.set(key, JSON.stringify(value), "EX", ttl);
    },

    async del(key: string) {
      await redis.del(key);
    },

    async wrap<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
      const cached = await redis.get(key);

      if (cached) {
        return JSON.parse(cached);
      }

      const result = await fn();

      if (result !== null && result !== undefined) {
        await redis.set(key, JSON.stringify(result), "EX", ttl);
      }

      return result;
    },
  });
});
