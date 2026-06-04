import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { hash, verify, type Options } from "@node-rs/argon2";

// db
import { db } from "#/db/index.ts";
import * as schema from "#/drizzle/schema/index.ts";

export const argon2Options: Options = {
  memoryCost: 65536, // 64 MiB
  timeCost: 3, // 3 iterations
  parallelism: 4, // 4 lanes
  outputLen: 32, // 32 bytes
  algorithm: 2, // Argon2id
};

const auth = betterAuth({
  appName: "Fastify Drizzle",
  database: drizzleAdapter(db, {
    provider: "pg", // or "pg" or "mysql"
    schema,
  }),
  user: {
    changeEmail: {
      enabled: true,
    },
    additionalFields: {
      firstName: { type: "string", required: true },
      lastName: { type: "string", required: true },
      roleId: { type: "string" },
    },
  },
  emailAndPassword: {
    enabled: true,
    password: {
      hash: async (password: string) => {
        return await hash(password, argon2Options);
      },
      verify: async (data: { password: string; hash: string }) => {
        return await verify(data.hash, data.password, argon2Options);
      },
    },
  },
  baseURL: process.env.BETTER_AUTH_BASE_URL || "http://localhost:3006",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [
    "http://localhost:3006",
    "http://localhost:3006/*",
    "http://localhost:3000",
    "http://localhost:3000/*",
  ],
  advanced: {
    trustedProxyHeaders: true,
    cookiePrefix: "fastify-drizzle",
    useSecureCookies: true,
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 7 * 24 * 60 * 60,
      strategy: "jwe",
      refreshCache: false, // since we are using a database it should be `false`
    },
  },
});

export type User = typeof auth.$Infer.Session.user;
export type Session = typeof auth.$Infer.Session;

export default auth;
