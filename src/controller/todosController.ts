import { asc, eq, inArray } from "drizzle-orm";
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
  ids: z.array(z.number(), {
    error: "No id's provided.",
  }),
});

const todosQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
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

      const page = parseInt(query.page ?? "1");
      const limit = parseInt(query.limit ?? "10");
      const offset = (page - 1) * limit;

      try {
        const totalCount = await db.$count(
          todos,
          eq(todos.userId, session.user.id),
        );
        // const query = db.select().from(todos);
        // const getPaginatedTodos = await withPagination({
        //   qb: query.$dynamic(),
        //   orderByColumn: asc(todos.id),
        //   page,
        //   pageSize: limit,
        // }).where(eq(todos.userId, session.user.id));

        const getPaginatedTodos = await db
          .select()
          .from(todos)
          .orderBy(asc(todos.id))
          .limit(limit)
          .offset(offset)
          .where(eq(todos.userId, session.user.id));

        return {
          data: getPaginatedTodos,
          totalCount,
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit),
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
