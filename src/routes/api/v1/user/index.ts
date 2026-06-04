import { join } from "path";
import fs from "fs";
import { fileTypeFromBuffer } from "file-type";
import { eq } from "drizzle-orm";
import { hash } from "@node-rs/argon2";
import { v4 } from "uuid";
import z from "zod";

// db
import { db } from "#/db/index.ts";
import { account, user } from "#/drizzle/schema/index.ts";

// libs
import { accessPermissionCheck } from "#/utils/rbac.ts";
import { argon2Options } from "#/lib/auth.ts";

// types
import type { FastifyRequest, FastifyReply } from "fastify";
import type {
  FastifyZodOpenApiSchema,
  FastifyZodOpenApiTypeProvider,
} from "fastify-zod-openapi";
import type { TypedFastifyInstance } from "#/types/index.ts";

const AccessResponseSchema = {
  200: z.object({
    id: z.string().nullable(),
    role: z.string().nullable(),
    permissions: z.array(z.string()),
  }),
  401: z.object({
    error: z.string().meta({
      description: "Unauthorized error message",
      example: "Unauthorized",
    }),
  }),
  403: z.object({
    error: z.string().meta({
      description: "Forbidden error message",
      example: "Forbidden",
    }),
    message: z.string().optional(),
  }),
  500: z.object({
    error: z.string().meta({
      description: "Internal Server Error message",
      example: "Internal Server Error",
    }),
  }),
};

const UPLOADS_DIR = "/app/src/public/uploads";

