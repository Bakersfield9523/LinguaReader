import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import os from "os";
import crypto from "crypto";

// 从脚本所在目录向上查找 .env，确保 Tauri 启动时 CWD 不在 app/ 也能找到配置
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const candidatePaths = [
  path.resolve(__dirname, "..", ".env"),       // 生产环境 boot.js 在 dist/
  path.resolve(__dirname, "..", "..", ".env"), // 开发环境 env.ts 在 api/lib/
  path.resolve(process.cwd(), ".env"),           // 最后回退到 CWD
];
const envPath = candidatePaths.find((p) => fs.existsSync(p));
if (envPath) config({ path: envPath });

// 导出 app 根目录（.env 所在目录），供开发环境数据库解析使用
export const appRoot = envPath ? path.dirname(envPath) : process.cwd();

const isProduction = process.env.NODE_ENV === "production";

// 获取应用数据目录（桌面生产环境用来持久化数据库和密钥）
function getAppDataDir(): string {
  const home = os.homedir();
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || home, "LinguaReader");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "LinguaReader");
  }
  return path.join(home, ".local", "share", "LinguaReader");
}

function getOrCreatePersistentSecret(dataDir: string): string {
  const secretPath = path.join(dataDir, ".app_secret");
  if (fs.existsSync(secretPath)) {
    return fs.readFileSync(secretPath, "utf-8").trim();
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(secretPath, secret, "utf-8");
  try { fs.chmodSync(secretPath, 0o600); } catch { /* Windows 上不支持 chmod，忽略 */ }
  return secret;
}

// 在生产环境：数据库和密钥使用用户数据目录，避免写入安装目录
const appDataDir = getAppDataDir();
const databaseUrl = isProduction
  ? `file:${path.join(appDataDir, "data", "lingua.db")}`
  : (process.env.DATABASE_URL || "file:./data/lingua.db");

const appSecret = isProduction
  ? getOrCreatePersistentSecret(appDataDir)
  : (process.env.APP_SECRET || crypto.randomBytes(32).toString("hex"));

export const env = {
  appId: process.env.APP_ID || "lingua_reader",
  appSecret,
  isProduction,
  databaseUrl,
  appDataDir,
  appRoot,
};
