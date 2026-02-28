import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({ path: [".env.local", ".env"] });

export default defineConfig({
  schema: "./src/drizzle/schema/index.ts",
  out: "./src/drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    database: process.env.POSTGRES_DB as string,
    user: process.env.POSTGRES_USER as string,
    password: process.env.POSTGRES_PASSWORD as string,
    host: process.env.POSTGRES_HOST as string,
    port: Number(process.env.POSTGRES_PORT),
    // Alternatively, you can use a connection string:
    //
    // url: process.env.DATABASE_URL as string,
  },
  verbose: true,
  strict: true,
});
