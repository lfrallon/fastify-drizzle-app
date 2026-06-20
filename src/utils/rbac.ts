import { eq, inArray } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";

// db
import { db } from "#/db/index.ts";
import {
  roles,
  permissions,
  user,
  rolePermissions,
} from "#/drizzle/schema/schema.ts";

// lib
import auth from "#/lib/auth.ts";

// types
import type { IncomingHttpHeaders } from "node:http";

export type Action = "create" | "read" | "update" | "delete";

const rolePermissionsCache = new Map<
  string,
  {
    permissions: string[];
    expiresAt: number;
  }
>();
const CACHE_TTL_MS = 500;

async function getRolePermissions(roleId: string): Promise<string[]> {
  const now = Date.now();
  const cached = rolePermissionsCache.get(roleId);

  if (cached && cached.expiresAt > now) {
    return cached.permissions;
  }

  // Fetch from DB
  const roleRecord = await db.query.roles.findFirst({
    where: eq(roles.id, roleId),
    with: {
      rolePermissions: {
        with: {
          permission: true,
        },
      },
    },
  });

  if (!roleRecord) {
    return [];
  }

  const permissionsList = roleRecord.rolePermissions.map(
    (p) => p.permission.permission,
  );

  // Cache the result
  rolePermissionsCache.set(roleId, {
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
    ? await db.query.roles.findFirst({
        where: eq(roles.id, userRecord.roleId),
        columns: {
          name: true,
          id: true,
        },
      })
    : null;

  const rolePermissionIds = userRecord.roleId
    ? await db.query.rolePermissions.findMany({
        where: eq(rolePermissions.roleId, userRecord.roleId),
        columns: {
          permissionId: true,
        },
      })
    : [];

  const permissionIds = rolePermissionIds.map((p) => p.permissionId);

  const permissionsList = await db.query.permissions.findMany({
    where: inArray(permissions.id, permissionIds),
  });

  return {
    role: roleRecord?.name || "Guest",
    roleId: roleRecord?.id,
    permissions: permissionsList.map((p) => p.permission),
  };
}

export function invalidateRoleCache(roleId?: string) {
  if (roleId) {
    rolePermissionsCache.delete(roleId);
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
  const customPermissions = userAccess.permissions;

  if (!userAccess.roleId) {
    return {
      error: "Forbidden",
      message: "Access Denied: You do not have access on this resource.",
      statusCode: 403,
    };
  }

  const inheritedPermissions = await getRolePermissions(userAccess.roleId);

  const allPermissions = [
    ...new Set([...inheritedPermissions, ...customPermissions]),
  ];

  if (userAccess.role === "Admin") {
    return {
      session,
      currentUser: {
        ...user,
        role: userAccess.role,
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
      role: userAccess.role,
      permissions: customPermissions,
    },
  };
}
