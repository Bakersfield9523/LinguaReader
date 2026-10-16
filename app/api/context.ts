import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { jwtVerify, SignJWT } from "jose";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { eq } from "drizzle-orm";
import { env } from "./lib/env";

// 统一使用 env.ts 加载的密钥（确保 .env 被正确加载后再读取）
const JWT_SECRET = new TextEncoder().encode(env.appSecret);

export async function createToken(payload: { userId: number; email?: string; phone?: string }) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    // 180d（4.4.17）：原 30d 对"偶尔打开一次的桌面阅读器"太短——用户 8-12 登录、
    // 9-11 令牌静默过期，之后每次点同步都报"请先登录"而界面仍显示已登录（localStorage
    // 缓存），排查半天。延长有效期 + 前端 401 自动登出，双管齐下消除该故障模式。
    .setExpirationTime("180d")
    .setIssuedAt()
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, { clockTolerance: 60 });
    return payload as { userId: number; email?: string; phone?: string };
  } catch {
    return null;
  }
}

// 找回密码用的短时效令牌（10 分钟），与普通登录令牌用途分离
export async function createResetToken(userId: number) {
  return new SignJWT({ userId, purpose: "reset" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .setIssuedAt()
    .sign(JWT_SECRET);
}

export async function verifyResetToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, { clockTolerance: 60 });
    if ((payload as any).purpose !== "reset") return null;
    return payload as { userId: number; purpose: string };
  } catch {
    return null;
  }
}

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user: { id: number; email?: string; phone?: string; name: string; avatar?: string } | null;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const authHeader = opts.req.headers.get("authorization");
  let user: TrpcContext["user"] = null;

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = await verifyToken(token);
    if (payload) {
      const db = getDb();
      const found = await db
        .select({
          id: users.id,
          email: users.email,
          phone: users.phone,
          name: users.name,
          avatar: users.avatar,
        })
        .from(users)
        .where(eq(users.id, payload.userId))
        .limit(1);
      if (found.length > 0) {
        user = {
          id: found[0].id,
          email: found[0].email ?? undefined,
          phone: found[0].phone ?? undefined,
          name: found[0].name,
          avatar: found[0].avatar ?? undefined,
        };
      }
    }
  }

  return { req: opts.req, resHeaders: opts.resHeaders, user };
}
