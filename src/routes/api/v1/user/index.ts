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
import { accessPermissionCheck } from "#/utils/rbac.ts";

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
  401: z.object({
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
      const permissionResult = await accessPermissionCheck(
        request.headers,
        "user:read",
      );
      if (!permissionResult.currentUser || !permissionResult.session) {
        return reply.status(permissionResult.statusCode).send({
          error: permissionResult.error,
          ...(permissionResult.message
            ? { message: permissionResult.message }
            : {}),
        });
      }

      try {
        return reply.send(permissionResult.session.user);
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
      const permissionResult = await accessPermissionCheck(
        headers,
        "user:update",
      );
      if (!permissionResult.currentUser || !permissionResult.session) {
        return reply.status(permissionResult.statusCode).send({
          error: permissionResult.error,
          ...(permissionResult.message
            ? { message: permissionResult.message }
            : {}),
        });
      }

      const { firstName, lastName } = body;

      try {
        const updateUser = await db
          .update(user)
          .set({
            name: `${firstName} ${lastName}`,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(user.id, permissionResult.session.user.id))
          .returning();

        return reply.code(200).send(updateUser[0]);
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );
}
