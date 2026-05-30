import { and, asc, desc, eq, gt, lt, or } from "drizzle-orm";
import z from "zod";

// db
import { db } from "#/db/index.ts";
import { role, rolePermission } from "#/drizzle/schema/index.ts";

// libs
import { accessPermissionCheck } from "#/utils/rbac.ts";
import { buildUserPermissionsCacheKey } from "#/lib/permissions/index.ts";

// types
import type { TypedFastifyInstance } from "#/types/index.ts";
import type { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";

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
  // GET /api/v1/permissions
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
}
