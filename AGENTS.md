# AGENTS.md

## Project overview
- This repository is a Node.js ESM Fastify API starter built with TypeScript, Drizzle ORM, PostgreSQL, Better Auth, and Zod/OpenAPI integration.
- The runtime entrypoint is `src/index.ts`, which starts the Fastify server on `process.env.APP_PORT` or port `3006` by default.
- The main server factory lives in `src/server.ts` and wires together Fastify, CORS, Swagger/OpenAPI, Better Auth, and route autoloading.
- Builds are produced with `tsdown` into `dist/`, and the production start command runs `node dist/index.mjs`.

## Stack and major libraries
- Fastify 5 for the HTTP server.
- `fastify-zod-openapi` for request/response schemas and OpenAPI generation.
- `@fastify/swagger` and `@fastify/swagger-ui` for API docs, mounted at `/`.
- Better Auth with the Drizzle adapter for auth/session management.
- Drizzle ORM + `pg` for PostgreSQL access and schema migrations.
- `qs` is used as the Fastify querystring parser.
- `dotenv` is used for local environment loading.

## Actual application capabilities
- Exposes Swagger UI at `/`.
- Exposes Better Auth endpoints through `/api/auth/*`.
- Autoloads route modules from `src/routes`.
- Provides authenticated user routes at:
  - `GET /api/v1/user`
  - `PUT /api/v1/user/update`
- Provides authenticated todo routes at:
  - `GET /api/v1/todos`
  - `POST /api/v1/todos/add`
  - `DELETE /api/v1/todos`
  - `PUT /api/v1/todos/update`
- Uses cursor-based pagination for todo listing based on `updatedAt` and `id`.
- Stores auth, session, and todo data in PostgreSQL through Drizzle schema files under `src/drizzle/schema`.

## Source layout
- `src/index.ts`: process entrypoint and startup logging.
- `src/server.ts`: Fastify construction, CORS, Swagger, auth endpoint bridge, and route autoloading.
- `src/db/index.ts`: PostgreSQL pool and Drizzle client.
- `src/lib/auth.ts`: Better Auth server configuration.
- `src/lib/auth-client.ts`: Better Auth client configured for `http://localhost:3006`.
- `src/routes/api/v1/user/index.ts`: authenticated user endpoints.
- `src/routes/api/v1/todos/index.ts`: authenticated todo CRUD endpoints.
- `src/drizzle/schema/*`: Drizzle tables, enums, and relations.
- `src/drizzle/migrations/*`: generated SQL migrations and metadata snapshots.
- `drizzle.config.ts`: Drizzle Kit configuration.
- `tsdown.config.ts`: build configuration.
- `compose.yml`: dev/prod/db/adminer container orchestration.
- `Dockerfile`: multi-stage development and production container build.

## Environment variables and important settings
- Application port:
  - `APP_PORT` defaults to `3006`.
- Fastify CORS plugin:
  - `CLIENT_ORIGIN` defaults to `http://localhost:3000`.
- Better Auth:
  - `BETTER_AUTH_BASE_URL` defaults to `http://localhost:3006`.
  - `BETTER_AUTH_SECRET` is expected for auth secret configuration.
  - Trusted origins are hard-coded for localhost ports `3000` and `3006`.
  - `useSecureCookies` is enabled, so cookie behavior may differ on plain HTTP local setups.
- Database client (`src/db/index.ts`):
  - `POSTGRES_HOST`
  - `POSTGRES_PORT`
  - `POSTGRES_USER`
  - `POSTGRES_PASSWORD`
  - `POSTGRES_DB`
- Drizzle Kit (`drizzle.config.ts`):
  - Loads `.env.local` first, then `.env`.
  - Requires `DATABASE_URL`.
- Docker Compose also references:
  - `PROD_PORT`
  - `DB_PORT`
  - `ALLOWED_ORIGINS`
  - `PROD_MEMORY_LIMIT`
  - `PROD_CPU_LIMIT`
  - `PROD_MEMORY_RESERVATION`
  - `PROD_CPU_RESERVATION`

## Commands agents should use
- Install dependencies: `npm install`
- Development server: `npm run dev`
- Docker-oriented development command: `npm run dev:docker`
- Build: `npm run build`
- Production start: `npm run start`
- Type-check: `npm run typecheck`
- Format TypeScript in `src/`: `npm run format`
- Generate Better Auth artifacts: `npm run auth:generate`
- Drizzle commands:
  - `npm run db:generate`
  - `npm run db:migrate`
  - `npm run db:push`
  - `npm run db:pull`
  - `npm run db:studio`
- Release helpers:
  - `npm run release`
  - `npm run release:dry-run`

## Docker and local services
- `compose.yml` defines:
  - `fastify-dev` for development
  - `fastify-prod` for production profile
  - `db` using `postgres:latest`
  - `adminer` exposed on `0.0.0.0:8080`
- The Dockerfile includes multi-stage targets for `deps`, `build-deps`, `build`, `development`, and `production`.
- The default container app port is `3006`.

## Working rules for agents in this repo
- Treat this as a backend/API project; there is no active frontend application in this repository.
- Prefer changing route definitions, auth config, schema files, or Docker/Drizzle config only when the task specifically requires it.
- Keep code ESM-compatible and TypeScript-based.
- Preserve the existing alias style such as `#/server.ts`.
- Keep Fastify route schemas compatible with `fastify-zod-openapi` and Zod.
- Do not hand-edit generated migration metadata unless the task explicitly requires it.
- If schema changes are made, update or generate the matching Drizzle migration files.
- When changing environment handling, keep local defaults aligned with the current localhost-based development setup.

## Known project-specific caveats
- README content is not fully aligned with the current route layout; prefer the source files as the source of truth.
- Swagger UI is mounted at `/`, so changes to the root path may affect API docs access.
- Better Auth is wrapped manually in `src/server.ts` to work around CORS handling.
- `src/lib/auth.ts` enables secure cookies, which can affect local auth flows if the environment is not HTTPS-aware.
- There is currently no dedicated automated test suite configured in `package.json`; type-checking and targeted runtime validation are the main built-in verification steps.
