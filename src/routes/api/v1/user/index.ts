import { and, asc, desc, eq, gt, inArray, lt, or } from "drizzle-orm";
import z from "zod";

// types
import type { FastifyRequest, FastifyReply } from "fastify";
import type {
  FastifyZodOpenApiSchema,
  FastifyZodOpenApiTypeProvider,
} from "fastify-zod-openapi";
import type { TypedFastifyInstance } from "#/types/index.ts";

// auth lib
import { accessPermissionCheck } from "#/utils/rbac.ts";

// libs
import { buildUserAccountsCacheKey } from "#/lib/user/index.ts";
import { buildUserPermissionsCacheKey } from "#/lib/permissions/index.ts";
import { buildUserRolesCacheKey } from "#/lib/roles/index.ts";

// db
import { db } from "#/db/index.ts";
import { role, rolePermission, user } from "#/drizzle/schema/index.ts";

// types
type UserSelect = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
  roleId: string | null;
};

interface UserAccountsNodes {
  user: UserSelect;
  role: string | null;
  permissions: string[];
}

interface UserRolesNodes {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
  users: UserSelect[];
  permissions: string[];
}

const PutBodySchema = z.object({
  firstName: z
    .string()
    .min(2, "First name is required.")
    .meta({ description: "User's first name", example: "John" }),
  lastName: z
    .string()
    .min(2, "Last name is required.")
    .meta({ description: "User's last name", example: "Doe" }),
}) satisfies FastifyZodOpenApiSchema;

const UpdateResponseSchema = {
  200: z.object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
    image: z.string().nullable(),
    emailVerified: z.boolean(),
    createdAt: z.string().meta({
      description: "User creation date",
      example: "2024-01-01T00:00:00.000Z",
    }),
    updatedAt: z.string().meta({
      description: "User last update date",
      example: "2024-01-01T00:00:00.000Z",
    }),
  }),
  401: z.object({
    error: z.string().meta({
      description: "Unauthorized error message",
      example: "Unauthorized",
    }),
  }),
  403: z.object({
    error: z.string().meta({
      description: "Forbidden error message",
      example: "Forbidden",
    }),
    message: z.string().optional(),
  }),
  500: z.object({
    error: z.string().meta({
      description: "Internal Server Error message",
      example: "Internal Server Error",
    }),
  }),
};

const PositiveIntParam = z.coerce.number().int().min(1).max(200);

const CursorPaginationQuerySchema = z
  .object({
    id: z.string().optional().meta({
      description: "The id of the last item from the previous page",
      example: "",
    }),
    updatedAt: z.string().optional().meta({
      description: "The date of the last item from the previous page",
      example: "",
    }),
    pageSize: PositiveIntParam.default(10).meta({
      description: "Number of items to return per page",
      example: 10,
    }),
    orderBy: z.enum(["asc", "desc"]).default("desc").meta({
      description: "Order of the items",
      example: "desc",
    }),
    limit: PositiveIntParam.optional().meta({
      description: "Optional alias for pageSize, clamped by the API for safety",
      example: 200,
    }),
  })
  .strict()
  .refine((data) => !(data.id && !data.updatedAt), {
    message: "'id' is required.",
    path: ["id"],
  })
  .refine((data) => !(data.updatedAt && !data.id), {
    message: "'updatedAt' is required.",
    path: ["updatedAt"],
  });

const AccessResponseSchema = {
  200: z.object({
    id: z.string().nullable(),
    role: z.string().nullable(),
    permissions: z.array(z.string()),
  }),
  401: z.object({
    error: z.string().meta({
      description: "Unauthorized error message",
      example: "Unauthorized",
    }),
  }),
  403: z.object({
    error: z.string().meta({
      description: "Forbidden error message",
      example: "Forbidden",
    }),
    message: z.string().optional(),
  }),
  500: z.object({
    error: z.string().meta({
      description: "Internal Server Error message",
      example: "Internal Server Error",
    }),
  }),
};

