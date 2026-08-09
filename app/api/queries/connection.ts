import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { env, appRoot } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

let instance: ReturnType<typeof drizzle<typeof fullSchema>>;

function resolveDbPath(rawUrl: string): string {
  // 如果是绝对路径则直接返回（包括 file: 协议的绝对路径）
  const withoutPrefix = rawUrl.replace(/^file:/, "");
  if (path.isAbsolute(withoutPrefix)) return withoutPrefix;

  // 否则解析为 .env 所在的应用根目录，避免受 Tauri 启动 CWD 影响
  return path.resolve(appRoot, withoutPrefix);
}

/**
 * 自动建表（CREATE TABLE IF NOT EXISTS）
 * 确保在 Tauri 生产环境（未运行 drizzle-kit push）中数据库表存在
 */
function ensureTables(sqlite: InstanceType<typeof Database>) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT,
      phone TEXT,
      name TEXT NOT NULL DEFAULT '',
      avatar TEXT,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE TABLE IF NOT EXISTS user_books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      local_id TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT,
      language TEXT NOT NULL DEFAULT 'en',
      cover TEXT,
      total_chapters INTEGER NOT NULL DEFAULT 0,
      progress INTEGER NOT NULL DEFAULT 0,
      current_chapter INTEGER NOT NULL DEFAULT 0,
      chapter_data TEXT,
      contents_map TEXT,
      folder_id TEXT,
      last_read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE TABLE IF NOT EXISTS user_words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      local_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      chapter_id TEXT,
      word TEXT NOT NULL,
      sentence TEXT,
      paragraph TEXT,
      ai_meaning TEXT,
      ai_context TEXT,
      dictionary TEXT,
      mastery_level INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE TABLE IF NOT EXISTS user_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      local_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ai_language TEXT NOT NULL DEFAULT 'zh',
      font_size INTEGER NOT NULL DEFAULT 18,
      line_height INTEGER NOT NULL DEFAULT 180,
      theme TEXT NOT NULL DEFAULT 'light',
      font_family TEXT DEFAULT 'system-ui, -apple-system, sans-serif',
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE TABLE IF NOT EXISTS user_highlights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      local_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      chapter_index INTEGER NOT NULL,
      chapter_id TEXT,
      chapter_title TEXT,
      text TEXT NOT NULL,
      note TEXT,
      color TEXT,
      type TEXT,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE TABLE IF NOT EXISTS user_bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      local_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      chapter_index INTEGER NOT NULL,
      chapter_title TEXT,
      note TEXT,
      scroll_position INTEGER,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
  `);
}

export function getDb() {
  if (!instance) {
    const dbPath = resolveDbPath(env.databaseUrl);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    // 自动建表，确保生产环境数据库结构完整
    ensureTables(sqlite);
    instance = drizzle(sqlite, { schema: fullSchema });
  }
  return instance;
}
