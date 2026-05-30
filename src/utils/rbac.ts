import { eq } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";

// db
import { db } from "#/db/index.ts";
import { role, rolePermission, user } from "#/drizzle/schema/schema.ts";

// lib
import auth from "#/lib/auth.ts";

// types
import type { IncomingHttpHeaders } from "node:http";

export type Action = "create" | "read" | "update" | "delete";

const rolePermissionsCache = new Map<
  string,
  { permissions: string[]; expiresAt: number }
>();
const CACHE_TTL_MS = 500;

async function getRolePermissions(roleName: string): Promise<string[]> {
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

  const permissionsList = permissions.map((p) => p.permission);

  // Cache the result
  rolePermissionsCache.set(roleName, {
    permissions: permissionsList,
    expiresAt: now + CACHE_TTL_MS,
  });

  return permissionsList;
}

async function getUserAccess(userId: string) {
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
      permissions: [] as string[],
    };
  }

  const roleRecord = userRecord.roleId
    ? await db.query.role.findFirst({
        where: eq(role.id, userRecord.roleId),
        columns: {
          name: true,
        },
      })
    : null;

  const permissions = userRecord.roleId
    ? await db.query.rolePermission.findMany({
        where: eq(rolePermission.roleId, userRecord.roleId),
        columns: {
          permission: true,
        },
      })
    : [];

  return {
    role: roleRecord?.name || "Guest",
    permissions: permissions.map((p) => p.permission),
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
  requiredPermission: string,
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

  const userAccess = await getUserAccess(user.id);
  const userRole = userAccess.role;
  const customPermissions = userAccess.permissions;

  const inheritedPermissions = await getRolePermissions(userRole);
  const allPermissions = [
    ...new Set([...inheritedPermissions, ...customPermissions]),
  ];

  if (userRole === "Admin") {
    return {
      session,
      currentUser: {
        ...user,
        role: userRole,
        permissions: allPermissions,
      },
    };
  }

  if (!new Set(allPermissions).has(requiredPermission)) {
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
