import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import mwProxy from "../mw-proxy";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GET /api/mw/:word", () => {
  const originalKey = process.env.MW_API_KEY;
  const originalLegacy = process.env.VITE_MW_API_KEY;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    delete process.env.MW_API_KEY;
    delete process.env.VITE_MW_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env.MW_API_KEY = originalKey;
    process.env.VITE_MW_API_KEY = originalLegacy;
    vi.restoreAllMocks();
  });

  it("T1: 未配置 Key 时返回 500（前端据此回退 Wiktionary）", async () => {
    const res = await mwProxy.request("/hello");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("MW_API_KEY");
  });

  it("T2: 缺查询词返回 400", async () => {
    process.env.MW_API_KEY = "test-key";
    const res = await mwProxy.request("/%20");
    expect(res.status).toBe(400);
  });

  it("T3: 上游 200 时原样透传（不在后端二次解析）", async () => {
    process.env.MW_API_KEY = "test-key";
    const payload = [{ meta: { id: "hello:1" }, fl: "noun", def: [] }];
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(payload)) as never;

    const res = await mwProxy.request("/hello");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(payload);
  });

  it("T4: 查询词被 encodeURIComponent（含空格的短语）", async () => {
    process.env.MW_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    globalThis.fetch = fetchMock as never;

    await mwProxy.request("/" + encodeURIComponent("look up"));
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("/look%20up?");
    expect(url).toContain("key=test-key");
  });

  it("T5: 上游失败时返回 502", async () => {
    process.env.MW_API_KEY = "test-key";
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down")) as never;
    const res = await mwProxy.request("/hello");
    expect(res.status).toBe(502);
  });

  it("T6: 兼容旧变量名 VITE_MW_API_KEY（升级后无需立即改名）", async () => {
    process.env.VITE_MW_API_KEY = "legacy-key";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    globalThis.fetch = fetchMock as never;

    const res = await mwProxy.request("/hello");
    expect(res.status).toBe(200);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("key=legacy-key");
  });
});
