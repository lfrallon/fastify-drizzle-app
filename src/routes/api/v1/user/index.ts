import { and, asc, desc, eq, gt, lt, or } from "drizzle-orm";
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
import { buildTodosCacheKey } from "#/lib/todos/index.ts";

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
    .get("", async function (request: FastifyRequest, reply: FastifyReply) {
      const permissionResult = await accessPermissionCheck(
        request.headers,
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
        querystring: z
          .object({
            id: z.string().optional().meta({
              description: "The id of the last item from the previous page",
              example: "",
            }),
            updatedAt: z.string().optional().meta({
              description: "The date of the last item from the previous page",
              example: "",
            }),
            pageSize: z.coerce.number().default(10).meta({
              description: "Number of items to return per page",
              example: 10,
            }),
            orderBy: z.enum(["asc", "desc"]).default("desc").meta({
              description: "Order of the items",
              example: "desc",
            }),
            limit: z.coerce.number().optional().meta({
              description:
                "Optional alias for pageSize, clamped by the API for safety",
              example: 200,
            }),
          })
          .refine((data) => !(data.id && !data.updatedAt), {
            message: "'id' is required.",
            path: ["id"],
          })
          .refine((data) => !(data.updatedAt && !data.id), {
            message: "'updatedAt' is required.",
            path: ["updatedAt"],
          }),
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

        const rawRequestedLimit = limit ?? pageSize;
        const clampedPageSize = Math.min(Math.max(rawRequestedLimit, 1), 200);

        const cursor =
          updatedAt && id
            ? {
                id,
                updatedAt,
              }
            : undefined;
        const queryLimit = clampedPageSize + 1;

        const cacheKey = buildTodosCacheKey({
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
            const usersCached = await db
              .select()
              .from(user)
              .leftJoin(role, eq(user.roleId, role.id))
              .leftJoin(rolePermission, eq(user.roleId, role.id))
              .where(
                cursor
                  ? or(
                      orderBy === "desc"
                        ? lt(user.updatedAt, cursor.updatedAt)
                        : gt(user.updatedAt, cursor.updatedAt),
                      and(
                        eq(user.updatedAt, cursor.updatedAt),
                        lt(user.id, cursor.id),
                      ),
                    )
                  : undefined,
              )
              .limit(queryLimit)
              .orderBy(
                orderBy === "desc" ? desc(user.updatedAt) : asc(user.updatedAt),
                orderBy === "desc" ? desc(user.id) : asc(user.id),
              );

            const map = new Map<
              string,
              { user: UserSelect; role: string | null; permissions: string[] }
            >();

            console.log("🚀 ~ usersCached:", usersCached);

            for (const row of usersCached) {
              const uid = row.user.id;
              const perm = row.role_permission?.permission ?? null;

              if (!map.has(uid)) {
                map.set(uid, {
                  user: row.user,
                  role: row.role?.name ?? null,
                  permissions: perm ? [perm] : [],
                });
              } else if (perm) {
                const entry = map.get(uid)!;
                if (!entry.permissions.includes(perm)) {
                  entry.permissions.push(perm);
                }
              }
            }

            // preserve original ordering from usersCached
            const ordered = [] as {
              user: UserSelect;
              role: string | null;
              permissions: string[];
            }[];
            const seen = new Set<string>();
            for (const row of usersCached) {
              const uid = row.user.id;
              if (!seen.has(uid)) {
                seen.add(uid);
                ordered.push(map.get(uid)!);
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
        console.log("🚀 ~ currentPageItems:", currentPageItems);

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
}
