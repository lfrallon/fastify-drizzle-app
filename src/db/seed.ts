import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "#/drizzle/schema/index.ts";
import { v4 } from "uuid";
import { permissions, roles } from "#/drizzle/schema/index.ts";

const DEFAULT_SEEDS = {
  roles: [
    {
      id: 1,
      name: "System",
      description: "System access.",
      is_system: true,
    },
    {
      id: 2,
      name: "Admin",
      description: "Full system access.",
      is_system: false,
    },
    {
      id: 3,
      name: "User",
      description: "Limitted system access.",
      is_system: false,
    },
    {
      id: 4,
      name: "Guest",
      description: "Limitted read-only system access.",
      is_system: false,
    },
    {
      id: 5,
      name: "None",
      description: "Read-only system access.",
      is_system: false,
    },
  ],
  permissions: [
    {
      id: 1,
      resource: "user",
      action: "create",
      permission: "user:create",
    },
    {
      id: 2,
      resource: "user",
      action: "read",
      permission: "user:read",
    },
    {
      id: 3,
      resource: "user",
      action: "update",
      permission: "user:update",
    },
    {
      id: 4,
      resource: "todos",
      action: "read",
      permission: "todos:read",
    },
    {
      id: 5,
      resource: "todos",
      action: "create",
      permission: "todos:create",
    },
    {
      id: 6,
      resource: "todos",
      action: "update",
      permission: "todos:update",
    },
    {
      id: 7,
      resource: "todos",
      action: "delete",
      permission: "todos:delete",
    },
    {
      id: 8,
      resource: "geo-notes",
      action: "read",
      permission: "geo-notes:read",
    },
    {
      id: 9,
      resource: "geo-notes",
      action: "create",
      permission: "geo-notes:create",
    },
    {
      id: 10,
      resource: "geo-notes",
      action: "update",
      permission: "geo-notes:update",
    },
    {
      id: 11,
      resource: "geo-notes",
      action: "delete",
      permission: "geo-notes:delete",
    },
  ],
};

async function seed() {
  console.log("🌱 Seeding roles...");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const database = drizzle({ client: pool, schema });

  try {
    // Check if roles already exist
    const existingRoles = await database.query.roles.findMany();
    if (existingRoles.length > 0) {
      console.log("✅ Roles already exist. Skipping seed.");
      return;
    }

    for (const role of DEFAULT_SEEDS.roles) {
      console.log(`  Creating role: ${role.name}`);

      await database.insert(roles).values({
        id: v4(),
        name: role.name,
        isSystem: role.is_system,
        description: role.description,
      });
    }

    for (const perm of DEFAULT_SEEDS.permissions) {
      await database.insert(permissions).values({
        id: v4(),
        resource: perm.resource,
        action: perm.action as any,
        permission: perm.permission,
      });
    }

    console.log(`    ✓ Added ${DEFAULT_SEEDS.permissions.length} permissions`);

    console.log("✅ Seeding completed successfully!");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
}

seed();
