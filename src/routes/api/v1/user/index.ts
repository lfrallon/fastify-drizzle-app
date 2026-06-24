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

// hooks
import { requirePermission } from "#/hooks/index.ts";

// types
import type { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import type { TypedFastifyInstance } from "#/types/fastify.js";

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
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "",
    {
      preHandler: requirePermission("user:read"),
    },
    async function ({ session }, reply) {
      try {
        return reply.send(session.user);
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // POST /api/v1/user/create
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/create",
    {
      preHandler: requirePermission("user:create"),
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
            }, "Image must be smaller than 5MB")
            .optional(),
        }),
      },
    },
    async ({ body, session }, reply) => {
      try {
        const { email, firstName, lastName, roleId, password, image } = body;

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
                  : mimetype === "image/jpeg"
                    ? ".jpeg"
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

        await fastify.cache.delByPrefix(
          `user:accounts|userId:${session.user.id}|`,
        );

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
      preHandler: requirePermission("user:update"),
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
            .union([
              z
                .instanceof(Buffer, {
                  message: "Image must be a valid file buffer",
                })
                .meta({ description: "Image data buffer." })
                .refine((buffer) => {
                  const FIVE_MB = 5 * 1024 * 1024;
                  return buffer.length <= FIVE_MB;
                }, "Image must be smaller than 5MB")
                .optional(),
              z.string({ error: "Image must be a string or a buffer" }).meta({
                description: "A string representation value of 'null'.",
              }),
            ])
            .meta({
              description:
                "Optional user avatar image file buffer or string representation",
            })
            .nullable()
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
          400: z.object({
            error: z.string().meta({
              description: "Bad request error message",
            }),
          }),
          401: z.object({
            error: z.string().meta({
              description: "Unauthorized error message",
            }),
          }),
          403: z.object({
            error: z.string().meta({
              description: "Forbidden error message",
            }),
            message: z.string().optional(),
          }),
          500: z.object({
            error: z.string().meta({
              description: "Internal Server Error message",
            }),
          }),
        },
      },
    },
    async ({ body, session }, reply) => {
      try {
        const { userId, image, password, ...payload } = body;
        const updatedFields = { ...payload };
        let imageString = null;
        let newPassword = null;

        if (image && typeof image === "object") {
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
                  : mimetype === "image/jpeg"
                    ? ".jpeg"
                    : ".jpg";
            const uniqueFileName = `${Date.now()}_${updatedFields.firstName}_${updatedFields.lastName}${ext}`;
            const savePath = join(UPLOADS_DIR, uniqueFileName);

            await fs.promises.writeFile(savePath, image);

            imageString = `/profile/${uniqueFileName}`;
          } catch (error) {
            console.error("Error saving image file:", error);
            return reply.code(500).send({ error: "Failed to save image file" });
          }
        }

        if (password) {
          newPassword = await hash(password, argon2Options);
        }

        const updatedUser = await db.transaction(async (tx) => {
          const [updateUser] = await tx
            .update(user)
            .set({
              ...(updatedFields.firstName
                ? {
                    name: `${updatedFields.firstName} ${updatedFields.lastName}`,
                  }
                : {}),
              ...(imageString
                ? { image: imageString }
                : image && typeof image === "string" && image === "null"
                  ? { image: null }
                  : {}),
              ...updatedFields,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(user.id, userId))
            .returning();

          if (newPassword) {
            await tx
              .update(account)
              .set({
                password: newPassword,
                updatedAt: new Date().toISOString(),
              })
              .where(eq(account.userId, userId));
          }

          return updateUser;
        });

        await fastify.cache.delByPrefix(
          `user:accounts|userId:${session.user.id}|`,
        );

        return reply.code(200).send(updatedUser);
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
    async function ({ headers }, reply) {
      try {
        const permissionResult = await accessPermissionCheck(
          headers,
          "user:read",
        );

        if (!permissionResult.currentUser || !permissionResult.session) {
          return reply.status(200).send({
            id: null,
            role: null,
            permissions: [],
          });
        }

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
