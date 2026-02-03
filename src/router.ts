import fastifyCors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

// controllers
import indexController from "./controller/indexController.ts";
import todosController from "./controller/todosController.ts";
import userController from "./controller/userController.ts";

export default async function router(fastify: FastifyInstance) {
  fastify.register(todosController, { prefix: "/api/v1/todos" });
  fastify.register(userController, { prefix: "/api/v1/user" });
  fastify.register(indexController, { prefix: "/" });
  // Configure CORS policies
  fastify.register(fastifyCors, {
    origin: process.env.CLIENT_ORIGIN || "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true,
    maxAge: 86400,
  });
}
