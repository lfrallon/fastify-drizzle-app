import { eq } from "drizzle-orm";

// types
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

// auth lib
import { auth } from "../lib/auth.ts";

// db
import { db } from "../db/index.ts";
import { user } from "../drizzle/schema/index.ts";

export default async function userController(fastify: FastifyInstance) {
  // GET /api/v1/user
  fastify.get(
    "/",
    async function (request: FastifyRequest, reply: FastifyReply) {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session || !session.user) {
        return reply.status(403).send({ error: "Unauthorized" });
      }

      fastify.log.info(
        "🚀 ~ userController ~ session id: " + session?.session?.id,
      );

      const userInfo = await db
        .select()
        .from(user)
        .where(eq(user.id, session.user.id));

      reply.send(userInfo[0]);
    },
  );

  fastify.put<{ Body: { name: string } }>(
    "/",
    async ({ body, headers }, reply) => {
      const session = await auth.api.getSession({ headers });
      if (!session || !session.user) {
        return reply.status(403).send({ error: "Unauthorized" });
      }

      fastify.log.info(
        "🚀 ~ userController ~ session id: " + session?.session?.id,
      );

      const { name } = body;
      console.log("🚀 ~ userController ~ name:", name);

      const updateUser = await db
        .update(user)
        .set({
          name,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(user.id, session.user.id))
        .returning();

      console.log("🚀 ~ userController ~ updateUser:", updateUser);

      reply.send(updateUser[0]);
    },
  );
}
