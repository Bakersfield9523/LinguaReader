import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import aiProxy from "./ai-proxy";

const app = new Hono<{ Bindings: HttpBindings }>();

// CORS 仅在生产环境需要（Tauri WebView 从 http://tauri.localhost 跨域请求）
// 开发模式 @hono/vite-dev-server 自动处理 CORS，重复添加会导致 Vite dev server 崩溃
if (env.isProduction) {
  const { cors } = await import("hono/cors");
  app.use("*", cors({
    origin: (origin) => origin || "*",
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
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  // 远程数据库（Turso/libSQL）初始化：在监听端口前确保云端连接与表结构就绪。
  // 用 try/catch 包裹：云端配置错误或网络不可达时，绝不影响本地 SQLite 后端的启动，
  // 避免“云端没配好 → 整个世界（注册/登录/书架）全部 Failed to fetch”的连锁崩溃。
  // 4.4.16：再加 25s 整体超时——逐条建表各带 20s 请求超时，最坏情况会拖到几分钟，
  // 超时后走本地兜底，云端之后仍可由 sync 端点按冷却时间自动重连（ensureRemoteReady）。
  const { initRemoteDb } = await import("./queries/connection");
  try {
    await Promise.race([
      initRemoteDb(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("云端初始化超时（25s）")), 25_000),
      ),
    ]);
  } catch (e) {
    console.error("initRemoteDb failed, falling back to local SQLite:", e);
  }

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
