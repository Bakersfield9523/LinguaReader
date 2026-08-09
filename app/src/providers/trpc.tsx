import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";

export const trpc = createTRPCReact<AppRouter>();

// Tauri v2 使用 __TAURI_INTERNALS__，v1 使用 __TAURI__
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__;
const isDev = import.meta.env.DEV;

// 在 Tauri 桌面端使用绝对地址访问本地 Node.js 后端；浏览器开发环境使用相对地址由 Vite 代理
const TRPC_URL = isTauri || !isDev ? 'http://localhost:3000/api/trpc' : '/api/trpc';

const queryClient = new QueryClient();
const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: TRPC_URL,
      transformer: superjson,
      headers() {
        const token = localStorage.getItem("auth_token");
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});

export function TRPCProvider({ children }: { children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
