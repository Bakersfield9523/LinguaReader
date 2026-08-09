import { z } from "zod";
import crypto from "crypto";
import { createRouter, authRateLimited, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { eq, or } from "drizzle-orm";
import { createToken } from "./context";
import { TRPCError } from "@trpc/server";

// 简单密码哈希（使用 crypto，无需 argon2）
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  const check = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  // 使用恒定时间比较防止时序攻击
  const hashBuffer = Buffer.from(hash, 'hex');
  const checkBuffer = Buffer.from(check, 'hex');
  if (hashBuffer.length !== checkBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, checkBuffer);
}

export const authRouter = createRouter({
  // ── 注册 ──
  register: authRateLimited
    .input(
      z.object({
        name: z.string().min(1).max(50),
        email: z.string().email().optional(),
        phone: z.string().min(5).max(20).optional(),
        password: z.string().min(6).max(100),
      }).refine((data) => data.email || data.phone, {
        message: "请提供邮箱或手机号",
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      // 检查是否已存在
      if (input.email) {
        const existing = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, input.email))
          .limit(1);
        if (existing.length > 0) {
          throw new TRPCError({ code: "CONFLICT", message: "该邮箱已被注册" });
        }
      }
      if (input.phone) {
        const existing = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.phone, input.phone))
          .limit(1);
        if (existing.length > 0) {
          throw new TRPCError({ code: "CONFLICT", message: "该手机号已被注册" });
        }
      }

      const passwordHash = hashPassword(input.password);
      const result = await db.insert(users).values({
        name: input.name,
        email: input.email || null,
        phone: input.phone || null,
        passwordHash,
      });

      const userId = Number(result.lastInsertRowid);
      const token = await createToken({
        userId,
        email: input.email,
        phone: input.phone,
      });

      return {
        token,
        user: { id: userId, name: input.name, email: input.email, phone: input.phone },
      };
    }),

  // ── 登录 ──
  login: authRateLimited
    .input(
      z.object({
        account: z.string().min(1), // 邮箱或手机号
        password: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      const found = await db
        .select()
        .from(users)
        .where(or(eq(users.email, input.account), eq(users.phone, input.account)))
        .limit(1);

      if (found.length === 0) {
        // 统一错误消息，防止用户枚举攻击
        throw new TRPCError({ code: "UNAUTHORIZED", message: "账号或密码错误" });
      }

      const user = found[0];
      const valid = verifyPassword(input.password, user.passwordHash);
      if (!valid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "账号或密码错误" });
      }

      const token = await createToken({
        userId: user.id,
        email: user.email ?? undefined,
        phone: user.phone ?? undefined,
      });

      return {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          avatar: user.avatar,
        },
      };
    }),

  // ── 获取当前用户信息 ──
  me: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const found = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        avatar: users.avatar,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    if (found.length === 0) {
      throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
    }

    return found[0];
  }),

  // ── 更新用户信息 ──
  updateProfile: authedQuery
    .input(
      z.object({
        name: z.string().min(1).max(50).optional(),
        avatar: z.string().optional(), // base64
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .update(users)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.avatar !== undefined ? { avatar: input.avatar } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, ctx.user.id));

      return { success: true };
    }),

  // ── 修改密码 ──
  changePassword: authedQuery
    .input(
      z.object({
        oldPassword: z.string().min(1),
        newPassword: z.string().min(6).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const found = await db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      if (found.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
      }

      const valid = verifyPassword(input.oldPassword, found[0].passwordHash);
      if (!valid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "旧密码错误" });
      }

      const newHash = hashPassword(input.newPassword);
      await db
        .update(users)
        .set({ passwordHash: newHash, updatedAt: new Date().toISOString() })
        .where(eq(users.id, ctx.user.id));

      return { success: true };
    }),
});
