import { eq } from "drizzle-orm";
import z from "zod";

// types
import type { FastifyRequest, FastifyReply } from "fastify";
import type {
  FastifyZodOpenApiSchema,
  FastifyZodOpenApiTypeProvider,
} from "fastify-zod-openapi";
import type { TypedFastifyInstance } from "#/types/index.ts";

// auth lib
import auth from "#/lib/auth.ts";

// db
import { db } from "#/db/index.ts";
import { user } from "#/drizzle/schema/index.ts";

const PutBodySchema = z.object({
  firstName: z
    .string()
    .min(2, "First name is required.")
    .meta({ description: "User's first name", example: "John" }),
  lastName: z
    .string()
    .min(2, "Last name is required.")
    .meta({ description: "User's last name", example: "Doe" }),
}) satisfies FastifyZodOpenApiSchema;

const UpdateResponseSchema = {
  200: z.object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
    image: z.string().nullable(),
    emailVerified: z.boolean(),
    createdAt: z.string().meta({
      description: "User creation date",
      example: "2024-01-01T00:00:00.000Z",
    }),
    updatedAt: z.string().meta({
      description: "User last update date",
      example: "2024-01-01T00:00:00.000Z",
    }),
  }),
  403: z.object({
    error: z.string().meta({
      description: "Unauthorized error message",
      example: "Unauthorized",
    }),
  }),
  500: z.object({
    error: z.string().meta({
      description: "Internal Server Error message",
      example: "Internal Server Error",
    }),
  }),
};

export default async function (fastify: TypedFastifyInstance) {
  // GET /api/v1/user
  fastify
    .withTypeProvider<FastifyZodOpenApiTypeProvider>()
    .get("", async function (request: FastifyRequest, reply: FastifyReply) {
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
    });

  // PUT /api/v1/user/update
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().put(
    "/update",
    {
      schema: {
        body: PutBodySchema,
        response: UpdateResponseSchema,
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

        return reply.code(200).send(updateUser[0]);
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );
}
