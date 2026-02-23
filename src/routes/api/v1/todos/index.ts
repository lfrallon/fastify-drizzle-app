import { eq, inArray, or, and, desc, lt, gt, asc } from "drizzle-orm";
import { z } from "zod";

// types
import type { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import type { TypedFastifyInstance } from "#/types/index.ts";

// auth lib
import auth from "#/lib/auth.ts";

// db
import { db } from "#/db/index.ts";
import { todos } from "#/drizzle/schema/schema.ts";

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
            createdAt: z.string().optional().meta({
              description:
                "The creation date of the last item from the previous page",
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
          })
          .refine((data) => !(data.id && !data.createdAt), {
            message: "'id' is required.",
            path: ["id"],
          })
          .refine((data) => !(data.createdAt && !data.id), {
            message: "'createdAt' is required.",
            path: ["createdAt"],
          }),
      },
    },
    async function ({ headers, query }, reply) {
      const session = await auth.api.getSession({ headers });
      if (!session || !session.user) {
        return reply.status(403).send({ error: "Unauthorized" });
      }

      try {
        const { createdAt, id, pageSize = 6, orderBy } = query;
        const cursor =
          createdAt && id
            ? {
                id,
                createdAt,
              }
            : undefined;
        const limit = pageSize + 1;

        const totalCount = await db.$count(
          todos,
          eq(todos.userId, session.user.id),
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

        const getPaginatedTodos = await db
          .select()
          .from(todos)
          .where(
            // make sure to add indices for the columns that you use for cursor
            and(
              eq(todos.userId, session.user.id),
              cursor
                ? or(
                    orderBy === "desc"
                      ? lt(todos.createdAt, cursor.createdAt)
                      : gt(todos.createdAt, cursor.createdAt),
                    and(
                      eq(todos.createdAt, cursor.createdAt),
                      lt(todos.id, cursor.id),
                    ),
                  )
                : undefined,
            ),
          )
          .limit(limit)
          .orderBy(
            orderBy === "desc" ? desc(todos.createdAt) : asc(todos.createdAt),
            orderBy === "desc" ? desc(todos.id) : asc(todos.id),
          );

        // Check if we got more items than the requested page size
        const hasNextPage = getPaginatedTodos.length > pageSize;

        // If yes, slice the array to return only the requested page size
        const currentPageItems = hasNextPage
          ? getPaginatedTodos.slice(0, pageSize)
          : getPaginatedTodos;

        // The next cursor will be the ID of the last item in the current page
        const newNextCursor =
          currentPageItems.length > 0
            ? {
                id: currentPageItems[currentPageItems.length - 1].id,
                createdAt:
                  currentPageItems[currentPageItems.length - 1].createdAt,
              }
            : null;

        // const getPaginatedTodos = await db
        //   .select()
        //   .from(todos)
        //   .orderBy(asc(todos.id))
        //   .limit(limit)
        //   .offset(offset)
        //   .where(eq(todos.userId, session.user.id));

        return reply.code(200).send({
          nodes: currentPageItems,
          pageInfo: {
            hasNextPage,
            nextCursor: newNextCursor,
            totalPages: Math.ceil(totalCount / pageSize),
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
      const session = await auth.api.getSession({ headers });
      if (!session || !session.user) {
        reply.status(401).send({ message: "Unauthorized" });
        return;
      }

      const { title } = body;

      if (!title || title.length === 0) {
        return reply.code(400).send({ error: "No title provided!" });
      }

      try {
        const addedTodo = await db
          .insert(todos)
          .values({ title, userId: session.user.id })
          .returning();

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
      const session = await auth.api.getSession({ headers });
      if (!session || !session.user) {
        return reply.status(403).send({ error: "Unauthorized" });
      }

      const { ids } = body;

      if (!ids || ids.length === 0) {
        return reply.code(400).send({ error: "No id's provided." });
      }

      try {
        const deletedTodos = await db
          .delete(todos)
          .where(and(eq(todos.userId, session.user.id), inArray(todos.id, ids)))
          .returning();

        if (deletedTodos.length === 0) {
          return reply.code(404).send({ error: "Request not completed." });
        }

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
      const session = await auth.api.getSession({ headers });
      if (!session || !session.user) {
        return reply.status(403).send({ error: "Unauthorized" });
      }

      try {
        const updatedTodos = [];

        for (const item of body) {
          const { id, title, completed } = item;

          const existingTodo = await db
            .select()
            .from(todos)
            .where(and(eq(todos.id, id), eq(todos.userId, session.user.id)))
            .limit(1)
            .then((rows) => rows[0] || undefined);

          if (!existingTodo) {
            continue; // Skip if the todo item doesn't exist or doesn't belong to the user
          }

          const updatedTodo = await db
            .update(todos)
            .set({
              title: title !== undefined ? title : existingTodo.title,
              completed:
                completed !== undefined ? completed : existingTodo.completed,
              updatedAt: new Date().toLocaleString(),
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
