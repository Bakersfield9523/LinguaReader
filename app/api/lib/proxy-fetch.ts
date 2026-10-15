/**
 * 可走 HTTP 代理的 fetch（零依赖，仅 Node 内置模块）。
 *
 * 存在原因（4.4.16 云端同步修复）：
 * 1. `@libsql/client` 的 `Config.fetch` 自定义 fetch **只在 https:/http: 路径生效**：
 *    `libsql://` 会被 expandConfig 映射成 wss（WebSocket），自定义 fetch 在该路径被完全忽略。
 *    因此 DATABASE_URL 必须归一化成 `https://` 才能走这条代理通道（见 connection.ts 的 normalizeRemoteUrl）。
 * 2. 国内网络直连 Turso（*.turso.io）会超时，必须经本机代理（Clash/FlClash，默认 127.0.0.1:7899）出网。
 *    Node 后端默认不走系统代理（Node 22 也没有 NODE_USE_ENV_PROXY），裸 fetch 必然失败——
 *    这正是 2026-08-31 云端同步被整体禁用的直接原因。
 * 3. 不引入 undici / https-proxy-agent 等依赖：后端按外部模块分发，少一个传递依赖少一份打包/ABI 风险。
 *
 * 实现要点：
 * - https 目标：向代理发 CONNECT 建立隧道 → 在隧道上做 TLS → 按普通 HTTPS 请求收发；
 * - http 目标：按绝对 URI（absolute-form）直接把请求发给代理；
 * - 代理解析顺序：HTTPS_PROXY/HTTP_PROXY/ALL_PROXY 环境变量 → Windows 注册表 ProxyServer → 默认 http://127.0.0.1:7899；
 * - 代理端口拒绝连接（ECONNREFUSED，通常是代理没开）时自动回退一次直连，避免"代理没开 → 云端彻底不可用"；
 * - localhost / 127.0.0.1 / ::1 永远直连，不绕代理。
 */
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import { execSync } from "node:child_process";

/** CONNECT 建隧道与整体请求的超时（毫秒）。云端不可达时快速失败，避免拖慢启动/同步。 */
const CONNECT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 20_000;

/** 这些头由 Node 自行管理或需要剥离，直接转发会导致双重编码/连接复用异常。 */
const STRIPPED_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "content-length",
  // 不向服务器声明接受 gzip：代理通道返回的是原始字节，不做解压，声明了反而会让
  // 某些 CDN 返回压缩体导致 JSON 解析失败（hrana 默认也不发这个头）。
  "accept-encoding",
]);

export interface ProxyInfo {
  url: URL;
  /** 代理来源，仅用于日志 */
  source: "env" | "registry" | "default";
}

function readEnvProxy(): string | undefined {
  const raw =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy;
  const v = raw?.trim();
  return v ? v : undefined;
}

function readRegistryProxy(): string | undefined {
  if (process.platform !== "win32") return undefined;
  try {
    const out = execSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer',
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 },
    );
    const m = out.match(/ProxyServer\s+REG_SZ\s+(\S+)/);
    if (!m) return undefined;
    const val = m[1].trim();
    if (!val || val === "0") return undefined;
    // 注册表值可能是 "127.0.0.1:7899"（无协议），也可能是 "http=127.0.0.1:7899;https=..." 形式
    let picked = val;
    if (val.includes("=")) {
      const seg = val
        .split(";")
        .find((s) => s.trim().toLowerCase().startsWith("http="));
      picked = (seg || val.split(";")[0]).split("=").slice(1).join("=").trim();
    }
    if (!picked) return undefined;
    return /^https?:\/\//i.test(picked) ? picked : `http://${picked}`;
  } catch {
    return undefined;
  }
}

/** 解析出网代理。拿不到任何配置时默认本机混合端口 7899（Clash/FlClash 常见值）。 */
export function resolveProxy(): ProxyInfo | null {
  const fromEnv = readEnvProxy();
  const fromReg = fromEnv ? undefined : readRegistryProxy();
  const raw = fromEnv || fromReg || "http://127.0.0.1:7899";
  try {
    const url = new URL(raw);
    if (!url.hostname) return null;
    return { url, source: fromEnv ? "env" : fromReg ? "registry" : "default" };
  } catch {
    return null;
  }
}

