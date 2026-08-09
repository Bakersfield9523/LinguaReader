import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowLeft, BookOpen, Settings, Type, Moon, Sun, Highlighter, X,
  ChevronLeft, ChevronRight, List, Loader2, Sparkles, Volume2,
  ChevronDown, ChevronUp, Bookmark as BookmarkIcon, BookmarkPlus as BookmarkPlusIcon, Trash2,
  PenLine, Underline
} from 'lucide-react';
import { AIChatPanel } from './AIChatPanel';
import { PDFCanvasViewer } from './PDFCanvasViewer';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { lookupWord, getQuickTranslation } from '@/lib/dictionary';
import { EPUBParser, PDFParser, getBookContent } from '@/lib/fileParser';
import { BookDB, HighlightDB } from '@/lib/db';
import { analyzeWordWithAI, hasApiKey as checkHasApiKey, type AIContextResponse } from '@/lib/aiService';
import { SettingsDialog } from './SettingsDialog';
import type { Book, WordMarker, DictionaryDefinition, ReaderSettings, Chapter, Bookmark, Highlight } from '@/types';

// ============ 可滚动标题组件 ============

function MarqueeTitle({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [scrollStyle, setScrollStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    const checkOverflow = () => {
      const container = containerRef.current;
      const text = textRef.current;
      if (!container || !text) return;

      const containerWidth = container.clientWidth;
      const textWidth = text.scrollWidth;

      if (textWidth > containerWidth) {
        setOverflows(true);
        const distance = containerWidth - textWidth;
        const duration = Math.max(2.5, Math.abs(distance) / 50);
        setScrollStyle({
          '--scroll-distance': `${distance}px`,
          '--scroll-duration': `${duration}s`,
        } as React.CSSProperties);
      } else {
        setOverflows(false);
        setScrollStyle({});
      }
    };

    checkOverflow();
    window.addEventListener('resize', checkOverflow);
    return () => window.removeEventListener('resize', checkOverflow);
  }, [children]);

  return (
    <span ref={containerRef} className={`block overflow-hidden ${className || ''}`} style={style}>
      <span
        ref={textRef}
        className={`block truncate ${overflows ? 'group-hover:whitespace-nowrap group-hover:animate-marquee' : ''}`}
        style={scrollStyle}
      >
        {children}
      </span>
    </span>
  );
}

// ============ 单词发音按钮 ============

interface PronunciationButtonsProps {
  word: string;
  language: string;
  ukPhonetic?: string;
  usPhonetic?: string;
}

function PronunciationButtons({ word, language, ukPhonetic, usPhonetic }: PronunciationButtonsProps) {
  const [playing, setPlaying] = useState<'uk' | 'us' | null>(null);
  const [supported, setSupported] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) {
      setSupported(false);
      return;
    }

    // 尝试预加载 voices，部分浏览器/WebView 需要触发 onvoiceschanged 才能返回完整列表
    if (typeof synth.onvoiceschanged !== 'undefined') {
      synth.onvoiceschanged = () => {
        synth.getVoices();
      };
    }
    return () => {
      synth.onvoiceschanged = null;
      // 组件卸载时停止音频播放
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      synth.cancel();
    };
  }, []);

  // 切换单词时停止上一个音频
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      window.speechSynthesis?.cancel();
      setPlaying(null);
    };
  }, [word]);

  const speakWithTTS = useCallback((accent: 'uk' | 'us') => {
    const synth = window.speechSynthesis;
    if (!synth) return;

    // 每次播放时重新获取 voices，避免组件 mount 时 voices 尚未加载
    const all = synth.getVoices() || [];
    const targetLang = accent === 'uk' ? 'en-GB' : 'en-US';
    const voice =
      all.find(v => v.lang.toLowerCase().startsWith(targetLang.toLowerCase())) ||
      all.find(v => v.lang.toLowerCase().startsWith('en')) ||
      all[0];

    const utterance = new SpeechSynthesisUtterance(word);
    if (voice) utterance.voice = voice;
    utterance.lang = targetLang;
    utterance.rate = 0.85;

    utterance.onstart = () => setPlaying(accent);
    utterance.onend = () => setPlaying(null);
    utterance.onerror = () => setPlaying(null);

    synth.speak(utterance);
  }, [word]);

  const play = useCallback((accent: 'uk' | 'us') => {
    if (!word) return;

    // 停止上一个播放
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    window.speechSynthesis?.cancel();

    // 有道词典发音：type=0 英音 / type=1 美音，无需 API Key，稳定可用。
    // 返回 MP3 音频流，覆盖绝大多数英文单词；加载失败时回退到 Web Speech TTS。
    const youdaoUrl = `https://dict.youdao.com/dictvoice?type=${accent === 'uk' ? 0 : 1}&audio=${encodeURIComponent(word)}`;
    setPlaying(accent); // 立即反馈
    const el = new Audio(youdaoUrl);
    audioRef.current = el;
    el.onended = () => { setPlaying(null); audioRef.current = null; };
    el.onerror = () => {
      setPlaying(null);
      audioRef.current = null;
      // 有道音频加载失败时回退到 TTS
      speakWithTTS(accent);
    };
    el.play().catch(() => {
      setPlaying(null);
      audioRef.current = null;
      speakWithTTS(accent);
    });
  }, [word, speakWithTTS]);

  if (language !== 'en') {
    return null;
  }

  return (
    <div className="flex items-center gap-3">
      {/* 英式发音 pill */}
      <button
        onClick={() => play('uk')}
        disabled={playing !== null}
        className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm
                   bg-white hover:bg-gray-50 border border-gray-200
                   shadow-[0_1px_3px_rgba(0,0,0,0.08)]
                   transition-all duration-150 disabled:opacity-40"
        title="英式发音"
      >
        <span className="text-gray-500 text-xs select-none font-medium">英</span>
        {ukPhonetic ? (
          <span className="text-gray-400 italic text-xs">{`/${ukPhonetic}/`}</span>
        ) : (
          <span className="text-gray-300 text-xs">—</span>
        )}
        <Volume2 className={`w-3.5 h-3.5 flex-shrink-0 ${playing === 'uk' ? 'text-[#e5a349] animate-pulse' : 'text-[#e5a349]/70 group-hover:text-[#e5a349]'}`} />
      </button>

      {/* 美式发音 pill */}
      <button
        onClick={() => play('us')}
        disabled={playing !== null}
        className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm
                   bg-white hover:bg-gray-50 border border-gray-200
                   shadow-[0_1px_3px_rgba(0,0,0,0.08)]
                   transition-all duration-150 disabled:opacity-40"
        title="美式发音"
      >
        <span className="text-gray-500 text-xs select-none font-medium">美</span>
        {usPhonetic ? (
          <span className="text-gray-400 italic text-xs">{`/${usPhonetic}/`}</span>
        ) : (
          <span className="text-gray-300 text-xs">—</span>
        )}
        <Volume2 className={`w-3.5 h-3.5 flex-shrink-0 ${playing === 'us' ? 'text-[#e5a349] animate-pulse' : 'text-[#e5a349]/70 group-hover:text-[#e5a349]'}`} />
      </button>
    </div>
  );
}

// ============ 章节树组件 ============

interface ChapterTreeProps {
  chapters: Chapter[];
  currentChapter: number;
  expandedChapters: Set<string>;
  onToggleExpand: (id: string) => void;
  onSelectChapter: (id: string) => void;
  level?: number;
}

