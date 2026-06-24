import { and, asc, desc, eq, gt, inArray, lt, or } from "drizzle-orm";
import { verify } from "@node-rs/argon2";
import { v4 } from "uuid";
import z from "zod";

// db
import { db } from "#/db/index.ts";
import { roles, rolePermissions, account } from "#/drizzle/schema/index.ts";

// libs
import { argon2Options } from "#/lib/auth.ts";
import { buildUserRolesCacheKey } from "#/lib/roles/index.ts";

// hooks
import { requirePermission } from "#/hooks/index.ts";

// types
import type { TypedFastifyInstance } from "#/types/fastify.js";
import type { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";

type Permissions = {
  id: string;
  createdAt: string;
  updatedAt: string;
  action: "create" | "read" | "update" | "delete";
  resource: string;
  permission: string;
};

interface RolesNodes {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
  permissions: Permissions[];
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
      preHandler: requirePermission("roles:read"),
      schema: {
        querystring: CursorPaginationQuerySchema,
      },
    },
    async function ({ query, currentUser, session }, reply) {
      if (currentUser.role !== "Admin") {
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
          userId: session.user.id,
          clampedPageSize,
          orderBy,
          cursor,
        });

        const totalCount = await db.$count(roles);

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

        const getPaginatedRoles = await fastify.cache.wrap(
          cacheKey,
          300,
          async () => {
            const pageRoleRows = await db
              .select({
                id: roles.id,
                updatedAt: roles.updatedAt,
              })
              .from(roles)
              .where(
                cursor
                  ? or(
                      orderBy === "desc"
                        ? lt(roles.updatedAt, cursor.updatedAt)
                        : gt(roles.updatedAt, cursor.updatedAt),
                      and(
                        eq(roles.updatedAt, cursor.updatedAt),
                        orderBy === "desc"
                          ? lt(roles.id, cursor.id)
                          : gt(roles.id, cursor.id),
                      ),
                    )
                  : undefined,
              )
              .orderBy(
                orderBy === "desc"
                  ? desc(roles.updatedAt)
                  : asc(roles.updatedAt),
                orderBy === "desc" ? desc(roles.id) : asc(roles.id),
              )
              .limit(queryLimit);

            if (pageRoleRows.length === 0) return [];

            const pageRoleIds = pageRoleRows.map((row) => row.id);

            const rolesQuery = await db
              .select()
              .from(roles)
              .where(inArray(roles.id, pageRoleIds));

            const rolesAndPermissionsQuery = await db.query.roles.findMany({
              where: inArray(roles.id, pageRoleIds),
              with: {
                rolePermissions: {
                  with: {
                    permission: true,
                  },
                },
              },
            });

            const permissionsByRoleId = new Map<string, Permissions[]>();

            for (const role of rolesAndPermissionsQuery) {
              const roles = role.rolePermissions;

              for (const r of roles) {
                if (r.roleId) {
                  const existing = permissionsByRoleId.get(r.roleId);
                  if (existing) {
                    if (!existing.includes(r.permission)) {
                      existing.push(r.permission);
                    }
                  } else {
                    permissionsByRoleId.set(r.roleId, [r.permission]);
                  }
                }
              }
            }

            const roleMap = new Map(
              rolesQuery.map((r) => [
                r.id,
                {
                  ...r,
                  permissions: permissionsByRoleId.get(r.id) ?? [],
                },
              ]),
            );

            const ordered: RolesNodes[] = [];

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

        const hasNextPage = getPaginatedRoles.length > clampedPageSize;

        const currentPageItems = hasNextPage
          ? getPaginatedRoles.slice(0, clampedPageSize)
          : getPaginatedRoles;

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

  // POST /api/v1/roles/create
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/create",
    {
      preHandler: requirePermission("roles:create"),
      schema: {
        body: z.object({
          roleName: z.string().min(2, "Role name").meta({ example: "User" }),
          description: z
            .string()
            .min(2, "Description")
            .meta({ example: "Limitted system access." }),
          permissions: z
            .array(z.string())
            .default([])
            .optional()
            .meta({ description: "Role permissions", example: "user:read" }),
        }),
      },
    },
    async ({ session, body }, reply) => {
      try {
        const { roleName, description, permissions } = body;

        if (!roleName || roleName.trim().length === 0) {
          return reply.code(400).send({ error: "Role name is required!" });
        }

        if (!description || description.trim().length === 0) {
          return reply.code(400).send({ error: "Description is required!" });
        }

        const newRole = await db.transaction(async (tx) => {
          const [insertedRole] = await tx
            .insert(roles)
            .values({
              id: v4(),
              name: roleName,
              description,
              isSystem: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            .returning();

          if (permissions && permissions.length > 0) {
            for (const perm of permissions) {
              await tx.insert(rolePermissions).values({
                roleId: insertedRole.id,
                permissionId: perm.trim(),
                createdAt: new Date().toISOString(),
              });
            }
          }

          return insertedRole;
        });

        await fastify.cache.delByPrefix(
          `user:roles|userId:${session.user.id}|`,
        );

        return reply.code(201).send({
          success: true,
          role: { id: newRole.id, name: newRole.name },
        });
      } catch (_error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // PATCH /api/v1/roles/update
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().patch(
    "/update",
    {
      preHandler: requirePermission("roles:update"),
      schema: {
        body: z.object({
          roleId: z.uuid().meta({ description: "Role id." }),
          roleName: z
            .string()
            .min(2, "Role name")
            .optional()
            .meta({ example: "User" }),
          description: z
            .string()
            .min(2, "Description")
            .optional()
            .meta({ example: "Limitted system access." }),
          permissions: z
            .union([
              z.array(z.uuid()).meta({
                description: "Role permissions",
                example: "123e4567-e89b-12d3-a456-426614174000",
              }),
              z.null().meta({ description: "Remove all permission access." }),
            ])
            .optional()
            .meta({
              description: "Optional role permissions.",
              example: `["user:create"] | "null" | []`,
            }),
        }),
      },
    },
    async ({ session, body }, reply) => {
      try {
        const { roleId, description, roleName, permissions } = body;

        if (!roleId || roleId.trim().length === 0) {
          return reply
            .code(400)
            .send({ error: "Role id is required to proceed!" });
        }

        const updatedRolePermissions = await db.transaction(async (tx) => {
          const [updateRolePermissions] = await tx
            .update(roles)
            .set({
              ...(description ? { description } : {}),
              ...(roleName ? { name: roleName } : {}),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(roles.id, roleId))
            .returning();

          if (permissions === null) {
            const currentPermissions = await tx
              .select({
                permissionId: rolePermissions.permissionId,
              })
              .from(rolePermissions)
              .where(eq(rolePermissions.roleId, roleId));

            if (currentPermissions && currentPermissions.length === 0) return;

            const toBeDeletedIds = currentPermissions.map(
              (p) => p.permissionId,
            );
            await tx
              .delete(rolePermissions)
              .where(inArray(rolePermissions.permissionId, toBeDeletedIds));

            await fastify.cache.delByPrefix(
              `user:permissions|userId:${session.user.id}|`,
            );
          }

          if (
            typeof permissions === "object" &&
            permissions &&
            permissions.length > 0
          ) {
            const queryCurrentPerms = await tx
              .select({
                permissionId: rolePermissions.permissionId,
              })
              .from(rolePermissions)
              .where(eq(rolePermissions.roleId, roleId));

            const currentPermissions = queryCurrentPerms.map(
              (p) => p.permissionId,
            );

            const toAddPermissions = permissions.filter(
              (newPerms) => !currentPermissions.includes(newPerms),
            );

            const toRemovePermissions = currentPermissions.filter(
              (rmPerms) => !permissions.includes(rmPerms),
            );

            if (toRemovePermissions.length > 0) {
              await tx
                .delete(rolePermissions)
                .where(
                  inArray(rolePermissions.permissionId, toRemovePermissions),
                );
            }

            if (toAddPermissions.length > 0) {
              for (const perm of toAddPermissions) {
                if (perm) {
                  await tx.insert(rolePermissions).values({
                    permissionId: perm,
                    roleId: roleId,
                    createdAt: new Date().toISOString(),
                  });
                }
              }
            }
          }
          return updateRolePermissions;
        });

        await fastify.cache.delByPrefix(
          `user:roles|userId:${session.user.id}|`,
        );

        return reply.code(201).send({
          success: true,
          role: updatedRolePermissions,
        });
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // DELETE /api/v1/roles/delete
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().delete(
    "/delete",
    {
      preHandler: requirePermission("roles:delete"),
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
    async ({ body, currentUser, session }, reply) => {
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
          .where(eq(account.userId, currentUser.id))
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

        const deletedRoles = await db
          .delete(roles)
          .where(inArray(roles.id, ids))
          .returning();

        if (deletedRoles.length === 0) {
          return reply.code(404).send({ error: "Request not completed." });
        }

        await fastify.cache.delByPrefix(
          `user:roles|userId:${session.user.id}|`,
        );

        return reply.send({
          message: `${deletedRoles.length} item/s deleted successfully`,
          deletedItems: deletedRoles.map((item) => ({
            id: item.id,
            role: item.name,
          })),
        });
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );
}