function shouldBypass(target: URL): boolean {
  const h = target.hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "[::1]" ||
    h.endsWith(".localhost")
  );
}

/**
 * 通过 HTTP 代理 CONNECT 隧道访问 https 目标的 Agent。
 * createConnection 里手动完成 CONNECT + TLS，再把 TLSSocket 交给 Node 的 http 客户端，
 * 响应解析（状态行/分块编码/keep-alive）全部复用 Node 原生能力，不手写解析器。
 *
 * ⚠️ 必须继承 https.Agent 而不是 http.Agent，两个实例属性会被 Node 读取：
 *   - `protocol`：ClientRequest 校验 `options.protocol === agent.protocol`，
 *     http.Agent 的是 'http:'，用于 https.request 会直接抛 ERR_INVALID_PROTOCOL；
 *   - `defaultPort`：URL 没写端口时 Node 用 `agent.defaultPort` 补端口，
 *     http.Agent 的是 80 → CONNECT 到目标的 80 端口（明文）→ 在明文上做 TLS
 *     报 ERR_SSL_PACKET_LENGTH_TOO_LONG。https.Agent 的两个值都正确。
 */
class ConnectProxyAgent extends https.Agent {
  private readonly proxy: URL;

  constructor(proxy: URL) {
    super({ keepAlive: true, maxSockets: 8 });
    this.proxy = proxy;
  }

  // 注意签名对齐 @types/node 的新版 Agent.createConnection（callback 可选、返回 Duplex）。
  // 运行时 Node 两种风格都支持：要么回调，要么同步返回 socket。
  createConnection(
    options: http.ClientRequestArgs,
    callback?: (err: Error | null, stream: Duplex) => void,
  ): Duplex | null | undefined {
    let settled = false;
    const done = (err: Error | null, socket?: Socket) => {
      if (settled) return;
      settled = true;
      callback?.(err, socket as unknown as Duplex);
    };

    const targetHost = String(options.host);
    const targetPort = Number(options.port) || 443;

    const proxyReq = http.request({
      host: this.proxy.hostname,
      port: Number(this.proxy.port) || 80,
      method: "CONNECT",
      path: `${targetHost}:${targetPort}`,
      headers: this.proxy.username
        ? {
            "Proxy-Authorization":
              "Basic " +
              Buffer.from(
                `${decodeURIComponent(this.proxy.username)}:${decodeURIComponent(this.proxy.password)}`,
              ).toString("base64"),
          }
        : {},
      timeout: CONNECT_TIMEOUT_MS,
    });

    proxyReq.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        done(new Error(`代理 CONNECT 失败：HTTP ${res.statusCode} ${res.statusMessage || ""}`.trim()));
        return;
      }
      const tlsSocket = tls.connect(
        {
          socket,
          servername: (options as any).servername || targetHost,
          ALPNProtocols: ["http/1.1"],
        },
        () => done(null, tlsSocket as unknown as Socket),
      );
      tlsSocket.on("error", (err) => done(err));
    });
    proxyReq.on("timeout", () => {
      proxyReq.destroy(new Error("代理 CONNECT 超时"));
    });
    proxyReq.on("error", (err: NodeJS.ErrnoException) => {
      done(markProxyDownIfRefused(err));
    });
    proxyReq.end();
    // 异步建链：结果经 callback 返回，这里同步返回 null（Node 的 Agent 两种风格都支持）
    return null;
  }
}

function pickForwardHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    if (!STRIPPED_HEADERS.has(key.toLowerCase())) headers[key] = value;
  });
  return headers;
}

/** 标记"代理整体不可用"的错误，供 proxyFetch 决定是否回退直连 */
function isProxyDownError(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as any).__proxyDown === true;
}

/** 代理端口拒绝连接 → 打上 __proxyDown 标记（CONNECT 隧道与 absolute-form 两条路径共用） */
function markProxyDownIfRefused<T>(err: T): T {
  if (err && typeof err === "object" && (err as unknown as NodeJS.ErrnoException).code === "ECONNREFUSED") {
    (err as any).__proxyDown = true;
  }
  return err;
}

/**
 * 生成一个可走代理的 fetch，传给 @libsql/client 的 createClient({ fetch })。
 * 代理不可用时返回的 fetch 会自动回退全局 fetch（直连）。
 */
