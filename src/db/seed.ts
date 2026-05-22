import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "#/drizzle/schema/index.ts";
import { role, rolePermission } from "#/drizzle/schema/schema.ts";
import { v4 } from "uuid";

const DEFAULT_ROLES = {
  Admin: [
    "user:read",
    "user:update",
    "todos:read",
    "todos:create",
    "todos:update",
    "todos:delete",
    "map-messages:read",
    "map-messages:create",
    "map-messages:update",
    "map-messages:delete",
  ],
  User: [
    "user:read",
    "user:update",
    "todos:read",
    "todos:create",
    "todos:update",
    "todos:delete",
    "map-messages:read",
    "map-messages:create",
    "map-messages:update",
    "map-messages:delete",
  ],
  Guest: ["todos:read", "map-messages:read"],
};

async function seed() {
  console.log("🌱 Seeding roles...");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const database = drizzle({ client: pool, schema });

  try {
    // Check if roles already exist
    const existingRoles = await database.query.role.findMany();
    if (existingRoles.length > 0) {
      console.log("✅ Roles already exist. Skipping seed.");
      return;
    }

    for (const [roleName, permissions] of Object.entries(DEFAULT_ROLES)) {
      const roleId = v4();
      console.log(`  Creating role: ${roleName}`);

      await database.insert(role).values({
        id: roleId,
        name: roleName,
        isSystem: true,
      });

      for (const perm of permissions) {
        await database.insert(rolePermission).values({
          id: v4(),
          roleId,
          permission: perm as any,
        });
      }

      console.log(`    ✓ Added ${permissions.length} permissions`);
    }

    console.log("✅ Seeding completed successfully!");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
}

seed();
