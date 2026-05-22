import { relations } from "drizzle-orm/relations";
import {
  user,
  todos,
  account,
  session,
  mapMessages,
  role,
  rolePermission,
} from "./schema.ts";

export const mapMessagesRelations = relations(mapMessages, ({ one }) => ({
  user: one(user, {
    fields: [mapMessages.userId],
    references: [user.id],
  }),
}));

export const todosRelations = relations(todos, ({ one }) => ({
  user: one(user, {
    fields: [todos.userId],
    references: [user.id],
  }),
}));

export const userRelations = relations(user, ({ many }) => ({
  todos: many(todos),
  accounts: many(account),
  sessions: many(session),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const roleRelations = relations(role, ({ many }) => ({
  permissions: many(rolePermission),
}));

export const rolePermissionRelations = relations(rolePermission, ({ one }) => ({
  role: one(role, {
    fields: [rolePermission.roleId],
    references: [role.id],
  }),
}));
