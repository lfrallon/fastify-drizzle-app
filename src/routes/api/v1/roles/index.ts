import { and, asc, desc, eq, gt, inArray, lt, or } from "drizzle-orm";
import z from "zod";

// db
import { db } from "#/db/index.ts";
import { role, rolePermission, user } from "#/drizzle/schema/index.ts";

// libs
import { accessPermissionCheck } from "#/utils/rbac.ts";
import { buildUserRolesCacheKey } from "#/lib/roles/index.ts";

// types
import type { TypedFastifyInstance } from "#/types/index.ts";
import type { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";

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

export default async function (fastify: TypedFastifyInstance) {
  // GET /api/v1/roles
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "",
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
