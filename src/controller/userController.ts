import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

// auth lib
import { auth } from "../lib/auth.ts";

export default async function userController(fastify: FastifyInstance) {
  // GET /api/v1/user
  fastify.get(
    "/",
    async function (request: FastifyRequest, reply: FastifyReply) {
      const session = await auth.api.getSession({ headers: request.headers });
      fastify.log.info(
        "🚀 ~ userController ~ session id: " + session?.session?.id,
      );

      if (!session || !session.user) {
        return reply.status(403).send({ error: "Unauthorized" });
      }

      // For demonstration, return the first account's info
      const account = session.user;
      reply.send(account);
    },
  );
}
