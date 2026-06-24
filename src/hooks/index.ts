import type { FastifyReply, FastifyRequest } from "fastify";

// libs
import { accessPermissionCheck } from "#/utils/rbac.ts";

export function requirePermission(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await accessPermissionCheck(request.headers, permission);

    if (!result.currentUser || !result.session) {
      return reply.status(result.statusCode ?? 403).send({
        error: result.error,
        ...(result.message ? { message: result.message } : {}),
      });
    }

    request.currentUser = result.currentUser;
    request.session = result.session;
  };
}
