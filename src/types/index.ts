import { type FastifyInstance } from "fastify";
import type { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";

// Define and export a custom type
export type TypedFastifyInstance = FastifyInstance & {
  withTypeProvider: () => FastifyInstance<
    any,
    any,
    any,
    any,
    FastifyZodOpenApiTypeProvider
  >;
};
