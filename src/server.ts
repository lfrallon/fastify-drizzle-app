import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";

// types
import type { ZodTypeProvider } from "fastify-type-provider-zod";
// routes
import router from "./router.ts";

// libs
import { auth } from "./lib/auth.ts";

const allowedOrigins = new Set([
  "http://localhost:3000", // Development environment
  "http://localhost:3006", // Customer app
]);

const corsHeaders = {
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
};

function isOriginAllowed(origin: string): boolean {
  return allowedOrigins.has(origin);
}

function buildCorsResponse(
  origin: string,
  status: number,
  body: string | null = null,
) {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders,
      "Access-Control-Allow-Origin": origin,
    },
  });
}

function withCors(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin") ?? "";

    if (!isOriginAllowed(origin)) {
      return new Response("CORS not allowed", { status: 403 });
    }

    if (req.method === "OPTIONS") {
      return buildCorsResponse(origin, 204);
    }

    const res = await handler(req);

    const response = new Response(res.body, res);

    for (const [key, value] of Object.entries(corsHeaders)) {
      response.headers.set(key, value);
    }

    response.headers.set("Access-Control-Allow-Origin", origin);

    return response;
  };
}

const baseHandler = withCors(auth.handler);

export const createServer = async () => {
  const fastify = Fastify({
    logger: true,
  });

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  // Register authentication endpoint

  /**
   * Better Auth CORS issues found in: https://github.com/better-auth/better-auth/issues/4052
   *
   **/
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      try {
        // Construct request URL
        const url = new URL(request.url, `http://${request.headers.host}`);

        // Convert Fastify headers to standard Headers object
        const headers = new Headers();

        Object.entries(request.headers).forEach(([key, value]) => {
          if (value) headers.append(key, value.toString());
        });

        // Create Fetch API-compatible request
        const req = new Request(url.toString(), {
          method: request.method,
          headers,
          ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        });

        // Process authentication request
        const response = await baseHandler(req);

        // Forward response to client
        reply.status(response.status);
        response.headers.forEach((value, key) => reply.header(key, value));
        reply.send(response.body ? await response.text() : null);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "An unknown error occurred";
        fastify.log.error("Authentication Error: " + errorMessage);
        reply.status(500).send({
          error: "Internal authentication error",
          code: "AUTH_FAILURE",
        });
      }
    },
  });

  // Middleware: Router
  fastify.register(router);

  return fastify;
};
