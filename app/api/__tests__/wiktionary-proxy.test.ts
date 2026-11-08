import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.mock 会被提升到 import 之前，用 vi.hoisted 拿到可在工厂里引用的 mock
const mocks = vi.hoisted(() => ({ proxyFetch: vi.fn() }));
vi.mock("../lib/proxy-fetch", () => ({
  createProxyFetch: () => mocks.proxyFetch,
  // 模拟"自动解析已命中默认混合端口"：不额外增加候选通道，测试保持确定性
  resolveProxy: () => ({ url: new URL("http://127.0.0.1:7899"), source: "default" }),
}));

import wtProxy, { buildWiktionaryUrl } from "../wiktionary-proxy";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const WIKITEXT = {
  parse: { wikitext: { "*": "==English==\n===Noun===\n# a greeting" } },
};

describe("buildWiktionaryUrl", () => {
  it("T1: 目标域名与参数固定，查询词做 URL 编码", () => {
    const url = buildWiktionaryUrl("look up");
    expect(url).toContain("https://en.wiktionary.org/w/api.php?");
    expect(url).toContain("action=parse");
    expect(url).toContain("prop=wikitext");
    expect(url).toContain("page=look%20up");
  });

  it("T2: 特殊字符不会破坏 query string", () => {
    expect(buildWiktionaryUrl("a&b=c")).toContain("page=a%26b%3Dc");
  });
});

describe("GET /api/wt/:word", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    mocks.proxyFetch.mockReset();
    globalThis.fetch = vi.fn() as never;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("T3: 缺查询词返回 400", async () => {
    const res = await wtProxy.request("/%20");
    expect(res.status).toBe(400);
  });

  it("T4: 直连成功时原样透传，且带可识别的 User-Agent", async () => {
    const direct = vi.fn().mockResolvedValue(jsonResponse(WIKITEXT));
    globalThis.fetch = direct as never;
    mocks.proxyFetch.mockResolvedValue(jsonResponse(WIKITEXT));

    const res = await wtProxy.request("/hello");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(WIKITEXT);

    const [url, init] = direct.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("en.wiktionary.org/w/api.php");
    expect(url).toContain("page=hello");
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain("LinguaReader");
  });

  it("T5: 直连失败时由代理通道胜出", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("direct timeout")) as never;
    mocks.proxyFetch.mockResolvedValue(jsonResponse(WIKITEXT));

    const res = await wtProxy.request("/hello");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(WIKITEXT);
  });

  it("T6: 直连拿到 5xx 时不采纳，等代理结果", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: "bad" }, 502)) as never;
    mocks.proxyFetch.mockResolvedValue(jsonResponse(WIKITEXT));

    const res = await wtProxy.request("/hello");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(WIKITEXT);
  });

  it("T7: 两路都失败返回 502（前端据此判定回退源不可用）", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline")) as never;
    mocks.proxyFetch.mockRejectedValue(new Error("proxy down"));

    const res = await wtProxy.request("/hello");
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Wiktionary");
  });

  it("T8: 词条不存在（上游 404）照常透传，不被当成通道故障", async () => {
    const notFound = { error: { code: "missingtitle", info: "page not found" } };
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(notFound, 404)) as never;
    mocks.proxyFetch.mockResolvedValue(jsonResponse(notFound, 404));

    const res = await wtProxy.request("/zzzznotaword");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual(notFound);
  });

  it("T9: 短语查询词编码后到达上游", async () => {
    const direct = vi.fn().mockResolvedValue(jsonResponse(WIKITEXT));
    globalThis.fetch = direct as never;
    mocks.proxyFetch.mockResolvedValue(jsonResponse(WIKITEXT));

    await wtProxy.request("/" + encodeURIComponent("look up"));
    const [url] = direct.mock.calls[0] as unknown as [string];
    expect(url).toContain("page=look%20up");
  });
});
