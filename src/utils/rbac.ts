import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";

// auth lib
import auth from "#/lib/auth.ts";

// db
import { db } from "#/db/index.ts";
import { user } from "#/drizzle/schema/schema.ts";

// types
import type { IncomingHttpHeaders } from "node:http";

type Permission = "Create" | "Read" | "Update" | "Delete";

const rolePermissions: Record<string, Permission[]> = {
  Admin: ["Create", "Read", "Update", "Delete"],
  User: ["Create", "Read", "Update"],
  Guest: ["Read"],
};

export async function accessPermissionCheck(
  headers: IncomingHttpHeaders,
  permission: Permission,
) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(headers),
  });

  if (!session?.user) {
    return {
      error: "Unauthorized",
      message: `Missing ${permission.toUpperCase()} permission.`,
      statusCode: 401,
    };
  }

  const currentUser = await db.query.user.findFirst({
    where: eq(user.id, session.user.id),
    columns: {
      id: true,
      role: true,
      permissions: true,
    },
  });

  if (!currentUser) {
    return {
      error: "Unauthorized",
      message: `Missing ${permission.toUpperCase()} permission.`,
      statusCode: 401,
    };
  }

  const allowedPermissions = rolePermissions[currentUser.role] ?? [];
  const assignedPermissions = new Set(currentUser.permissions ?? []);
  const hasRolePermission = allowedPermissions.includes(permission);
  const hasAssignedPermission =
    currentUser.role === "Admin" || assignedPermissions.has(permission);

  if (!hasRolePermission || !hasAssignedPermission) {
    return {
      error: "Forbidden",
      message: `Missing ${permission.toUpperCase()} permission.`,
      statusCode: 403,
    };
  }

  return { session, currentUser };
}
