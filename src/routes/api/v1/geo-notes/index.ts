import { eq, or, and, desc, lt, gt, asc, gte, lte } from "drizzle-orm";
import z from "zod";

// lib
import {
  buildGeoNotesCacheKey,
  parseBboxString,
} from "#/lib/geo-notes/index.ts";
import { accessPermissionCheck } from "#/utils/rbac.ts";

// db & schema
import { db } from "#/db/index.ts";
import { geoNotes } from "#/drizzle/schema/schema.ts";

// hooks
import { requirePermission } from "#/hooks/index.ts";

// types
import type { TypedFastifyInstance } from "#/types/fastify.js";
import type { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";

export default async function (fastify: TypedFastifyInstance) {
  // GET /api/v1/geo-notes
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
    async ({ query }, reply) => {
      try {
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
              gte(geoNotes.latitude, bboxFilter.south),
              lte(geoNotes.latitude, bboxFilter.north),
              bboxFilter.west <= bboxFilter.east
                ? and(
                    gte(geoNotes.longitude, bboxFilter.west),
                    lte(geoNotes.longitude, bboxFilter.east),
                  )
                : or(
                    and(
                      gte(geoNotes.longitude, bboxFilter.west),
                      lte(geoNotes.longitude, 180),
                    ),
                    and(
                      gte(geoNotes.longitude, -180),
                      lte(geoNotes.longitude, bboxFilter.east),
                    ),
                  ),
            )
          : undefined;
        const cacheKey = buildGeoNotesCacheKey({
          orderBy,
          clampedPageSize,
          cursor,
          bboxFilter,
        });

        const totalCount = await db.$count(geoNotes, bboxCondition);

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
              .from(geoNotes)
              .where(
                and(
                  bboxCondition,
                  cursor
                    ? or(
                        orderBy === "desc"
                          ? lt(geoNotes.updatedAt, cursor.updatedAt)
                          : gt(geoNotes.updatedAt, cursor.updatedAt),
                        and(
                          eq(geoNotes.updatedAt, cursor.updatedAt),
                          lt(geoNotes.id, cursor.id),
                        ),
                      )
                    : undefined,
                ),
              )
              .limit(queryLimit)
              .orderBy(
                orderBy === "desc"
                  ? desc(geoNotes.updatedAt)
                  : asc(geoNotes.updatedAt),
                orderBy === "desc" ? desc(geoNotes.id) : asc(geoNotes.id),
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

  // POST /api/v1/geo-notes
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/add",
    {
      schema: {
        body: z.object({
          title: z.string({ error: "Invalid input." }).meta({
            description: "The title of the map message",
            example: "Sample Map Message",
          }),
          geoNote: z.string({ error: "Invalid input." }).meta({
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
      try {
        const permissionResult = await accessPermissionCheck(
          headers,
          "geo-notes:create",
        );

        const { title, geoNote, latitude, longitude, videoUrl } = body;

        if (!title || title.length === 0) {
          return reply.code(400).send({ error: "No title provided!" });
        }

        if (!geoNote || geoNote.length === 0) {
          return reply.code(400).send({ error: "No map message provided!" });
        }

        if (latitude === undefined || longitude === undefined) {
          return reply
            .code(400)
            .send({ error: "Latitude and longitude are required!" });
        }

        const newGeoNote = await db
          .insert(geoNotes)
          .values({
            title,
            geoNote,
            latitude,
            longitude,
            userId: permissionResult
              ? permissionResult?.session?.user.id
              : null,
            videoUrl,
          })
          .returning();

        // ✅ invalidate related read caches
        await fastify.cache.delByPrefix("geoNotes:");

        return reply.send(newGeoNote[0]);
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // DELETE /api/v1/geo-notes
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().delete(
    "",
    {
      preHandler: requirePermission("geo-notes:delete"),
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
    async ({ currentUser, body, session }, reply) => {
      try {
        const { data } = body;

        if (!data || data.length === 0) {
          return reply.code(400).send({ error: "No data provided." });
        }

        const deletedGeoNotes = [];

        for (const item of data) {
          const { id } = item;

          const whereConditions =
            currentUser.role === "Admin"
              ? eq(geoNotes.id, id)
              : and(eq(geoNotes.id, id), eq(geoNotes.userId, session.user.id));

          const existinggeoNotes = await db
            .select()
            .from(geoNotes)
            .where(whereConditions)
            .limit(1)
            .then((rows) => rows[0] || undefined);

          if (!existinggeoNotes) {
            continue;
          }

          const deletedGeoNote = await db
            .delete(geoNotes)
            .where(whereConditions)
            .returning();

          if (deletedGeoNote.length > 0) {
            deletedGeoNotes.push(deletedGeoNote[0]);
          }
        }

        if (deletedGeoNotes.length === 0) {
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
          const cacheKey = buildGeoNotesCacheKey({
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
          message: `${deletedGeoNotes.length} item/s deleted successfully`,
          deletedItems: deletedGeoNotes.map((item) => ({
            id: item.id,
            title: item.title,
          })),
        });
      } catch (error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );

  // PUT /api/v1/geo-notes
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().put(
    "/update",
    {
      preHandler: requirePermission("geo-notes:update"),
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
                geoNote: z.string({ error: "Invalid input." }).meta({
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
                  data.title !== undefined || data.geoNote !== undefined,
                {
                  message:
                    "At least one of 'title' or 'message' must be provided.",
                },
              ),
          ),
        }),
      },
    },
    async ({ currentUser, body, session }, reply) => {
      try {
        const { data } = body;

        if (!data || data.length === 0) {
          return reply.code(400).send({ error: "No data provided." });
        }

        const updatedGeoNotes = [];

        for (const item of data) {
          const { id, title, geoNote, videoUrl } = item;

          const whereConditions =
            currentUser.role === "Admin"
              ? eq(geoNotes.id, id)
              : and(eq(geoNotes.id, id), eq(geoNotes.userId, session.user.id));

          const existingGeoNotes = await db
            .select()
            .from(geoNotes)
            .where(whereConditions)
            .limit(1)
            .then((rows) => rows[0] || undefined);

          if (!existingGeoNotes) {
            continue;
          }

          const updatedGeoNote = await db
            .update(geoNotes)
            .set({
              title: title !== undefined ? title : existingGeoNotes.title,
              geoNote:
                geoNote !== undefined ? geoNote : existingGeoNotes.geoNote,
              videoUrl:
                videoUrl !== undefined ? videoUrl : existingGeoNotes.videoUrl,
            })
            .where(whereConditions)
            .returning();

          if (updatedGeoNote.length > 0) {
            updatedGeoNotes.push(updatedGeoNote[0]);
          }
        }

        if (updatedGeoNotes.length === 0) {
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
          const cacheKey = buildGeoNotesCacheKey({
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
          message: `${updatedGeoNotes.length} item/s updated successfully`,
          updatedItems: updatedGeoNotes.map((item) => ({
            id: item.id,
            title: item.title,
            geoNote: item.geoNote,
            videoUrl: item.videoUrl,
          })),
        });
      } catch (_error) {
        return reply.code(500).send({ error: "Internal Server Error" });
      }
    },
  );
}
