// Merriam-Webster 词典后端代理（4.4.19）
//
// 背景：此前 Key 写在前端 `import.meta.env.VITE_MW_API_KEY`，Vite 对 VITE_ 前缀做
// **构建期内联**，明文 Key 被打进 dist/public/assets/*.js 随安装包分发给每个终端用户。
// 搬到后端后，Key 只存在于运行进程的 .env 里，前端产物中不再出现。
//
// 与 /api/ai 一样是 Hono 子应用，由 boot.ts 用 app.route("/api/mw", mwProxy) 挂载。
import { Hono } from "hono";

const MW_BASE_URL = "https://www.dictionaryapi.com/api/v3/references/learners/json";
const TIMEOUT_MS = 5000;

const mwProxy = new Hono();

// GET /api/mw/:word — 原样透传 MW 的响应（MW 可能返回对象数组，也可能返回
// 拼写建议的字符串数组，所以后端不做二次解析，交给前端 dictionary.ts 处理）
mwProxy.get("/:word", async (c) => {
  // 兼容已部署环境：旧的 .env 里变量名叫 VITE_MW_API_KEY，一并读取避免升级后失效
  const key = process.env.MW_API_KEY || process.env.VITE_MW_API_KEY || "";
  if (!key) {
    return c.json({ error: "MW_API_KEY 未配置（英文词典将回退到 Wiktionary）" }, 500);
  }

  const word = (c.req.param("word") || "").trim();
  if (!word) return c.json({ error: "缺少查询词" }, 400);

  const url = `${MW_BASE_URL}/${encodeURIComponent(word)}?key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "词典服务请求失败";
    return c.json({ error: msg }, 502);
  }
});

export default mwProxy;
