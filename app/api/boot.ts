import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import aiProxy from "./ai-proxy";
import mwProxy from "./mw-proxy";
import wtProxy from "./wiktionary-proxy";

const app = new Hono<{ Bindings: HttpBindings }>();

// CORS 仅在生产环境需要（Tauri WebView 从 http://tauri.localhost 跨域请求）
// 开发模式 @hono/vite-dev-server 自动处理 CORS，重复添加会导致 Vite dev server 崩溃
if (env.isProduction) {
  const { cors } = await import("hono/cors");
  const { isAllowedOrigin } = await import("./lib/cors-origin");
  app.use("*", cors({
    // 4.4.19：白名单制。非白名单来源返回 null → 不写 Access-Control-Allow-Origin
    // → 浏览器判定跨域失败。此前是 `origin || "*"`（回显任意 Origin），等于对全网开放。
    origin: (origin) => (isAllowedOrigin(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }));
}
app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.route("/api/ai", aiProxy);
// 4.4.19：MW 词典代理，Key 只存在后端，避免随前端产物分发
app.route("/api/mw", mwProxy);
// 4.4.21：Wiktionary 回退源也走后端（WebView 直连该域名必超时）
app.route("/api/wt", wtProxy);
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  // 4.4.22：先监听端口，再把云端初始化放到后台。
  // 旧版把 initRemoteDb（最长 25s，逐条建表还要经出网代理）放在 serve 之前，
  // 应用刚打开的这段窗口里 /api/mw、/api/wt 全部「连接被拒」，用户点词必然
  // 得到「找不到解析」；前端又会把这次失败缓存下来，后端就绪后依旧查不出来。
  // 词典 / AI / 本地 SQLite 完全不依赖云端，没理由等它。
  // 4.4.19：只监听回环地址。此前未传 hostname → Node 绑到 ::（所有网卡），
  // 公共 WiFi 下同网段机器可直接访问本机 API（含无鉴权的 /api/ai）。
  serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
    console.log(`Server running on http://127.0.0.1:${port}/`);
  });

  // 云端配置错误或网络不可达时，绝不影响本地服务（本地 SQLite 兜底）。
  // 25s 整体超时后走本地，云端之后仍可由 sync 端点按冷却时间自动重连
  // （ensureRemoteReady）；这里不 await，只 fire-and-forget 并吞掉异常。
  const { initRemoteDb } = await import("./queries/connection");
  void Promise.race([
    initRemoteDb(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("云端初始化超时（25s）")), 25_000),
    ),
  ]).catch((e) => {
    console.error("initRemoteDb failed, falling back to local SQLite:", e);
  });
}
