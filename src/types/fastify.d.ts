import { type FastifyInstance } from "fastify";
import type { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import type { Session } from "#/lib/auth.ts";
import type { accessPermissionCheck } from "#/utils/rbac.ts";

type PermissionResult = Awaited<ReturnType<typeof accessPermissionCheck>>;

type CurrentUser = NonNullable<PermissionResult["currentUser"]>;

// Define and export a custom type
declare module "fastify" {
  interface FastifyInstance {
    cache: {
      get<T>(key: string): Promise<T | null>;
      set(key: string, value: unknown, ttl?: number): Promise<void>;
      del(key: string): Promise<void>;
      delByPrefix(prefix: string): Promise<void>;
      wrap<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T>;
    };
  }

  interface FastifyRequest {
    currentUser: CurrentUser;
    session: Session;
  }
}

export type TypedFastifyInstance = FastifyInstance & {
  withTypeProvider: () => FastifyInstance<
    any,
    any,
    any,
    any,
    FastifyZodOpenApiTypeProvider
  >;
};