function ChapterTree({
  chapters,
  currentChapter,
  expandedChapters,
  onToggleExpand,
  onSelectChapter,
  level = 0
}: ChapterTreeProps) {
  // 计算当前章节在扁平列表中的位置用于高亮判断（递归支持任意层级嵌套）
  const getFlatIndex = (items: Chapter[], targetId: string): number => {
    let idx = 0;
    const search = (list: Chapter[]): boolean => {
      for (const ch of list) {
        if (ch.id === targetId) return true;
        idx++;
        if (ch.children && search(ch.children)) return true;
      }
      return false;
    };
    return search(items) ? idx : -1;
  };

  return (
    <div className="space-y-0.5">
      {chapters.map((chapter) => {
        const flatIdx = getFlatIndex(chapters, chapter.id);
        const isActive = flatIdx === currentChapter;
        const hasChildren = chapter.children && chapter.children.length > 0;
        const isExpanded = expandedChapters.has(chapter.id);
        const isFront = chapter.isFrontMatter || chapter.type === 'frontmatter';

        return (
          <div key={chapter.id}>
            {/* 行容器：overflow-hidden 防止内容溢出 */}
            <div
              className={`flex items-center rounded-lg transition-colors overflow-hidden ${
                isActive
                  ? 'bg-[#e5a349] text-white'
                  : isFront
                  ? 'text-white/40 hover:bg-white/5'
                  : 'text-white/70 hover:bg-white/5'
              }`}
              style={{ paddingLeft: `${level * 12 + 8}px` }}
            >
              {/* 展开/折叠按钮 - 固定尺寸，不会被压缩 */}
              {hasChildren ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleExpand(chapter.id);
                  }}
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10 flex-shrink-0"
                  type="button"
                >
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
              ) : (
                <span className="w-7 h-7 flex-shrink-0" />
              )}

              {/* 章节标题按钮 - min-w-0 确保可以收缩 */}
              <button
                onClick={() => onSelectChapter(chapter.id)}
                className="group flex-1 min-w-0 text-left py-2 pr-2"
                type="button"
              >
                <MarqueeTitle className="flex-1">
                  <span className={`text-xs opacity-50 mr-1 ${isFront ? 'italic' : ''}`}>
                    {chapter.type === 'volume' ? '\u25A0' : '\u2022'}
                  </span>
                  <span className={`text-sm ${isFront ? 'italic' : ''}`}>
                    {chapter.title}
                  </span>
                </MarqueeTitle>
              </button>
            </div>

            {/* 递归渲染子章节 */}
            {hasChildren && isExpanded && (
              <div className="mt-0.5">
                <ChapterTree
                  chapters={chapter.children!}
                  currentChapter={currentChapter}
                  expandedChapters={expandedChapters}
                  onToggleExpand={onToggleExpand}
                  onSelectChapter={onSelectChapter}
                  level={level + 1}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============ Reader 主组件 ============

interface ReaderProps {
  book: Book;
  wordMarkers: WordMarker[];
  onAddWord: (word: WordMarker) => void;
  onDeleteWord: (id: string) => void;
  onUpdateWord: (id: string, updates: Partial<WordMarker>) => void;
  onBack: () => void;
  onUpdateProgress: (bookId: string, progress: number, currentChapter?: number, scrollPosition?: number) => void;
}

export function Reader({
  book,
  wordMarkers,
  onAddWord,
  onDeleteWord,
  onUpdateWord,
  onBack,
  onUpdateProgress
}: ReaderProps) {
  // 状态
  const [chapters, setChapters] = useState<Chapter[]>(book.chapters || []);
  const [currentChapter, setCurrentChapter] = useState(book.currentChapter || 0);
  const [chapterContent, setChapterContent] = useState<string>('');
  // 当前章节涉及的书籍自带样式表（含内联 <style> 与外部 <link>），作用域化后注入阅读器，
  // 使角标/引用等靠 class 定义的小字号排版得以还原。
  const [bookCss, setBookCss] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [parser, setParser] = useState<EPUBParser | PDFParser | null>(null);
  const [contents, setContents] = useState<Map<string, string>>(new Map());
  
  // 单词选择状态
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const selectedSentenceRef = useRef<string>('');
  // PDF 模式下，选中文本时记录词索引区间，供 addHighlight 持久化为 startIndex/endIndex
  const selectedRangeRef = useRef<[number, number] | null>(null);
  const [dictionaryData, setDictionaryData] = useState<DictionaryDefinition | null>(null);
  const [dictLoading, setDictLoading] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);

  // ===== 性能优化：词典/AI 结果缓存 =====
  // 同一本书内重复点击同一单词很常见（复习）。缓存命中时跳过网络请求，
  // 直接显示历史结果，体感速度从 ~3s → ~10ms。
  const dictCacheRef = useRef<Map<string, DictionaryDefinition | null>>(new Map());
  const aiCacheRef = useRef<Map<string, AIContextResponse | null>>(new Map());
  // 跟踪"当前请求的 generation"——切到新词后旧请求的 setState 应该被丢弃
  const dictGenRef = useRef(0);
  const aiGenRef = useRef(0);

  // AI 解析状态
  const [aiData, setAiData] = useState<AIContextResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [hasAiKey, setHasAiKey] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);

  // PDF 阅读状态
  // 从 book.currentChapter 恢复上次阅读的页码（currentChapter 存的是页码-1）
  const [pdfCurrentPage, setPdfCurrentPage] = useState(
    book.format === 'pdf' && book.currentChapter ? book.currentChapter + 1 : 1
  );
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [pdfHighlightVersion, setPdfHighlightVersion] = useState(0);

  // 阅读时长记录
  const readStartTimeRef = useRef<number>(Date.now());

  // 阅读设置 — 从 localStorage 加载，变更时同步回
  const [settings, setSettings] = useState<ReaderSettings>(() => {
    try {
      const saved = localStorage.getItem('reader_settings');
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return {
      fontSize: 18,
      lineHeight: 1.8,
      theme: 'light',
      fontFamily: 'Georgia, serif'
    };
  });
  // 设置变更时持久化到 localStorage
  useEffect(() => {
    try {
      localStorage.setItem('reader_settings', JSON.stringify(settings));
    } catch { /* ignore */ }
  }, [settings]);
  const [showSettings, setShowSettings] = useState(false);

  // 章节树展开状态
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());

  // 书签
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);

  // 滚动位置追踪
  const scrollPosRef = useRef(book.scrollPosition || 0);
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 标记是否已经恢复过滚动位置（防止循环）
  const scrollRestoredRef = useRef(false);
  // 用 ref 保存最新进度，避免闭包陷阱
  const bookProgressRef = useRef(book.progress || 0);
  bookProgressRef.current = book.progress || 0;
  // 用 ref 保存 currentChapter 避免 handleScroll 重建
  const currentChapterRef = useRef(currentChapter);
  currentChapterRef.current = currentChapter;

  // 高亮/下划线
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [bookmarkTab, setBookmarkTab] = useState<'bookmark' | 'highlight'>('bookmark');

  // AI 解析返回后，自动补充到已标记的单词中
  useEffect(() => {
    if (!aiData || !selectedWord || aiLoading) return;

    // 检查该单词是否已经被标记，且没有 AI 解析
    const existingMarker = wordMarkers.find(
      w => w.word.toLowerCase() === selectedWord.toLowerCase() && w.bookId === book.id
    );
    if (existingMarker && !existingMarker.aiExplanation) {
      const parts: string[] = [];
      if (aiData.meaning) parts.push(`释义：${aiData.meaning}`);
      if (aiData.contextExplanation) parts.push(`上下文：${aiData.contextExplanation}`);
      if (aiData.usage) parts.push(`用法：${aiData.usage}`);
      if (aiData.synonyms && aiData.synonyms.length > 0) parts.push(`同义词：${aiData.synonyms.join('、')}`);
      if (aiData.examples && aiData.examples.length > 0) parts.push(`例句：${aiData.examples.join('\n')}`);
      const aiExplanation = parts.join('\n');
      if (aiExplanation && typeof onUpdateWord === 'function') {
        onUpdateWord(existingMarker.id, { aiExplanation });
      }
    }
  }, [aiData, aiLoading, selectedWord, wordMarkers, book.id, onUpdateWord]);

  // 侧边栏模式 & 选中文本 & 当前操作的下划线
  type SidebarMode = 'empty' | 'word' | 'selection' | 'highlightNote';
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('empty');
  const [selectedText, setSelectedText] = useState<string>('');
  const [activeHighlight, setActiveHighlight] = useState<Highlight | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>('');

  // 加载书签（必须在 useEffect/addBookmark/deleteBookmark/jumpToBookmark 之前）
  const loadBookmarks = useCallback(async () => {
    const bms = await BookDB.getBookmarks(book.id);
    setBookmarks(bms);
  }, [book.id]);

  // 加载高亮
  const loadHighlights = useCallback(async () => {
    const hls = await HighlightDB.getByBookId(book.id);
    setHighlights(hls);
  }, [book.id]);

  // 扁平化章节列表（用于导航）- 必须在 callback 和 JSX 之前定义
  const flatChapters = useMemo(() => {
    const result: Chapter[] = [];
    const flatten = (items: Chapter[]) => {
      for (const ch of items) {
        result.push(ch);
        if (ch.children) flatten(ch.children);
      }
    };
    flatten(chapters);
    return result;
  }, [chapters]);

  const contentRef = useRef<HTMLDivElement>(null);
  const htmlContentRef = useRef<HTMLDivElement>(null);
  const justSelectedRef = useRef(false); // 阻止 onClick 覆盖 onMouseUp 的 selection 状态
  const pendingScrollHighlightRef = useRef<string | null>(null); // 待滚动到的高亮 ID（从侧边栏点击笔记时设置）

  // 获取已标记的单词集合（useMemo 避免每次渲染重建 Set）
  const markedWords = useMemo(
    () => new Set(wordMarkers.map(w => w.word.toLowerCase())),
    [wordMarkers]
  );

  // 在 DOM 渲染后：高亮已标记单词 + 渲染下划线（带 data-id 和笔记图标）
  // 注：之前使用 `dangerouslySetInnerHTML` + DOM mutation（replaceChild / range.extractContents），
  // 模式有死结：任何 setState 触发父组件重渲染时，effect 重复运行可能把已包装节点二次处理
  // 导致 DOM 结构损坏、高亮"消失"。
  //
  // 本轮彻底重写为 **Diazazo 同款纯 React 渲染模式**：
  //   1) 把 chapterContent 解析为 token 数组
  //   2) 在 JSX 中按 markedWords / highlights 直接给每个 token 套 className / wrapper
  //   3) React reconciliation 自动保证高亮永远与状态一致——不存在"消失"窗口
  //
  // DOM mutation effect 整段删除（之前 ~120 行 + 各种边界 case 全部不再需要）。
  useEffect(() => {
    // 保留滚动到高亮的副作用
    if (pendingScrollHighlightRef.current && htmlContentRef.current) {
      const targetEl = htmlContentRef.current.querySelector(`[data-highlight-id="${pendingScrollHighlightRef.current}"]`);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      pendingScrollHighlightRef.current = null;
    }
  }, [chapterContent, currentChapter]);

  // 切换章节展开状态
  const toggleExpand = useCallback((chapterId: string) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(chapterId)) {
        next.delete(chapterId);
      } else {
        next.add(chapterId);
      }
      return next;
    });
  }, []);

  // 找到章节在扁平列表中的索引
  const findChapterIndex = useCallback((targetId: string): number => {
    const flatten = (items: Chapter[]): Chapter[] => {
      const result: Chapter[] = [];
      for (const ch of items) {
        result.push(ch);
        if (ch.children) {
          result.push(...flatten(ch.children));
        }
      }
      return result;
    };
    const flat = flatten(chapters);
    return flat.findIndex(ch => ch.id === targetId);
  }, [chapters]);

  // 检查是否配置了 API Key
  useEffect(() => {
    checkHasApiKey().then(setHasAiKey);
  }, []);

  // 加载书籍内容 - 只在 book.id 变化时执行（切换书籍时）
  useEffect(() => {
    let isMounted = true;
    
    async function loadBook() {
      setLoading(true);
      try {
        // 打开书时立即更新 lastReadAt，确保书架排序正确
        onUpdateProgress(book.id, book.progress || 0, book.currentChapter);

        const { parser, chapters: loadedChapters, contents: loadedContents } = await getBookContent(book);
        
        if (!isMounted) return;
        
        // 扁平化章节列表 - 使用 loadedChapters 直接计算，不依赖 chapters state
        const flat = (() => {
          const result: Chapter[] = [];
          const flatten = (items: Chapter[]) => {
            for (const ch of items) {
              result.push(ch);
              if (ch.children) flatten(ch.children);
            }
          };
          flatten(loadedChapters);
          return result;
        })();
        
        setParser(parser);
        setChapters(loadedChapters);
        setContents(loadedContents);

        // 使用 book.currentChapter prop（最新值），而不是 stale 的 state
        const initialChapter = Math.min(
          book.currentChapter || 0,
          Math.max(0, flat.length - 1)
        );
        setCurrentChapter(initialChapter);

        // 加载当前章节内容
        const currentChapterId = flat[initialChapter]?.id;
        if (currentChapterId && loadedContents.has(currentChapterId)) {
          setChapterContent(loadedContents.get(currentChapterId) || '');
        } else if (flat.length > 0) {
          // 如果当前章节不存在，加载第一章
          const firstChapterId = flat[0].id;
          setChapterContent(loadedContents.get(firstChapterId) || '');
          setCurrentChapter(0);
        }
      } catch (error) {
        console.error('Error loading book:', error);
      } finally {
        if (isMounted) {
          // PDF: restore last read page from book.currentChapter
          if (book.format === 'pdf') {
            const savedPage = (book.currentChapter || 0) + 1;
            setPdfCurrentPage(savedPage);
            setCurrentChapter(book.currentChapter || 0);
          }
          setLoading(false);
          // 加载书签和高亮（await 确保数据加载完成后再允许交互）
          await loadBookmarks();
          await loadHighlights();
        }
      }
    }
    
    loadBook();
    
    return () => {
      isMounted = false;
      // 保存阅读时长
      const elapsed = Math.round((Date.now() - readStartTimeRef.current) / 60000);
      if (elapsed > 0) {
        // 使用本地日期而非 UTC 日期，避免跨时区记录到错误日期
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        import('@/lib/db').then(({ ReadingDayDB }) => {
          ReadingDayDB.addMinutes(today, elapsed);
        });
      }
      // 重置计时器，避免切换书籍时累积时长
      readStartTimeRef.current = Date.now();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, loadBookmarks, loadHighlights, onUpdateProgress]);   // 监听 book.id 变化时重新加载

  // 退出阅读时保存滚动位置（独立 useEffect，避免触发书籍重载）
  // currentChapterRef 已在上方声明
  // 用 ref 保存 onUpdateProgress，避免闭包陷阱
  const onUpdateProgressRef = useRef(onUpdateProgress);
  onUpdateProgressRef.current = onUpdateProgress;
  useEffect(() => {
    return () => {
      // 使用 setTimeout 将保存推迟到下一个事件循环，避免在组件卸载同步期间触发状态更新
      setTimeout(() => {
        (async () => {
          try {
            // 清除滚动保存定时器，避免泄漏
            if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
            // 使用 ref 读取最新值
            await onUpdateProgressRef.current(
              book.id,
              bookProgressRef.current,
              currentChapterRef.current,
              scrollPosRef.current
            );
          } catch (e) {
            // 静默处理错误，避免影响用户体验
          }
        })();
      }, 0);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  // 切换章节（使用 flatChapters 扁平列表）
  const changeChapter = useCallback(async (index: number) => {
    if (index < 0 || index >= flatChapters.length) return;

    setCurrentChapter(index);
    const chapter = flatChapters[index];
    const chapterId = chapter.id;

    if (contents.has(chapterId)) {
      setChapterContent(contents.get(chapterId) || '');
    } else if (parser instanceof EPUBParser && chapter.href) {
      // 动态加载 EPUB 章节
      const content = await parser.getChapterContent(chapter.href);
      setChapterContent(content.html);
      setBookCss(content.css);
      contents.set(chapterId, content.html);
      setContents(new Map(contents));
    } else {
      // 没有预加载内容时的 fallback（PDF 或其他格式）
      setChapterContent(contents.get(chapterId) || `第 ${index + 1} 章\n\n（暂无内容）`);
    }

    // 保存阅读进度（通过回调通知父组件更新 React 状态，确保下次打开时记忆位置）
    // 确保进度至少为 1（避免章节数 >100 时第一章进度四舍五入为 0）
    const rawProgress = ((index + 1) / flatChapters.length) * 100;
    const progress = Math.max(1, Math.min(100, Math.round(rawProgress)));
    // 同步更新本地 ref，确保滚动保存和退出时使用最新进度
    bookProgressRef.current = progress;
    onUpdateProgress(book.id, progress, index);
    
    // 重新加载书签和高亮
    loadBookmarks();
    loadHighlights();

    // 滚动到顶部
    contentRef.current?.scrollTo(0, 0);
  }, [flatChapters, contents, parser, book.id, onUpdateProgress, loadBookmarks, loadHighlights]);

  // 滚动位置保存（防抖，500ms）
  // PDF 模式下不处理滚动（PDF 用翻页而非滚动）
  const handleScroll = useCallback(() => {
    if (!contentRef.current || book.format === 'pdf') return;
    // 如果正在恢复滚动位置，跳过保存
    if (scrollRestoredRef.current) return;
    const el = contentRef.current;
    const scrollPercent = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
    scrollPosRef.current = Math.round(scrollPercent * 100);
    if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
    scrollSaveTimerRef.current = setTimeout(() => {
      onUpdateProgress(book.id, bookProgressRef.current, currentChapterRef.current, scrollPosRef.current);
    }, 500);
  }, [book.id, book.format, onUpdateProgress]);
  // 不依赖 currentChapter（用 ref 代替），避免翻页时重建

  // 恢复滚动位置（只在 EPUB/TXT 模式下，且只执行一次）
  const restoreScrollPosition = useCallback(() => {
    if (book.format === 'pdf') return;
    if (scrollRestoredRef.current) return;
    if (!contentRef.current || !chapterContent) return;
    const pos = book.scrollPosition || scrollPosRef.current;
    if (pos > 0) {
      scrollRestoredRef.current = true;
      const el = contentRef.current;
      const target = (pos / 100) * Math.max(1, el.scrollHeight - el.clientHeight);
      requestAnimationFrame(() => {
        el.scrollTop = target;
        // 短暂延迟后清除标记，允许正常滚动保存
        setTimeout(() => { scrollRestoredRef.current = false; }, 600);
      });
    }
  }, [book.scrollPosition, chapterContent, book.format]);

  // 章节内容加载完成后恢复滚动位置
  useEffect(() => {
    if (chapterContent && !loading) {
      restoreScrollPosition();
    }
  }, [chapterContent, loading, restoreScrollPosition]);

  // 重置 scrollRestored 标记（章节切换时允许重新恢复）
  useEffect(() => {
    scrollRestoredRef.current = false;
  }, [currentChapter]);

  // 用 ref 保存关键 state，避免 onClick 闭包引用过期值
  const flatChaptersRef = useRef(flatChapters);
  flatChaptersRef.current = flatChapters;
  const contentsRef = useRef(contents);
  contentsRef.current = contents;
  const parserRef = useRef(parser);
  parserRef.current = parser;

  // 获取单词周围的上下文
  // 辅助函数：从 HTML 提取纯文本
  const htmlToPlainText = useCallback((html: string): string => {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    return (temp.textContent || '').replace(/\s+/g, ' ');
  }, []);

  const getWordContext = useCallback((word: string): string => {
    if (!chapterContent) return '';

    // 先将 HTML 转为纯文本再查找
    const plainText = htmlToPlainText(chapterContent);

    // 清理单词用于匹配（包括Unicode标点）
    const cleanWord = word.toLowerCase().replace(/[\p{P}\p{S}]/gu, '');

    // 查找所有匹配位置
    const contentLower = plainText.toLowerCase();
    const positions: number[] = [];
    let pos = contentLower.indexOf(cleanWord);
    while (pos !== -1) {
      positions.push(pos);
      pos = contentLower.indexOf(cleanWord, pos + 1);
    }

    if (positions.length === 0) {
      // 尝试查找包含该单词的句子（处理清理后的单词可能和原文不完全匹配的情况）
      const sentences = plainText.split(/[.!?。！？]+/);
      for (const sentence of sentences) {
        // 同时检查清理后的形式和原始形式
        if (sentence.toLowerCase().includes(cleanWord) || sentence.toLowerCase().includes(word.toLowerCase())) {
          const trimmed = sentence.trim();
          return trimmed.length > 0 ? trimmed.substring(0, 300) : plainText.substring(0, 300);
        }
      }
      // 兜底：返回包含该单词附近的文本（至少确保非空）
      const fallback = plainText.substring(0, 300).trim();
      return fallback.length > 0 ? fallback : '(上下文暂不可用)';
    }

    // 如果只有一个匹配，直接用；如果有多个，找包含在较完整句子中的那个
    let wordIndex = positions[0];
    if (positions.length > 1) {
      // 优先找包含在较长上下文（完整句子）中的匹配
      let bestScore = -1;
      for (const p of positions) {
        // 找句子边界
        let sStart = p;
        while (sStart > 0 && !/[.!?。！？\n]/.test(plainText[sStart - 1])) sStart--;
        let sEnd = p + cleanWord.length;
        while (sEnd < plainText.length && !/[.!?。！？\n]/.test(plainText[sEnd])) sEnd++;
        const score = sEnd - sStart; // 句子越长分数越高（更可能是完整上下文）
        if (score > bestScore) {
          bestScore = score;
          wordIndex = p;
        }
      }
    }

    // 获取单词前后的上下文（约 150 字符）
    const contextStart = Math.max(0, wordIndex - 150);
    const contextEnd = Math.min(plainText.length, wordIndex + cleanWord.length + 150);
    let context = plainText.substring(contextStart, contextEnd);

    // 确保从完整的单词开始和结束
    if (contextStart > 0) {
      const firstSpace = context.search(/\s/);
      if (firstSpace > 0) {
        context = context.substring(firstSpace + 1);
      }
    }
    if (contextEnd < plainText.length) {
      const lastSpace = context.lastIndexOf(' ');
      if (lastSpace > 0) {
        context = context.substring(0, lastSpace);
      }
    }

    return context.trim();
  }, [chapterContent, htmlToPlainText]);

  // 添加书签
  const addBookmark = useCallback(async () => {
    const chapter = flatChapters[currentChapter];
    if (!chapter) return;
    const bm: Bookmark = {
      id: `${book.id}-${currentChapter}-${Date.now()}`,
      bookId: book.id,
      chapterIndex: currentChapter,
      chapterTitle: chapter.title,
      createdAt: Date.now(),
    };
    await BookDB.addBookmark(bm);
    setBookmarks(prev => [bm, ...prev]);
  }, [book.id, currentChapter, flatChapters]);

  // 删除书签
  const deleteBookmark = useCallback(async (id: string) => {
    await BookDB.deleteBookmark(id);
    setBookmarks(prev => prev.filter(b => b.id !== id));
  }, []);

  // 跳转到书签
  const jumpToBookmark = useCallback((bm: Bookmark) => {
    changeChapter(bm.chapterIndex);
    setShowBookmarks(false);
  }, [changeChapter]);

  // 添加高亮/下划线
  const addHighlight = useCallback(async (text: string, type: 'underline' | 'highlight' = 'highlight'): Promise<Highlight | null> => {
    try {
      // PDF 使用页码作为 chapterIndex，EPUB/TXT 使用 currentChapter
      const chapterIdx = book.format === 'pdf' ? pdfCurrentPage - 1 : currentChapter;
      const chapter = flatChapters[chapterIdx];
      const hl: Highlight = {
        id: `${book.id}-${chapterIdx}-${Date.now()}`,
        bookId: book.id,
        chapterIndex: chapterIdx,
        chapterId: chapter?.id || (book.format === 'pdf' ? `page-${pdfCurrentPage}` : undefined),
        chapterTitle: book.format === 'pdf'
          ? `第 ${pdfCurrentPage} 页`
          : (chapter?.title || `第 ${currentChapter + 1} 章`),
        text,
        type,
        createdAt: Date.now(),
      };
      // PDF 模式：若本次选择带有词索引区间，持久化之，使再次加载时能精确定位
      // 到用户选中的那个出现位置（避免同页重复文本总匹配第一个）。
      if (book.format === 'pdf' && selectedRangeRef.current) {
        hl.startIndex = selectedRangeRef.current[0];
        hl.endIndex = selectedRangeRef.current[1];
      }
      await HighlightDB.add(hl);
      setHighlights(prev => [hl, ...prev]);
      // Trigger PDF highlight re-render
      if (book.format === 'pdf') {
        setPdfHighlightVersion(v => v + 1);
      }
      return hl;
    } catch (err) {
      console.error('[Reader] addHighlight error:', err);
      return null;
    }
  }, [book.id, book.format, currentChapter, pdfCurrentPage, flatChapters]);

  // 删除高亮
  const deleteHighlight = useCallback(async (id: string) => {
    await HighlightDB.delete(id);
    setHighlights(prev => prev.filter(h => h.id !== id));
    if (book.format === 'pdf') {
      setPdfHighlightVersion(v => v + 1);
    }
  }, [book.format]);

  // 处理单词点击
  // sentence 参数是从点击位置直接提取的所在句子（精确上下文，避免 indexOf 找到第一次出现的问题）
  const handleWordClick = useCallback(async (word: string, sentence?: string) => {
    try {
      // 对于短语（多词），保留原文结构（如 "coup d'état"），只去除首尾标点
      const isPhrase = word.trim().includes(' ');
      const cleanWord = isPhrase
        ? word.trim().replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')
        : word.replace(/[\p{P}\p{S}]/gu, '');
      if (cleanWord.length < 2) return;

      // 保存句子到 ref，供 toggleWordMarker 使用
      selectedSentenceRef.current = sentence || '';

      setSidebarMode('word');
      setSelectedWord(cleanWord);
      setDictLoading(true);
      setAiLoading(true);
      setAiError(null);
      setShowSidebar(true);

      // 生成请求 id，防止旧请求的 setState 污染新词的结果
      const myDictGen = ++dictGenRef.current;
      const myAiGen = ++aiGenRef.current;

      // 1) 词典查询：先查缓存
      const dictCacheKey = `${book.language}::${cleanWord}`;
      let definition = dictCacheRef.current.get(dictCacheKey);
      if (definition === undefined) { // 缓存未命中（注意：null 表示"已查过且没结果"也要缓存）
        setAiData(null);
        try {
          definition = await lookupWord(cleanWord, book.language);
        } catch (dictErr: any) {
          console.error('词典查询失败:', dictErr);
          definition = null;
        }
        dictCacheRef.current.set(dictCacheKey, definition ?? null);
      }
      // 期间用户可能已切换到别的词
      if (myDictGen !== dictGenRef.current) return;
      setDictionaryData(definition);
      setDictLoading(false);

      // 2) AI 解析：先查缓存（key 含上下文，不同句子结果可能不同）
      let context = '';
      try {
        if (sentence && sentence.length >= 3) {
          context = sentence;
        } else {
          context = getWordContext(cleanWord);
        }
        if (!context && sentence) context = sentence;
        if (!context) context = cleanWord;
      } catch (ctxErr: any) {
        console.error('获取上下文失败:', ctxErr);
        context = sentence || cleanWord;
      }

      if (hasAiKey) {
        const aiCacheKey = `${book.language}::${cleanWord}::${context.slice(0, 200)}`;
        let aiResult = aiCacheRef.current.get(aiCacheKey);
        if (aiResult === undefined) {
          try {
            aiResult = await analyzeWordWithAI(cleanWord, context, book.language);
          } catch (aiErr: any) {
            // 期间切到别的词就不再 setError
            if (myAiGen === aiGenRef.current) {
              setAiError(aiErr.message || 'AI 解析失败');
            }
            aiResult = null;
          }
          aiCacheRef.current.set(aiCacheKey, aiResult ?? null);
        }
        if (myAiGen !== aiGenRef.current) return;
        setAiData(aiResult);
        setAiError(null);
      } else {
        setAiData(null);
      }
      setAiLoading(false);
    } catch (err: any) {
      console.error('查看解析失败:', err);
      setAiError('解析过程中出错，请重试');
      setDictLoading(false);
      setAiLoading(false);
    }
  }, [book.language, hasAiKey, getWordContext]);

  // 标记/取消标记单词
  const toggleWordMarker = useCallback(async () => {
    if (!selectedWord) return;

    const existingMarker = wordMarkers.find(
      w => w.word.toLowerCase() === selectedWord.toLowerCase() && w.bookId === book.id
    );

    if (existingMarker) {
      onDeleteWord(existingMarker.id);
    } else {
      const translation = await getQuickTranslation(selectedWord, book.language);
      // 获取单词所在的原文上下文：优先使用点击时提取的精确句子，回退到 getWordContext
      const sentence = selectedSentenceRef.current;
      const context = sentence.length >= 10
        ? sentence
        : getWordContext(selectedWord);
      // 如果已有 AI 解析结果，格式化为字符串保存到单词本
      let aiExplanation: string | undefined;
      if (aiData) {
        const parts: string[] = [];
        if (aiData.meaning) parts.push(`释义：${aiData.meaning}`);
        if (aiData.contextExplanation) parts.push(`上下文：${aiData.contextExplanation}`);
        if (aiData.usage) parts.push(`用法：${aiData.usage}`);
        if (aiData.synonyms && aiData.synonyms.length > 0) parts.push(`同义词：${aiData.synonyms.join('、')}`);
        if (aiData.examples && aiData.examples.length > 0) parts.push(`例句：${aiData.examples.join('\n')}`);
        aiExplanation = parts.join('\n');
      }
      const newMarker: WordMarker = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        word: selectedWord,
        bookId: book.id,
        chapterId: flatChapters[currentChapter]?.id,
        context,
        translation,
        dictionaryDef: dictionaryData || undefined,
        aiExplanation,
        language: book.language,
        createdAt: Date.now(),
        reviewCount: 0,
        masteryLevel: 0
      };
      onAddWord(newMarker);
    }
  }, [selectedWord, dictionaryData, aiData, wordMarkers, book.id, book.language, flatChapters, currentChapter, onAddWord, onDeleteWord, getWordContext]);

  /**
   * 从点击事件中提取单词及其所在句子的上下文
   * 返回 { word, sentence }，sentence 是点击位置所在的那句话
   * 这样即使同一个单词出现多次，也能获取到当前点击位置的准确上下文
   */
  const extractWordFromClick = useCallback((e: React.MouseEvent<HTMLDivElement>): { word: string; sentence: string } | null => {
    const range = document.caretRangeFromPoint?.(e.clientX, e.clientY)
      || (() => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) return sel.getRangeAt(0);
        return null;
      })();

    if (!range) return null;

    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) return null;

    const fullText = textNode.textContent || '';
    const clickOffset = range.startOffset;

    // 从点击位置向前扫描到单词开头
    let start = clickOffset;
    while (start > 0) {
      const ch = fullText[start - 1];
      if (/\s/.test(ch) || /[\p{P}\p{S}\p{Z}]/u.test(ch)) break;
      start--;
    }

    // 从点击位置向后扫描到单词结尾
    let end = clickOffset;
    while (end < fullText.length) {
      const ch = fullText[end];
      if (/\s/.test(ch) || /[\p{P}\p{S}\p{Z}]/u.test(ch)) break;
      end++;
    }

    const word = fullText.substring(start, end);
    if (!word || word.length < 2) return null;

    const cleanWord = word.replace(/[\p{P}\p{S}]/gu, '');
    if (!/^[\p{L}\p{M}'-]+$/u.test(cleanWord) || cleanWord.length < 2) return null;

    // 提取点击位置所在的句子 — 使用 Range 扩展获取跨越多个 textNode 的完整句子
    const sentence = (() => {
      // 方法：获取 range 所在段落的完整文本，然后定位目标单词
      // 向上查找最近的段落级祖先（p, div, li, h1-h6 等）
      let container: Node = textNode;
      while (container && container !== htmlContentRef.current) {
        container = container.parentNode!;
      }

      // 获取容器的完整纯文本
      let containerText = '';
      if (container instanceof HTMLElement) {
        containerText = container.textContent || '';
      } else {
        // fallback: 用包含 textNode 的父元素
        const parent = textNode.parentElement;
        containerText = parent ? (parent.textContent || '') : fullText;
      }

      if (!containerText) return fullText.substring(start, end);

      // 在容器文本中定位目标单词（使用最近的匹配）
      // 先找所有匹配位置，选择与 clickOffset 比例最接近的
      const positions: number[] = [];
      let pos = containerText.toLowerCase().indexOf(cleanWord.toLowerCase());
      while (pos !== -1) {
        positions.push(pos);
        pos = containerText.toLowerCase().indexOf(cleanWord.toLowerCase(), pos + 1);
      }

      // 计算 textNode 中单词位置占全文的比例，找最接近的匹配
      let bestPos = positions[0] || 0;
      if (positions.length > 1 && fullText.length > 0) {
        const nodeRatio = start / fullText.length;
        let bestDiff = Infinity;
        for (const p of positions) {
          const containerRatio = p / containerText.length;
          const diff = Math.abs(containerRatio - nodeRatio);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestPos = p;
          }
        }
      }

      // 从 bestPos 向前向后找句子边界
      let sStart = bestPos;
      while (sStart > 0) {
        const ch = containerText[sStart - 1];
        if (/[.!?。！？\n]/.test(ch)) break;
        sStart--;
      }
      let sEnd = bestPos + cleanWord.length;
      while (sEnd < containerText.length) {
        const ch = containerText[sEnd];
        if (/[.!?。！？\n]/.test(ch)) {
          sEnd++; // 包含句子结束标点
          break;
        }
        sEnd++;
      }
      return containerText.substring(sStart, sEnd).trim();
    })();

    return { word: cleanWord, sentence };
  }, []);

  /**
   * 高亮已标记的单词：给内容中的已标记单词添加高亮样式
   * 通过在 HTML 中包裹 <mark> 标签实现
   */
  // 处理 PDF 选中的文字
  const handlePdfTextSelect = useCallback((text: string, sentence?: string, range?: [number, number]) => {
    const cleanText = text.trim();
    if (cleanText.length === 0) return;
    if (cleanText.length >= 2) {
      // 保存句子上下文供后续使用（AI解析时优先使用）
      if (sentence && sentence.length >= 3) {
        selectedSentenceRef.current = sentence;
      }
      // 保存词索引区间，供 addHighlight 持久化（PDF 精确定位高亮）
      selectedRangeRef.current = range && range[1] >= range[0] ? range : null;
      // 显示操作面板（解析/下划线/笔记）
      setSelectedText(cleanText);
      setSidebarMode('selection');
      setShowSidebar(true);
    }
  }, []);

  // 渲染 HTML 内容（直接渲染，保留图片和格式）
  // 内容点击处理器（在 useCallback 中稳定引用）
  const handleContentMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      const text = sel.toString().trim();
      if (text.length >= 2) {
        setSelectedText(text);
        setSidebarMode('selection');
        setShowSidebar(true);
        sel.removeAllRanges();
        justSelectedRef.current = true;
      }
    }
  }, []);

  const handleContentClick = useCallback((e: React.MouseEvent) => {
    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      return;
    }
    const target = e.target as HTMLElement;
    const highlightEl = target.closest('[data-highlight-id]') as HTMLElement | null;
    if (highlightEl) {
      const hlId = highlightEl.getAttribute('data-highlight-id');
      if (hlId) {
        const hl = highlights.find(h => h.id === hlId);
        if (hl) {
          setActiveHighlight(hl);
          setNoteDraft(hl.note || '');
          setSidebarMode('highlightNote');
          setShowSidebar(true);
          return;
        }
      }
    }
    const result = extractWordFromClick(e);
    if (result) {
      setSidebarMode('word');
      handleWordClick(result.word, result.sentence);
    }
  }, [extractWordFromClick, handleWordClick, highlights]);

  // PDF 翻页时同步更新 currentChapter 和保存阅读进度
  const handlePdfPageChange = useCallback((page: number) => {
    setPdfCurrentPage(page);
    // PDF 的 currentChapter 存的是页码-1
    const chapterIdx = page - 1;
    setCurrentChapter(chapterIdx);
    // 保存阅读进度
    const progress = pdfTotalPages > 0 ? Math.max(1, Math.round((page / pdfTotalPages) * 100)) : 0;
    bookProgressRef.current = progress;
    onUpdateProgress(book.id, progress, chapterIdx);
  }, [book.id, pdfTotalPages, onUpdateProgress]);

  // 当前章节高亮（直接派生，避免在 renderContent 内部 filter 产生闭包陷阱）
  const currentChapterHighlights = useMemo(
    () => highlights.filter(h => h.chapterIndex === currentChapter),
    [highlights, currentChapter]
  );

  // 渲染内容区域 — 普通函数，不需要 useCallback（每次渲染直接调用）
  const renderContent = () => {
    if (book.format === 'pdf') {
      return (
        <div className="py-6">
          <PDFCanvasViewer
            fileData={book.fileData}
            pageNum={pdfCurrentPage}
            bookId={book.id}
            chapterIndex={pdfCurrentPage - 1}
            onTextSelect={handlePdfTextSelect}
            onPageCount={setPdfTotalPages}
            onPageChange={handlePdfPageChange}
            highlightVersion={pdfHighlightVersion}
            wordMarkers={wordMarkers}
            showSidebar={showSidebar}
          />
        </div>
      );
    }
    if (!chapterContent) {
      return (
        <div className="text-center py-20">
          <p className="opacity-60">本章内容为空</p>
        </div>
      );
    }

    // ===== Diazazo 同款纯 React 渲染 =====
    // 把 chapterContent（HTML 字符串）解析为 token 数组，然后在 JSX 中按
    // markedWords / highlights 状态给每个 token 套 className / wrapper。
    // 优势：高亮是 React 渲染的一部分，永远与状态一致——不存在"消失"窗口。
    return (
      <div
        ref={htmlContentRef}
        className={`reader-html-content reader-theme-${settings.theme}`}
        style={{ fontSize: `${settings.fontSize}px`, lineHeight: `${settings.lineHeight}` }}
        onClick={handleContentClick}
        onMouseUp={handleContentMouseUp}
      >
        {bookCss ? <style>{scopeCss(bookCss, '.reader-html-content')}</style> : null}
        {parseHtmlToReact(chapterContent, markedWords, currentChapterHighlights)}
      </div>
    );
  };

  // 主题样式
  const themeStyles = {
    light: 'bg-[#f5f2e9] text-[#2c2c2c]',
    dark: 'bg-[#1a1c1f] text-[#e0e0e0]',
    sepia: 'bg-[#f4ecd8] text-[#5b4636]'
  };

  const isWordMarked = selectedWord && markedWords.has(selectedWord.toLowerCase());

  if (loading) {
    return (
      <div className={`min-h-screen ${themeStyles[settings.theme]} flex items-center justify-center`}>
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-[#e5a349]" />
          <p className="opacity-60">正在加载书籍...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${themeStyles[settings.theme]}`}>
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-inherit border-b border-current/10">
        <div className="flex items-center justify-between h-16 px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="hover:bg-current/10"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            
            {/* Chapter Navigation */}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-2 hover:bg-current/10">
                  <List className="w-4 h-4" />
                  <span className="hidden sm:inline">目录</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[340px] bg-[#282b2f] border-white/10">
                <SheetHeader>
                  <SheetTitle className="text-white">{book.title}</SheetTitle>
                </SheetHeader>
                <div className="mt-6 max-h-[calc(100vh-120px)] overflow-y-auto">
                  {flatChapters.length === 0 ? (
                    <p className="text-white/40 text-center py-8">暂无目录</p>
                  ) : (
                    <ChapterTree
                      chapters={chapters}
                      currentChapter={currentChapter}
                      expandedChapters={expandedChapters}
                      onToggleExpand={toggleExpand}
                      onSelectChapter={(chapterId) => {
                        if (book.format === 'pdf') {
                          // PDF: extract page number from chapter href or id
                          const ch = chapters.find(c => c.id === chapterId);
                          const pageNum = ch?.href ? parseInt(ch.href, 10) : undefined;
                          if (pageNum && pageNum >= 1) {
                            handlePdfPageChange(pageNum);
                          } else {
                            // Fallback: use chapter index as page number
                            const idx = chapters.findIndex(c => c.id === chapterId);
                            if (idx >= 0) handlePdfPageChange(idx + 1);
                          }
                        } else {
                          const idx = findChapterIndex(chapterId);
                          if (idx >= 0) changeChapter(idx);
                        }
                      }}
                    />
                  )}
                </div>
              </SheetContent>
            </Sheet>

            {/* 书签按钮 */}
            <Button
              variant="ghost"
              onClick={() => setShowBookmarks(!showBookmarks)}
              className={`hover:bg-current/10 ${showBookmarks ? 'bg-current/10' : ''}`}
              title="书签"
            >
              <BookmarkIcon className="w-4 h-4" />
              {bookmarks.length > 0 && (
                <span className="text-xs ml-0.5">{bookmarks.length}</span>
              )}
            </Button>

            <div className="hidden md:block">
              <h1 className="font-semibold truncate max-w-[300px]">
                {flatChapters[currentChapter]?.title || book.title}
              </h1>
              <p className="text-xs opacity-60">
                {currentChapter + 1} / {flatChapters.length} 章
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* 添加书签按钮 */}
            <Button
              variant="ghost"
              onClick={addBookmark}
              className="hover:bg-current/10"
              title="添加书签"
            >
              <BookmarkPlusIcon className="w-4 h-4" />
            </Button>

            {/* AI Settings Button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSettingsDialog(true)}
              className={`hover:bg-current/10 relative`}
              title="AI 设置"
            >
              <Sparkles className={`w-5 h-5 ${hasAiKey ? 'text-purple-400' : ''}`} />
              {!hasAiKey && (
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-yellow-500 rounded-full" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSettings(!showSettings)}
              className={`hover:bg-current/10 ${showSettings ? 'bg-current/10' : ''}`}
            >
              <Settings className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSidebar(!showSidebar)}
              className={`hover:bg-current/10 ${showSidebar ? 'bg-current/10' : ''}`}
            >
              <BookOpen className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="border-t border-current/10 p-4">
            <div className="flex items-center gap-6 flex-wrap justify-center">
              {/* Font Size */}
              <div className="flex items-center gap-3">
                <Type className="w-4 h-4 opacity-60" />
                <span className="text-sm opacity-80">字号</span>
                <Slider
                  value={[settings.fontSize]}
                  onValueChange={([value]) => setSettings(s => ({ ...s, fontSize: value }))}
                  min={14}
                  max={28}
                  step={1}
                  className="w-28"
                />
                <span className="text-sm w-8">{settings.fontSize}</span>
              </div>

              {/* Line Height */}
              <div className="flex items-center gap-3">
                <span className="text-sm opacity-80">行距</span>
                <Slider
                  value={[settings.lineHeight]}
                  onValueChange={([value]) => setSettings(s => ({ ...s, lineHeight: value }))}
                  min={1.2}
                  max={2.5}
                  step={0.1}
                  className="w-28"
                />
              </div>

              {/* Theme */}
              <div className="flex items-center gap-2">
                <span className="text-sm opacity-80">主题</span>
                <button
                  onClick={() => setSettings(s => ({ ...s, theme: 'light' }))}
                  className={`p-2 rounded-lg transition-colors ${
                    settings.theme === 'light' ? 'bg-[#e5a349] text-white' : 'hover:bg-current/10'
                  }`}
                >
                  <Sun className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setSettings(s => ({ ...s, theme: 'sepia' }))}
                  className={`p-2 rounded-lg transition-colors ${
                    settings.theme === 'sepia' ? 'bg-[#e5a349] text-white' : 'hover:bg-current/10'
                  }`}
                >
                  <BookOpen className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setSettings(s => ({ ...s, theme: 'dark' }))}
                  className={`p-2 rounded-lg transition-colors ${
                    settings.theme === 'dark' ? 'bg-[#e5a349] text-white' : 'hover:bg-current/10'
                  }`}
                >
                  <Moon className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Bookmarks / Highlights Bar — 白底黑字，z-50 覆盖所有内容 */}
      {showBookmarks && (
        <div className="fixed inset-x-0 top-16 bottom-0 z-50 bg-white text-gray-900 shadow-2xl overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">书签 & 笔记</h2>
              <button
                onClick={() => setShowBookmarks(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500 hover:text-gray-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 mb-4">
              <button
                onClick={() => setBookmarkTab('bookmark')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  bookmarkTab === 'bookmark'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                书签 ({bookmarks.length})
              </button>
              <button
                onClick={() => setBookmarkTab('highlight')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  bookmarkTab === 'highlight'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                笔记 ({highlights.length})
              </button>
            </div>

            {/* Bookmark tab content */}
            {bookmarkTab === 'bookmark' && (
              <>
                {bookmarks.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">暂无书签，点击顶部 <BookmarkPlusIcon className="w-3 h-3 inline" /> 添加</p>
                ) : (
                  <div className="space-y-2">
                    {bookmarks.map(bm => (
                      <div
                        key={bm.id}
                        className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-100 transition-colors group"
                        onClick={() => jumpToBookmark(bm)}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {bm.chapterTitle || `第 ${bm.chapterIndex + 1} 章`}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {new Date(bm.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteBookmark(bm.id); }}
                          className="text-gray-300 hover:text-red-500 transition-colors p-1"
                          title="删除书签"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Highlight/Note tab content */}
            {bookmarkTab === 'highlight' && (
              <>
                {highlights.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">暂无笔记，拖拽选中文本后可在右侧操作面板添加</p>
                ) : (
                  <div className="space-y-2">
                    {highlights.map(hl => (
                      <div
                        key={hl.id}
                        className="flex items-start gap-3 bg-gray-50 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-100 transition-colors group border-l-4 border-[#e5a349]"
                        onClick={async () => {
                          setShowBookmarks(false);
                          setShowSidebar(true);

                          const idx = hl.chapterIndex;

                          if (book.format === 'pdf') {
                            // PDF: 翻到高亮所在页（chapterIndex 存的是页码-1）
                            handlePdfPageChange(idx + 1);
                          } else if (idx >= 0 && idx < flatChaptersRef.current.length) {
                            // EPUB/TXT: 加载章节内容，然后滚动到高亮位置
                            const latestFlatChapters = flatChaptersRef.current;
                            const latestContents = contentsRef.current;
                            const latestParser = parserRef.current;

                            setCurrentChapter(idx);
                            const chId = hl.chapterId || latestFlatChapters[idx]?.id;
                            if (chId && latestContents.has(chId)) {
                              setChapterContent(latestContents.get(chId) || '');
                            } else if (latestParser instanceof EPUBParser && latestFlatChapters[idx]?.href) {
                              const content = await latestParser.getChapterContent(latestFlatChapters[idx].href!);
                              setChapterContent(content.html);
                              setBookCss(content.css);
                              latestContents.set(chId!, content.html);
                              setContents(new Map(latestContents));
                            }
                            const rawProgress = ((idx + 1) / latestFlatChapters.length) * 100;
                            const progress = Math.max(1, Math.min(100, Math.round(rawProgress)));
                            bookProgressRef.current = progress;
                            onUpdateProgress(book.id, progress, idx);
                            // 设置待滚动目标 — 高亮渲染 effect 会在 DOM 就绪后 scrollIntoView
                            pendingScrollHighlightRef.current = hl.id;
                          }

                          // 打开该高亮的笔记面板
                          setActiveHighlight(hl);
                          setNoteDraft(hl.note || '');
                          setSidebarMode('highlightNote');
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 leading-relaxed">
                            <span className="border-b-2 border-[#e5a349]">{hl.text}</span>
                            {hl.note && <span className="ml-1 text-[#e5a349]">•</span>}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {hl.chapterTitle || `第 ${hl.chapterIndex + 1} 章`} · {new Date(hl.createdAt).toLocaleDateString()}
                          </p>
                          {hl.note && (
                            <p className="text-xs text-gray-500 mt-1 bg-gray-100 rounded-lg px-2 py-1.5">{hl.note}</p>
                          )}
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteHighlight(hl.id); }}
                          className="text-gray-300 hover:text-red-500 transition-colors p-1 flex-shrink-0"
                          title="删除笔记"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="pt-16 flex">
        {/* Reader Area */}
        <main
          ref={contentRef}
          onScroll={book.format === 'pdf' ? undefined : handleScroll}
          className={`flex-1 h-[calc(100vh-64px)] ${
            book.format === 'pdf' ? 'overflow-hidden' : 'overflow-y-auto'
          } ${showSidebar && book.format !== 'pdf' ? 'lg:mr-[400px] transition-[margin] duration-300' : ''}`}
        >
          <div
            className={book.format === 'pdf' ? '' : 'max-w-3xl mx-auto py-10 px-6 lg:px-10'}
            style={book.format === 'pdf' ? undefined : {
              fontSize: settings.fontSize,
              lineHeight: settings.lineHeight,
              fontFamily: settings.fontFamily
            }}
          >
            {/* Chapter Title (EPUB/TXT only) */}
            {book.format !== 'pdf' && flatChapters[currentChapter] && (
              <h1 className="text-3xl font-bold mb-8 text-center">
                {flatChapters[currentChapter].title}
              </h1>
            )}
            
            {/* Content */}
            <div className="prose prose-lg max-w-none">
              {renderContent()}
            </div>

            {/* Chapter Navigation Footer (EPUB/TXT only) */}
            {book.format !== 'pdf' && (
              <div className="flex items-center justify-between mt-16 pt-8 border-t border-current/10">
                <Button
                  variant="ghost"
                  onClick={() => changeChapter(currentChapter - 1)}
                  disabled={currentChapter === 0}
                  className="flex items-center gap-2 bg-current/5 border border-current/15 opacity-90 hover:bg-current/10 hover:opacity-100 disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                  上一章
                </Button>
                
                <span className="text-sm text-white/60">
                  {currentChapter + 1} / {flatChapters.length}
                </span>

                <Button
                  variant="ghost"
                  onClick={() => changeChapter(currentChapter + 1)}
                  disabled={currentChapter >= flatChapters.length - 1}
                  className="flex items-center gap-2 bg-current/5 border border-current/15 opacity-90 hover:bg-current/10 hover:opacity-100 disabled:opacity-30"
                >
                  下一章
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        </main>

        {/* Sidebar */}
        {showSidebar && (
          <aside className="fixed right-0 top-[64px] bottom-0 w-full lg:w-[400px] border-l border-current/10 bg-inherit overflow-y-auto z-30">
            <div className="p-6">
              {/* ===== 模式 1: 选中文本操作面板 ===== */}
              {sidebarMode === 'selection' && (
                <div className="space-y-5">
                  <div className="flex items-start justify-between">
                    <h3 className="text-lg font-bold">选中文本</h3>
                    <button
                      onClick={() => setSidebarMode('empty')}
                      className="p-1.5 hover:bg-current/10 rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* 选中的文本预览 */}
                  <div className="bg-current/5 rounded-xl p-4 border border-current/10">
                    <p className="text-sm leading-relaxed italic opacity-80">&ldquo;{selectedText}&rdquo;</p>
                  </div>

                  {/* 三个操作按钮 */}
                  <div className="space-y-2.5">
                    <button
                      onClick={() => {
                        // 把完整的选中文本传给解析（支持多词）
                        const cleanText = selectedText.replace(/[\p{P}\p{S}]/gu, '').trim();
                        if (cleanText.length >= 2) {
                          // PDF模式下优先使用从PDF解析器传递过来的句子上下文
                          const sentence = selectedSentenceRef.current || selectedText;
                          handleWordClick(cleanText, sentence);
                        }
                      }}
                      className="w-full py-3 px-4 rounded-xl bg-[#e5a349] text-white hover:bg-[#d49340] transition-colors flex items-center justify-center gap-2 font-medium"
                    >
                      <BookOpen className="w-4 h-4" />
                      查看解析
                    </button>

                    <button
                      onClick={() => {
                        addHighlight(selectedText, 'underline');
                        setSidebarMode('empty');
                      }}
                      className="w-full py-3 px-4 rounded-xl bg-[#343840] text-white hover:bg-[#404650] transition-colors flex items-center justify-center gap-2 font-medium"
                    >
                      <Underline className="w-4 h-4 text-[#e5a349]" />
                      画下划线
                    </button>

                    <button
                      onClick={async () => {
                        // 保存高亮并直接进入笔记编辑（使用 addHighlight 返回的同一对象）
                        const hl = await addHighlight(selectedText, 'highlight');
                        if (hl) {
                          setActiveHighlight(hl);
                          setNoteDraft('');
                          setSidebarMode('highlightNote');
                        }
                      }}
                      className="w-full py-3 px-4 rounded-xl bg-[#343840] text-white hover:bg-[#404650] transition-colors flex items-center justify-center gap-2 font-medium"
                    >
                      <PenLine className="w-4 h-4 text-[#e5a349]" />
                      笔记
                    </button>
                  </div>
                </div>
              )}

              {/* ===== 模式 2: 单词解析面板 ===== */}
              {sidebarMode === 'word' && selectedWord && (
                <div className="space-y-6">
                  {/* Word Header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-3xl font-bold">{selectedWord}</h2>
                      <div className="mt-2">
                        <PronunciationButtons
                          word={selectedWord}
                          language={book.language}
                          ukPhonetic={dictionaryData?.ukPhonetic}
                          usPhonetic={dictionaryData?.usPhonetic}
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => setSidebarMode('empty')}
                      className="p-2 hover:bg-current/10 rounded-lg transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Mark Button */}
                  <button
                    onClick={toggleWordMarker}
                    className={`w-full py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all ${
                      isWordMarked
                        ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30'
                        : 'bg-[#e5a349] text-white hover:bg-[#d49340]'
                    }`}
                  >
                    <Highlighter className="w-5 h-5" />
                    <span>{isWordMarked ? '取消标记' : '标记单词'}</span>
                  </button>

                  {/* Dictionary Definition */}
                  <div className="space-y-3">
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                      <Type className="w-5 h-5 text-[#e5a349]" />
                      词典释义
                    </h3>

                    {dictLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-[#e5a349]" />
                      </div>
                    ) : dictionaryData ? (
                      <div className="space-y-4">
                        {dictionaryData.partOfSpeech && (
                          <span className="inline-block px-3 py-1 rounded-full bg-[#e5a349]/20 text-[#e5a349] text-sm">
                            {dictionaryData.partOfSpeech}
                          </span>
                        )}

                        <div className="space-y-2">
                          {dictionaryData.definitions.slice(0, 5).map((def, index) => (
                            <div key={index} className="flex gap-3">
                              <span className="text-[#e5a349] font-medium flex-shrink-0">{index + 1}.</span>
                              <p className="opacity-80 text-sm">{def}</p>
                            </div>
                          ))}
                        </div>

                        {dictionaryData.examples && dictionaryData.examples.length > 0 && (
                          <div className="mt-4">
                            <h4 className="text-sm font-medium opacity-60 mb-2">例句</h4>
                            <div className="space-y-2">
                              {dictionaryData.examples.slice(0, 2).map((example, index) => (
                                <p key={index} className="text-sm opacity-70 italic pl-4 border-l-2 border-current/20">
                                  &ldquo;{example}&rdquo;
                                </p>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm opacity-60 py-4">
                        {book.language === 'fr'
                          ? '未找到该单词的法语释义'
                          : book.language === 'de'
                          ? '未找到该单词的德语释义'
                          : book.language === 'ja'
                          ? '未找到该单词的日语释义'
                          : book.language === 'uk'
                          ? '未找到该单词的乌克兰语释义'
                          : book.language === 'pl'
                          ? '未找到该单词的波兰语释义'
                          : 'No definition found for this word'}
                      </p>
                    )}
                  </div>

                  {/* AI 对话框 */}
                  <div className="space-y-3 border-t border-current/10 pt-4">
                    <AIChatPanel
                      word={selectedWord}
                      context={getWordContext(selectedWord || '')}
                      language={book.language}
                      hasApiKey={hasAiKey}
                      onOpenSettings={() => setShowSettingsDialog(true)}
                      aiData={aiData}
                      aiLoading={aiLoading}
                      aiError={aiError}
                      theme={settings.theme}
                    />
                  </div>
                </div>
              )}

              {/* ===== 模式 3: 下划线笔记面板 ===== */}
              {sidebarMode === 'highlightNote' && activeHighlight && (
                <div className="space-y-5">
                  <div className="flex items-start justify-between">
                    <h3 className="text-lg font-bold">笔记</h3>
                    <button
                      onClick={() => setSidebarMode('empty')}
                      className="p-1.5 hover:bg-current/10 rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* 下划线文本 */}
                  <div className="bg-current/5 rounded-xl p-4 border border-current/10">
                    <p className="text-xs opacity-60 mb-1">{activeHighlight.chapterTitle || `第 ${activeHighlight.chapterIndex + 1} 章`}</p>
                    <p className="text-sm leading-relaxed border-b-2 border-[#e5a349] inline">{activeHighlight.text}</p>
                  </div>

                  {/* 笔记编辑 */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium opacity-70">笔记内容</label>
                    <textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="写下你的想法..."
                      className="w-full h-32 bg-current/5 border border-current/10 rounded-xl p-3 text-sm opacity-90 placeholder:opacity-30 resize-none focus:outline-none focus:border-[#e5a349]/50"
                    />
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        await HighlightDB.update(activeHighlight.id, { note: noteDraft });
                        setHighlights(prev => prev.map(h => h.id === activeHighlight.id ? { ...h, note: noteDraft } : h));
                        setSidebarMode('empty');
                      }}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-[#e5a349] text-white hover:bg-[#d49340] transition-colors font-medium text-sm"
                    >
                      保存笔记
                    </button>
                    <button
                      onClick={async () => {
                        await deleteHighlight(activeHighlight.id);
                        setSidebarMode('empty');
                      }}
                      className="py-2.5 px-4 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors text-sm"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* 已有笔记显示 */}
                  {activeHighlight.note && (
                    <div className="bg-[#e5a349]/10 rounded-xl p-3 border border-[#e5a349]/20">
                      <p className="text-xs text-[#e5a349] font-medium mb-1">当前笔记</p>
                      <p className="text-sm opacity-70">{activeHighlight.note}</p>
                    </div>
                  )}
                </div>
              )}

              {/* ===== 模式 0: 空状态 ===== */}
              {sidebarMode === 'empty' && (
                <div className="text-center py-12">
                  <div className="w-16 h-16 rounded-full bg-current/5 flex items-center justify-center mx-auto mb-4">
                    <BookOpen className="w-8 h-8 opacity-40" />
                  </div>
                  <p className="opacity-60">拖拽选中文本进行操作</p>
                  <p className="text-sm opacity-40 mt-2">
                    可选：查看解析 / 画下划线 / 笔记
                  </p>
                  {wordMarkers.length > 0 && (
                    <p className="text-xs opacity-30 mt-4">
                      已标记 {wordMarkers.length} 个单词
                    </p>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Settings Dialog for AI API Key */}
      <SettingsDialog 
        open={showSettingsDialog} 
        onOpenChange={(open) => {
          setShowSettingsDialog(open);
          // 关闭对话框后重新检查 API Key 状态
          if (!open) {
            checkHasApiKey().then(setHasAiKey);
          }
        }} 
      />
    </div>
  );
}

// ============ HTML → React 解析器（Diazazo 同款纯 React 渲染）============
// 把 chapterContent（HTML 字符串）解析为 React 节点数组，在词级别应用高亮/marked className。
// 关键设计：只识别安全子集标签（p/h1-h6/div/br/strong/em），其余原样保留为 text。
// 这样高亮/marked 是 React 渲染的一部分，与状态 100% 同步——不存在"消失"窗口。

interface ParseOptions {
  markedWords: Set<string>;
  highlights: Highlight[];
}

/**
 * 把一段书籍 CSS 的选择器全部前缀为 scope（如 .reader-html-content），
 * 使其只作用于阅读器内容容器，而不会泄漏到应用其它 UI（侧边栏/对话框等）。
 * 处理常见结构：普通规则、逗号分组、@media/@supports 嵌套、@font-face/@keyframes/@import 等原样保留。
 */
function scopeSelector(sel: string, scope: string): string {
  let s = sel.replace(/\b(html|body)\b/g, '').replace(/\s{2,}/g, ' ').trim();
  if (!s) return scope;
  if (s === '*') return `${scope} *`;
  return `${scope} ${s}`;
}

function scopeCss(css: string, scope: string): string {
  if (!css) return '';
  const out: string[] = [];
  let buf = '';
  let i = 0;
  const n = css.length;
  while (i < n) {
    const ch = css[i];
    if (/\s/.test(ch)) { buf += ch; i++; continue; }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (ch === '{') {
      const prelude = buf.trim();
      buf = '';
      // 找到匹配的右括号（处理嵌套）
      let depth = 1;
      let j = i + 1;
      while (j < n && depth > 0) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        if (depth === 0) break;
        j++;
      }
      const inner = css.slice(i + 1, j);
      i = j + 1;
      if (prelude.startsWith('@')) {
        if (/^@(media|supports|container|layer)\b/i.test(prelude)) {
          out.push(`${prelude} {${scopeCss(inner, scope)}}`);
        } else {
          out.push(`${prelude} {${inner}}`);
        }
      } else {
        const scoped = prelude.split(',').map(s => scopeSelector(s.trim(), scope)).filter(Boolean).join(', ');
        out.push(`${scoped} {${inner}}`);
      }
      continue;
    }
    if (ch === '}') { buf = ''; i++; continue; }
    if (ch === ';') {
      const prelude = buf.trim();
      buf = '';
      if (prelude) out.push(`${prelude};`);
      i++; continue;
    }
    buf += ch;
    i++;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out.join('\n');
}

function parseHtmlToReact(
  html: string,
  markedWords: Set<string>,
  highlights: Highlight[],
): React.ReactNode {
  // 1) 抽取"高亮文本 → ID" 区间
  const hlRanges: Array<{ start: number; end: number; id: string; hasNote: boolean }> = [];
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  const plainText = (tempDiv.textContent || '');

  const sortedHl = [...highlights].sort((a, b) => b.text.length - a.text.length);
  for (const hl of sortedHl) {
    if (!hl.text) continue;
    const t = hl.text;
    let from = 0;
    while (true) {
      const i = plainText.indexOf(t, from);
      if (i < 0) break;
      const overlapped = hlRanges.some(r =>
        (i >= r.start && i < r.end) || (i + t.length > r.start && i + t.length <= r.end) ||
        (i <= r.start && i + t.length >= r.end)
      );
      if (!overlapped) {
        hlRanges.push({ start: i, end: i + t.length, id: hl.id, hasNote: !!hl.note });
      }
      from = i + Math.max(1, t.length);
    }
  }
  hlRanges.sort((a, b) => a.start - b.start);

  // 2) 用 React.createElement 构造节点（不用 JSX，避免 react-jsx 运行时误报 hooks 误用）
  function renderTextSegment(text: string, basePlainStart: number): React.ReactNode[] {
    if (!text) return [];
    const segs: React.ReactNode[] = [];
    const active = hlRanges.filter(r =>
      r.start < basePlainStart + text.length && r.end > basePlainStart
    );
    if (active.length === 0) {
      segs.push(renderWordsWithMark(text, basePlainStart, null));
      return segs;
    }
    let pos = basePlainStart;
    for (const r of active) {
      if (r.start > pos) {
        const before = text.slice(pos - basePlainStart, r.start - basePlainStart);
        segs.push(renderWordsWithMark(before, pos, null));
      }
      const inHl = text.slice(Math.max(r.start, pos) - basePlainStart, r.end - basePlainStart);
      const hlInner: React.ReactNode[] = [renderWordsWithMark(inHl, Math.max(r.start, pos), r.id)];
      if (r.hasNote) {
        hlInner.push(React.createElement('span', {
          key: `nd-${r.id}-${basePlainStart}`,
          style: { color: '#e5a349', fontSize: '0.85em' },
        }, ' •'));
      }
      segs.push(React.createElement('span', {
        key: `hl-${r.id}-${basePlainStart}`,
        'data-highlight-id': r.id,
        className: 'border-b-2 border-[#e5a349] cursor-pointer hover:bg-[#e5a349]/10 transition-colors',
      }, ...hlInner));
      pos = r.end;
    }
    if (pos < basePlainStart + text.length) {
      const after = text.slice(pos - basePlainStart);
      segs.push(renderWordsWithMark(after, pos, null));
    }
    return segs;
  }

  function renderWordsWithMark(
    text: string,
    plainStart: number,
    _hlId: string | null,
  ): React.ReactNode {
    if (!text) return null;
    const parts = text.split(/([^\p{L}\p{M}\u2010-\u2015']+)/gu);
    const nodes: React.ReactNode[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      const isWordLike = /[\p{L}\p{M}]/u.test(part);
      if (!isWordLike) {
        nodes.push(React.createElement('span', { key: `t-${plainStart}-${i}` }, part));
        continue;
      }
      const clean = part.replace(/[\p{P}\p{S}]/gu, '').toLowerCase();
      const isMarked = clean && markedWords.has(clean) && clean.length >= 2;
      if (isMarked) {
        nodes.push(React.createElement('mark', {
          key: `m-${plainStart}-${i}`,
          className: 'cursor-pointer',
          style: {
            backgroundColor: 'rgba(229,163,73,0.3)',
            borderBottom: '2px solid #e5a349',
            padding: '0 2px',
            borderRadius: '2px',
          },
        }, part));
      } else {
        nodes.push(React.createElement('span', { key: `t-${plainStart}-${i}` }, part));
      }
    }
    return React.createElement(React.Fragment, { key: `wf-${plainStart}` }, ...nodes);
  }

  // 3) 顶层节点遍历
  const out: React.ReactNode[] = [];
  let plainCursor = 0;
  let nodeSeq = 0; // 全局唯一序号：避免并列元素（多张图片/兄弟节点）key 冲突
  // 允许透传的安全属性白名单。图片的 src / style 必须保留，否则 base64 图片与尺寸样式会丢失。
  const SAFE_ATTRS = new Set([
    'src', 'alt', 'title', 'width', 'height', 'href', 'target', 'rel',
    'id', 'class', 'style', 'name', 'align', 'border', 'colspan', 'rowspan',
    'viewBox', 'preserveAspectRatio', 'xmlns', 'fill', 'stroke',
  ]);
  // 把内联 style 字符串解析为 React 样式对象（避免字符串 style 在部分 React 版本下不生效）
  function parseInlineStyle(str: string): Record<string, string> | undefined {
    if (!str) return undefined;
    const obj: Record<string, string> = {};
    str.split(';').forEach(decl => {
      const idx = decl.indexOf(':');
      if (idx < 0) return;
      const prop = decl.slice(0, idx).trim();
      const val = decl.slice(idx + 1).trim();
      if (!prop || !val) return;
      const camel = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      obj[camel] = val;
    });
    return Object.keys(obj).length ? obj : undefined;
  }
  function buildProps(el: Element): Record<string, any> {
    const props: Record<string, any> = { key: `el-${nodeSeq++}` };
    for (let i = 0; i < el.attributes.length; i++) {
      const a = el.attributes[i];
      const name = a.name;
      // 仅透传白名单属性；data-* 保留（EPUB 常用 epub:type 等，且 data- 天然安全）
      if (SAFE_ATTRS.has(name) || name.startsWith('data-')) {
        if (name === 'style') {
          const parsed = parseInlineStyle(a.value);
          if (parsed) props.style = parsed;
        } else {
          props[name === 'class' ? 'className' : name] = a.value;
        }
      }
    }
    return props;
  }
  function processNode(node: ChildNode): React.ReactNode | null {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      const segs = renderTextSegment(text, plainCursor);
      plainCursor += text.length;
      return React.createElement(React.Fragment, { key: `fr-${plainCursor}-${nodeSeq++}` }, ...segs);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const children: React.ReactNode[] = [];
    el.childNodes.forEach(child => {
      const c = processNode(child);
      if (c !== null) children.push(c);
    });
    if (tag === 'br') return React.createElement('br', { key: `br-${nodeSeq++}` });
    if (tag === 'p') {
      const props = buildProps(el);
      props.className = ['mb-4 leading-relaxed', props.className].filter(Boolean).join(' ');
      return React.createElement('p', props, ...children);
    }
    if (/^h[1-6]$/.test(tag)) {
      const props = buildProps(el);
      props.className = ['mt-6 mb-4 font-bold', props.className].filter(Boolean).join(' ');
      return React.createElement(tag, props, ...children);
    }
    if (tag === 'div') return React.createElement('div', buildProps(el), ...children);
    if (tag === 'strong' || tag === 'b') return React.createElement(tag, buildProps(el), ...children);
    if (tag === 'em' || tag === 'i') return React.createElement(tag, buildProps(el), ...children);
    if (tag === 'a') {
      const props = buildProps(el);
      const href = el.getAttribute('href') || '';
      // 外链在新标签打开，避免整页 SPA 被跳走
      if (/^https?:\/\//i.test(href) && !props.target) {
        props.target = '_blank';
        props.rel = 'noopener noreferrer';
      }
      return React.createElement('a', props, ...children);
    }
    // 通用兜底：保留安全属性（含 img 的 src/style、svg/image 的 href 等）
    return React.createElement(tag, buildProps(el), ...children);
  }
  tempDiv.childNodes.forEach(child => {
    const c = processNode(child);
    if (c !== null) out.push(c);
  });
  return out;
}
