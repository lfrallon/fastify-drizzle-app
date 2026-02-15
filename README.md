# Fastify, Drizzle, Better Auth & TypeScript Starter

A simple starter template for building APIs with Fastify, Drizzle and TypeScript using Node.js 22+/24+.

## Requirements

- **Node.js 22.0.0 or higher**
- npm

## Installation

```bash
git clone https://github.com/lfrallon/fastify-drizzle-app.git
cd fastify-drizzle-app
npm install
```

## Usage

### Development

Start the development server with hot reload:

```bash
npm run dev
```

The server will automatically restart when you change files.

### Production

Start the production server:

```bash
npm run start
```

### Other Commands

```bash
npm run typecheck  # Check for TypeScript errors
npm run format     # Format code with Prettier
npm run db:studio  # Web interface for drizzle database
```

## Project Structure

```
├── drizzle.config.ts
├── fastify-database-erd
├── package.json
├── package-lock.json
├── README.md
├── src
│   ├── db
│   │   └── index.ts
│   ├── drizzle
│   │   ├── migrations
│   │   │   ├── 0000_flimsy_dragon_man.sql
│   │   │   ├── 0001_stale_manta.sql
│   │   │   ├── 0002_watery_young_avengers.sql
│   │   │   └── meta
│   │   │       ├── 0000_snapshot.json
│   │   │       ├── 0001_snapshot.json
│   │   │       ├── 0002_snapshot.json
│   │   │       └── _journal.json
│   │   └── schema
│   │       ├── index.ts
│   │       ├── relations.ts
│   │       └── schema.ts
│   ├── index.ts
│   ├── lib
│   │   ├── auth-client.ts
│   │   └── auth.ts
│   ├── plugins
│   ├── routes
│   │   ├── api
│   │   │   └── v1
│   │   │       ├── todos
│   │   │       │   └── index.ts
│   │   │       └── users
│   │   │           └── index.ts
│   │   └── root.ts
│   ├── server.ts
│   └── utils
│       └── pagination.ts
├── static
│   └── index.html
└── tsconfig.json
```

## Getting Started

1. Start the dev server: `npm run dev`
2. Visit `http://localhost:3006` in your browser
3. Check `http://localhost:3006/api/v1/user` for the API endpoint
4. Edit files in `src/` to see changes automatically

## Features

- ✅ Fastify web framework
- ✅ TypeScript support (no build step needed)
- ✅ Hot reload in development
- ✅ Type checking with `npm run typecheck`
- ✅ Better Auth for authentication
- ✅ Drizzle for database

## License

MIT

## Reference

- [matschik - Github repo](https://github.com/matschik/fastify-typescript-starter)