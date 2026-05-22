import { eq } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";

// db
import { db } from "#/db/index.ts";
import { role, rolePermission, user } from "#/drizzle/schema/schema.ts";

// lib
import auth from "#/lib/auth.ts";

// types
import type { IncomingHttpHeaders } from "node:http";

export type Resource = "user" | "todos" | "map-messages";
export type Action = "create" | "read" | "update" | "delete";
export type Permission = `${Resource}:${Action}`;

const rolePermissionsCache = new Map<
  string,
  { permissions: Permission[]; expiresAt: number }
>();
const CACHE_TTL_MS = 500;

async function getRolePermissions(roleName: string): Promise<Permission[]> {
  const now = Date.now();
  const cached = rolePermissionsCache.get(roleName);

  if (cached && cached.expiresAt > now) {
    return cached.permissions;
  }

  // Fetch from DB
  const roleRecord = await db.query.role.findFirst({
    where: eq(role.name, roleName),
  });

  if (!roleRecord) {
    return [];
  }

  const permissions = await db.query.rolePermission.findMany({
    where: eq(rolePermission.roleId, roleRecord.id),
    columns: { permission: true },
  });

  const permissionsList = permissions.map((p) => p.permission as Permission);

  // Cache the result
  rolePermissionsCache.set(roleName, {
    permissions: permissionsList,
    expiresAt: now + CACHE_TTL_MS,
  });

  return permissionsList;
}

async function getUserAccess(userId: string, roleId: string) {
  const userRecord = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: {
      id: true,
      email: true,
      roleId: true,
    },
  });

  if (!userRecord) {
    return {
      role: "Guest",
      permissions: [] as Permission[],
    };
  }

  const roleRecord = await db.query.role.findFirst({
    where: eq(role.id, roleId),
    columns: {
      name: true,
    },
  });

  const permissions = await db.query.rolePermission.findMany({
    where: eq(rolePermission.roleId, roleId),
    columns: {
      permission: true,
    },
  });

  return {
    role: roleRecord?.name || "Guest",
    permissions: permissions.map((p) => p.permission as Permission) || [],
  };
}

export function invalidateRoleCache(roleName?: string) {
  if (roleName) {
    rolePermissionsCache.delete(roleName);
  } else {
    rolePermissionsCache.clear();
  }
}

interface Options {
  /** Optional resource ID to validate object ownership (e.g., todo.userId === user.id) */
  ownerId?: string;
}

export async function accessPermissionCheck(
  headers: IncomingHttpHeaders,
  requiredPermission: Permission,
  options?: Options,
) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(headers),
  });

  if (!session?.user) {
    return {
      error: "Unauthorized",
      message: "Authentication session is missing or expired.",
      statusCode: 401,
    };
  }

  const { user } = session;

  const userAccess = await getUserAccess(
    options?.ownerId ?? user.id,
    user.roleId,
  );
  const userRole = userAccess.role;
  const customPermissions = userAccess.permissions;

  if (userRole === "Admin") {
    return {
      session,
      currentUser: {
        ...user,
        role: userRole,
        permissions: customPermissions,
      },
    };
  }

  const inheritedPermissions = await getRolePermissions(userRole);
  const allPermissions = new Set([
    ...inheritedPermissions,
    ...customPermissions,
  ]);

  if (!allPermissions.has(requiredPermission)) {
    return {
      error: "Forbidden",
      message: `Missing permission: ${requiredPermission}`,
      statusCode: 403,
    };
  }

  if (options?.ownerId && user.id !== options.ownerId) {
    return {
      error: "Forbidden",
      message: "Access Denied: You do not own this resource.",
      statusCode: 403,
    };
  }

  return {
    session,
    currentUser: {
      ...user,
      role: userRole,
      permissions: customPermissions,
    },
  };
}
