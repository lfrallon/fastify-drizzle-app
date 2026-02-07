import { asc, eq, inArray, or, gt, and } from "drizzle-orm";
import { z } from "zod";

// types
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// auth lib
import { auth } from "../lib/auth.ts";

// db
import { db } from "../db/index.ts";
import { todos } from "../drizzle/schema/schema.ts";

const addTodosBodySchema = z.object({
  title: z.string().min(5, "Title is required."),
});

const deleteTodosBodySchema = z.object({
  ids: z.array(z.uuid(), {
    error: "No id's provided.",
  }),
});

interface IQueryCursor {
  id: string;
  createdAt: string;
}

const todosQuerySchema = z.object({
  cursor: z.string().optional(),
  pageSize: z.string().optional(),
});

export default async function todosController(fastify: FastifyInstance) {
  // GET /api/v1/todos
  fastify.withTypeProvider<ZodTypeProvider>().get(
    "/",
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

      const cursor: IQueryCursor | undefined = query.cursor
        ? JSON.parse(query.cursor)
        : undefined;

      const pageSize = parseInt(query.pageSize ?? "10");

      try {
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
                  gt(todos.createdAt, cursor.createdAt),
                  and(
                    eq(todos.createdAt, cursor.createdAt),
                    gt(todos.id, cursor.id),
                    eq(todos.userId, session.user.id),
                  ),
                )
              : eq(todos.userId, session.user.id),
          )
          .limit(pageSize)
          .orderBy(asc(todos.createdAt), asc(todos.id));

        const newCursor = {
          id: getPaginatedTodos[getPaginatedTodos.length - 1].id,
          createdAt: getPaginatedTodos[getPaginatedTodos.length - 1].createdAt,
        };

        // const getPaginatedTodos = await db
        //   .select()
        //   .from(todos)
        //   .orderBy(asc(todos.id))
        //   .limit(limit)
        //   .offset(offset)
        //   .where(eq(todos.userId, session.user.id));

        return {
          data: getPaginatedTodos,
          pageInfo: {
            cursor: newCursor,
          },
          pageSize,
          totalPages: Math.ceil(totalCount / pageSize),
          totalCount,
        };
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // POST /api/v1/todos
  fastify.withTypeProvider<ZodTypeProvider>().post(
    "/",
    {
      schema: {
        body: addTodosBodySchema,
      },
    },
    async ({ body, headers }, reply) => {
      const session = await auth.api.getSession({ headers });
      if (!session || !session.user) {
        return reply.status(403).send({ error: "Unauthorized" });
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
    "/",
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