export function createProxyFetch(): typeof fetch {
  const proxy = resolveProxy();
  if (!proxy) {
    console.warn("[proxy-fetch] 未能解析出网代理，云端请求将直连");
    return fetch;
  }
  console.log(`[proxy-fetch] 出网代理：${proxy.url.host}（来源：${proxy.source}）`);
  const agent = new ConnectProxyAgent(proxy.url);

  async function send(target: URL, req: Request, headers: Record<string, string>, body?: Buffer): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      if (target.protocol === "http:") {
        // http 目标：absolute-form 直接发给代理。
        // 注意 Host 头必须写目标主机（不是代理）：上面 STRIPPED_HEADERS 把传入的 host 剥掉了，
        // 不补的话 Node 会用「连接的代理地址」当 Host，目标站点直接回 400。
        return await new Promise<Response>((resolve, reject) => {
          const request = http.request(
            {
              host: proxy!.url.hostname,
              port: Number(proxy!.url.port) || 80,
              method: req.method,
              path: target.href,
              headers: { ...headers, host: target.host },
              timeout: REQUEST_TIMEOUT_MS,
              signal: controller.signal,
            },
            (res) => {
              const chunks: Buffer[] = [];
              res.on("data", (c) => chunks.push(c));
              res.on("end", () => {
                const respHeaders = new Headers();
                for (const [k, v] of Object.entries(res.headers)) {
                  if (Array.isArray(v)) {
                    for (const vv of v) respHeaders.append(k, vv);
                  } else if (v != null) {
                    respHeaders.set(k, v);
                  }
                }
                resolve(
                  new Response(Buffer.concat(chunks), {
                    status: res.statusCode,
                    statusText: res.statusMessage,
                    headers: respHeaders,
                  }),
                );
              });
              res.on("error", reject);
            },
          );
          request.on("error", (err) => reject(markProxyDownIfRefused(err)));
          if (body) request.write(body);
          request.end();
        });
      }

      // https 目标：经 CONNECT 隧道
      return await new Promise<Response>((resolve, reject) => {
        const request = https.request(
          target,
          {
            agent,
            method: req.method,
            headers,
            timeout: REQUEST_TIMEOUT_MS,
            signal: controller.signal,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
              const respHeaders = new Headers();
              for (const [k, v] of Object.entries(res.headers)) {
                if (Array.isArray(v)) {
                  for (const vv of v) respHeaders.append(k, vv);
                } else if (v != null) {
                  respHeaders.set(k, v);
                }
              }
              resolve(
                new Response(Buffer.concat(chunks), {
                  status: res.statusCode,
                  statusText: res.statusMessage,
                  headers: respHeaders,
                }),
              );
            });
            res.on("error", reject);
          },
        );
        request.on("error", (err) => reject(markProxyDownIfRefused(err)));
        request.on("timeout", () => request.destroy(new Error("云端请求超时（socket 15s 无响应）")));
        if (body) request.write(body);
        request.end();
      });
    } finally {
      clearTimeout(timer);
    }
  }

  // 注意：服务端 tsconfig 的 lib 只有 ES2022（无 DOM），RequestInfo 不存在，用显式联合类型
  return async function proxyFetch(input: Request | string | URL, init?: RequestInit): Promise<Response> {
    let req: Request;
    if (typeof input === "string" || input instanceof URL) {
      req = new Request(input.toString(), init);
    } else {
      req = input as Request;
    }

    const target = new URL(req.url);
    if (shouldBypass(target)) return fetch(req);

    const headers = pickForwardHeaders(req);
    let body: Buffer | undefined;
    if (req.body) body = Buffer.from(await req.arrayBuffer());

    try {
      return await send(target, req, headers, body);
    } catch (err) {
      // 代理没开（端口拒绝连接）→ 回退一次直连；代理在但目标不可达时不重试，避免双倍等待
      if (isProxyDownError(err)) {
        console.warn(`[proxy-fetch] 代理 ${proxy.url.host} 拒绝连接，回退直连 ${target.host}`);
        return fetch(
          new Request(req.url, {
            method: req.method,
            headers,
            body: body ? new Uint8Array(body) : undefined,
          }),
        );
      }
      throw err;
    }
  };
}
