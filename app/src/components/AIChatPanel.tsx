import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Sparkles, User, Loader2, RotateCcw, Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { chatWithAI } from '@/lib/aiService';
import { LANGUAGE_NAMES } from '@/types';
import type { Language } from '@/types';
import type { AIContextResponse } from '@/lib/aiService';

interface AIChatPanelProps {
  word: string | null;
  context: string;
  language: Language;
  hasApiKey: boolean;
  onOpenSettings: () => void;
  aiData: AIContextResponse | null;
  aiLoading: boolean;
  aiError: string | null;
  theme?: 'light' | 'dark' | 'sepia';
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

const AI_LANG_STORAGE_KEY = 'ai_reply_language';

function loadSavedAiLang(): 'zh' | 'en' {
  try {
    const saved = localStorage.getItem(AI_LANG_STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch { /* ignore */ }
  return 'zh';
}

function saveAiLang(lang: 'zh' | 'en') {
  try {
    localStorage.setItem(AI_LANG_STORAGE_KEY, lang);
  } catch { /* ignore */ }
}

export function AIChatPanel({
  word,
  context,
  language,
  hasApiKey,
  onOpenSettings,
  aiData,
  aiLoading,
  aiError,
  theme = 'dark',
}: AIChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [isReAnalyzing, setIsReAnalyzing] = useState(false);
  const [aiLang, setAiLang] = useState<'zh' | 'en'>(loadSavedAiLang);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastWordRef = useRef<string | null>(null);

  // 根据主题确定文字和边框颜色
  const isLight = theme === 'light';
  const tc = {
    main: isLight ? 'text-gray-800' : 'text-white/90',
    muted: isLight ? 'text-gray-500' : 'text-white/60',
    faint: isLight ? 'text-gray-400' : 'text-white/40',
    dark: isLight ? 'text-gray-700' : 'text-white/80',
    inputBg: isLight ? 'bg-gray-100' : 'bg-[#1e2125]',
    inputBorder: isLight ? 'border-gray-300' : 'border-white/10',
    placeholder: isLight ? 'placeholder:text-gray-400' : 'placeholder:text-white/30',
    inputText: isLight ? 'text-gray-800' : 'text-white',
    assistantBg: isLight ? 'bg-gray-200/70' : 'bg-white/5',
    userBg: isLight ? 'bg-amber-100/70' : 'bg-[#e5a349]/15',
    border: isLight ? 'border-gray-200' : 'border-white/10',
    hoverBg: isLight ? 'hover:bg-black/5' : 'hover:bg-white/10',
    icon: isLight ? 'text-gray-500' : 'text-white/60',
    iconHover: isLight ? 'hover:text-gray-800' : 'hover:text-white',
  };

  // 格式化AI回复
  const formatAIResponse = useCallback((data: AIContextResponse, lang: 'zh' | 'en'): string => {
    if (lang === 'en') {
      const parts: string[] = [];
      if (data.meaning) parts.push(`**Meaning:** ${data.meaning}`);
      if (data.contextExplanation) parts.push(`**Context:** ${data.contextExplanation}`);
      if (data.usage) parts.push(`**Usage:** ${data.usage}`);
      if (data.synonyms && data.synonyms.length > 0) parts.push(`**Synonyms:** ${data.synonyms.join(', ')}`);
      if (data.examples && data.examples.length > 0) parts.push(`**Examples:**\n${data.examples.map(e => `- "${e}"`).join('\n')}`);
      return parts.join('\n\n');
    } else {
      const parts: string[] = [];
      if (data.meaning) parts.push(`**释义：**${data.meaning}`);
      if (data.contextExplanation) parts.push(`**上下文理解：**${data.contextExplanation}`);
      if (data.usage) parts.push(`**用法说明：**${data.usage}`);
      if (data.synonyms && data.synonyms.length > 0) parts.push(`**同义词：**${data.synonyms.join('、')}`);
      if (data.examples && data.examples.length > 0) parts.push(`**例句：**\n${data.examples.map(e => `- "${e}"`).join('\n')}`);
      return parts.join('\n\n');
    }
  }, []);

  // 用AI生成完整回复（真正的重新解析）
  const generateAIResponse = useCallback(async (targetLang: 'zh' | 'en') => {
    if (!word || !hasApiKey) return;
    setIsReAnalyzing(true);
    try {
      const isPhrase = word.includes(' ') || word.includes('\'') || word.includes('-');
      const langName = LANGUAGE_NAMES[language].en;
      const itemLabel = isPhrase ? 'phrase/expression' : 'word';
      const itemLabelZh = isPhrase ? '短语/词组' : '单词';
      const systemPrompt = targetLang === 'zh'
        ? `You are a professional language learning assistant. Please analyze the following ${langName} ${itemLabel} IN CHINESE. Provide a comprehensive analysis.`
        : `You are a professional language tutor. Please analyze the following ${langName} ${itemLabel} IN ENGLISH. Provide a comprehensive analysis.`;

      const userPrompt = targetLang === 'zh'
        ? `请详细分析这个${langName}${itemLabelZh}："${word}"\n上下文："${context}"\n\n请提供以下内容（用中文）：\n1. 中文释义\n2. 上下文理解\n3. 用法说明\n4. 同义词\n5. 例句`
        : `Please analyze the ${langName} ${itemLabel}: "${word}"\nContext: "${context}"\n\nPlease provide:\n1. Meaning in English\n2. Context explanation\n3. Usage notes\n4. Synonyms\n5. Example sentences`;

      const answer = await chatWithAI(systemPrompt, userPrompt);

      const assistantMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: answer,
        timestamp: Date.now(),
      };
      setMessages([assistantMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: targetLang === 'zh'
          ? `抱歉，出错了：${err.message || '请检查API配置'}`
          : `Sorry, error: ${err.message || 'Please check API settings'}`,
        timestamp: Date.now(),
      };
      setMessages([errorMsg]);
    } finally {
      setIsReAnalyzing(false);
    }
  }, [word, hasApiKey, language, context]);

  // 当 aiData 或 word 变化时，格式化显示（首次加载）
  useEffect(() => {
    if (aiData && word && word !== lastWordRef.current) {
      lastWordRef.current = word;
      const content = formatAIResponse(aiData, aiLang);
      const assistantMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content,
        timestamp: Date.now(),
      };
      setMessages([assistantMsg]);
    }
  }, [aiData, word, aiLang, formatAIResponse]);

  // 清空对话当单词改变时
  useEffect(() => {
    if (!word) {
      setMessages([]);
      setInputValue('');
      lastWordRef.current = null;
    }
  }, [word]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAsking, isReAnalyzing]);

  // 发送追问
  const handleSendQuestion = useCallback(async () => {
    if (!inputValue.trim() || !word || !hasApiKey) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: inputValue.trim(),
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setIsAsking(true);

    try {
      const langNameCn = LANGUAGE_NAMES[language].zh;
      const langNameEn = LANGUAGE_NAMES[language].en;
      const systemPrompt = aiLang === 'zh'
        ? `你是专业的语言学习助手。用户正在学习${langNameCn}单词"${word}"。上下文："${context}"。请用中文回答用户的问题。`
        : `You are a professional language tutor. The user is learning the ${langNameEn} word "${word}". Context: "${context}". Please answer in English.`;

      const answer = await chatWithAI(systemPrompt, userMsg.content);

      const assistantMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: answer,
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: aiLang === 'zh' ? `抱歉，出错了：${err.message || '请检查API配置'}` : `Sorry, error: ${err.message || 'Please check API settings'}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsAsking(false);
    }
  }, [inputValue, word, hasApiKey, language, context, aiLang]);

  // 切换双语并重新请求AI生成完整回复
  const toggleLang = useCallback(() => {
    const newLang = aiLang === 'zh' ? 'en' : 'zh';
    setAiLang(newLang);
    saveAiLang(newLang);
    // 切换后重新请求AI生成完整回复
    if (word && hasApiKey) {
      generateAIResponse(newLang);
    }
  }, [aiLang, word, hasApiKey, generateAIResponse]);

  if (!hasApiKey) {
    return (
      <div className="bg-purple-500/10 rounded-xl p-4 text-center">
        <Sparkles className="w-10 h-10 text-purple-400 mx-auto mb-3" />
        <p className="text-sm opacity-80 mb-3">
          配置 AI API Key 以启用上下文解析功能
        </p>
        <Button
          onClick={onOpenSettings}
          variant="ghost"
          className="bg-purple-500/15 border border-purple-400/40 text-purple-300 hover:bg-purple-500/25 hover:text-purple-200"
          size="sm"
        >
          <Sparkles className="w-4 h-4 mr-2" />
          配置 API Key
        </Button>
      </div>
    );
  }

  if (aiLoading || isReAnalyzing) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
        <span className="ml-2 text-sm opacity-60">
          {isReAnalyzing ? (aiLang === 'zh' ? '重新生成中...' : 'Regenerating...') : 'AI 分析中...'}
        </span>
      </div>
    );
  }

  if (aiError) {
    return (
      <div className="bg-red-500/10 rounded-xl p-4">
        <p className="text-sm text-red-400">{aiError}</p>
        <Button
          onClick={onOpenSettings}
          variant="ghost"
          className="mt-3 bg-red-500/15 border border-red-400/40 text-red-300 hover:bg-red-500/25 hover:text-red-200"
          size="sm"
        >
          检查 API Key
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 头部：标题 + 双语切换 + 重新解析 */}
      <div className={`flex items-center justify-between ${tc.main}`}>
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-400" />
          AI 解析
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleLang}
            className={`p-1.5 rounded-lg transition-colors ${tc.icon} ${tc.iconHover} ${tc.hoverBg}`}
            title={aiLang === 'zh' ? 'Switch to English' : '切换到中文'}
          >
            <Languages className="w-4 h-4" />
          </button>
          <span className={`text-xs mr-1 ${tc.faint}`}>{aiLang === 'zh' ? '中文' : 'EN'}</span>
          {word && (
            <button
              onClick={() => generateAIResponse(aiLang)}
              disabled={isAsking || isReAnalyzing}
              className={`p-1.5 rounded-lg transition-colors ${tc.icon} ${tc.iconHover} ${tc.hoverBg} disabled:opacity-30`}
              title="重新解析"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 对话区域 */}
      <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <p className={`text-sm py-4 text-center ${tc.muted}`}>
            {aiLang === 'zh' ? '点击单词后 AI 将自动分析上下文含义' : 'Click a word for AI analysis'}
          </p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              {/* 头像 */}
              <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center ${
                msg.role === 'assistant'
                  ? 'bg-purple-500/20'
                  : 'bg-[#e5a349]/20'
              }`}>
                {msg.role === 'assistant' ? (
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                ) : (
                  <User className="w-3.5 h-3.5 text-[#e5a349]" />
                )}
              </div>

              {/* 消息气泡 */}
              <div className={`rounded-xl px-3 py-2 text-sm max-w-[85%] ${
                msg.role === 'assistant'
                  ? `${tc.assistantBg} ${tc.main}`
                  : `${tc.userBg} ${tc.main}`
              }`}>
                <div className="whitespace-pre-wrap leading-relaxed">
                  {msg.content}
                </div>
              </div>
            </div>
          ))
        )}

        {isAsking && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-full bg-purple-500/20 flex-shrink-0 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
            </div>
            <div className={`${tc.assistantBg} rounded-xl px-3 py-2`}>
              <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      {word && (
        <div className={`flex gap-2 pt-2 border-t ${tc.border}`}>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendQuestion();
              }
            }}
            placeholder={aiLang === 'zh' ? '追问 AI...' : 'Ask follow-up...'}
            className={`flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-400/50 ${tc.inputBg} ${tc.inputBorder} ${tc.inputText} ${tc.placeholder} border`}
          />
          <Button
            onClick={handleSendQuestion}
            disabled={!inputValue.trim() || isAsking}
            size="sm"
            className="bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 disabled:opacity-30"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
