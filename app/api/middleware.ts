import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;
export const publicQuery = t.procedure;

// 需要登录的查询
export const authedQuery = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// ============ 速率限制中间件 ============

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// 定期清理过期条目（每 5 分钟）
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetAt < now) rateLimitStore.delete(key);
  }
}, 5 * 60 * 1000);

/**
 * 速率限制中间件工厂
 * @param maxRequests 时间窗口内最大请求数
 * @param windowMs 时间窗口（毫秒）
 */
export function rateLimited(maxRequests: number, windowMs: number) {
  return t.middleware(async ({ ctx, next }) => {
    // 使用客户端 IP 作为限制键（回退到 'unknown'）
    const ip = ctx.req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || ctx.req.headers.get('x-real-ip')
      || 'unknown';

    const key = `auth:${ip}`;
    const now = Date.now();
    const entry = rateLimitStore.get(key);

    if (!entry || entry.resetAt < now) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      entry.count++;
      if (entry.count > maxRequests) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `请求过于频繁，请 ${retryAfter} 秒后再试`,
        });
      }
    }

    return next({ ctx });
  });
}

// 认证端点速率限制：每 IP 每分钟最多 10 次请求
export const authRateLimited = t.procedure.use(rateLimited(10, 60 * 1000));
