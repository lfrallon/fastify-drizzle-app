import { eq } from "drizzle-orm";
import z from "zod";

// types
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// auth lib
import { auth } from "../lib/auth.ts";

// db
import { db } from "../db/index.ts";
import { user } from "../drizzle/schema/index.ts";

const putBodySchema = z.object({
  firstName: z.string().min(2, "First name is required."),
  lastName: z.string().min(2, "Last name is required."),
});

export default async function userController(fastify: FastifyInstance) {
  // GET /api/v1/user
  fastify.get(
    "/",
    async function (request: FastifyRequest, reply: FastifyReply) {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session || !session.user) {
        return reply.status(403).send({ error: "Unauthorized" });
      }

      try {
        const userInfo = await db
          .select()
          .from(user)
          .where(eq(user.id, session.user.id));

        return reply.send(userInfo[0]);
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // PUT /api/v1/user
  fastify.withTypeProvider<ZodTypeProvider>().put(
    "/",
    {
      schema: {
        body: putBodySchema,
      },
    },
    async ({ body, headers }, reply) => {
      const session = await auth.api.getSession({ headers });
      if (!session || !session.user) {
        return reply.status(403).send({ error: "Unauthorized" });
      }

      const { firstName, lastName } = body;

      try {
        const updateUser = await db
          .update(user)
          .set({
            name: `${firstName} ${lastName}`,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(user.id, session.user.id))
          .returning();

        return reply.send(updateUser[0]);
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );
}
