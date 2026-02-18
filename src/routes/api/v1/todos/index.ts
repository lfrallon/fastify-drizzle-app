import { eq, inArray, or, and, desc, lt, gt, asc } from "drizzle-orm";
import { z } from "zod";

// types
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// auth lib
import auth from "#/lib/auth.ts";

// db
import { db } from "#/db/index.ts";
import { todos } from "#/drizzle/schema/schema.ts";

const addTodosBodySchema = z.object({
  title: z.string({ error: "Invalid input." }),
});

const deleteTodosBodySchema = z.object({
  ids: z.array(z.uuid(), {
    error: "No id's provided.",
  }),
});

const todosQuerySchema = z
  .object({
    id: z.string().optional(),
    createdAt: z.string().optional(),
    pageSize: z.coerce.number().default(10),
    orderBy: z.enum(["asc", "desc"]).default("asc"),
  })
  .refine((data) => !(data.id && !data.createdAt), {
    message: "'id' is required.",
    path: ["id"],
  })
  .refine((data) => !(data.createdAt && !data.id), {
    message: "'createdAt' is required.",
    path: ["createdAt"],
  });

export default async function (fastify: FastifyInstance) {
  // GET /api/v1/todos
  fastify.withTypeProvider<ZodTypeProvider>().get(
    "",
    {
      schema: {
        querystring: todosQuerySchema,
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

        const getPaginatedTodos = await db
          .select()
          .from(todos)
          .where(
            // make sure to add indices for the columns that you use for cursor
            cursor
              ? or(
                  orderBy === "desc"
                    ? lt(todos.createdAt, cursor.createdAt)
                    : gt(todos.createdAt, cursor.createdAt),
                  and(
                    eq(todos.createdAt, cursor.createdAt),
                    lt(todos.id, cursor.id),
                    eq(todos.userId, session.user.id),
                  ),
                )
              : eq(todos.userId, session.user.id),
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
  fastify.withTypeProvider<ZodTypeProvider>().post(
    "/add",
    {
      schema: {
        body: addTodosBodySchema,
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
  fastify.withTypeProvider<ZodTypeProvider>().delete(
    "",
    {
      schema: {
        body: deleteTodosBodySchema,
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
          .where(inArray(todos.id, ids))
          .returning();

        return reply.send({
          message: `${deletedTodos.length} item/s deleted successfully`,
          deletedItems: deletedTodos.map((item) => {
            return {
              id: item.id,
              title: item.title,
            };
          }),
        });
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );
}
