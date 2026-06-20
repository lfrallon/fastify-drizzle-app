import { relations } from "drizzle-orm/relations";
import {
  user,
  todos,
  account,
  session,
  geoNotes,
  roles,
  rolePermissions,
  permissions,
} from "./schema.ts";

export const geoNotesRelations = relations(geoNotes, ({ one }) => ({
  user: one(user, {
    fields: [geoNotes.userId],
    references: [user.id],
  }),
}));

export const todosRelations = relations(todos, ({ one }) => ({
  user: one(user, {
    fields: [todos.userId],
    references: [user.id],
  }),
}));

export const userRelations = relations(user, ({ many, one }) => ({
  todos: many(todos),
  accounts: many(account),
  sessions: many(session),
  role: one(roles, {
    fields: [user.roleId],
    references: [roles.id],
  }),
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

export const rolesRelations = relations(roles, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(
  rolePermissions,
  ({ one }) => ({
    role: one(roles, {
      fields: [rolePermissions.roleId],
      references: [roles.id],
    }),

    permission: one(permissions, {
      fields: [rolePermissions.permissionId],
      references: [permissions.id],
    }),
  }),
);
