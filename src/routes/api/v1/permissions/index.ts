import { and, asc, desc, eq, gt, inArray, lt, or } from "drizzle-orm";
import { verify } from "@node-rs/argon2";
import { v4 } from "uuid";
import z from "zod";

// db
import { db } from "#/db/index.ts";
import { account, permissions } from "#/drizzle/schema/index.ts";

// libs
import { accessPermissionCheck } from "#/utils/rbac.ts";
import { argon2Options } from "#/lib/auth.ts";
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

        const totalCount = await db.$count(permissions);

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
                id: permissions.id,
                createdAt: permissions.createdAt,
                updatedAt: permissions.updatedAt,
                action: permissions.action,
                resource: permissions.resource,
                permission: permissions.permission,
              })
              .from(permissions)
              .where(
                cursor
                  ? or(
                      orderBy === "desc"
                        ? lt(permissions.updatedAt, cursor.updatedAt)
                        : gt(permissions.updatedAt, cursor.updatedAt),
                      and(
                        eq(permissions.updatedAt, cursor.updatedAt),
                        lt(permissions.id, cursor.id),
                      ),
                    )
                  : undefined,
              )
              .limit(queryLimit)
              .orderBy(
                orderBy === "desc"
                  ? desc(permissions.updatedAt)
                  : asc(permissions.updatedAt),
                orderBy === "desc" ? desc(permissions.id) : asc(permissions.id),
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
      } catch (_error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // POST /api/v1/permissions/create
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/create",
    {
      schema: {
        body: z.object({
          resource: z
            .string()
            .min(2, "Resource is required")
            .meta({ example: "user" }),
          key: z
            .string()
            .min(2, "Key is required")
            .meta({ example: "user:create" }),
          action: z
            .enum(["create", "read", "update", "delete"])
            .meta({ example: "create | read | update | delete" }),
        }),
      },
    },
    async ({ headers, body }, reply) => {
      const permissionResult = await accessPermissionCheck(
        headers,
        "user:create",
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
        const { action, key, resource } = body;

        if (action.trim().length === 0) {
          return reply.code(400).send({ error: "Action is required!" });
        }

        if (key.trim().length === 0) {
          return reply.code(400).send({ error: "Key is required!" });
        }

        if (resource.trim().length === 0) {
          return reply.code(400).send({ error: "Resource is required!" });
        }

        const newPermission = await db.transaction(async (tx) => {
          const [insertedPermission] = await tx
            .insert(permissions)
            .values({
              id: v4(),
              action,
              permission: key,
              resource,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            .returning();

          return insertedPermission;
        });

        await fastify.cache.delByPrefix(
          `user:permissions|userId:${permissionResult.session.user.id}|`,
        );

        return reply.code(201).send({
          success: true,
          permission: { id: newPermission.id, key: newPermission.permission },
        });
      } catch (_error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // POST /api/v1/permissions/update
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().patch(
    "/update",
    {
      schema: {
        body: z.object({
          id: z.string().min(2, "Permission id is required."),
          resource: z
            .string()
            .min(2, "Resource")
            .meta({ example: "user" })
            .optional(),
          key: z
            .string()
            .min(2, "Key")
            .meta({ example: "user:create" })
            .optional(),
          action: z
            .enum(["create", "read", "update", "delete"])
            .meta({ example: "create | read | update | delete" })
            .optional(),
          roleId: z
            .string()
            .meta({ example: "123e4567-e89b-12d3-a456-426614174000" })
            .optional(),
        }),
      },
    },
    async ({ headers, body }, reply) => {
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

      try {
        const { id, ...payload } = body;
        const updatedFields = { ...payload };

        if (id.trim().length === 0) {
          return reply.code(400).send({ error: "Permission id is required!" });
        }

        const updatePermission = await db.transaction(async (tx) => {
          const [updatePermission] = await tx
            .update(permissions)
            .set({
              ...(updatedFields.key ? { permission: updatedFields.key } : {}),
              ...updatedFields,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(permissions.id, id))
            .returning();

          return updatePermission;
        });

        await fastify.cache.delByPrefix(
          `user:permissions|userId:${permissionResult.session.user.id}|`,
        );

        return reply.code(201).send({
          success: true,
          permission: {
            id: updatePermission.id,
            key: updatePermission.permission,
          },
        });
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // DELETE /api/v1/permissions/delete
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().delete(
    "/delete",
    {
      schema: {
        body: z.object({
          ids: z
            .array(z.uuid(), {
              error: "No id's provided.",
            })
            .meta({
              description: "Permission id's",
              example: ["123e4567-e89b-12d3-a456-426614174000"],
            }),
          password: z
            .string()
            .min(8, `Confirm password must contain at least 8 characters.`)
            .regex(
              /[a-zA-Z]/,
              `Confirm password must contain at least one letter.`,
            )
            .regex(
              /[0-9]/,
              `Confirm password must contain at least one number.`,
            )
            .regex(
              /[^a-zA-Z0-9]/,
              `Confirm password must contain at least one special character.`,
            )
            .trim(),
        }),
      },
    },
    async ({ headers, body }, reply) => {
      const permissionResult = await accessPermissionCheck(
        headers,
        "user:delete",
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
        const { password, ids } = body;

        if (password.trim().length === 0) {
          return reply
            .code(400)
            .send({ error: "Password is required to proceed!" });
        }

        if (!ids || ids.length === 0) {
          return reply.code(400).send({ error: "No id's provided." });
        }

        const [currentAccount] = await db
          .select({
            id: account.id,
            userId: account.userId,
            password: account.password,
          })
          .from(account)
          .where(eq(account.userId, permissionResult.currentUser.id))
          .limit(1);

        if (!currentAccount) {
          return reply.status(404).send({ error: "User not found!" });
        }

        const isValid = await verify(
          currentAccount.password,
          password,
          argon2Options,
        );

        if (!isValid) {
          return reply.status(401).send({ error: "Invalid password" });
        }

        // TODO: Block permission request deletion if it is a system permission
        const deletedPermissions = await db
          .delete(permissions)
          .where(inArray(permissions.id, ids))
          .returning();

        if (deletedPermissions.length === 0) {
          return reply.code(404).send({ error: "Request not completed." });
        }

        await fastify.cache.delByPrefix(
          `user:permissions|userId:${permissionResult.session.user.id}|`,
        );

        return reply.send({
          message: `${deletedPermissions.length} item/s deleted successfully`,
          deletedItems: deletedPermissions.map((item) => ({
            id: item.id,
            permission: item.permission,
          })),
        });
      } catch (_error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );
}
