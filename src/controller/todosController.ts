import { eq } from "drizzle-orm";

// types
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

// auth lib
import { auth } from "../lib/auth.ts";

// db
import { db } from "../db/index.ts";
import { todos } from "../drizzle/schema/schema.ts";

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
}
