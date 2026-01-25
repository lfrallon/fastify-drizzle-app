import fastifyCors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

// controllers
import userController from "./controller/userController.ts";
import indexController from "./controller/indexController.ts";

export default async function router(fastify: FastifyInstance) {
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
