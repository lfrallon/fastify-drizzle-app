import { fromNodeHeaders } from "better-auth/node";
import { eq, or, and, desc, lt, gt, asc, gte, lte } from "drizzle-orm";
import z from "zod";

// lib
import auth from "#/lib/auth.ts";

// db & schema
import { db } from "#/db/index.ts";
import { mapMessages } from "#/drizzle/schema/schema.ts";

// types
import type { TypedFastifyInstance } from "#/types/index.ts";
import type { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";

function parseBboxString(bbox: string) {
  const values = bbox.split(",").map((value) => Number(value.trim()));

  if (values.length !== 4 || values.some((value) => Number.isNaN(value))) {
    return null;
  }

  const [west, south, east, north] = values;

  return {
    west,
    south,
    east,
    north,
  };
}

function buildMapMessagesCacheKey(params: {
  orderBy: "asc" | "desc";
  clampedPageSize: number;
  cursor?: {
    id: string;
    updatedAt: string;
  };
  bboxFilter?: {
    west: number;
    south: number;
    east: number;
    north: number;
  } | null;
}) {
  const { orderBy, clampedPageSize, cursor, bboxFilter } = params;

  return [
    "mapMessages:",
    `orderBy:${orderBy}`,
    `pageSize:${clampedPageSize}`,
    `cursorId:${cursor?.id ?? "none"}`,
    `cursorUpdatedAt:${cursor?.updatedAt ?? "none"}`,
    `west:${bboxFilter?.west ?? "none"}`,
    `south:${bboxFilter?.south ?? "none"}`,
    `east:${bboxFilter?.east ?? "none"}`,
    `north:${bboxFilter?.north ?? "none"}`,
  ].join("|");
}

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
        }),
      },
    },
    async ({ body, headers }, reply) => {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(headers),
      });

      const { title, mapMessage, latitude, longitude } = body;

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
            userId: session?.user?.id,
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
}
