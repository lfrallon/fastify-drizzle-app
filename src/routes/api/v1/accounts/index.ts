import { and, asc, desc, eq, gt, inArray, lt, or } from "drizzle-orm";
import z from "zod";

// types
import type { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import type { TypedFastifyInstance } from "#/types/index.ts";

// db
import { db } from "#/db/index.ts";
import { role, rolePermission, user } from "#/drizzle/schema/index.ts";

// libs
import { accessPermissionCheck } from "#/utils/rbac.ts";
import { buildUserAccountsCacheKey } from "#/lib/user/index.ts";

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
  // GET /api/v1/accounts
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
}
