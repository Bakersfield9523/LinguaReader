// AI API 后端代理 —— 绕过浏览器 CORS 限制
// 前端所有 AI 请求经此路由转发到各 AI 提供商
import { Hono } from "hono";

// ============ 提供商配置（与前端 aiService.ts 同步） ============

interface ProviderConfig {
  apiBase: string;
  model: string;
}

const AI_PROVIDERS: Record<string, ProviderConfig> = {
  kimi: {
    apiBase: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
  },
  deepseek: {
    apiBase: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  openai: {
    apiBase: "https://api.openai.com/v1",
    model: "gpt-3.5-turbo",
  },
  gemini: {
    apiBase: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.0-flash",
  },
};

// ============ 路由 ============

const aiProxy = new Hono();

// POST /api/ai/test — 测试 API Key 是否有效
// Body: { provider, apiKey }
// Response: { success: boolean, error?: string }
aiProxy.post("/test", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { provider, apiKey } = body as { provider: string; apiKey: string };

  const config = provider ? AI_PROVIDERS[provider] : undefined;
  if (!config) {
    return c.json({ success: false, error: "未知的 AI 提供商" }, 400);
  }
  if (!apiKey || apiKey.length === 0) {
    return c.json({ success: false, error: "API Key 不能为空" }, 400);
  }

  try {
    // 发送一个最小请求来验证 Key
    const response = await fetch(`${config.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      return c.json({ success: true });
    }

    // 解析错误信息
    let errorMsg = `HTTP ${response.status}`;
    try {
      const errorData = await response.json() as { error?: { message?: string } };
      errorMsg = errorData?.error?.message || errorMsg;
    } catch {
      // JSON 解析失败，使用默认错误信息
    }

    // 401/403 = Key 无效，其他错误也返回具体信息
    return c.json({ success: false, error: errorMsg });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "网络请求失败";
    return c.json({ success: false, error: msg });
  }
});

// POST /api/ai/chat — 代理 AI Chat Completion
// Body: { provider, apiKey, messages, temperature?, maxTokens? }
// Response: { content: string } 或 { error: string }
aiProxy.post("/chat", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const {
    provider,
    apiKey,
    messages,
    temperature = 0.3,
    maxTokens = 800,
  } = body as {
    provider: string;
    apiKey: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    maxTokens?: number;
  };

  const config = provider ? AI_PROVIDERS[provider] : undefined;
  if (!config) {
    return c.json({ error: "未知的 AI 提供商" }, 400);
  }
  if (!apiKey) {
    return c.json({ error: "API Key 未配置" }, 400);
  }

  try {
    const response = await fetch(`${config.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      let errorMsg = `API 请求失败: ${response.status}`;
      try {
        const errorData = await response.json() as { error?: { message?: string } };
        errorMsg = errorData?.error?.message || errorMsg;
      } catch {
        // JSON 解析失败
      }
      return c.json({ error: errorMsg }, response.status as 400);
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data?.choices?.[0]?.message?.content || "";
    return c.json({ content });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "网络请求失败";
    return c.json({ error: msg }, 500);
  }
});

export default aiProxy;
