import { createServer } from "#/server.ts";

const FASTIFY_PORT = Number(process.env.APP_PORT) || 3006;

const main = async () => {
  const fastify = await createServer();

  try {
    fastify.listen({ port: FASTIFY_PORT, host: "0.0.0.0" }, () => {
      fastify.log.info(`Listening on ${FASTIFY_PORT}...`);
    });

    console.log(
      `🚀  Fastify server running on port http://localhost:${FASTIFY_PORT}`,
    );
    console.log(`Route index:           /`);
    console.log(`Route accounts:        /api/v1/accounts`);
    console.log(`Route notes:           /api/v1/geo-notes`);
    console.log(`Route permissions:     /api/v1/permissions`);
    console.log(`Route roles:           /api/v1/roles`);
    console.log(`Route todos:           /api/v1/todos`);
    console.log(`Route user:            /api/v1/user`);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred";
    fastify.log.error("fastify.listen: " + errorMessage);
    process.exit(1);
  }
};

main();
