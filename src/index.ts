import { createServer } from "#/server.ts";

const FASTIFY_PORT = Number(process.env.FASTIFY_PORT) || 3006;

const main = async () => {
  const fastify = await createServer();

  try {
    fastify.listen({ port: FASTIFY_PORT }, () => {
      fastify.log.info(`Listening on ${FASTIFY_PORT}...`);
    });

    console.log(
      `🚀  Fastify server running on port http://localhost:${FASTIFY_PORT}`,
    );
    console.log(`Route index:  /`);
    console.log(`Route user:   /api/v1/user`);
    console.log(`Route todos:  /api/v1/todos`);
    console.log(`Route add:    /api/v1/todos/add`);
    console.log(`Route delete: /api/v1/todos/delete`);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred";
    fastify.log.error("fastify.listen: " + errorMessage);
    process.exit(1);
  }
};

main();
