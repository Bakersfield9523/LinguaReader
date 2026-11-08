// Wiktionary 词典后端代理（4.4.21）
//
// 为什么要有这一层：
// 1. WebView2 直连 https://en.wiktionary.org 在国内网络下必超时（实测 8s+ 无响应），
//    而 MW 主源又依赖本机 Node 后端。后端一旦没起来，英文词典「所有词都找不到解析」。
// 2. 把回退源也收进后端后，两个源共用同一个 localhost 通道：后端活着就有释义，
//    后端没起来会立刻连接失败（不再白等 6s），排查也只需要看一个地方。
// 3. 后端不能直接裸 fetch：同样超时。这里复用 4.4.16 为零依赖云端同步写的
//    CONNECT 隧道（api/lib/proxy-fetch.ts），走本机出网代理（FastFly 默认 7899）。
//
// 出网策略：直连与代理并发，谁先给出可用响应用谁。海外/直连可用的环境走直连最快；
// 国内环境由代理胜出。整体 5.5s 封顶，不会拖住前端。
import { Hono } from "hono";
import { createProxyFetch, resolveProxy } from "./lib/proxy-fetch";

const WT_API = "https://en.wiktionary.org/w/api.php";
// Wikimedia 要求可识别的 User-Agent；默认 undici UA 会被 403
const USER_AGENT = "LinguaReader/4.4.21 (desktop ebook reader; local dictionary lookup)";
const DIRECT_TIMEOUT_MS = 2200;
const TOTAL_TIMEOUT_MS = 5500;
const DEFAULT_PROXY = "http://127.0.0.1:7899";

/** 单独导出便于单测：URL 拼接与编码不要藏在请求逻辑里 */
export function buildWiktionaryUrl(word: string): string {
  return `${WT_API}?action=parse&page=${encodeURIComponent(word)}&prop=wikitext&format=json&redirects=1`;
}

let proxyFetchesCache: typeof fetch[] | null = null;
function outboundProxyFetches(): typeof fetch[] {
  if (!proxyFetchesCache) {
    // .env 可选覆盖：换了代理端口时无需改代码（例 WIKTIONARY_PROXY=http://127.0.0.1:7890）
    const explicit = process.env.WIKTIONARY_PROXY?.trim();
    if (explicit) {
      proxyFetchesCache = [createProxyFetch(explicit)];
    } else {
      const list = [createProxyFetch()];
      // 启动器/容器可能注入一个不允许 CONNECT 的 HTTP_PROXY（实测本机 63771 会拖到超时）。
      // 自动解析出的若不是本机混合端口，就再加一条 FastFly/Clash 常见端口候选。
      const auto = resolveProxy();
      if (!auto || auto.url.host !== "127.0.0.1:7899") {
        list.push(createProxyFetch(DEFAULT_PROXY));
      }
      proxyFetchesCache = list;
    }
  }
  return proxyFetchesCache;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** 5xx / 403 / 429 视为这条通道失败，让另一条有机会；404（词条不存在）照常透传 */
function accept(res: Response): Promise<Response> {
  if (res.status >= 500 || res.status === 403 || res.status === 429) {
    return Promise.reject(new Error(`upstream HTTP ${res.status}`));
  }
  return Promise.resolve(res);
}

export async function fetchWiktionary(word: string): Promise<Response> {
  const url = buildWiktionaryUrl(word);
  const init: RequestInit = {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  };

  const direct = withTimeout(fetch(url, init), DIRECT_TIMEOUT_MS).then(
    accept,
    () => Promise.reject(new Error("direct channel failed")),
  );
  const proxied = outboundProxyFetches().map((f, i) =>
    withTimeout(f(url, init), TOTAL_TIMEOUT_MS).then(
      accept,
      () => Promise.reject(new Error(`proxy channel ${i} failed`)),
    ),
  );

  return Promise.any([direct, ...proxied]);
}

const wtProxy = new Hono();

// GET /api/wt/:word — 原样透传 MediaWiki 的 JSON（词条不存在时是 {"error": ...}，
// 前端 parse 不到 wikitext 就自然回退，后端不做二次解析）
wtProxy.get("/:word", async (c) => {
  const word = (c.req.param("word") || "").trim();
  if (!word) return c.json({ error: "缺少查询词" }, 400);

  try {
    const res = await fetchWiktionary(word);
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch {
    return c.json({ error: "Wiktionary 请求失败（直连与代理均不可用）" }, 502);
  }
});

export default wtProxy;
