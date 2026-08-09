import { relations } from "drizzle-orm";
import { users, userBooks, userWords, userFolders, userSettings } from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  books: many(userBooks),
  words: many(userWords),
  folders: many(userFolders),
  settings: many(userSettings),
}));

export const userBooksRelations = relations(userBooks, ({ one }) => ({
  user: one(users, { fields: [userBooks.userId], references: [users.id] }),
}));

export const userWordsRelations = relations(userWords, ({ one }) => ({
  user: one(users, { fields: [userWords.userId], references: [users.id] }),
}));

export const userFoldersRelations = relations(userFolders, ({ one }) => ({
  user: one(users, { fields: [userFolders.userId], references: [users.id] }),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, { fields: [userSettings.userId], references: [users.id] }),
}));
