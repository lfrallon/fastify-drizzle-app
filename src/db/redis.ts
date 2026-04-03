import { Redis } from "ioredis";

export const redis = new Redis({
  port: Number(process.env.REDIS_PORT),
  host: process.env.REDIS_HOST,
  username: process.env.REDIS_USERNAME,
  password: process.env.REDIS_PASSWORD,
  lazyConnect: true,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy(times) {
    return Math.min(times * 100, 2000);
  },
});

redis.on("connect", () => {
  console.log("✅ Redis connected");
});

redis.on("ready", () => {
  console.log("✅ Redis ready");
});

redis.on("close", () => {
  console.log("⚠️ Redis closed");
});

redis.on("reconnecting", () => {
  console.log("🔄 Redis reconnecting");
});

redis.on("error", (err) => {
  console.error("❌ Redis error:", err);
});
