import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { env, appRoot } from "../lib/env";
import { createProxyFetch } from "../lib/proxy-fetch";
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
// 远程（Turso/libSQL）是否真正初始化成功。仅在成功时走云端分支；
// 失败时 getDb() 回退到本地 SQLite，避免“云端没配好 → 注册/登录/书架全部抛错”的连锁崩溃。
let remoteReady = false;

function isRemoteDb(url: string): boolean {
  return url.startsWith("libsql:") || url.startsWith("https:") || url.startsWith("http:");
}

/**
 * 把 libsql:// 归一化成 https://（4.4.16）。
 * 原因：@libsql/client 的 expandConfig 会把 libsql:// 映射为 wss（WebSocket）路径，
 * 而自定义 fetch（本机的代理通道，见 lib/proxy-fetch.ts）在 WebSocket 路径上被忽略，
 * 只有 https:/http: 的 HTTP 路径才会使用 Config.fetch。不转换的话代理永远不生效。
 */
function normalizeRemoteUrl(rawUrl: string): string {
  return rawUrl.replace(/^libsql:\/\//i, "https://");
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

// 本地 SQLite 表结构迁移：为已存在的旧表补加新列/新索引（CREATE TABLE IF NOT EXISTS 不会改已有表）
// 每条语句独立 try/catch，列/索引已存在时忽略报错。
// 4.4.19：新增邮箱/手机号唯一约束。此前 users.email / users.phone 无任何唯一性保障，
// 加上注册是「先 SELECT 判重再 INSERT」且不在事务内 → 可被抢注他人邮箱，导致受害者
// 登录时 .limit(1) 命中攻击者记录而永久登不上。
// 刻意不改 CREATE_TABLES_SQL：CREATE TABLE IF NOT EXISTS 对已存在的库直接跳过，
// 加了 UNIQUE 老库也不生效，会造成「新库有约束 / 老库没有」的行为分裂。
const LOCAL_ALTERS = [
  "ALTER TABLE users ADD COLUMN security_question TEXT",
  "ALTER TABLE users ADD COLUMN security_answer TEXT",
  // 空串归一为 NULL：否则多条 '' 会互相冲突导致索引建不上
  // （SQLite 的 UNIQUE 索引把多个 NULL 视为互不相等，只填手机号的用户不受影响）
  "UPDATE users SET email = NULL WHERE email IS NOT NULL AND TRIM(email) = ''",
  "UPDATE users SET phone = NULL WHERE phone IS NOT NULL AND TRIM(phone) = ''",
  "CREATE UNIQUE INDEX IF NOT EXISTS users_email_uidx ON users(email)",
  "CREATE UNIQUE INDEX IF NOT EXISTS users_phone_uidx ON users(phone)",
];

function migrateLocalSchema(sqlite: InstanceType<typeof Database>) {
  for (const sql of LOCAL_ALTERS) {
    try {
      sqlite.exec(sql);
    } catch (e) {
      // 老库若已存在重复邮箱/手机号，唯一索引会建不上：只告警不改数据
      // （把重复行清空会让人直接登不上，破坏性大于收益）
      console.warn("[db] migration skipped:", sql, "→", (e as Error)?.message);
    }
  }
  try {
    const dup = sqlite
      .prepare(
        "SELECT email AS k, COUNT(*) AS c FROM users WHERE email IS NOT NULL GROUP BY email HAVING c > 1",
      )
      .all() as Array<{ k: string; c: number }>;
    if (dup.length) {
      console.warn("[db] 存量库存在重复邮箱，唯一索引未生效，请人工清理：", dup);
    }
  } catch {
    /* 体检失败不影响启动 */
  }
}

export function getDb() {
  if (!instance) {
    const url = env.databaseUrl;
    if (isRemoteDb(url) && remoteReady && libsqlClient) {
      // 远程模式：连接实例已在 initRemoteDb() 中建立就绪
      instance = drizzleLibsql(libsqlClient, { schema: fullSchema });
    } else {
      // 本地 SQLite：兜底分支，覆盖三种情况：
      //  1) 未配置 DATABASE_URL（默认）；
      //  2) 配置了远程但未初始化成功（云端故障/网络/凭证错误）→ 安全回退，不抛错；
      //  3) 任何意外路径。
      if (isRemoteDb(url) && !remoteReady) {
        console.warn(
          "[db] 远程数据库未就绪，已回退到本地 SQLite（本次会话数据不会同步到云端）"
        );
      }
      const dbPath = resolveDbPath(env.localDatabaseUrl);
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
 *
 * 4.4.16：URL 归一化为 https:// 并注入可走代理的 fetch（lib/proxy-fetch.ts），
 * 否则国内网络直连 Turso 必超时——这正是云端同步此前被整体禁用的原因。
 */
export async function initRemoteDb(): Promise<void> {
  if (!isRemoteDb(env.databaseUrl)) return;
  const { createClient } = await import("@libsql/client");
  const url = normalizeRemoteUrl(env.databaseUrl);
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* 保留原始值用于日志 */
  }
  console.log(`[db] 正在连接云端数据库：${host}`);
  libsqlClient = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    fetch: createProxyFetch(),
  });
  instance = drizzleLibsql(libsqlClient, { schema: fullSchema });

  try {
    // 建表（远程为异步 execute；逐条执行 CREATE TABLE IF NOT EXISTS）
    const statements = CREATE_TABLES_SQL
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await libsqlClient.execute(stmt);
    }

    // 为旧版云端库补加新列/新索引（CREATE TABLE IF NOT EXISTS 不会改已有表）
    for (const sql of LOCAL_ALTERS) {
      try {
        await libsqlClient.execute(sql);
      } catch (e) {
        console.warn("[db] remote migration skipped:", sql, "→", (e as Error)?.message);
      }
    }
  } catch (e) {
    // 关键兜底（4.4.16）：上面已把 instance 指向远程 drizzle，若此时失败不复位，
    // getDb() 会因 instance 非空而永远返回这个连不上的实例——本地 SQLite 兜底
    // 整个失效，注册/登录/书架全部报错。这正是"云端没配好 → 连锁崩溃"的形态。
    instance = null;
    libsqlClient = null;
    throw e;
  }

  // 全部建表/改表成功后才标记远程就绪，getDb() 据此决定是否走云端分支。
  remoteReady = true;
  console.log(`[db] 云端数据库就绪：${host}`);
}

// ── 云端连接的懒重试（4.4.16）──
// 启动时代理没开/网络不通 → remoteReady=false → 回退本地。用户随后打开代理再点同步时，
// 由 ensureRemoteReady() 补一次初始化，不必重启应用。失败有 30s 冷却，避免每次同步都干等超时。

let remoteInitInFlight: Promise<void> | null = null;
let lastRemoteAttemptAt = 0;
const REMOTE_RETRY_COOLDOWN_MS = 30_000;

/** 是否配置了云端数据库（不论此刻是否连得上） */
export function isRemoteConfigured(): boolean {
  return isRemoteDb(env.databaseUrl);
}

/** 当前是否真正走云端分支 */
export function isRemoteReady(): boolean {
  return remoteReady;
}

/**
 * 确保云端已连接；未连接且配置了云端时，按冷却时间补一次初始化。
 * 返回值即 remoteReady：false 表示本次只能用本地 SQLite（调用方应给出明确提示，
 * 而不是静默写本地库却提示"同步成功"——那是 4.4.16 之前最误导用户的行为）。
 */
export async function ensureRemoteReady(): Promise<boolean> {
  if (remoteReady) return true;
  if (!isRemoteDb(env.databaseUrl)) return false;

  if (remoteInitInFlight) {
    try {
      await remoteInitInFlight;
    } catch {
      /* 忽略，下面统一返回 remoteReady */
    }
    return remoteReady;
  }

  const now = Date.now();
  if (now - lastRemoteAttemptAt < REMOTE_RETRY_COOLDOWN_MS) return false;
  lastRemoteAttemptAt = now;

  remoteInitInFlight = initRemoteDb().finally(() => {
    remoteInitInFlight = null;
  });
  try {
    await remoteInitInFlight;
  } catch (e) {
    console.error("[db] 云端数据库重连失败，继续使用本地 SQLite：", e);
  }
  return remoteReady;
}
