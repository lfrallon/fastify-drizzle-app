import { eq } from "drizzle-orm";
import { z } from "zod";

// types
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// auth lib
import { auth } from "../lib/auth.ts";

// db
import { db } from "../db/index.ts";
import { todos } from "../drizzle/schema/schema.ts";

const postBodySchema = z.object({
  title: z.string().min(5, "Title is required."),
});

export default async function todosController(fastify: FastifyInstance) {
  // GET /api/v1/todos
  fastify.get(
    "/",

    async function (request: FastifyRequest, reply: FastifyReply) {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session || !session.user) {
        return reply.status(403).send({ error: "Unauthorized" });
      }

      fastify.log.info(
        "🚀 ~ todosController ~ session id: " + session?.session?.id,
      );

      const todo = await db
        .select()
        .from(todos)
        .where(eq(todos.userId, session.user.id));

      reply.send(todo);
    },
  );

  // POST /api/v1/todos
  fastify.withTypeProvider<ZodTypeProvider>().post(
    "/",
    {
      schema: {
        body: postBodySchema,
      },
    },
    async ({ body, headers }, reply) => {
      const session = await auth.api.getSession({ headers });
      if (!session || !session.user) {
        return reply.status(403).send({ error: "Unauthorized" });
      }

      const { title } = body;

      const addTodo = await db
        .insert(todos)
        .values({ title, userId: session.user.id })
        .returning();

      reply.send(addTodo[0]);
    },
  );
}
