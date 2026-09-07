import { sql } from "drizzle-orm";
import {
  sqliteTable,
  integer,
  text,
} from "drizzle-orm/sqlite-core";

// ── Users ──
export const users = sqliteTable("users", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  email: text("email"),
  phone: text("phone"),
  name: text("name").notNull().default(""),
  avatar: text("avatar"), // base64 encoded avatar image
  passwordHash: text("password_hash").notNull(),
  securityQuestion: text("security_question"), // 找回密码用的安全问题
  securityAnswer: text("security_answer"), // 安全答案的哈希（pbkdf2）
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

// ── User Books (云端同步) ──
export const userBooks = sqliteTable("user_books", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }).notNull(),
  localId: text("local_id").notNull(), // 本地书籍ID
  title: text("title").notNull(),
  author: text("author"),
  language: text("language").notNull().default("en"),
  cover: text("cover"), // base64 encoded cover
  totalChapters: integer("total_chapters").notNull().default(0),
  progress: integer("progress").notNull().default(0),
  currentChapter: integer("current_chapter").notNull().default(0),
  chapterData: text("chapter_data"), // JSON string of chapters tree
  contentsMap: text("contents_map"), // JSON string of Map<chapterId, content>
  folderId: text("folder_id"),
  lastReadAt: text("last_read_at"),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

// ── User Word Markers (云端同步) ──
export const userWords = sqliteTable("user_words", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }).notNull(),
  localId: text("local_id").notNull(), // 本地单词ID
  bookId: text("book_id").notNull(),
  chapterId: text("chapter_id"),
  word: text("word").notNull(),
  sentence: text("sentence"),
  paragraph: text("paragraph"),
  aiMeaning: text("ai_meaning"),
  aiContext: text("ai_context"),
  dictionary: text("dictionary"), // JSON string
  masteryLevel: integer("mastery_level").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

// ── User Folders (云端同步) ──
export const userFolders = sqliteTable("user_folders", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }).notNull(),
  localId: text("local_id").notNull(),
  name: text("name").notNull(),
  color: text("color"),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

// ── User Settings (云端同步) ──
export const userSettings = sqliteTable("user_settings", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }).notNull(),
  aiLanguage: text("ai_language").notNull().default("zh"),
  fontSize: integer("font_size").notNull().default(18),
  lineHeight: integer("line_height").notNull().default(180), // stored as *100
  theme: text("theme").notNull().default("light"),
  fontFamily: text("font_family").default("system-ui, -apple-system, sans-serif"),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

// ── User Highlights (云端同步) ──
export const userHighlights = sqliteTable("user_highlights", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }).notNull(),
  localId: text("local_id").notNull(),
  bookId: text("book_id").notNull(),
  chapterIndex: integer("chapter_index").notNull(),
  chapterId: text("chapter_id"),
  chapterTitle: text("chapter_title"),
  text: text("text").notNull(),
  note: text("note"),
  color: text("color"),
  type: text("type"), // 'underline' | 'highlight'
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

// ── User Bookmarks (云端同步) ──
export const userBookmarks = sqliteTable("user_bookmarks", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }).notNull(),
  localId: text("local_id").notNull(),
  bookId: text("book_id").notNull(),
  chapterIndex: integer("chapter_index").notNull(),
  chapterTitle: text("chapter_title"),
  note: text("note"),
  scrollPosition: integer("scroll_position"),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});
