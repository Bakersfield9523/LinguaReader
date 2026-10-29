/**
 * 后端 CORS 来源白名单（4.4.19）。
 *
 * 背景：此前 `origin: (origin) => origin || "*"` 会把任意请求方的 Origin 原样回显，
 * 等于对全网开放本机的 /api/trpc 与 /api/ai（AI 代理无鉴权，可被当免费中继）。
 *
 * 只放行本机前端自身的来源：
 *  - Windows（frontendDist 模式）：http://tauri.localhost
 *  - macOS / Linux（自定义协议）：tauri://localhost
 *  - 浏览器开发态与本机动调：localhost / 127.0.0.1 / [::1]（端口不限）
 *
 * 注意：用 new URL() 解析后再比 hostname，避免 `http://localhost.evil.com` 这类
 * 前缀伪装绕过字符串 startsWith 判断。
 */
const EXACT_ORIGINS = new Set([
  "http://tauri.localhost",
  "https://tauri.localhost",
  "tauri://localhost",
]);

const ALLOWED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  if (EXACT_ORIGINS.has(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return ALLOWED_HOSTNAMES.has(u.hostname);
  } catch {
    return false;
  }
}
