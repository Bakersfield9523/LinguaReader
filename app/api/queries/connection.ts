import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { env, appRoot } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

// 远程（libSQL/Turso）与本地（better-sqlite3）共用同一套建表语句（SQLite 方言，完全兼容）
const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    phone TEXT,
    name TEXT NOT NULL DEFAULT '',
    avatar TEXT,
    password_hash TEXT NOT NULL,
    security_question TEXT,
    security_answer TEXT,
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
`;

let instance: any;
let libsqlClient: any = null;

function isRemoteDb(url: string): boolean {
  return url.startsWith("libsql:") || url.startsWith("https:") || url.startsWith("http:");
}

function resolveDbPath(rawUrl: string): string {
  // 如果是绝对路径则直接返回（包括 file: 协议的绝对路径）
  const withoutPrefix = rawUrl.replace(/^file:/, "");
  if (path.isAbsolute(withoutPrefix)) return withoutPrefix;

  // 否则解析为 .env 所在的应用根目录，避免受 Tauri 启动 CWD 影响
  return path.resolve(appRoot, withoutPrefix);
}

function ensureTables(sqlite: InstanceType<typeof Database>) {
  sqlite.exec(CREATE_TABLES_SQL);
}

// 本地 SQLite 表结构迁移：为已存在的旧表补加新列（CREATE TABLE IF NOT EXISTS 不会改已有表）
// 每条 ALTER 独立 try/catch，列已存在时忽略报错。
const LOCAL_ALTERS = [
  "ALTER TABLE users ADD COLUMN security_question TEXT",
  "ALTER TABLE users ADD COLUMN security_answer TEXT",
];

function migrateLocalSchema(sqlite: InstanceType<typeof Database>) {
  for (const sql of LOCAL_ALTERS) {
    try {
      sqlite.exec(sql);
    } catch {
      /* 列已存在则忽略 */
    }
  }
}

export function getDb() {
  if (!instance) {
    const url = env.databaseUrl;
    if (isRemoteDb(url)) {
      // 远程模式：连接实例应在启动时由 initRemoteDb() 预先建立（见 boot.ts）。
      // 正常流程下 instance 已就绪，这里兜底再建一次以防万一。
      if (!libsqlClient) {
        throw new Error("远程数据库尚未初始化，请确认启动流程调用了 initRemoteDb()");
      }
      instance = drizzleLibsql(libsqlClient, { schema: fullSchema });
    } else {
      // 本地 SQLite：单机模式（默认 / 未配置云数据库时的兜底）
      const dbPath = resolveDbPath(url);
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const sqlite = new Database(dbPath);
      sqlite.pragma("journal_mode = WAL");
      sqlite.pragma("foreign_keys = ON");
      // 自动建表，确保生产环境数据库结构完整
      ensureTables(sqlite);
      // 为旧版数据库补加新列（如安全问题字段）
      migrateLocalSchema(sqlite);
      instance = drizzleSqlite(sqlite, { schema: fullSchema });
    }
  }
  return instance;
}

/**
 * 初始化远程数据库（libSQL/Turso）。
 * - 动态加载 @libsql/client，避免本地模式下启动即尝试解析该模块（否则打包后运行目录缺包会崩溃）。
 * - 仅在远程模式（DATABASE_URL 为 libsql:/https:/http:）执行；本地模式直接返回。
 * - 在 boot.ts 的 serve 之前 await，确保云端表结构就绪。
 */
export async function initRemoteDb(): Promise<void> {
  if (!isRemoteDb(env.databaseUrl)) return;
  const { createClient } = await import("@libsql/client");
  libsqlClient = createClient({
    url: env.databaseUrl,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });
  instance = drizzleLibsql(libsqlClient, { schema: fullSchema });

  // 建表（远程为异步 execute；逐条执行 CREATE TABLE IF NOT EXISTS）
  const statements = CREATE_TABLES_SQL
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await libsqlClient.execute(stmt);
  }

  // 为旧版云端库补加新列（CREATE TABLE IF NOT EXISTS 不会改已有表）
  for (const sql of LOCAL_ALTERS) {
    try {
      await libsqlClient.execute(sql);
    } catch {
      /* 列已存在则忽略 */
    }
  }
}
