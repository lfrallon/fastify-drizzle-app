import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

// db
import { db } from "../db/index.ts";
import * as schema from "../drizzle/schema/index.ts";

export const auth = betterAuth({
  appName: "Fastify Drizzle",
  database: drizzleAdapter(db, {
    provider: "pg", // or "pg" or "mysql"
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [
    "http://localhost:3006",
    "http://localhost:3006/*",
    "http://localhost:3000",
    "http://localhost:3000/*",
  ],
  advanced: {
    cookiePrefix: "fastify-drizzle",
    useSecureCookies: true,
  },
  // session: {
  //   cookieCache: {
  //     enabled: true,
  //     maxAge: 7 * 24 * 60 * 60,
  //     strategy: "jwe",
  //     refreshCache: false, // since we are using a secondary storage it should be `false`
  //   },
  // },
});
