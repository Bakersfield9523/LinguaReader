// 后端动态端口：Rust 启动 Node 后端时探测空闲端口并写入，前端通过 invoke('get_backend_port') 读取。
// 避免 3000 被其他常驻软件占用导致 "Failed to fetch"。

let backendPort = 3000;

export function getBackendPort(): number {
  return backendPort;
}

export function setBackendPort(p: number): void {
  if (p && p > 0) backendPort = p;
}

function isTauriEnv(): boolean {
  return (
    typeof window !== 'undefined' &&
    (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__)
  );
}

/// 在应用启动（渲染前）调用：从 Rust 侧读取后端实际端口
export async function initBackendPort(): Promise<void> {
  try {
    if (!isTauriEnv()) return; // 浏览器开发环境用相对路径，无需端口
    const { invoke } = await import('@tauri-apps/api/core');
    const p = await invoke<number>('get_backend_port');
    if (typeof p === 'number' && p > 0) {
      backendPort = p;
      console.log(`[backend] using dynamic port ${backendPort}`);
    }
  } catch (e) {
    console.warn('[backend] failed to get port, fallback 3000', e);
  }
}
