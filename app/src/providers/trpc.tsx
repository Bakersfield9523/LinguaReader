import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";
import { useState } from "react";
import { getBackendPort } from "@/lib/backend";

export const trpc = createTRPCReact<AppRouter>();

// Tauri v2 使用 __TAURI_INTERNALS__，v1 使用 __TAURI__
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__;
const isDev = import.meta.env.DEV;

// Tauri 桌面端用绝对地址访问本地 Node 后端，端口由 Rust 动态分配（避免 3000 被占用）。
// 浏览器开发环境用相对地址由 Vite 代理。
// 注意：url 在组件首次渲染时才计算，确保 initBackendPort() 已先执行。
function getTrpcUrl(): string {
  return isTauri || !isDev ? `http://localhost:${getBackendPort()}/api/trpc` : '/api/trpc';
}

export function TRPCProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: getTrpcUrl(),
          transformer: superjson,
          headers() {
            const token = localStorage.getItem("auth_token");
            return token ? { Authorization: `Bearer ${token}` } : {};
          },
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
