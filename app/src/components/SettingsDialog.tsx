import { useState, useEffect, useCallback } from 'react';
import { X, Check, Loader2, Sparkles, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AI_PROVIDERS,
  getAllSavedApiKeys,
  saveApiKey,
  getSelectedProvider,
  saveSelectedProvider,
  testApiKey,
  hasApiKey
} from '@/lib/aiService';
import type { AIProvider } from '@/lib/aiService';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>('kimi');
  const [apiKeys, setApiKeys] = useState<Record<AIProvider, string>>({
    kimi: '', deepseek: '', openai: '', gemini: ''
  });
  const [showKeys, setShowKeys] = useState<Record<AIProvider, boolean>>({
    kimi: false, deepseek: false, openai: false, gemini: false
  });
  const [isLoading, setIsLoading] = useState(true);
  const [testingProvider, setTestingProvider] = useState<AIProvider | null>(null);
  const [testResults, setTestResults] = useState<Record<AIProvider, { status: 'success' | 'error'; error?: string } | null>>({
    kimi: null, deepseek: null, openai: null, gemini: null
  });
  const [hasAnyKey, setHasAnyKey] = useState(false);

  // 加载已保存的配置
  useEffect(() => {
    if (open) {
      loadSettings();
    }
  }, [open]);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const [savedKeys, savedProvider] = await Promise.all([
        getAllSavedApiKeys(),
        getSelectedProvider()
      ]);
      setApiKeys(savedKeys);
      setSelectedProvider(savedProvider);
      const hasKey = await hasApiKey();
      setHasAnyKey(hasKey);
      setTestResults({ kimi: null, deepseek: null, openai: null, gemini: null });
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveKey = useCallback(async (provider: AIProvider) => {
    const key = apiKeys[provider].trim();
    
    if (!key) {
      // 清空 Key
      await saveApiKey(provider, '');
      setApiKeys(prev => ({ ...prev, [provider]: '' }));
      const hasKey = await hasApiKey();
      setHasAnyKey(hasKey);
      return;
    }

    setTestingProvider(provider);
    setTestResults(prev => ({ ...prev, [provider]: null }));

    try {
      const result = await testApiKey(provider, key);
      
      if (result.success) {
        await saveApiKey(provider, key);
        setTestResults(prev => ({ ...prev, [provider]: { status: 'success' } }));
        // 如果当前选中的是这个 provider，重新检查
        if (selectedProvider === provider) {
          setHasAnyKey(true);
        }
      } else {
        setTestResults(prev => ({ ...prev, [provider]: { status: 'error', error: result.error } }));
      }
    } catch (error: any) {
      setTestResults(prev => ({ ...prev, [provider]: { status: 'error', error: error.message } }));
    } finally {
      setTestingProvider(null);
    }
  }, [apiKeys, selectedProvider]);

  const handleSelectProvider = useCallback(async (provider: AIProvider) => {
    setSelectedProvider(provider);
    await saveSelectedProvider(provider);
    const hasKey = await hasApiKey(provider);
    setHasAnyKey(hasKey);
  }, []);

  const toggleShowKey = (provider: AIProvider) => {
    setShowKeys(prev => ({ ...prev, [provider]: !prev[provider] }));
  };

  const currentProvider = AI_PROVIDERS[selectedProvider];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#282b2f] border-white/10 text-white max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#e5a349]" />
            AI 设置
          </DialogTitle>
          <DialogDescription className="text-white/60">
            配置 AI API Key 以启用上下文解析功能
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-[#e5a349]" />
          </div>
        ) : (
          <div className="space-y-6 mt-4">
            {/* 当前状态 */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
              <div className={`w-3 h-3 rounded-full ${hasAnyKey ? 'bg-green-500' : 'bg-yellow-500'}`} />
              <span className="text-sm">
                {hasAnyKey ? `已配置: ${AI_PROVIDERS[selectedProvider].name}` : '尚未配置 API Key'}
              </span>
            </div>

            {/* 选择默认提供商 */}
            <div>
              <Label className="text-white/80 mb-2 block">默认 AI 提供商</Label>
              <Select value={selectedProvider} onValueChange={(v) => handleSelectProvider(v as AIProvider)}>
                <SelectTrigger className="bg-[#1e2125] border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#282b2f] border-white/10">
                  {(Object.values(AI_PROVIDERS) as typeof currentProvider[]).map(provider => (
                    <SelectItem key={provider.id} value={provider.id} className="text-white">
                      <div className="flex items-center gap-2">
                        <span>{provider.logo}</span>
                        <span>{provider.name}</span>
                        {apiKeys[provider.id] && <Check className="w-3 h-3 text-green-400 ml-1" />}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-white/40 mt-1">{currentProvider.description}</p>
            </div>

            {/* 各提供商 API Key 配置 */}
            <div className="space-y-4">
              <Label className="text-white/80 block">API Key 配置</Label>
              
              {(Object.values(AI_PROVIDERS) as typeof currentProvider[]).map(provider => (
                <div 
                  key={provider.id} 
                  className={`p-4 rounded-xl border transition-all ${
                    selectedProvider === provider.id 
                      ? 'border-[#e5a349]/50 bg-[#e5a349]/5' 
                      : 'border-white/10 bg-white/3'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{provider.logo}</span>
                      <span className="font-medium text-white">{provider.name}</span>
                      {selectedProvider === provider.id && (
                        <span className="px-2 py-0.5 rounded-full bg-[#e5a349]/20 text-[#e5a349] text-xs">
                          默认
                        </span>
                      )}
                    </div>
                    <a 
                      href={provider.docsUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-xs text-[#e5a349] hover:underline flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      获取 Key
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <div className="relative mt-2">
                    <Input
                      type={showKeys[provider.id] ? 'text' : 'password'}
                      value={apiKeys[provider.id]}
                      onChange={(e) => {
                        setApiKeys(prev => ({ ...prev, [provider.id]: e.target.value }));
                        setTestResults(prev => ({ ...prev, [provider.id]: null }));
                      }}
                      placeholder={`输入 ${provider.name} API Key`}
                      className="bg-[#1e2125] border-white/10 text-white placeholder:text-white/30 pr-20"
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => toggleShowKey(provider.id)}
                        className="text-xs text-white/40 hover:text-white/70 px-1"
                      >
                        {showKeys[provider.id] ? '隐藏' : '显示'}
                      </button>
                    </div>
                  </div>

                  {/* 测试结果 */}
                  {testResults[provider.id] && (
                    <div className={`mt-2 p-2 rounded-lg flex items-start gap-2 text-sm ${
                      testResults[provider.id]!.status === 'success' 
                        ? 'bg-green-500/20 text-green-400' 
                        : 'bg-red-500/20 text-red-400'
                    }`}>
                      {testResults[provider.id]!.status === 'success' ? (
                        <>
                          <Check className="w-4 h-4 mt-0.5 shrink-0" />
                          API Key 有效，已保存
                        </>
                      ) : (
                        <>
                          <X className="w-4 h-4 mt-0.5 shrink-0" />
                          <span className="break-all">
                            {testResults[provider.id]!.error || 'API Key 验证失败'}
                          </span>
                        </>
                      )}
                    </div>
                  )}

                  {/* 操作按钮 */}
                  <div className="flex gap-2 mt-2">
                    {apiKeys[provider.id] && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setApiKeys(prev => ({ ...prev, [provider.id]: '' }));
                          saveApiKey(provider.id, '');
                        }}
                        className="flex-1 bg-[#1e2125] text-white/75 border border-white/15 hover:bg-[#282b2f] hover:text-white text-xs"
                      >
                        清除
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => handleSaveKey(provider.id)}
                      disabled={testingProvider === provider.id || !apiKeys[provider.id].trim()}
                      className="flex-1 bg-[#e5a349] hover:bg-[#d49340] text-white disabled:opacity-50 text-xs"
                    >
                      {testingProvider === provider.id ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          验证中...
                        </>
                      ) : (
                        <>
                          <Check className="w-3 h-3 mr-1" />
                          {apiKeys[provider.id] ? '验证并保存' : '保存'}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* 使用说明 */}
            <div className="text-xs text-white/40 space-y-1 border-t border-white/10 pt-4">
              <p>• API Key 存储在本地，通过本地后端代理转发请求（不走浏览器直连）</p>
              <p>• 点击「获取 Key」可前往各平台官网申请 API Key</p>
              <p>• 所有提供商均使用 OpenAI 兼容接口格式</p>
              <p>• 新用户注册各平台通常可获得免费额度</p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
