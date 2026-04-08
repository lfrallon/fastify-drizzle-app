import { eq, inArray, or, and, desc, lt, gt, asc } from "drizzle-orm";
import { z } from "zod";

// db
import { db } from "#/db/index.ts";
import { todos } from "#/drizzle/schema/schema.ts";

// libs
import { accessPermissionCheck } from "#/utils/rbac.ts";
import { buildTodosCacheKey } from "#/lib/todos/index.ts";

// types
import type { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import type { TypedFastifyInstance } from "#/types/index.ts";

export default async function (fastify: TypedFastifyInstance) {
  // GET /api/v1/todos
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "",
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
      const permissionResult = await accessPermissionCheck(headers, "Read");
      if (!permissionResult.currentUser || !permissionResult.currentUser) {
        return reply.status(permissionResult.statusCode).send({
          error: permissionResult.error,
          ...(permissionResult.message
            ? { message: permissionResult.message }
            : {}),
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

        const totalCount = await db.$count(
          todos,
          eq(todos.userId, permissionResult.session.user.id),
        );

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

        const getPaginatedTodos = await fastify.cache.wrap(
          cacheKey,
          300,
          async () => {
            const todosCached = await db
              .select()
              .from(todos)
              .where(
                and(
                  eq(todos.userId, permissionResult.session.user.id),
                  cursor
                    ? or(
                        orderBy === "desc"
                          ? lt(todos.updatedAt, cursor.updatedAt)
                          : gt(todos.updatedAt, cursor.updatedAt),
                        and(
                          eq(todos.updatedAt, cursor.updatedAt),
                          lt(todos.id, cursor.id),
                        ),
                      )
                    : undefined,
                ),
              )
              .limit(queryLimit)
              .orderBy(
                orderBy === "desc"
                  ? desc(todos.updatedAt)
                  : asc(todos.updatedAt),
                orderBy === "desc" ? desc(todos.id) : asc(todos.id),
              );

            return todosCached;
          },
        );

        const hasNextPage = getPaginatedTodos.length > clampedPageSize;

        const currentPageItems = hasNextPage
          ? getPaginatedTodos.slice(0, clampedPageSize)
          : getPaginatedTodos;

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

  // POST /api/v1/todos
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/add",
    {
      schema: {
        body: z.object({
          title: z
            .string({ error: "Invalid input." })
            .meta({ description: "Todo title", example: "Water the plants." }),
        }),
      },
    },
    async ({ body, headers }, reply) => {
      const permissionResult = await accessPermissionCheck(headers, "Create");
      if (!permissionResult.currentUser || !permissionResult.currentUser) {
        return reply.status(permissionResult.statusCode).send({
          error: permissionResult.error,
          ...(permissionResult.message
            ? { message: permissionResult.message }
            : {}),
        });
      }

      const { title } = body;

      if (!title || title.length === 0) {
        return reply.code(400).send({ error: "No title provided!" });
      }

      try {
        const addedTodo = await db
          .insert(todos)
          .values({ title, userId: permissionResult.session.user.id })
          .returning();

        await fastify.cache.delByPrefix("todos:");

        return reply.send(addedTodo[0]);
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // DELETE /api/v1/todos
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().delete(
    "",
    {
      schema: {
        body: z.object({
          ids: z
            .array(z.uuid(), {
              error: "No id's provided.",
            })
            .meta({
              description: "Todo's id's",
              example: ["123e4567-e89b-12d3-a456-426614174000"],
            }),
        }),
      },
    },
    async ({ body, headers }, reply) => {
      const permissionResult = await accessPermissionCheck(headers, "Delete");
      if (!permissionResult.currentUser || !permissionResult.currentUser) {
        return reply.status(permissionResult.statusCode).send({
          error: permissionResult.error,
          ...(permissionResult.message
            ? { message: permissionResult.message }
            : {}),
        });
      }

      const { ids } = body;

      if (!ids || ids.length === 0) {
        return reply.code(400).send({ error: "No id's provided." });
      }

      try {
        const deletedTodos = await db
          .delete(todos)
          .where(
            and(
              eq(todos.userId, permissionResult.session.user.id),
              inArray(todos.id, ids),
            ),
          )
          .returning();

        if (deletedTodos.length === 0) {
          return reply.code(404).send({ error: "Request not completed." });
        }

        await fastify.cache.delByPrefix("todos:");

        return reply.send({
          message: `${deletedTodos.length} item/s deleted successfully`,
          deletedItems: deletedTodos.map((item) => ({
            id: item.id,
            title: item.title,
          })),
        });
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // PUT /api/v1/todos
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().put(
    "/update",
    {
      schema: {
        body: z.array(
          z
            .object({
              id: z.uuid().meta({
                description: "The id of the todo item",
                example: "123e4567-e89b-12d3-a456-426614174000",
              }),
              title: z.string().optional().meta({
                description: "The new title of the todo item",
                example: "Water the plants.",
              }),
              completed: z.boolean().optional().meta({
                description: "The new completion status of the todo item",
                example: true,
              }),
            })
            .refine(
              (data) =>
                data.title !== undefined || data.completed !== undefined,
              {
                message:
                  "At least one of 'title' or 'completed' must be provided.",
              },
            ),
        ),
      },
    },
    async ({ body, headers }, reply) => {
      const permissionResult = await accessPermissionCheck(headers, "Update");
      if (!permissionResult.currentUser || !permissionResult.currentUser) {
        return reply.status(permissionResult.statusCode).send({
          error: permissionResult.error,
          ...(permissionResult.message
            ? { message: permissionResult.message }
            : {}),
        });
      }

      try {
        const updatedTodos = [];

        for (const item of body) {
          const { id, title, completed } = item;

          const existingTodo = await db
            .select()
            .from(todos)
            .where(
              and(
                eq(todos.id, id),
                eq(todos.userId, permissionResult.session.user.id),
              ),
            )
            .limit(1)
            .then((rows) => rows[0] || undefined);

          if (!existingTodo) {
            continue;
          }

          const updatedTodo = await db
            .update(todos)
            .set({
              title: title !== undefined ? title : existingTodo.title,
              completed:
                completed !== undefined ? completed : existingTodo.completed,
            })
            .where(eq(todos.id, id))
            .returning();

          if (updatedTodo.length > 0) {
            updatedTodos.push(updatedTodo[0]);
          }
        }

        if (updatedTodos.length === 0) {
          return reply.code(404).send({
            error: "No items were updated. Please check the provided ids.",
          });
        }

        await fastify.cache.delByPrefix("todos:");

        return reply.send({
          message: `${updatedTodos.length} item/s updated successfully`,
          updatedItems: updatedTodos.map((item) => ({
            id: item.id,
            title: item.title,
            completed: item.completed,
          })),
        });
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );
}
