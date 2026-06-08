import { sql } from "drizzle-orm";
import {
  pgTable,
  index,
  foreignKey,
  text,
  numeric,
  timestamp,
  unique,
  boolean,
  uuid,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";

export const account = pgTable(
  "account",
  {
    id: text().primaryKey().notNull(),
    scope: text(),
    password: text(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      mode: "string",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      mode: "string",
    }),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
  },
  (table) => [
    index("account_userId_idx").using(
      "btree",
      table.userId.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "account_user_id_user_id_fk",
    }).onDelete("cascade"),
  ],
);

export const user = pgTable(
  "user",
  {
    id: text().primaryKey().notNull(),
    roleId: text("role_id").references(() => role.id),
    name: text().notNull(),
    firstName: text().notNull(),
    lastName: text().notNull(),
    email: text().notNull(),
    image: text(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.roleId],
      foreignColumns: [role.id],
      name: "user_role_id_role_id_fk",
    }).onDelete("set null"),
    index("user_roleId_idx").on(table.roleId),
    unique("user_email_unique").on(table.email),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text().primaryKey().notNull(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("verification_identifier_idx").using(
      "btree",
      table.identifier.asc().nullsLast().op("text_ops"),
    ),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text().primaryKey().notNull(),
    token: text().notNull(),
    expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull(),
  },
  (table) => [
    index("session_userId_idx").using(
      "btree",
      table.userId.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "session_user_id_user_id_fk",
    }).onDelete("cascade"),
    unique("session_token_unique").on(table.token),
  ],
);

export const todos = pgTable(
  "todos",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    title: text().notNull(),
    completed: boolean().default(false).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .$onUpdate(() => sql`CURRENT_TIMESTAMP`)
      .notNull(),
    userId: text("user_id").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "todos_user_id_user_id_fk",
    }).onDelete("cascade"),
    index("todos_created_at_idx").on(table.createdAt),
    uniqueIndex("todos_id_idx").on(table.id),
  ],
);

export const geoNotes = pgTable(
  "geo_notes",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    title: text().notNull(),
    geoNote: text().notNull(),
    latitude: numeric("latitude", { mode: "number" }).notNull(),
    longitude: numeric("longitude", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .$onUpdate(() => sql`CURRENT_TIMESTAMP`)
      .notNull(),
    userId: text("user_id"),
    videoUrl: text("video_url"),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "geo-notes_user_id_user_id_fk",
    }).onDelete("cascade"),
    index("geo-notes_updated_at_idx").on(table.updatedAt),
    index("geo-notes_lat_lng_updated_at_idx").on(
      table.latitude,
      table.longitude,
      table.updatedAt.desc(),
    ),
    uniqueIndex("geo-notes_id_idx").on(table.id),
  ],
);

export const role = pgTable("role", {
  id: text().primaryKey().notNull(),
  name: text().notNull().unique(),
  description: text(),
  isSystem: boolean("is_system").default(false).notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" })
    .defaultNow()
    .$onUpdate(() => sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const actionEnum = pgEnum("action", [
  "create",
  "read",
  "update",
  "delete",
]);

export const rolePermission = pgTable(
  "role_permission",
  {
    id: text().primaryKey().notNull(),
    roleId: text("role_id").references(() => role.id),
    resource: text().notNull(),
    action: actionEnum().notNull(),
    permission: text().notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .$onUpdate(() => sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.roleId],
      foreignColumns: [role.id],
      name: "role_permission_role_id_fk",
    }).onDelete("set null"),
    unique("role_permission_unique").on(table.roleId, table.permission),
  ],
);
