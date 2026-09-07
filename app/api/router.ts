import { createRouter, publicQuery } from "./middleware";
import { authRouter } from "./auth-router";
import { syncRouter } from "./sync-router";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),

  auth: authRouter,
  sync: syncRouter,
});

export type AppRouter = typeof appRouter;
