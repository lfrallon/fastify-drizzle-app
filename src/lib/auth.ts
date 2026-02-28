import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

// db
import { db } from "#/db/index.ts";
import * as schema from "#/drizzle/schema/index.ts";

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
  },
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
