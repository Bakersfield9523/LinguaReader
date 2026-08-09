// 多 AI API 提供商服务
// Tauri 环境：通过 invoke() 调用 Rust 命令（reqwest 发请求，完全绕过 CORS）
// 浏览器环境：通过后端代理 /api/ai/* 转发
import { SettingsDB } from './db';
import { LANGUAGE_NAMES } from '@/types';
import type { Language } from '@/types';

// ============ 类型定义 ============

export type AIProvider = 'kimi' | 'deepseek' | 'openai' | 'gemini';

export interface AIProviderConfig {
  id: AIProvider;
  name: string;
  logo: string;
  apiBase: string;
  model: string;
  description: string;
  docsUrl: string;
}

export interface AIContextResponse {
  meaning: string;
  contextExplanation: string;
  usage: string;
  synonyms?: string[];
  examples?: string[];
}

export interface AIProviderState {
  provider: AIProvider;
  apiKey: string;
}

export interface ApiKeyTestResult {
  success: boolean;
  error?: string;
}

// ============ 提供商配置 ============

export const AI_PROVIDERS: Record<AIProvider, AIProviderConfig> = {
  kimi: {
    id: 'kimi',
    name: 'Kimi AI',
    logo: '🌙',
    apiBase: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    description: '月之暗面 Kimi AI，国内可用，中文理解优秀',
    docsUrl: 'https://platform.moonshot.cn/'
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    logo: '🐋',
    apiBase: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    description: 'DeepSeek V3，推理能力强，性价比高',
    docsUrl: 'https://platform.deepseek.com/'
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    logo: '🤖',
    apiBase: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo',
    description: 'GPT-3.5 Turbo，需要海外网络环境',
    docsUrl: 'https://platform.openai.com/'
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    logo: '💎',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.0-flash',
    description: 'Google Gemini，速度快，免费额度 generous',
    docsUrl: 'https://aistudio.google.com/app/apikey'
  }
};

// ============ 环境检测 ============

// Tauri v2 注入 __TAURI_INTERNALS__；v1 或 withGlobalTauri 注入 __TAURI__
const isTauri = typeof window !== 'undefined'
  && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__);
const isDev = import.meta.env.DEV;

// 浏览器开发模式用相对路径（同源），生产模式用 localhost:3000
const AI_PROXY_BASE = isDev ? '' : 'http://localhost:3000';

// ============ Tauri invoke 封装 ============