export default async function (fastify: TypedFastifyInstance) {
  // GET /api/v1/user
  fastify
    .withTypeProvider<FastifyZodOpenApiTypeProvider>()
    .get("", async function ({ headers }, reply) {
      const permissionResult = await accessPermissionCheck(
        headers,
        "user:read",
      );
      if (!permissionResult.currentUser || !permissionResult.session) {
        const statusCode = permissionResult.statusCode === 403 ? 403 : 401;

        return reply.status(statusCode).send({
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

  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/create",
    {
      schema: {
        body: z.object({
          firstName: z.string().min(2, "First name is required"),
          lastName: z.string().min(2, "Last name is required"),
          email: z.email("Invalid email address"),
          password: z.string().min(8, "Password must be at least 6 characters"),
          roleId: z.string(),
          image: z
            .instanceof(Buffer, {
              message: "Image must be a valid file buffer",
            })
            .meta({
              description: "Optional user avatar image file buffer",
            })
            .refine((buffer) => {
              // Optional: Validate file size directly from the buffer (e.g., 5MB limit)
              const FIVE_MB = 5 * 1024 * 1024;
              return buffer.length <= FIVE_MB;
            }, "Image must be smaller than 5MB"),
        }),
      },
    },
    async (request, reply) => {
      const permissionResult = await accessPermissionCheck(
        request.headers,
        "user:create",
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
        const { email, firstName, lastName, roleId, password, image } =
          request.body;

        let imageString = null;

        if (!firstName || firstName.trim().length === 0) {
          return reply.code(400).send({ error: "First name is required!" });
        }

        if (!lastName || lastName.trim().length === 0) {
          return reply.code(400).send({ error: "Last name is required!" });
        }

        if (!email || email.trim().length === 0) {
          return reply.code(400).send({ error: "Email is required!" });
        }

        if (!password || password.length === 0) {
          return reply.code(400).send({ error: "Password is required!" });
        }

        if (image) {
          const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
          const meta = await fileTypeFromBuffer(image);

          let mimetype: string | null =
            typeof meta?.mime === "string" ? meta.mime : null;

          if (!mimetype && typeof meta?.ext === "string") {
            const ext = meta.ext;
            const extToMime: Record<string, string> = {
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
              ".png": "image/png",
              ".webp": "image/webp",
            };
            mimetype = extToMime[ext] ?? null;
          }

          if (!mimetype || !allowedMimeTypes.includes(mimetype)) {
            return reply.code(400).send({
              error: "Invalid image format. Allowed types: JPEG, PNG, WebP",
            });
          }

          try {
            if (!fs.existsSync(UPLOADS_DIR)) {
              fs.mkdirSync(UPLOADS_DIR, { recursive: true });
            }

            const ext =
              mimetype === "image/png"
                ? ".png"
                : mimetype === "image/webp"
                  ? ".webp"
                  : ".jpg";
            const uniqueFileName = `${Date.now()}_${firstName}_${lastName}${ext}`;
            const savePath = join(UPLOADS_DIR, uniqueFileName);

            await fs.promises.writeFile(savePath, image);

            imageString = `/profile/${uniqueFileName}`;
          } catch (error) {
            console.error("Error saving image file:", error);
            return reply.code(500).send({ error: "Failed to save image file" });
          }
        }

        const passwordHash = await hash(password, argon2Options);

        const newUser = await db.transaction(async (tx) => {
          const [insertedUser] = await tx
            .insert(user)
            .values({
              id: v4(),
              roleId,
              name: `${firstName} ${lastName}`,
              firstName,
              lastName,
              email: email.toLowerCase(),
              emailVerified: false,
              image: imageString,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            .returning();

          await tx.insert(account).values({
            id: v4(),
            userId: insertedUser.id,
            accountId: email.toLowerCase(),
            providerId: "credential",
            password: passwordHash,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          return insertedUser;
        });

        // ✅ invalidate related read caches
        await fastify.cache.delByPrefix("user:accounts");

        return reply.code(201).send({
          success: true,
          user: { id: newUser.id, email: newUser.email },
        });
      } catch (_error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // PATCH /api/v1/user/update
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().patch(
    "/update",
    {
      schema: {
        body: z.object({
          userId: z.string().min(2, "User id is required."),
          firstName: z.string().min(2, "First name").optional(),
          lastName: z.string().min(2, "Last name").optional(),
          email: z.email("Email address").optional(),
          password: z
            .string()
            .min(8, "Password must be at least 6 characters")
            .optional(),
          roleId: z.string().optional(),
          image: z
            .instanceof(Buffer, {
              message: "Image must be a valid file buffer",
            })
            .meta({
              description: "Optional user avatar image file buffer",
            })
            .refine((buffer) => {
              // Optional: Validate file size directly from the buffer (e.g., 5MB limit)
              const FIVE_MB = 5 * 1024 * 1024;
              return buffer.length <= FIVE_MB;
            }, "Image must be smaller than 5MB")
            .optional(),
        }),
        response: {
          200: z.object({
            id: z.string(),
            name: z.string(),
            firstName: z.string(),
            lastName: z.string(),
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
          403: z.object({
            error: z.string().meta({
              description: "Forbidden error message",
              example: "Forbidden",
            }),
            message: z.string().optional(),
          }),
          500: z.object({
            error: z.string().meta({
              description: "Internal Server Error message",
              example: "Internal Server Error",
            }),
          }),
        },
      },
    },
    async ({ body, headers }, reply) => {
      console.log("🚀 ~ body:", body);

      const permissionResult = await accessPermissionCheck(
        headers,
        "user:update",
      );
      if (!permissionResult.currentUser || !permissionResult.session) {
        const statusCode = permissionResult.statusCode === 403 ? 403 : 401;

        return reply.status(statusCode).send({
          error: permissionResult.error,
          ...(permissionResult.message
            ? { message: permissionResult.message }
            : {}),
        });
      }

      try {
        // TODO: Implemet a user update
        const { firstName, lastName, email, image, password, roleId, userId } =
          body;

        const updateUser = await db
          .update(user)
          .set({
            name: `${firstName} ${lastName}`,
            firstName,
            lastName,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(user.id, userId))
          .returning();

        return reply.code(200).send(updateUser[0]);
      } catch (_error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // GET /api/v1/user/access
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/access",
    {
      schema: {
        response: AccessResponseSchema,
      },
    },
    async function (request: FastifyRequest, reply: FastifyReply) {
      const permissionResult = await accessPermissionCheck(
        request.headers,
        "user:read",
      );
      if (!permissionResult.currentUser || !permissionResult.session) {
        return reply.status(200).send({
          id: null,
          role: null,
          permissions: [],
        });
      }

      try {
        return reply.code(200).send({
          id: permissionResult.session.user.roleId,
          role: permissionResult.currentUser.role,
          permissions: permissionResult.currentUser.permissions,
        });
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );
}