export default async function (fastify: TypedFastifyInstance) {
  // GET /api/v1/user
  fastify
    .withTypeProvider<FastifyZodOpenApiTypeProvider>()
    .get("", async function ({ headers }, reply) {
      const permissionResult = await accessPermissionCheck(
        headers,
        "user:read",
      );
      if (!permissionResult.currentUser || !permissionResult.session) {
        const statusCode = permissionResult.statusCode === 403 ? 403 : 401;

        return reply.status(statusCode).send({
          error: permissionResult.error,
          ...(permissionResult.message
            ? { message: permissionResult.message }
            : {}),
        });
      }

      try {
        return reply.send(permissionResult.session.user);
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    });

  // GET /api/v1/user/accounts
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/accounts",
    {
      schema: {
        querystring: CursorPaginationQuerySchema,
      },
    },
    async function ({ headers, query }, reply) {
      const permissionResult = await accessPermissionCheck(
        headers,
        "user:read",
      );
      if (!permissionResult.currentUser || !permissionResult.session) {
        const statusCode = permissionResult.statusCode === 403 ? 403 : 401;

        return reply.status(statusCode).send({
          error: permissionResult.error,
          ...(permissionResult.message
            ? { message: permissionResult.message }
            : {}),
        });
      }

      if (permissionResult.currentUser.role !== "Admin") {
        return reply.status(403).send({
          error: "Forbidden",
          message: "You do not have permission to access this resource.",
        });
      }

      try {
        const { updatedAt, id, pageSize, orderBy, limit } = query;

        const clampedPageSize = limit ?? pageSize;

        const cursor =
          updatedAt && id
            ? {
                id,
                updatedAt,
              }
            : undefined;
        const queryLimit = clampedPageSize + 1;

        const cacheKey = buildUserAccountsCacheKey({
          userId: permissionResult.session.user.id,
          clampedPageSize,
          orderBy,
          cursor,
        });

        const totalCount = await db.$count(user);

        if (totalCount === 0) {
          return reply.code(200).send({
            nodes: [],
            pageInfo: {
              hasNextPage: false,
              nextCursor: null,
              totalPages: 0,
            },
            totalCount,
          });
        }

        const getPaginatedUsers = await fastify.cache.wrap(
          cacheKey,
          300,
          async () => {
            const pageUserRows = await db
              .select({
                id: user.id,
                updatedAt: user.updatedAt,
              })
              .from(user)
              .where(
                cursor
                  ? or(
                      orderBy === "desc"
                        ? lt(user.updatedAt, cursor.updatedAt)
                        : gt(user.updatedAt, cursor.updatedAt),
                      and(
                        eq(user.updatedAt, cursor.updatedAt),
                        orderBy === "desc"
                          ? lt(user.id, cursor.id)
                          : gt(user.id, cursor.id),
                      ),
                    )
                  : undefined,
              )
              .limit(queryLimit)
              .orderBy(
                orderBy === "desc" ? desc(user.updatedAt) : asc(user.updatedAt),
                orderBy === "desc" ? desc(user.id) : asc(user.id),
              );

            if (pageUserRows.length === 0) return [];

            const pageUserIds = pageUserRows.map((row) => row.id);

            const usersCached = await db
              .select({
                id: user.id,
                name: user.name,
                email: user.email,
                image: user.image,
                emailVerified: user.emailVerified,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
                roleId: user.roleId,
                roleName: role.name,
                permission: rolePermission.permission,
              })
              .from(user)
              .leftJoin(role, eq(user.roleId, role.id))
              .leftJoin(rolePermission, eq(rolePermission.roleId, role.id))
              .where(inArray(user.id, pageUserIds))
              .orderBy(
                orderBy === "desc" ? desc(user.updatedAt) : asc(user.updatedAt),
                orderBy === "desc" ? desc(user.id) : asc(user.id),
              );

            const map = new Map<string, UserAccountsNodes>();

            for (const row of usersCached) {
              const uid = row.id;
              const perm = row.permission ?? null;

              if (!map.has(uid)) {
                map.set(uid, {
                  user: {
                    id: row.id,
                    name: row.name,
                    email: row.email,
                    image: row.image,
                    emailVerified: row.emailVerified,
                    createdAt: row.createdAt,
                    updatedAt: row.updatedAt,
                    roleId: row.roleId,
                  },
                  role: row.roleName ?? null,
                  permissions: perm ? [perm] : [],
                });
              } else if (perm) {
                const entry = map.get(uid)!;
                if (!entry.permissions.includes(perm)) {
                  entry.permissions.push(perm);
                }
              }
            }

            // preserve original ordering from pageUserRows
            const ordered: UserAccountsNodes[] = [];
            const seen = new Set<string>();
            for (const row of pageUserRows) {
              const uid = row.id;
              if (!seen.has(uid)) {
                seen.add(uid);
                const node = map.get(uid);
                if (node) ordered.push(node);
              }
            }

            return ordered;
          },
        );

        const hasNextPage = getPaginatedUsers.length > clampedPageSize;

        const currentPageItems = hasNextPage
          ? getPaginatedUsers.slice(0, clampedPageSize)
          : getPaginatedUsers;

        const newNextCursor =
          currentPageItems.length > 0
            ? {
                id: currentPageItems[currentPageItems.length - 1].user.id,
                updatedAt:
                  currentPageItems[currentPageItems.length - 1].user.updatedAt,
              }
            : null;
        return reply.code(200).send({
          nodes: currentPageItems,
          pageInfo: {
            hasNextPage,
            nextCursor: newNextCursor,
            totalPages: Math.ceil(totalCount / clampedPageSize),
          },
          totalCount,
        });
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // PUT /api/v1/user/update
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().put(
    "/update",
    {
      schema: {
        body: PutBodySchema,
        response: UpdateResponseSchema,
      },
    },
    async ({ body, headers }, reply) => {
      const permissionResult = await accessPermissionCheck(
        headers,
        "user:update",
      );
      if (!permissionResult.currentUser || !permissionResult.session) {
        const statusCode = permissionResult.statusCode === 403 ? 403 : 401;

        return reply.status(statusCode).send({
          error: permissionResult.error,
          ...(permissionResult.message
            ? { message: permissionResult.message }
            : {}),
        });
      }

      const { firstName, lastName } = body;

      try {
        const updateUser = await db
          .update(user)
          .set({
            name: `${firstName} ${lastName}`,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(user.id, permissionResult.session.user.id))
          .returning();

        return reply.code(200).send(updateUser[0]);
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // GET /api/v1/user/access
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/access",
    {
      schema: {
        response: AccessResponseSchema,
      },
    },
    async function (request: FastifyRequest, reply: FastifyReply) {
      const permissionResult = await accessPermissionCheck(
        request.headers,
        "user:read",
      );
      if (!permissionResult.currentUser || !permissionResult.session) {
        return reply.status(200).send({
          id: null,
          role: null,
          permissions: [],
        });
      }

      try {
        return reply.code(200).send({
          id: permissionResult.session.user.roleId,
          role: permissionResult.currentUser.role,
          permissions: permissionResult.currentUser.permissions,
        });
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // GET /api/v1/user/permissions
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/permissions",
    {
      schema: {
        querystring: CursorPaginationQuerySchema,
      },
    },
    async function ({ headers, query }, reply) {
      const permissionResult = await accessPermissionCheck(
        headers,
        "user:read",
      );
      if (!permissionResult.currentUser || !permissionResult.session) {
        const statusCode = permissionResult.statusCode === 403 ? 403 : 401;

        return reply.status(statusCode).send({
          error: permissionResult.error,
          ...(permissionResult.message
            ? { message: permissionResult.message }
            : {}),
        });
      }

      if (permissionResult.currentUser.role !== "Admin") {
        return reply.status(403).send({
          error: "Forbidden",
          message: "You do not have permission to access this resource.",
        });
      }

      try {
        const { updatedAt, id, pageSize, orderBy, limit } = query;

        const clampedPageSize = limit ?? pageSize;

        const cursor =
          updatedAt && id
            ? {
                id,
                updatedAt,
              }
            : undefined;
        const queryLimit = clampedPageSize + 1;

        const cacheKey = buildUserPermissionsCacheKey({
          userId: permissionResult.session.user.id,
          clampedPageSize,
          orderBy,
          cursor,
        });

        const totalCount = await db.$count(rolePermission);

        if (totalCount === 0) {
          return reply.code(200).send({
            nodes: [],
            pageInfo: {
              hasNextPage: false,
              nextCursor: null,
              totalPages: 0,
            },
            totalCount,
          });
        }

        const getPaginatedUsers = await fastify.cache.wrap(
          cacheKey,
          300,
          async () => {
            const rolePermissionCached = await db
              .select({
                id: rolePermission.id,
                roleId: rolePermission.roleId,
                permission: rolePermission.permission,
                createdAt: rolePermission.createdAt,
                role: {
                  id: role.id,
                  name: role.name,
                  description: role.description,
                  isSystem: role.isSystem,
                  createdAt: role.createdAt,
                  updatedAt: role.updatedAt,
                },
              })
              .from(rolePermission)
              .leftJoin(role, eq(rolePermission.roleId, role.id))
              .where(
                cursor
                  ? or(
                      orderBy === "desc"
                        ? lt(rolePermission.createdAt, cursor.updatedAt)
                        : gt(rolePermission.createdAt, cursor.updatedAt),
                      and(
                        eq(rolePermission.createdAt, cursor.updatedAt),
                        lt(rolePermission.id, cursor.id),
                      ),
                    )
                  : undefined,
              )
              .limit(queryLimit)
              .orderBy(
                orderBy === "desc"
                  ? desc(rolePermission.createdAt)
                  : asc(rolePermission.createdAt),
                orderBy === "desc"
                  ? desc(rolePermission.id)
                  : asc(rolePermission.id),
              );

            return rolePermissionCached;
          },
        );

        const hasNextPage = getPaginatedUsers.length > clampedPageSize;

        const currentPageItems = hasNextPage
          ? getPaginatedUsers.slice(0, clampedPageSize)
          : getPaginatedUsers;

        const newNextCursor =
          currentPageItems.length > 0
            ? {
                id: currentPageItems[currentPageItems.length - 1].id,
                updatedAt:
                  currentPageItems[currentPageItems.length - 1].createdAt,
              }
            : null;
        return reply.code(200).send({
          nodes: currentPageItems,
          pageInfo: {
            hasNextPage,
            nextCursor: newNextCursor,
            totalPages: Math.ceil(totalCount / clampedPageSize),
          },
          totalCount,
        });
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // GET /api/v1/user/roles
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/roles",
    {
      schema: {
        querystring: CursorPaginationQuerySchema,
      },
    },
    async function ({ headers, query }, reply) {
      const permissionResult = await accessPermissionCheck(
        headers,
        "user:read",
      );
      if (!permissionResult.currentUser || !permissionResult.session) {
        const statusCode = permissionResult.statusCode === 403 ? 403 : 401;

        return reply.status(statusCode).send({
          error: permissionResult.error,
          ...(permissionResult.message
            ? { message: permissionResult.message }
            : {}),
        });
      }

      if (permissionResult.currentUser.role !== "Admin") {
        return reply.status(403).send({
          error: "Forbidden",
          message: "You do not have permission to access this resource.",
        });
      }

      try {
        const { updatedAt, id, pageSize, orderBy, limit } = query;

        const clampedPageSize = Math.min(
          Math.max(limit ?? pageSize ?? 10, 1),
          200,
        );

        const cursor =
          updatedAt && id
            ? {
                id,
                updatedAt,
              }
            : undefined;

        const queryLimit = clampedPageSize + 1;

        const cacheKey = buildUserRolesCacheKey({
          userId: permissionResult.session.user.id,
          clampedPageSize,
          orderBy,
          cursor,
        });

        const totalCount = await db.$count(role);

        if (totalCount === 0) {
          return reply.code(200).send({
            nodes: [],
            pageInfo: {
              hasNextPage: false,
              nextCursor: null,
              totalPages: 0,
            },
            totalCount,
          });
        }

        const getPaginatedUsers = await fastify.cache.wrap(
          cacheKey,
          300,
          async () => {
            /**
             * STEP 1
             * PAGINATE ONLY ROLE IDS
             */
            const pageRoleRows = await db
              .select({
                id: role.id,
                updatedAt: role.updatedAt,
              })
              .from(role)
              .where(
                cursor
                  ? or(
                      orderBy === "desc"
                        ? lt(role.updatedAt, cursor.updatedAt)
                        : gt(role.updatedAt, cursor.updatedAt),
                      and(
                        eq(role.updatedAt, cursor.updatedAt),
                        orderBy === "desc"
                          ? lt(role.id, cursor.id)
                          : gt(role.id, cursor.id),
                      ),
                    )
                  : undefined,
              )
              .orderBy(
                orderBy === "desc" ? desc(role.updatedAt) : asc(role.updatedAt),
                orderBy === "desc" ? desc(role.id) : asc(role.id),
              )
              .limit(queryLimit);

            if (pageRoleRows.length === 0) return [];

            const pageRoleIds = pageRoleRows.map((row) => row.id);

            /**
             * STEP 2
             * FETCH ROLES
             */
            const roles = await db
              .select()
              .from(role)
              .where(inArray(role.id, pageRoleIds));

            /**
             * STEP 3
             * FETCH USERS SEPARATELY
             */
            const users = await db
              .select()
              .from(user)
              .where(inArray(user.roleId, pageRoleIds));

            /**
             * STEP 4
             * FETCH PERMISSIONS SEPARATELY
             */
            const permissions = await db
              .select()
              .from(rolePermission)
              .where(inArray(rolePermission.roleId, pageRoleIds));

            /**
             * STEP 5
             * CREATE LOOKUP MAPS
             */
            const usersByRoleId = new Map<string, typeof users>();

            for (const u of users) {
              const roleId = u.roleId;

              if (!roleId) {
                continue;
              }

              const existing = usersByRoleId.get(roleId);

              if (existing) {
                existing.push(u);
              } else {
                usersByRoleId.set(roleId, [u]);
              }
            }

            const permissionsByRoleId = new Map<string, string[]>();

            for (const p of permissions) {
              const permission = p.permission;
              const existing = permissionsByRoleId.get(p.roleId);

              if (existing) {
                if (!existing.includes(permission)) {
                  existing.push(permission);
                }
              } else {
                permissionsByRoleId.set(p.roleId, [permission]);
              }
            }

            /**
             * STEP 6
             * CREATE ROLE LOOKUP
             */
            const roleMap = new Map(
              roles.map((r) => [
                r.id,
                {
                  ...r,
                  users: usersByRoleId.get(r.id) ?? [],
                  permissions: permissionsByRoleId.get(r.id) ?? [],
                },
              ]),
            );

            /**
             * STEP 7
             * PRESERVE CURSOR ORDER
             */
            const ordered: UserRolesNodes[] = [];

            const seen = new Set<string>();

            for (const row of pageRoleRows) {
              if (seen.has(row.id)) continue;

              seen.add(row.id);

              const roleNode = roleMap.get(row.id);

              if (roleNode) {
                ordered.push(roleNode);
              }
            }

            return ordered;
          },
        );

        const hasNextPage = getPaginatedUsers.length > clampedPageSize;

        const currentPageItems = hasNextPage
          ? getPaginatedUsers.slice(0, clampedPageSize)
          : getPaginatedUsers;

        const newNextCursor =
          currentPageItems.length > 0
            ? {
                id: currentPageItems[currentPageItems.length - 1].id,
                updatedAt:
                  currentPageItems[currentPageItems.length - 1].updatedAt,
              }
            : null;

        return reply.code(200).send({
          nodes: currentPageItems,
          pageInfo: {
            hasNextPage,
            nextCursor: newNextCursor,
            totalPages: Math.ceil(totalCount / clampedPageSize),
          },
          totalCount,
        });
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );
}