// 直接传参，Tauri v2 自动将 JS camelCase 映射到 Rust snake_case
async function tauriInvoke<T>(cmd: string, args: Record<string, any>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

// ============ 存储管理 ============

const STORAGE_KEY_PROVIDER = 'ai_selected_provider';
const STORAGE_KEY_PREFIX = 'ai_api_key_';

export async function getAllSavedApiKeys(): Promise<Record<AIProvider, string>> {
  const result: Record<string, string> = {};
  for (const provider of Object.keys(AI_PROVIDERS) as AIProvider[]) {
    const key = await SettingsDB.get(STORAGE_KEY_PREFIX + provider) || '';
    result[provider] = key;
  }
  return result as Record<AIProvider, string>;
}

export async function saveApiKey(provider: AIProvider, apiKey: string): Promise<void> {
  await SettingsDB.set(STORAGE_KEY_PREFIX + provider, apiKey);
}

export async function getApiKey(provider: AIProvider): Promise<string | null> {
  return await SettingsDB.get(STORAGE_KEY_PREFIX + provider);
}

export async function getSelectedProvider(): Promise<AIProvider> {
  const saved = await SettingsDB.get(STORAGE_KEY_PROVIDER);
  return (saved as AIProvider) || 'kimi';
}

export async function saveSelectedProvider(provider: AIProvider): Promise<void> {
  await SettingsDB.set(STORAGE_KEY_PROVIDER, provider);
}

export async function hasApiKey(provider?: AIProvider): Promise<boolean> {
  const p = provider || await getSelectedProvider();
  const key = await getApiKey(p);
  return !!key && key.length > 0;
}

export async function getAvailableProviders(): Promise<AIProvider[]> {
  const allKeys = await getAllSavedApiKeys();
  return (Object.keys(allKeys) as AIProvider[]).filter(p => allKeys[p]?.length > 0);
}

// ============ 统一的 fetch 封装（浏览器后端代理用） ============

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ============ 核心 AI 调用 ============

// 统一的 AI 补全调用
async function callAICompletion(
  provider: AIProvider,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number = 0.3,
  maxTokens: number = 800
): Promise<string> {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  if (isTauri) {
    // Tauri 环境：通过 Rust 命令发请求（绕过 CORS）
    const result = await tauriInvoke<{ content: string | null; error: string | null }>('ai_chat', {
      provider,
      apiKey,
      messages,
      temperature,
      maxTokens,
    });
    if (result.error) {
      throw new Error(result.error);
    }
    return result.content || '';
  } else {
    // 浏览器环境：通过后端代理
    const response = await fetchWithTimeout(`${AI_PROXY_BASE}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        apiKey,
        messages,
        temperature,
        maxTokens,
      })
    }, 60000);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `API 请求失败: ${response.status}`);
    }

    const data = await response.json();
    return data.content || '';
  }
}

// 解析 AI 响应
function parseAIResponse(content: string): AIContextResponse {
  try {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                      content.match(/```\s*([\s\S]*?)\s*```/) ||
                      [null, content];
    const jsonStr = jsonMatch[1] || content;
    const parsed = JSON.parse(jsonStr.trim());

    return {
      meaning: parsed.meaning || parsed.释义 || '',
      contextExplanation: parsed.contextExplanation || parsed.context || parsed.上下文解释 || '',
      usage: parsed.usage || parsed.用法 || '',
      synonyms: parsed.synonyms || parsed.同义词 || [],
      examples: parsed.examples || parsed.例句 || []
    };
  } catch {
    return {
      meaning: content,
      contextExplanation: '',
      usage: '',
      synonyms: [],
      examples: []
    };
  }
}

// 使用 AI 分析单词上下文
export async function analyzeWordWithAI(
  word: string,
  context: string,
  language: Language
): Promise<AIContextResponse | null> {
  const provider = await getSelectedProvider();
  const apiKey = await getApiKey(provider);

  if (!apiKey) {
    throw new Error(`${AI_PROVIDERS[provider].name} API Key 未配置`);
  }

  const langInfo = LANGUAGE_NAMES[language];
  const langName = langInfo.zh;
  const targetLang = langInfo.label;

  const isPhrase = word.includes(' ') || word.includes('\'') || word.includes('-');

  const systemPrompt = `你是一个专业的${langName}语言学习助手。请根据提供的上下文，详细解释${isPhrase ? '短语/词组' : '单词'}的含义和用法。
请以 JSON 格式返回以下结构：
{
  "meaning": "${isPhrase ? '短语' : '单词'}的中文释义（简洁）",
  "contextExplanation": "结合上下文的具体解释",
  "usage": "${isPhrase ? '短语' : '单词'}的用法说明",
  "synonyms": ["同义表达1", "同义表达2"],
  "examples": ["例句1", "例句2"]
}`;

  const userPrompt = `${isPhrase ? '短语' : '单词'}: "${word}"
上下文: "${context}"
语言: ${targetLang}

请分析这个${isPhrase ? '短语在给定上下文' : '单词在给定上下文'}中的含义和用法。`;

  try {
    const content = await callAICompletion(
      provider, apiKey, systemPrompt, userPrompt, 0.3, 800
    );

    if (!content) {
      throw new Error('API 返回内容为空');
    }

    return parseAIResponse(content);
  } catch (error: any) {
    console.error('AI API error:', error);
    throw error;
  }
}

// 使用 AI 翻译
export async function translateWithAI(
  text: string,
  sourceLang: Language
): Promise<string> {
  const provider = await getSelectedProvider();
  const apiKey = await getApiKey(provider);

  if (!apiKey) {
    throw new Error(`${AI_PROVIDERS[provider].name} API Key 未配置`);
  }

  const langName = LANGUAGE_NAMES[sourceLang].zh;

  const content = await callAICompletion(
    provider, apiKey,
    `你是一个${langName}到中文的翻译助手。请直接提供翻译结果，不要添加额外解释。`,
    `请将以下内容翻译成中文：\n\n${text}`,
    0.3, 500
  );

  return content.trim();
}

// 通用 AI 对话函数（用于追问）
export async function chatWithAI(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const provider = await getSelectedProvider();
  const apiKey = await getApiKey(provider);

  if (!apiKey) {
    throw new Error(`${AI_PROVIDERS[provider].name} API Key 未配置`);
  }

  const content = await callAICompletion(
    provider, apiKey, systemPrompt, userMessage, 0.5, 1000
  );

  return content.trim();
}

// 测试 API Key 是否有效
export async function testApiKey(provider: AIProvider, apiKey: string): Promise<ApiKeyTestResult> {
  console.log(`[AI] testApiKey: provider=${provider}, isTauri=${isTauri}, isDev=${isDev}`);

  if (isTauri) {
    // Tauri 环境：通过 Rust 命令测试 Key（绕过 CORS）
    try {
      const result = await tauriInvoke<{ success: boolean; error: string | null }>('ai_test_key', {
        provider,
        apiKey,
      });
      console.log('[AI] testApiKey result:', result);
      return {
        success: result.success,
        error: result.error || undefined,
      };
    } catch (error: any) {
      console.error('[AI] testApiKey invoke error:', error);
      return { success: false, error: error?.message || 'Tauri 命令调用失败' };
    }
  } else {
    // 浏览器环境：通过后端代理
    const url = `${AI_PROXY_BASE}/api/ai/test`;
    console.log(`[AI] testApiKey (proxy): ${url}`);
    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey }),
      }, 20000);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { success: false, error: errorData.error || `后端请求失败: ${response.status}` };
      }

      return await response.json();
    } catch (error: any) {
      const msg = error?.name === 'AbortError'
        ? '请求超时（后端服务可能未启动）'
        : (error?.message || '网络请求失败');
      return { success: false, error: msg };
    }
  }
}
