import { eq, or, and, desc, lt, gt, asc, gte, lte } from "drizzle-orm";
import z from "zod";

// lib
import {
  buildMapMessagesCacheKey,
  parseBboxString,
} from "#/lib/map-messages/index.ts";
import { accessPermissionCheck } from "#/utils/rbac.ts";

// db & schema
import { db } from "#/db/index.ts";
import { mapMessages } from "#/drizzle/schema/schema.ts";

// types
import type { TypedFastifyInstance } from "#/types/index.ts";
import type { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";

export default async function (fastify: TypedFastifyInstance) {
  // GET /api/v1/map-messages
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "",
    {
      schema: {
        querystring: z
          .object({
            id: z.string().optional().meta({
              description: "The id of the last item from the previous page",
              example: "",
            }),
            updatedAt: z.string().optional().meta({
              description: "The date of the last item from the previous page",
              example: "",
            }),
            pageSize: z.coerce.number().default(10).meta({
              description: "Number of items to return per page",
              example: 10,
            }),
            orderBy: z.enum(["asc", "desc"]).default("desc").meta({
              description: "Order of the items",
              example: "desc",
            }),
            bbox: z.string().optional().meta({
              description: "Optional bbox in `west,south,east,north` format",
              example: "-10,35,30,60",
            }),
            west: z.coerce.number().optional().meta({
              description: "Western longitude bound",
              example: -10,
            }),
            south: z.coerce.number().optional().meta({
              description: "Southern latitude bound",
              example: 35,
            }),
            east: z.coerce.number().optional().meta({
              description: "Eastern longitude bound",
              example: 30,
            }),
            north: z.coerce.number().optional().meta({
              description: "Northern latitude bound",
              example: 60,
            }),
            limit: z.coerce.number().optional().meta({
              description:
                "Optional alias for pageSize, clamped by the API for safety",
              example: 200,
            }),
            zoomBucket: z.enum(["broad", "medium", "close"]).optional().meta({
              description:
                "Optional zoom bucket hint from the client for future sampling rules",
              example: "broad",
            }),
          })
          .refine((data) => !(data.id && !data.updatedAt), {
            message: "'id' is required.",
            path: ["id"],
          })
          .refine((data) => !(data.updatedAt && !data.id), {
            message: "'updatedAt' is required.",
            path: ["updatedAt"],
          })
          .refine(
            (data) =>
              !(
                (data.west !== undefined ||
                  data.south !== undefined ||
                  data.east !== undefined ||
                  data.north !== undefined) &&
                (data.west === undefined ||
                  data.south === undefined ||
                  data.east === undefined ||
                  data.north === undefined)
              ),
            {
              message:
                "'west', 'south', 'east', and 'north' must all be provided together.",
              path: ["west"],
            },
          ),
      },
    },
    async ({ query, headers }, reply) => {
      try {
        const permissionResult = await accessPermissionCheck(
          headers,
          "map-messages:read",
        );
        if (!permissionResult.currentUser || !permissionResult.currentUser) {
          return reply.status(permissionResult.statusCode).send({
            error: permissionResult.error,
            ...(permissionResult.message
              ? { message: permissionResult.message }
              : {}),
          });
        }

        const {
          orderBy,
          pageSize,
          id,
          updatedAt,
          bbox,
          west,
          south,
          east,
          north,
          limit,
        } = query;

        const rawRequestedLimit = limit ?? pageSize;
        const clampedPageSize = Math.min(Math.max(rawRequestedLimit, 1), 200);

        const cursor =
          updatedAt && id
            ? {
                id,
                updatedAt,
              }
            : undefined;
        const queryLimit = clampedPageSize + 1;

        const parsedBboxFromString = bbox ? parseBboxString(bbox) : null;

        if (bbox && !parsedBboxFromString) {
          return reply.code(400).send({
            error:
              "Invalid 'bbox' format. Expected: west,south,east,north with numeric values.",
          });
        }

        const hasExplicitBbox =
          west !== undefined &&
          south !== undefined &&
          east !== undefined &&
          north !== undefined;

        const bboxFilter =
          parsedBboxFromString ??
          (hasExplicitBbox
            ? {
                west,
                south,
                east,
                north,
              }
            : null);
        const bboxCondition = bboxFilter
          ? and(
              gte(mapMessages.latitude, bboxFilter.south),
              lte(mapMessages.latitude, bboxFilter.north),
              bboxFilter.west <= bboxFilter.east
                ? and(
                    gte(mapMessages.longitude, bboxFilter.west),
                    lte(mapMessages.longitude, bboxFilter.east),
                  )
                : or(
                    and(
                      gte(mapMessages.longitude, bboxFilter.west),
                      lte(mapMessages.longitude, 180),
                    ),
                    and(
                      gte(mapMessages.longitude, -180),
                      lte(mapMessages.longitude, bboxFilter.east),
                    ),
                  ),
            )
          : undefined;
        const cacheKey = buildMapMessagesCacheKey({
          orderBy,
          clampedPageSize,
          cursor,
          bboxFilter,
        });

        const totalCount = await db.$count(mapMessages, bboxCondition);

        if (totalCount === 0) {
          return reply.code(200).send({
            nodes: [],
            pageInfo: {
              hasNextPage: false,
              nextCursor: null,
              totalPages: 0,
            },
            totalCount,
          });
        }

        const getPaginatedTodos = await fastify.cache.wrap(
          cacheKey,
          300,
          async () => {
            const todosCached = await db
              .select()
              .from(mapMessages)
              .where(
                and(
                  bboxCondition,
                  cursor
                    ? or(
                        orderBy === "desc"
                          ? lt(mapMessages.updatedAt, cursor.updatedAt)
                          : gt(mapMessages.updatedAt, cursor.updatedAt),
                        and(
                          eq(mapMessages.updatedAt, cursor.updatedAt),
                          lt(mapMessages.id, cursor.id),
                        ),
                      )
                    : undefined,
                ),
              )
              .limit(queryLimit)
              .orderBy(
                orderBy === "desc"
                  ? desc(mapMessages.updatedAt)
                  : asc(mapMessages.updatedAt),
                orderBy === "desc" ? desc(mapMessages.id) : asc(mapMessages.id),
              );

            return todosCached;
          },
        );

        const hasNextPage = getPaginatedTodos.length > clampedPageSize;

        const currentPageItems = hasNextPage
          ? getPaginatedTodos.slice(0, clampedPageSize)
          : getPaginatedTodos;

        const newNextCursor =
          currentPageItems.length > 0
            ? {
                id: currentPageItems[currentPageItems.length - 1].id,
                updatedAt:
                  currentPageItems[currentPageItems.length - 1].updatedAt,
              }
            : null;

        return reply.code(200).send({
          nodes: currentPageItems,
          pageInfo: {
            hasNextPage,
            nextCursor: newNextCursor,
            totalPages: Math.ceil(totalCount / clampedPageSize),
          },
          totalCount,
        });
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // POST /api/v1/map-messages
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/add",
    {
      schema: {
        body: z.object({
          title: z.string({ error: "Invalid input." }).meta({
            description: "The title of the map message",
            example: "Sample Map Message",
          }),
          mapMessage: z.string({ error: "Invalid input." }).meta({
            description: "The content of the map message",
            example: "Hello, this is a map message!",
          }),
          latitude: z.number({ error: "Invalid input." }).meta({
            description: "Latitude of the map message",
            example: 9.876,
          }),
          longitude: z.number({ error: "Invalid input." }).meta({
            description: "Longitude of the map message",
            example: 123.456,
          }),
          videoUrl: z.string().optional().meta({
            description:
              "Optional URL of a video associated with the map message",
            example: "https://example.com/video.mp4",
          }),
        }),
      },
    },
    async ({ body, headers }, reply) => {
      const permissionResult = await accessPermissionCheck(
        headers,
        "map-messages:create",
      );
      console.log("🚀 ~ permissionResult:", permissionResult);

      if (!permissionResult.currentUser || !permissionResult.currentUser) {
        return reply.status(permissionResult.statusCode).send({
          error: permissionResult.error,
          ...(permissionResult.message
            ? { message: permissionResult.message }
            : {}),
        });
      }

      const { title, mapMessage, latitude, longitude, videoUrl } = body;

      if (!title || title.length === 0) {
        return reply.code(400).send({ error: "No title provided!" });
      }

      if (!mapMessage || mapMessage.length === 0) {
        return reply.code(400).send({ error: "No map message provided!" });
      }

      if (latitude === undefined || longitude === undefined) {
        return reply
          .code(400)
          .send({ error: "Latitude and longitude are required!" });
      }

      try {
        const newMapMessage = await db
          .insert(mapMessages)
          .values({
            title,
            mapMessage,
            latitude,
            longitude,
            userId: permissionResult.session.user.id,
            videoUrl,
          })
          .returning();

        // ✅ invalidate related read caches
        await fastify.cache.delByPrefix("mapMessages:");

        return reply.send(newMapMessage[0]);
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // DELETE /api/v1/map-messages
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().delete(
    "",
    {
      schema: {
        body: z.object({
          data: z.array(
            z.object({
              id: z.uuid().meta({
                description: "The id of the todo item",
                example: "123e4567-e89b-12d3-a456-426614174000",
              }),
              updatedAt: z.string().optional().meta({
                description: "The date of the last item from the previous page",
                example: "",
              }),
              pageSize: z.coerce.number().default(10).meta({
                description: "Number of items to return per page",
                example: 10,
              }),
              orderBy: z.enum(["asc", "desc"]).default("desc").meta({
                description: "Order of the items",
                example: "desc",
              }),
              bbox: z.string().optional().meta({
                description: "Optional bbox in `west,south,east,north` format",
                example: "-10,35,30,60",
              }),
              west: z.coerce.number().optional().meta({
                description: "Western longitude bound",
                example: -10,
              }),
              south: z.coerce.number().optional().meta({
                description: "Southern latitude bound",
                example: 35,
              }),
              east: z.coerce.number().optional().meta({
                description: "Eastern longitude bound",
                example: 30,
              }),
              north: z.coerce.number().optional().meta({
                description: "Northern latitude bound",
                example: 60,
              }),
              limit: z.coerce.number().optional().meta({
                description:
                  "Optional alias for pageSize, clamped by the API for safety",
                example: 200,
              }),
              zoomBucket: z.enum(["broad", "medium", "close"]).optional().meta({
                description:
                  "Optional zoom bucket hint from the client for future sampling rules",
                example: "broad",
              }),
            }),
          ),
        }),
      },
    },
    async ({ body, headers }, reply) => {
      const permissionResult = await accessPermissionCheck(
        headers,
        "map-messages:delete",
      );
      if (!permissionResult.currentUser || !permissionResult.currentUser) {
        return reply.status(permissionResult.statusCode).send({
          error: permissionResult.error,
          ...(permissionResult.message
            ? { message: permissionResult.message }
            : {}),
        });
      }

      try {
        const { data } = body;

        if (!data || data.length === 0) {
          return reply.code(400).send({ error: "No data provided." });
        }

        const deletedMapMessages = [];

        for (const item of data) {
          const { id } = item;

          const whereConditions =
            permissionResult.currentUser.role === "Admin"
              ? eq(mapMessages.id, id)
              : and(
                  eq(mapMessages.id, id),
                  eq(mapMessages.userId, permissionResult.session.user.id),
                );

          const existingMapMessages = await db
            .select()
            .from(mapMessages)
            .where(whereConditions)
            .limit(1)
            .then((rows) => rows[0] || undefined);

          if (!existingMapMessages) {
            continue;
          }

          const deletedMapMessage = await db
            .delete(mapMessages)
            .where(whereConditions)
            .returning();

          if (deletedMapMessage.length > 0) {
            deletedMapMessages.push(deletedMapMessage[0]);
          }
        }

        if (deletedMapMessages.length === 0) {
          return reply.code(404).send({ error: "Request not completed." });
        }

        const cacheKeys: string[] = [];
        for (let i = 0; i < data.length; i++) {
          const {
            orderBy,
            pageSize,
            id,
            updatedAt,
            bbox,
            west,
            south,
            east,
            north,
            limit,
          } = data[i];

          const rawRequestedLimit = limit ?? pageSize;
          const clampedPageSize = Math.min(Math.max(rawRequestedLimit, 1), 200);

          const cursor =
            updatedAt && id
              ? {
                  id,
                  updatedAt,
                }
              : undefined;

          const parsedBboxFromString = bbox ? parseBboxString(bbox) : null;

          if (bbox && !parsedBboxFromString) {
            return reply.code(400).send({
              error:
                "Invalid 'bbox' format. Expected: west,south,east,north with numeric values.",
            });
          }

          const hasExplicitBbox =
            west !== undefined &&
            south !== undefined &&
            east !== undefined &&
            north !== undefined;

          const bboxFilter =
            parsedBboxFromString ??
            (hasExplicitBbox
              ? {
                  west,
                  south,
                  east,
                  north,
                }
              : null);
          const cacheKey = buildMapMessagesCacheKey({
            orderBy,
            clampedPageSize,
            cursor,
            bboxFilter,
          });
          cacheKeys.push(cacheKey);
        }

        for (let i = 0; i < cacheKeys.length; i++) {
          await fastify.cache.delByPrefix(cacheKeys[i]);
        }

        return reply.send({
          message: `${deletedMapMessages.length} item/s deleted successfully`,
          deletedItems: deletedMapMessages.map((item) => ({
            id: item.id,
            title: item.title,
          })),
        });
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // PUT /api/v1/map-messages
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().put(
    "/update",
    {
      schema: {
        body: z.object({
          data: z.array(
            z
              .object({
                id: z.uuid().meta({
                  description: "The id of the todo item",
                  example: "123e4567-e89b-12d3-a456-426614174000",
                }),
                title: z.string().optional().meta({
                  description: "The new title of the todo item",
                  example: "Water the plants.",
                }),
                mapMessage: z.string({ error: "Invalid input." }).meta({
                  description: "The content of the map message",
                  example: "Hello, this is a map message!",
                }),
                videoUrl: z.string().optional().meta({
                  description:
                    "Optional URL of a video associated with the map message",
                  example: "https://example.com/video.mp4",
                }),
                updatedAt: z.string().optional().meta({
                  description:
                    "The date of the last item from the previous page",
                  example: "",
                }),
                pageSize: z.coerce.number().default(10).meta({
                  description: "Number of items to return per page",
                  example: 10,
                }),
                orderBy: z.enum(["asc", "desc"]).default("desc").meta({
                  description: "Order of the items",
                  example: "desc",
                }),
                bbox: z.string().optional().meta({
                  description:
                    "Optional bbox in `west,south,east,north` format",
                  example: "-10,35,30,60",
                }),
                west: z.coerce.number().optional().meta({
                  description: "Western longitude bound",
                  example: -10,
                }),
                south: z.coerce.number().optional().meta({
                  description: "Southern latitude bound",
                  example: 35,
                }),
                east: z.coerce.number().optional().meta({
                  description: "Eastern longitude bound",
                  example: 30,
                }),
                north: z.coerce.number().optional().meta({
                  description: "Northern latitude bound",
                  example: 60,
                }),
                limit: z.coerce.number().optional().meta({
                  description:
                    "Optional alias for pageSize, clamped by the API for safety",
                  example: 200,
                }),
                zoomBucket: z
                  .enum(["broad", "medium", "close"])
                  .optional()
                  .meta({
                    description:
                      "Optional zoom bucket hint from the client for future sampling rules",
                    example: "broad",
                  }),
              })
              .refine(
                (data) =>
                  data.title !== undefined || data.mapMessage !== undefined,
                {
                  message:
                    "At least one of 'title' or 'message' must be provided.",
                },
              ),
          ),
        }),
      },
    },
    async ({ body, headers }, reply) => {
      const permissionResult = await accessPermissionCheck(
        headers,
        "map-messages:update",
      );
      if (!permissionResult.currentUser || !permissionResult.currentUser) {
        return reply.status(permissionResult.statusCode).send({
          error: permissionResult.error,
          ...(permissionResult.message
            ? { message: permissionResult.message }
            : {}),
        });
      }

      try {
        const { data } = body;

        if (!data || data.length === 0) {
          return reply.code(400).send({ error: "No data provided." });
        }

        const updatedMapMessages = [];

        for (const item of data) {
          const { id, title, mapMessage, videoUrl } = item;

          const whereConditions =
            permissionResult.currentUser.role === "Admin"
              ? eq(mapMessages.id, id)
              : and(
                  eq(mapMessages.id, id),
                  eq(mapMessages.userId, permissionResult.session.user.id),
                );

          const existingMapMessages = await db
            .select()
            .from(mapMessages)
            .where(whereConditions)
            .limit(1)
            .then((rows) => rows[0] || undefined);

          if (!existingMapMessages) {
            continue;
          }

          const updatedMapMessage = await db
            .update(mapMessages)
            .set({
              title: title !== undefined ? title : existingMapMessages.title,
              mapMessage:
                mapMessage !== undefined
                  ? mapMessage
                  : existingMapMessages.mapMessage,
              videoUrl:
                videoUrl !== undefined
                  ? videoUrl
                  : existingMapMessages.videoUrl,
            })
            .where(whereConditions)
            .returning();

          if (updatedMapMessage.length > 0) {
            updatedMapMessages.push(updatedMapMessage[0]);
          }
        }

        if (updatedMapMessages.length === 0) {
          return reply.code(404).send({
            error: "No items were updated. Please check the provided data.",
          });
        }

        const cacheKeys: string[] = [];
        for (let i = 0; i < data.length; i++) {
          const {
            orderBy,
            pageSize,
            id,
            updatedAt,
            bbox,
            west,
            south,
            east,
            north,
            limit,
          } = data[i];

          const rawRequestedLimit = limit ?? pageSize;
          const clampedPageSize = Math.min(Math.max(rawRequestedLimit, 1), 200);

          const cursor =
            updatedAt && id
              ? {
                  id,
                  updatedAt,
                }
              : undefined;

          const parsedBboxFromString = bbox ? parseBboxString(bbox) : null;

          if (bbox && !parsedBboxFromString) {
            return reply.code(400).send({
              error:
                "Invalid 'bbox' format. Expected: west,south,east,north with numeric values.",
            });
          }

          const hasExplicitBbox =
            west !== undefined &&
            south !== undefined &&
            east !== undefined &&
            north !== undefined;

          const bboxFilter =
            parsedBboxFromString ??
            (hasExplicitBbox
              ? {
                  west,
                  south,
                  east,
                  north,
                }
              : null);
          const cacheKey = buildMapMessagesCacheKey({
            orderBy,
            clampedPageSize,
            cursor,
            bboxFilter,
          });
          cacheKeys.push(cacheKey);
        }

        for (let i = 0; i < cacheKeys.length; i++) {
          await fastify.cache.delByPrefix(cacheKeys[i]);
        }

        return reply.send({
          message: `${updatedMapMessages.length} item/s updated successfully`,
          updatedItems: updatedMapMessages.map((item) => ({
            id: item.id,
            title: item.title,
            mapMessage: item.mapMessage,
            videoUrl: item.videoUrl,
          })),
        });
      } catch (_error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );
}
