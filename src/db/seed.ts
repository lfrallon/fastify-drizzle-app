import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "#/drizzle/schema/index.ts";
import { role, rolePermission } from "#/drizzle/schema/schema.ts";
import { v4 } from "uuid";

const DEFAULT_ROLES = {
  System: [
    {
      resource: "user",
      action: "create",
      permission: "user:create",
    },
    {
      resource: "user",
      action: "read",
      permission: "user:read",
    },
    {
      resource: "user",
      action: "update",
      permission: "user:update",
    },
    {
      resource: "user",
      action: "delete",
      permission: "user:delete",
    },
  ],
  Admin: [
    {
      resource: "user",
      action: "create",
      permission: "user:create",
    },
    {
      resource: "user",
      action: "read",
      permission: "user:read",
    },
    {
      resource: "user",
      action: "update",
      permission: "user:update",
    },
    {
      resource: "todos",
      action: "read",
      permission: "todos:read",
    },
    {
      resource: "todos",
      action: "create",
      permission: "todos:create",
    },
    {
      resource: "todos",
      action: "update",
      permission: "todos:update",
    },
    {
      resource: "todos",
      action: "delete",
      permission: "todos:delete",
    },
    {
      resource: "geo-notes",
      action: "read",
      permission: "geo-notes:read",
    },
    {
      resource: "geo-notes",
      action: "create",
      permission: "geo-notes:create",
    },
    {
      resource: "geo-notes",
      action: "update",
      permission: "geo-notes:update",
    },
    {
      resource: "geo-notes",
      action: "delete",
      permission: "geo-notes:delete",
    },
  ],
  User: [
    {
      resource: "user",
      action: "read",
      permission: "user:read",
    },
    {
      resource: "user",
      action: "update",
      permission: "user:update",
    },
    {
      resource: "todos",
      action: "read",
      permission: "todos:read",
    },
    {
      resource: "todos",
      action: "create",
      permission: "todos:create",
    },
    {
      resource: "todos",
      action: "update",
      permission: "todos:update",
    },
    {
      resource: "todos",
      action: "delete",
      permission: "todos:delete",
    },
    {
      resource: "geo-notes",
      action: "read",
      permission: "geo-notes:read",
    },
    {
      resource: "geo-notes",
      action: "create",
      permission: "geo-notes:create",
    },
    {
      resource: "geo-notes",
      action: "update",
      permission: "geo-notes:update",
    },
    {
      resource: "geo-notes",
      action: "delete",
      permission: "geo-notes:delete",
    },
  ],
  Guest: [
    {
      resource: "user",
      action: "read",
      permission: "user:read",
    },
    {
      resource: "geo-notes",
      action: "read",
      permission: "geo-notes:read",
    },
  ],
  None: [],
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
        isSystem: roleName === "System" ? true : false,
      });

      for (const perm of permissions) {
        await database.insert(rolePermission).values({
          id: v4(),
          roleId,
          resource: perm.resource,
          action: perm.action as any,
          permission: perm.permission,
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
