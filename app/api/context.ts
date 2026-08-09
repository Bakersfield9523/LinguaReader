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
    .setExpirationTime("30d")
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
