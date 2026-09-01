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
import { EPUBParser, PDFParser, getBookContent, getFileDataAsBlob } from '@/lib/fileParser';
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
  // 各章节的书籍自带样式表（id -> css），供初始章节/切换章节注入，避免"打开书第一个章节完全没有书籍样式"
  const [cssContents, setCssContents] = useState<Map<string, string>>(new Map());
  // EPUB 渲染模式：'iframe' 用 iframe + 原书完整 CSS 原样渲染（最大化保留原书格式，参考 koodo-reader）；
  // 'react' 用原 React 重建 DOM 渲染（兜底/兼容）。默认 iframe。
  const [epubRenderMode, setEpubRenderMode] = useState<'iframe' | 'react'>('iframe');

  // 单词选择状态
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const selectedSentenceRef = useRef<string>('');
  // PDF 模式下，选中文本时记录词索引区间，供 addHighlight 持久化为 startIndex/endIndex
  const selectedRangeRef = useRef<[number, number] | null>(null);
  const [dictionaryData, setDictionaryData] = useState<DictionaryDefinition | null>(null);
  const [dictLoading, setDictLoading] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  // 脚注/尾注弹层：点击脚注跳转链接时显示脚注正文（隔离 iframe 无法跨文件导航，改为就地弹内容）
  const [footnotePopover, setFootnotePopover] = useState<{ text: string; top: number; left: number } | null>(null);

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
  // PDF 渲染所需的文件载荷：新书籍直接是 Blob；旧书首次打开时在此异步迁移为 Blob（避免 500MB base64 字符串常驻内存）
  const [pdfFileData, setPdfFileData] = useState<string | Blob>(book.fileData);

  // 书籍切换时，将 fileData 规范为 Blob 供 PDF 渲染（旧 base64 书在此一次性迁移）
  useEffect(() => {
    let isMounted = true;
    setPdfFileData(book.fileData);
    if (typeof book.fileData === 'string') {
      getFileDataAsBlob(book).then((blob) => {
        if (isMounted) setPdfFileData(blob);
      }).catch(() => {});
    }
    return () => { isMounted = false; };
  }, [book.id, book.fileData]);

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
      fontFamily: 'Georgia, serif',
      readerMode: 'scroll'
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
  // 待恢复的滚动位置（在组件挂载时从 book.scrollPosition 捕获一次，
  // 避免后续章节切换/进度保存把 DB 里的值覆盖后影响恢复）。
  const pendingRestorePosRef = useRef(book.scrollPosition || 0);
  // 是否已挂载过：用于区分"初次打开"与"切换章节"，切换章节时让新章节从顶部开始。
  const readerMountedRef = useRef(false);
  // 用 ref 保存最新进度，避免闭包陷阱
  const bookProgressRef = useRef(book.progress || 0);
  bookProgressRef.current = book.progress || 0;
  // 用 ref 保存 currentChapter 避免 handleScroll 重建
  const currentChapterRef = useRef(currentChapter);
  currentChapterRef.current = currentChapter;

  // 翻页模式状态
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const pageModeRef = useRef(settings.readerMode === 'page');
  pageModeRef.current = settings.readerMode === 'page';
  const pageContentRef = useRef<HTMLDivElement>(null);
  // 翻页模式下是否已恢复过初始页码（避免章节切换时反复跳回旧位置）
  const pageRestoredRef = useRef(false);

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
  const iframeRef = useRef<HTMLIFrameElement>(null); // EPUB iframe 渲染容器
  const justSelectedRef = useRef(false); // 阻止 onClick 覆盖 onMouseUp 的 selection 状态
  const pendingScrollHighlightRef = useRef<string | null>(null); // 待滚动到的高亮 ID（从侧边栏点击笔记时设置）
  const highlightsRef = useRef<Highlight[]>([]); // iframe 桥接用：始终持有最新高亮列表
  highlightsRef.current = highlights;
  const iframeCleanHtmlRef = useRef(''); // iframe 内"干净内容"基线（load 后捕获，用于重应用高亮/标记）
  const iframeLoadedRef = useRef(false); // iframe 是否已加载完成（协调 marks 效果与 onLoad）

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
    const hlId = pendingScrollHighlightRef.current;
    if (!hlId) return;
    if (epubRenderMode === 'iframe' && book.format === 'epub') {
      // iframe 模式下高亮在 iframe 内，直接操作 contentDocument 滚动到该高亮
      const f = iframeRef.current;
      const doc = f && f.contentDocument;
      const el = doc && doc.querySelector(`[data-highlight-id="${hlId}"]`);
      if (el) (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
      pendingScrollHighlightRef.current = null;
      return;
    }
    if (htmlContentRef.current) {
      const targetEl = htmlContentRef.current.querySelector(`[data-highlight-id="${hlId}"]`);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      pendingScrollHighlightRef.current = null;
    }
  }, [chapterContent, currentChapter, epubRenderMode, book.format]);

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

        const { parser, chapters: loadedChapters, contents: loadedContents, cssContents: loadedCss } = await getBookContent(book);
        
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
        setCssContents(loadedCss);

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
          // 关键修复：初始章节也要同步注入该章节的书籍 CSS，
          // 否则打开书看到的第一个章节完全没有书籍样式（角标/引用/首字下沉等排版全部丢失）。
          setBookCss(loadedCss.get(currentChapterId) || '');
        } else if (flat.length > 0) {
          // 如果当前章节不存在，加载第一章
          const firstChapterId = flat[0].id;
          setChapterContent(loadedContents.get(firstChapterId) || '');
          setBookCss(loadedCss.get(firstChapterId) || '');
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
      if (content.css) {
        console.log(`[Reader] book css length=${content.css.length}, first 200 chars:`, content.css.slice(0, 200));
      } else {
        console.log('[Reader] no book css for chapter', chapter.href);
      }
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
    // iframe 模式下新章节 srcDoc 重新加载，自动回到顶部
    if (epubRenderMode === 'iframe') scrollPosRef.current = 0;
  }, [flatChapters, contents, parser, book.id, onUpdateProgress, loadBookmarks, loadHighlights, epubRenderMode]);

  // ============ EPUB iframe 渲染：父窗口直接操作 iframe.contentDocument ============
  // 不依赖 postMessage / 内联脚本（Tauri CSP 会拦截内联脚本）。所有交互由父窗口
  // 打包 JS 在 iframe onLoad 后直接操作其 contentDocument 完成，彻底绕开 CSP 限制。

  // 章节内容变化时重置 iframe 基线：避免 marks 效果在 iframe 重新加载前，
  // 把上一章的"干净内容"误写回正在切换的新文档。真正的内容捕获/应用由 onLoad 负责。
  useEffect(() => {
    iframeCleanHtmlRef.current = '';
    iframeLoadedRef.current = false;
  }, [chapterContent]);

  // 章节切换时关闭脚注弹层（避免锚点失效后弹层残留错位）
  useEffect(() => { setFootnotePopover(null); }, [currentChapter]);

  // 设置变化：仅更新样式（不重建 innerHTML，保留滚动位置）
  useEffect(() => {
    const f = iframeRef.current;
    const doc = f && f.contentDocument;
    if (!doc || !doc.body) return;
    iframeApplySettings(doc, { fontSize: settings.fontSize, lineHeight: settings.lineHeight, theme: settings.theme, readerMode: settings.readerMode });
  }, [settings.fontSize, settings.lineHeight, settings.theme, settings.readerMode]);

  // 滚动位置保存（防抖，500ms）
  // PDF 模式下不处理滚动（PDF 用翻页而非滚动）
  const handleScroll = useCallback(() => {
    // iframe 渲染模式：滚动发生在 iframe 内部
    if (epubRenderMode === 'iframe' && book.format === 'epub') {
      const f = iframeRef.current;
      if (!f || !f.contentWindow) return;
      const doc = f.contentWindow.document;
      // 翻页模式下滚动容器是 body（overflow:hidden 的横向多列），故用 doc.body；否则用 documentElement
      const el = settings.readerMode === 'page' ? doc.body : (doc.scrollingElement || doc.body);
      // 翻页模式为横向滚动，按 scrollLeft 计算章节内百分比；否则按 scrollTop
      const scrollPercent = settings.readerMode === 'page'
        ? el.scrollLeft / Math.max(1, el.scrollWidth - el.clientWidth)
        : el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
      scrollPosRef.current = Math.round(scrollPercent * 100);
      if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
      scrollSaveTimerRef.current = setTimeout(() => {
        onUpdateProgress(book.id, bookProgressRef.current, currentChapterRef.current, scrollPosRef.current);
      }, 500);
      return;
    }
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
  }, [book.id, book.format, onUpdateProgress, epubRenderMode]);
  // 不依赖 currentChapter（用 ref 代替），避免翻页时重建

  // 恢复滚动位置（只在 EPUB/TXT 非 iframe 模式下，且只执行一次）
  const restoreScrollPosition = useCallback(() => {
    if (book.format === 'pdf') return;
    // 翻页模式下进度以页码形式恢复（见下方章节切换 effect），不走 scrollTop
    if (settings.readerMode === 'page') return;
    // EPUB iframe 模式的滚动发生在 iframe 内部文档，恢复逻辑在 handleIframeLoad 中处理
    if (book.format === 'epub' && epubRenderMode === 'iframe') return;
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

  // ================= 翻页模式（page mode）核心逻辑 =================
  // 测量滚动容器与总页数：横向 CSS columns 下 scrollWidth / clientWidth
  const measurePages = useCallback((): { el: HTMLElement | null; pages: number } => {
    if (book.format === 'pdf') return { el: null, pages: 1 };
    if (epubRenderMode === 'iframe' && book.format === 'epub') {
      const f = iframeRef.current;
      if (!f || !f.contentWindow) return { el: null, pages: 1 };
      const doc = f.contentWindow.document;
      // 翻页模式下 body 才是带 overflow:hidden 的横向多列滚动容器（不是 documentElement），
      // 必须用 doc.body 测量/滚动，否则 window.scrollTo 因 documentElement 无横向溢出而失效。
      const width = doc.body.clientWidth || f.clientWidth;
      const scrollWidth = doc.body.scrollWidth;
      const pages = Math.max(1, Math.round(scrollWidth / Math.max(1, width)));
      return { el: doc.body, pages };
    }
    const el = pageContentRef.current;
    if (!el) return { el: null, pages: 1 };
    const width = el.clientWidth;
    const scrollWidth = el.scrollWidth;
    const pages = Math.max(1, Math.round(scrollWidth / Math.max(1, width)));
    return { el, pages };
  }, [book.format, epubRenderMode]);

  const updateTotalPages = useCallback(() => {
    if (settings.readerMode !== 'page' || book.format === 'pdf') return;
    const { pages } = measurePages();
    setTotalPages(pages);
  }, [settings.readerMode, book.format, measurePages]);

  // 翻页模式下按章节内页码保存进度（复用 scrollPosition 字段存章节内百分比）
  const savePageProgress = useCallback((page: number, pages: number) => {
    const pos = pages > 1 ? Math.round((page / (pages - 1)) * 100) : 0;
    scrollPosRef.current = pos;
    onUpdateProgress(book.id, bookProgressRef.current, currentChapterRef.current, pos);
  }, [book.id, onUpdateProgress]);

  // 跳转到指定页（0-based）
  const goToPage = useCallback((pageIndex: number) => {
    if (settings.readerMode !== 'page' || book.format === 'pdf') return;
    const { el, pages } = measurePages();
    const clamped = Math.max(0, Math.min(pageIndex, Math.max(0, pages - 1)));
    setCurrentPage(clamped);
    if (epubRenderMode === 'iframe' && book.format === 'epub') {
      const f = iframeRef.current;
      if (!f || !f.contentWindow) return;
      const doc = f.contentWindow.document;
      // 翻页模式下滚动容器是 body（overflow:hidden 的横向多列），而非 window/documentElement
      doc.body.scrollTo({ left: clamped * (doc.body.clientWidth || f.clientWidth), behavior: 'smooth' });
    } else if (el) {
      el.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' });
    }
    savePageProgress(clamped, pages);
  }, [settings.readerMode, book.format, epubRenderMode, measurePages, savePageProgress]);

  const nextPage = useCallback(() => {
    if (currentPage >= totalPages - 1) {
      // 最后一页：进入下一章（如果有）
      if (currentChapter < flatChapters.length - 1) {
        changeChapter(currentChapter + 1);
      }
      return;
    }
    goToPage(currentPage + 1);
  }, [currentPage, totalPages, currentChapter, flatChapters.length, goToPage, changeChapter]);

  const prevPage = useCallback(() => {
    if (currentPage <= 0) {
      // 第一页：回到上一章末尾（如果有）
      if (currentChapter > 0) {
        changeChapter(currentChapter - 1);
      }
      return;
    }
    goToPage(currentPage - 1);
  }, [currentPage, currentChapter, goToPage, changeChapter]);

  // 键盘翻页
  useEffect(() => {
    if (settings.readerMode !== 'page' || book.format === 'pdf') return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        nextPage();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        prevPage();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [settings.readerMode, book.format, nextPage, prevPage]);

  // 章节切换时重置到第 0 页；内容/窗口尺寸变化后重新测量页数；初次打开时恢复上次页码
  useEffect(() => {
    setCurrentPage(0);
    // 延迟测量，等待渲染完成
    const t1 = setTimeout(() => {
      updateTotalPages();
      // 初次打开（仅一次）根据保存的章节内百分比恢复页码
      if (!pageRestoredRef.current && pendingRestorePosRef.current > 0) {
        const { el, pages } = measurePages();
        const page = Math.min(
          Math.max(0, pages - 1),
          Math.round((pendingRestorePosRef.current / 100) * Math.max(0, pages - 1))
        );
        if (page > 0) {
          setCurrentPage(page);
          if (epubRenderMode === 'iframe' && book.format === 'epub') {
            const f = iframeRef.current;
            if (f?.contentWindow) f.contentWindow.document.body.scrollTo({ left: page * (f.contentWindow.document.body.clientWidth || f.clientWidth) });
          } else if (el) {
            el.scrollTo({ left: page * el.clientWidth });
          }
        }
        pageRestoredRef.current = true;
      }
    }, 150);
    const t2 = setTimeout(() => updateTotalPages(), 600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [currentChapter, chapterContent, settings.readerMode, updateTotalPages, measurePages]);

  useEffect(() => {
    const handleResize = () => { updateTotalPages(); };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateTotalPages]);

  // 用 ref 保存关键 state，避免 onClick 闭包引用过期值
  const flatChaptersRef = useRef(flatChapters);
  flatChaptersRef.current = flatChapters;
  const contentsRef = useRef(contents);
  contentsRef.current = contents;
  const parserRef = useRef(parser);
  parserRef.current = parser;
  // 当前章节的 EPUB 内路径（相对 OPF 目录），供脚注跨文件解析用，避免闭包过期
  const currentChapterHrefRef = useRef('');
  currentChapterHrefRef.current = (flatChapters[currentChapter] && flatChapters[currentChapter].href) || '';

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
    // 链接（脚注/尾注/交叉引用）：阻止默认导航，避免主窗口/EPUB 内容被带走到不存在的 href。
    // 脚注类链接改为"就地弹脚注内容"（同文档直接定位；跨文件经 parser 解析）。其余内部链接仅阻止导航。
    const anchorEl = target.closest('a') as HTMLAnchorElement | null;
    if (anchorEl && anchorEl.getAttribute('href')) {
      e.preventDefault();
      const href = anchorEl.getAttribute('href') || '';
      if (iframeIsFootnoteRef(anchorEl)) {
        void showFootnotePopover(document, anchorEl, href);
      }
      return;
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

  // 标记/高亮变化：重建内容并重新应用（保留滚动位置）。
  useEffect(() => {
    const f = iframeRef.current;
    const doc = f && f.contentDocument;
    if (!doc || !doc.body || !iframeLoadedRef.current) return;
    const prevY = doc.scrollingElement ? (doc.scrollingElement as HTMLElement).scrollTop : 0;
    iframeApplyAll(doc, iframeCleanHtmlRef.current, { fontSize: settings.fontSize, lineHeight: settings.lineHeight, theme: settings.theme }, markedWords, currentChapterHighlights.map(h => ({ id: h.id, text: h.text, note: h.note })));
    try { if (doc.scrollingElement) (doc.scrollingElement as HTMLElement).scrollTop = prevY; } catch (err) { /* ignore */ }
  }, [markedWords, currentChapterHighlights]);

  // ===== EPUB iframe 交互（父窗口直接操作 iframe.contentDocument，绕开 CSP 内联限制）=====
  // 用 ref 持有最新的 handleWordClick，避免 iframe 内绑定事件后闭包过期读到旧的 book.language / hasAiKey。
  const handleWordClickRef = useRef(handleWordClick);
  handleWordClickRef.current = handleWordClick;

  // iframe 内"单击"：优先命中高亮（弹笔记），否则按坐标取词查词。
  // 注：在 iframe 文档上监听，事件 target/clientX 都属于 iframe 坐标系，与父窗口无关。
  // 点击脚注/尾注跳转链接：解析脚注正文并以弹层显示（隔离 iframe 无法跨文件导航，改为就地弹内容）。
  const showFootnotePopover = useCallback(async (doc: Document, anchorEl: HTMLAnchorElement, href: string) => {
    const hashIdx = href.indexOf('#');
    const fragment = hashIdx >= 0 ? href.slice(hashIdx + 1) : '';
    if (!fragment) return;
    const filePart = hashIdx >= 0 ? href.slice(0, hashIdx).trim() : href.trim();
    let text: string | null = null;
    if (!filePart) {
      // 同文档锚点：用 resolveFootnoteElement 定位，因为精确 id 有时命中纯编号的 <a>，需向上找正文容器
      const el = resolveFootnoteElement(doc, fragment);
      if (el) text = extractFootnoteText(el);
    } else {
      // 跨文件：读取目标 xhtml 原文并按 id 定位脚注（EPUB 多把全书脚注集中放 notes.xhtml）
      const parser = parserRef.current as any;
      const base = currentChapterHrefRef.current;
      if (parser && typeof parser.getResourceRaw === 'function') {
        const raw = await parser.getResourceRaw(href, base);
        if (raw) {
          try {
            const parsed = new DOMParser().parseFromString(raw, 'text/html');
            const el = resolveFootnoteElement(parsed, fragment);
            if (el) text = extractFootnoteText(el);
          } catch (_) { /* ignore */ }
        }
      }
    }
    if (!text) return;
    // 弹层位置：iframe 内坐标 + iframe 在父窗口的位置（均为 viewport 相对，配合 position: fixed）
    const aRect = anchorEl.getBoundingClientRect();
    const fRect = iframeRef.current ? iframeRef.current.getBoundingClientRect() : null;
    const baseTop = fRect ? fRect.top : 0;
    const baseLeft = fRect ? fRect.left : 0;
    let top = baseTop + aRect.top + aRect.height + 6;
    let left = baseLeft + aRect.left;
    left = Math.min(left, window.innerWidth - 340);
    left = Math.max(8, left);
    setFootnotePopover({ text, top, left });
  }, []);

  const onIframeClick = useCallback((e: Event) => {
    const f = iframeRef.current;
    const doc = f && f.contentDocument;
    if (!doc || !doc.body) return;
    // 与父窗口一致：mouseup 刚选过文本时，click 直接跳过取词（避免选区被当成单词）
    if (justSelectedRef.current) { justSelectedRef.current = false; return; }
    const target = e.target as HTMLElement | null;
    const highlightEl = target && target.closest ? (target.closest('[data-highlight-id]') as HTMLElement | null) : null;
    if (highlightEl) {
      const hlId = highlightEl.getAttribute('data-highlight-id');
      if (hlId) {
        const hl = highlightsRef.current.find(h => h.id === hlId);
        if (hl) {
          setActiveHighlight(hl);
          setNoteDraft(hl.note || '');
          setSidebarMode('highlightNote');
          setShowSidebar(true);
          return;
        }
      }
    }
    // 链接（脚注/尾注/交叉引用跳转）：隔离 iframe 解析不了 EPUB 内部链接，
    // 不阻止默认行为会让 iframe 导航到不存在的 href → 整页黑屏。
    // 处理：一律 preventDefault；脚注类链接改为"就地弹脚注内容"（跨文件也能解析），
    // 其余内部链接仅阻止导航、不跳转。
    const anchorEl = target && target.closest ? (target.closest('a') as HTMLAnchorElement | null) : null;
    if (anchorEl && anchorEl.getAttribute('href')) {
      e.preventDefault();
      const href = anchorEl.getAttribute('href') || '';
      if (iframeIsFootnoteRef(anchorEl)) {
        void showFootnotePopover(doc, anchorEl, href);
      }
      return;
    }
    const me = e as MouseEvent;
    const info = iframeGetWordInfo(doc, me.clientX, me.clientY);
    if (info && info.word && info.word.length >= 2) {
      handleWordClickRef.current(info.word, info.sentence || undefined);
    }
  }, [showFootnotePopover]);

  // iframe 内"选词"：用户框选文本后弹出操作面板（解析/下划线/笔记）。
  const onIframeMouseup = useCallback(() => {
    const f = iframeRef.current;
    const doc = f && f.contentDocument;
    if (!doc) return;
    const sel = doc.getSelection ? doc.getSelection() : null;
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

  // iframe 加载完成：捕获干净内容基线 + 应用设置/标记/高亮/脚注 + 绑定交互事件。
  // 这是方案 B 的核心——全部由父窗口（打包 JS）在 onLoad 后操作 contentDocument，
  // 不再依赖被 CSP 拦截的 iframe 内联 <script>。
  const handleIframeLoad = useCallback(() => {
    const f = iframeRef.current;
    const doc = f && f.contentDocument;
    if (!doc || !doc.body) return;
    // 捕获干净内容基线（每次 load 都是全新文档，body 即未注入任何标记/高亮的原始渲染）
    iframeCleanHtmlRef.current = doc.body.innerHTML;
    iframeLoadedRef.current = true;
    iframeApplyAll(doc, iframeCleanHtmlRef.current, {
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      theme: settings.theme,
      readerMode: settings.readerMode,
    }, markedWords, currentChapterHighlights.map(h => ({ id: h.id, text: h.text, note: h.note })));
    // 绑定交互事件（在 iframe 文档上，绕开 CSP 内联脚本限制）
    doc.body.addEventListener('click', onIframeClick as EventListener);
    doc.body.addEventListener('mouseup', onIframeMouseup as EventListener);
    // 绑定滚动监听：iframe 内部滚动不会冒泡到父级 <main>（其 overflow-hidden），
    // 必须直接监听 iframe 自身的 window，否则滚动位置永远无法捕获/保存。
    if (f.contentWindow) {
      f.contentWindow.addEventListener('scroll', handleScroll, { passive: true });
    }
    // 恢复上次阅读位置：iframe 内部滚动需直接操作 iframe 文档的 scrollingElement。
    // 使用 pendingRestorePosRef（挂载时捕获的 DB 值），避免被后续进度保存覆盖。
    const savedPos = pendingRestorePosRef.current;
    if (!readerMountedRef.current) {
      // 初次打开：标记已挂载，后续章节切换不再视为"初次"
      readerMountedRef.current = true;
    } else {
      // 章节切换：新章节从顶部开始，不沿用上一章的残留位置
      pendingRestorePosRef.current = 0;
    }
    if (savedPos > 0) {
      requestAnimationFrame(() => {
        // 翻页模式下滚动容器是 body（overflow:hidden 的横向多列），故用它恢复横向位置
        const scEl = settings.readerMode === 'page' ? doc.body : (doc.scrollingElement || doc.body);
        if (settings.readerMode === 'page') {
          const max = Math.max(1, scEl.scrollWidth - scEl.clientWidth);
          scEl.scrollLeft = (savedPos / 100) * max;
        } else {
          const max = Math.max(1, scEl.scrollHeight - scEl.clientHeight);
          scEl.scrollTop = (savedPos / 100) * max;
        }
      });
    }
    // 翻页模式下文档布局完成后再测量一次总页数（onLoad 时列布局可能尚未稳定）
    if (settings.readerMode === 'page') {
      setTimeout(() => updateTotalPages(), 200);
    }
  }, [settings.fontSize, settings.lineHeight, settings.theme, settings.readerMode, markedWords, currentChapterHighlights, onIframeClick, onIframeMouseup, handleScroll, updateTotalPages]);

  // 渲染内容区域 — 普通函数，不需要 useCallback（每次渲染直接调用）
  const renderContent = () => {
    if (book.format === 'pdf') {
      return (
        <div className="py-6">
          <PDFCanvasViewer
            fileData={pdfFileData}
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

  // EPUB iframe 模式：把整章（图片已内联 base64 + 书籍完整 CSS 原样）塞进隔离 iframe，
  // 原书排版 100% 保留。查词/划词/高亮/脚注**不**走 iframe 内脚本——Tauri CSP 的
  // script-src 没有 'unsafe-inline'，内联脚本会被拦截（这正是 f144b45 那版"打不开"的根因）。
  // 方案 B：srcDoc 只注入样式与正文，所有交互由父窗口在 iframe onLoad 后直接操作其
  // contentDocument 完成（设置变化经父窗口 effect 直接改样式，避免重建 iframe 丢滚动）。
  const epubSrcDoc = useMemo(() => {
    if (book.format !== 'epub' || epubRenderMode !== 'iframe' || !chapterContent) return '';
    return buildSrcDoc(chapterContent, bookCss, {
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      theme: settings.theme,
      readerMode: settings.readerMode,
    });
  }, [book.format, epubRenderMode, chapterContent, bookCss]);

  const renderIframeContent = () => {
    if (!chapterContent) {
      return (
        <div className="text-center py-20">
          <p className="opacity-60">本章内容为空</p>
        </div>
      );
    }
    return (
      <iframe
        ref={iframeRef}
        srcDoc={epubSrcDoc}
        title="book-content"
        onLoad={handleIframeLoad}
        className="w-full h-full border-0 bg-transparent"
      />
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

              {/* 阅读模式：滑动 / 翻页 */}
              <div className="flex items-center gap-2">
                <span className="text-sm opacity-80">翻页</span>
                <div className="flex items-center bg-current/5 rounded-lg p-0.5 border border-current/10">
                  <button
                    onClick={() => setSettings(s => ({ ...s, readerMode: 'scroll' }))}
                    className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                      settings.readerMode !== 'page'
                        ? 'bg-[#e5a349] text-white shadow-sm'
                        : 'text-current/70 hover:bg-current/10'
                    }`}
                    title="连续滑动"
                  >
                    滑动
                  </button>
                  <button
                    onClick={() => setSettings(s => ({ ...s, readerMode: 'page' }))}
                    className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                      settings.readerMode === 'page'
                        ? 'bg-[#e5a349] text-white shadow-sm'
                        : 'text-current/70 hover:bg-current/10'
                    }`}
                    title="分页翻页"
                  >
                    翻页
                  </button>
                </div>
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
                              if (content.css) {
                                console.log(`[Reader] book css length=${content.css.length}, first 200 chars:`, content.css.slice(0, 200));
                              } else {
                                console.log('[Reader] no book css for chapter', latestFlatChapters[idx].href);
                              }
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
          className={`flex-1 h-[calc(100vh-64px)] relative ${
            (book.format === 'pdf' || (book.format === 'epub' && epubRenderMode === 'iframe') || settings.readerMode === 'page')
              ? 'overflow-hidden'
              : 'overflow-y-auto'
          } ${showSidebar && book.format !== 'pdf' ? 'lg:mr-[400px] transition-[margin] duration-300' : ''}`}
        >
          {book.format === 'epub' && epubRenderMode === 'iframe' ? (
            <div className="flex flex-col h-full">
              <div className="flex-1 min-h-0">
                {renderIframeContent()}
              </div>
              {/* Chapter Navigation Footer — 翻页模式下改由底部浮动页码条接管 */}
              {settings.readerMode !== 'page' && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-current/10">
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
          ) : (
            <div
              ref={pageContentRef}
              className={book.format === 'pdf'
                ? ''
                : settings.readerMode === 'page'
                  ? 'h-full w-full reader-page-columns pb-20'
                  : 'max-w-3xl mx-auto py-10 px-6 lg:px-10'}
              style={book.format === 'pdf'
                ? undefined
                : settings.readerMode === 'page'
                  ? {
                      fontSize: settings.fontSize,
                      lineHeight: settings.lineHeight,
                      fontFamily: settings.fontFamily,
                      columnWidth: '100%',
                      columnGap: 0,
                      columnFill: 'auto',
                      overflow: 'hidden'
                    }
                  : {
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

              {/* Chapter Navigation Footer (EPUB/TXT only) — 翻页模式下改由底部浮动页码条接管 */}
              {book.format !== 'pdf' && settings.readerMode !== 'page' && (
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
          )}

          {/* 翻页模式：底部浮动页码导航（滑动/PDF 模式不显示） */}
          {settings.readerMode === 'page' && book.format !== 'pdf' && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 px-2 py-1.5 rounded-full bg-black/65 text-white shadow-lg backdrop-blur-sm">
              <Button
                variant="ghost"
                onClick={prevPage}
                disabled={currentPage <= 0 && currentChapter <= 0}
                className="text-white hover:bg-white/15 disabled:opacity-30 px-2.5"
              >
                <ChevronLeft className="w-4 h-4" />
                上一页
              </Button>
              <span className="text-sm whitespace-nowrap px-1.5 tabular-nums">
                第 {Math.min(currentPage + 1, totalPages)} / {totalPages} 页
                <span className="opacity-60 mx-1.5">·</span>
                第 {currentChapter + 1}/{flatChapters.length} 章
              </span>
              <Button
                variant="ghost"
                onClick={nextPage}
                disabled={currentPage >= totalPages - 1 && currentChapter >= flatChapters.length - 1}
                className="text-white hover:bg-white/15 disabled:opacity-30 px-2.5"
              >
                下一页
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
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
                      {dictionaryData?.lemma && dictionaryData.lemma !== selectedWord.toLowerCase() && (
                        <p className="text-sm opacity-60 mt-1">原形：{dictionaryData.lemma}</p>
                      )}
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

      {/* 脚注/尾注弹层：点击脚注跳转链接时显示脚注正文（隔离 iframe 无法跨文件导航，改为就地弹内容） */}
      {footnotePopover && (
        <>
          <div
            onClick={() => setFootnotePopover(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 90 }}
          />
          <div
            className="footnote-popover"
            style={{
              position: 'fixed',
              top: footnotePopover.top,
              left: footnotePopover.left,
              zIndex: 91,
              maxWidth: 360,
              maxHeight: 'min(42vh, 360px)',
              overflowY: 'auto',
              background: settings.theme === 'dark' ? '#26282b' : '#fffdf7',
              color: settings.theme === 'dark' ? '#e0e0e0' : '#2c2c2c',
              border: '1px solid rgba(229,163,73,0.6)',
              borderRadius: 10,
              padding: '12px 14px 14px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
              fontSize: Math.max(12, settings.fontSize * 0.78),
              lineHeight: 1.7,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
                paddingBottom: 6,
                borderBottom: `1px solid ${settings.theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
              }}
            >
              <span style={{ fontSize: 11, opacity: 0.55, letterSpacing: 1.2, fontWeight: 500 }}>脚注</span>
              <button
                onClick={() => setFootnotePopover(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, opacity: 0.5, padding: '0 2px' }}
                aria-label="关闭"
              >×</button>
            </div>
            <div
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflowWrap: 'break-word',
              }}
            >
              {footnotePopover.text}
            </div>
          </div>
        </>
      )}
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
  // 去掉移除 html/body 后留下的前导组合符（如 "html > body a" → "> a"）
  while (/^[>+~\s]/.test(s)) {
    s = s.replace(/^[>+~\s]+/, '').replace(/\s{2,}/g, ' ').trim();
  }
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
        const scoped = splitSelectors(prelude)
          .map(s => scopeSelector(s.trim(), scope))
          .filter(Boolean)
          .join(', ');
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

function splitSelectors(prelude: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of prelude) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

// ============ EPUB iframe 渲染（参考 koodo-reader：iframe + 原书完整 CSS 原样渲染，最大化保留原书格式） ============
// 关键思路：把整章（图片已内联 base64、书籍全部 CSS 原样）塞进一个隔离的 iframe，
// 不再经过 scopeCss 字符串重写、也不经 React 重建 DOM——因此角标/引用/首字下沉/表格/图文混排等
// 原书排版 100% 保留。查词/划词/高亮/脚注**不**走 iframe 内脚本（会被 Tauri CSP 拦截），
// 而由父窗口在 iframe onLoad 后直接操作其 contentDocument 完成（见下方 iframeApplySettings 等）。

// 阅读器基础排版（注入 iframe head，作用在隔离文档内，无需 scope 前缀）
const READER_BASE_CSS = `
* { box-sizing: border-box; }
html { font-size: 18px; }
body { margin: 0; padding: 0; }
.reader-html-content {
  font-size: var(--reader-font, 18px);
  line-height: var(--reader-line, 1.6);
  padding: 2rem 2.2rem 4rem;
  max-width: 44rem;
  margin: 0 auto;
  font-family: 'Bricolage Grotesque', Georgia, 'Times New Roman', serif;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
/* 翻页模式：横向多列分页，父窗口按 clientWidth 步进滚动 */
.reader-html-content.reader-page-mode {
  height: 100vh;
  max-width: none;
  margin: 0;
  /* 仅保留纵向内边距（底部留出浮动页码条空间）；横向必须为 0，
     否则列宽 = clientWidth - 横向 padding，与按 clientWidth 步进翻页错位 */
  padding: 2.5rem 0 5rem;
  overflow: hidden;
  column-width: 100vw;
  column-gap: 0;
  column-fill: auto;
}
.reader-theme-light { background: #f5f2e9; color: #2c2c2c; }
.reader-theme-dark { background: #1a1c1f; color: #e0e0e0; }
.reader-theme-sepia { background: #f4ecd8; color: #5b4636; }
.reader-html-content p { margin: 0 0 1.25em; text-align: justify; }
.reader-html-content h1, .reader-html-content h2, .reader-html-content h3,
.reader-html-content h4, .reader-html-content h5, .reader-html-content h6 {
  margin: 1.5em 0 0.75em; font-weight: 700; line-height: 1.3;
}
.reader-html-content h1 { font-size: 1.8em; }
.reader-html-content h2 { font-size: 1.5em; }
.reader-html-content h3 { font-size: 1.3em; }
.reader-html-content h4 { font-size: 1.15em; }
.reader-html-content img { max-width: 100%; height: auto; display: block; margin: 1.5em auto; border-radius: 8px; }
.reader-html-content figure { margin: 1.5em 0; text-align: center; }
.reader-html-content figcaption { font-size: 0.85em; opacity: 0.7; margin-top: 0.5em; }
.reader-html-content blockquote { margin: 1.5em 0; padding-left: 1.5em; border-left: 3px solid currentColor; opacity: 0.85; font-style: italic; }
.reader-html-content pre { margin: 1.5em 0; padding: 1em; border-radius: 8px; overflow-x: auto; font-size: 0.9em; line-height: 1.5; background: rgba(128,128,128,0.1); }
.reader-html-content code { font-size: 0.9em; padding: 0.1em 0.3em; border-radius: 3px; background: rgba(128,128,128,0.15); }
.reader-html-content ul, .reader-html-content ol { margin: 1em 0; padding-left: 2em; }
.reader-html-content li { margin-bottom: 0.5em; }
.reader-html-content table { width: 100%; border-collapse: collapse; margin: 1.5em 0; }
.reader-html-content th, .reader-html-content td { padding: 0.5em 0.75em; border: 1px solid rgba(128,128,128,0.3); text-align: left; }
.reader-html-content th { font-weight: 600; background: rgba(128,128,128,0.1); }
.reader-html-content hr { margin: 2em 0; border: none; border-top: 1px solid rgba(128,128,128,0.3); }
.reader-html-content a { color: #e5a349; text-decoration: underline; cursor: pointer; }
.reader-html-content a:hover { opacity: 0.8; }
.reader-html-content sup, .reader-html-content sub { font-size: 0.65em !important; line-height: 0 !important; }
.reader-html-content sup { vertical-align: super !important; }
.reader-html-content sub { vertical-align: sub !important; }

/* 兜底：常见 EPUB 脚注/尾注/引用角标，即使书籍 CSS 把它们 reset 成正文也要保持上标小字号 */
.reader-html-content a[epub\:type~="noteref"],
.reader-html-content a[epub\:type~="noteback"],
.reader-html-content a[epub\:type~="referrer"],
.reader-html-content .noteref,
.reader-html-content .noteRef,
.reader-html-content .noteback,
.reader-html-content .footnote-ref,
.reader-html-content .endnote-ref,
.reader-html-content .note-ref,
.reader-html-content .fn,
.reader-html-content .fnref,
.reader-html-content .fn-ref,
.reader-html-content .pgk-fn,
.reader-html-content .reference,
.reader-html-content .ref,
.reader-html-content .cite,
.reader-html-content .en,
.reader-html-content .calibre_4,
.reader-html-content .calibre_5,
.reader-html-content .calibre_6,
.reader-html-content .reader-force-sup,
.reader-html-content .reader-force-sup * {
  vertical-align: super !important;
  font-size: 0.65em !important;
  line-height: 0 !important;
}
.reader-html-content center { text-align: center; }
.reader-html-content .epub-image, .reader-html-content .illustration { max-width: 100%; height: auto; margin: 1.5em auto; display: block; }
.reader-html-content mark, .reader-html-content .vocab-mark {
  background: rgba(229,163,73,0.3) !important;
  border-bottom: 2px solid #e5a349 !important;
  padding: 0 2px !important;
  border-radius: 2px !important;
  cursor: pointer !important;
  color: inherit !important;
}
.reader-html-content .user-highlight {
  background: rgba(99,179,237,0.28) !important;
  border-bottom: 2px solid #63b3ed !important;
  cursor: pointer !important;
  color: inherit !important;
}
.reader-theme-dark .reader-html-content a { color: #e5a349; }
.reader-theme-sepia .reader-html-content a { color: #8b6914; }
.reader-theme-light .reader-html-content a { color: #c47a1a; }
`;

// ============ EPUB iframe 渲染：父窗口直接操作 iframe.contentDocument ============
// 说明：Tauri CSP 的 script-src 没有 'unsafe-inline'，iframe srcDoc 内的内联 <script>
// 会被拦截而不执行，导致之前"查词/高亮/脚注识别全部失效、书打不开"。方案 B：把交互
// 逻辑从内联脚本改为父窗口（打包 JS，来源 'self'，不受内联限制）在 iframe onLoad 后
// 直接操作其 contentDocument，注入样式、绑定事件、应用高亮/标记/脚注，彻底绕开 CSP。

type IframeSettings = { fontSize: number; lineHeight: number; theme: string; readerMode?: 'scroll' | 'page' };
type IframeHighlight = { id: string; text: string; note?: string };

function iframeApplySettings(doc: Document, s: IframeSettings) {
  doc.documentElement.style.setProperty('--reader-font', s.fontSize + 'px');
  doc.documentElement.style.setProperty('--reader-line', String(s.lineHeight));
  doc.body.className = 'reader-html-content reader-theme-' + s.theme + (s.readerMode === 'page' ? ' reader-page-mode' : '');
}
function iframeCleanWord(w: string, isPhrase: boolean): string {
  if (isPhrase) return w.trim().replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
  return w.replace(/[\p{P}\p{S}]/gu, '');
}

function iframeGetSentence(block: HTMLElement, raw: string): string {
  const full = block ? (block.textContent || '') : '';
  const idx = full.toLowerCase().indexOf(raw.toLowerCase());
  if (idx < 0) return '';
  let s = idx; while (s > 0 && !/[.!?。！？\n]/.test(full[s - 1])) s--;
  let e = idx + raw.length; while (e < full.length && !/[.!?。！？\n]/.test(full[e])) e++;
  return full.slice(s, e).trim();
}
function iframeGetWordInfo(doc: Document, x: number, y: number): { word: string; sentence: string } | null {
  let range: any = null;
  const anyDoc = doc as any;
  if (anyDoc.caretRangeFromPoint) range = anyDoc.caretRangeFromPoint(x, y);
  else if (anyDoc.caretPositionFromPoint) { const cp = anyDoc.caretPositionFromPoint(x, y); if (cp) { range = doc.createRange(); range.setStart(cp.offsetNode, cp.offset); range.collapse(true); } }
  if (!range) return null;
  const node: any = range.startContainer;
  if (node.nodeType !== 3) {
    const el = node.nodeType === 1 ? node : node.parentNode;
    const txt = el && el.textContent ? el.textContent.trim() : '';
    if (txt) { const w = iframeCleanWord(txt, txt.indexOf(' ') > 0); if (w.length >= 2) return { word: w, sentence: iframeGetSentence(el as HTMLElement, txt) }; }
    return null;
  }
  const text = node.nodeValue; const off = range.startOffset;
  let st = off, en = off;
  while (st > 0 && /[\p{L}\p{M}\p{Pd}’']/u.test(text[st - 1])) st--;
  while (en < text.length && /[\p{L}\p{M}\p{Pd}’']/u.test(text[en])) en++;
  const raw = text.slice(st, en); if (!raw) return null;
  const word = iframeCleanWord(raw, raw.indexOf(' ') > 0); if (word.length < 2) return null;
  return { word, sentence: iframeGetSentence(node.parentNode as HTMLElement, raw) };
}
// 判断一个 <a> 是否为脚注/尾注/交叉引用跳转（用于上标样式与"点击弹脚注"）。
function iframeIsFootnoteRef(a: Element): boolean {
  const href = (a.getAttribute('href') || '').toLowerCase();
  const epubType = (a.getAttribute('epub:type') || '').toLowerCase();
  const id = (a.getAttribute('id') || '').toLowerCase();
  const cls = (' ' + (a.getAttribute('class') || '') + ' ').toLowerCase();
  const txt = (a.textContent || '').trim();
  const reNote = /noteref|noteback|referrer|note-ref|footnote|endnote|\bfn\b/;
  const isNoteRef = reNote.test(epubType + ' ' + href + ' ' + id + ' ' + cls);
  const looksLikeNumber = /^[\[\(]?\d+[\]\)]?$/.test(txt);
  return isNoteRef || (looksLikeNumber && /#/.test(href) && /note|fn|back/.test(href));
}
// 提取脚注正文文本：去掉脚注内的"返回正文"链接，合并空白。
function extractFootnoteText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('a').forEach(a => a.remove());
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}
// 按 id 找脚注元素：若精确命中元素文本很短（只有编号），则向上查找块容器（li/p/div/aside/section），
// 因为 EPUB 常见结构是 <li id="note4"><a>4</a> 正文……</li>，精确 id 可能只是 <a> 标记本身。
function resolveFootnoteElement(doc: Document, fragment: string): Element | null {
  let el = doc.getElementById(fragment);
  if (!el) {
    const variants = [
      fragment.replace(/^note/i, 'ftn'),
      fragment.replace(/^ftn/i, 'note'),
      fragment.replace(/^fn/i, 'note'),
      fragment + '-note',
      fragment.replace(/-rtn$/, ''),
      fragment.replace(/_rtn$/, ''),
    ];
    for (const v of variants) { if (v !== fragment) { el = doc.getElementById(v); if (el) break; } }
  }
  if (!el) return null;
  const baseText = extractFootnoteText(el);
  // 若精确元素文本很短（像纯编号），向上找包含更多正文的块级容器，但止步于 body
  if (baseText.length <= 5) {
    let p: Element | null = el;
    while (p && p !== doc.body) {
      p = p.parentElement;
      if (!p || p === doc.body) break;
      const t = extractFootnoteText(p);
      if (t.length > baseText.length + 5) {
        return p;
      }
    }
  }
  return el;
}
function iframeMarkFootnoteRefs(doc: Document) {
  const as = doc.querySelectorAll('a');
  for (let i = 0; i < as.length; i++) {
    const a = as[i] as HTMLElement;
    if (a.classList.contains('reader-force-sup')) continue;
    if (iframeIsFootnoteRef(a)) a.classList.add('reader-force-sup');
  }
}
function iframeApplyMarks(doc: Document, wordsSet: Set<string>) {
  if (!wordsSet || !wordsSet.size) return;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(n: any) {
      if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const p = n.parentNode; if (p && (p.tagName === 'SCRIPT' || p.tagName === 'STYLE')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes: any[] = []; let n: any; while (n = walker.nextNode()) nodes.push(n);
  for (const node of nodes) {
    const text = node.nodeValue;
    const parts = text.split(/([^\p{L}\p{M}\u2010-\u2015']+)/gu);
    const frag = doc.createDocumentFragment(); let changed = false;
    for (const part of parts) {
      if (!part) continue;
      if (/[\p{L}\p{M}]/u.test(part)) {
        const clean = part.replace(/[\p{P}\p{S}]/gu, '').toLowerCase();
        if (clean && wordsSet.has(clean) && clean.length >= 2) {
          const m = doc.createElement('mark'); m.className = 'vocab-mark'; m.textContent = part; frag.appendChild(m); changed = true; continue;
        }
      }
      frag.appendChild(doc.createTextNode(part));
    }
    if (changed) node.parentNode.replaceChild(frag, node);
  }
}
function iframeApplyHighlights(doc: Document, list: IframeHighlight[]) {
  if (!list || !list.length) return;
  const items = list.slice().sort((a, b) => b.text.length - a.text.length);
  for (const it of items) {
    if (!it.text) continue;
    const t = it.text;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n: any) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = n.parentNode; if (p && (p.tagName === 'SCRIPT' || p.tagName === 'STYLE' || (p.closest && p.closest('[data-highlight-id]')))) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes: any[] = []; let nd: any; while (nd = walker.nextNode()) nodes.push(nd);
    for (const node of nodes) {
      const text = node.nodeValue; let from = 0; const frag = doc.createDocumentFragment();
      while (true) {
        const idx = text.indexOf(t, from); if (idx < 0) { frag.appendChild(doc.createTextNode(text.slice(from))); break; }
        if (idx > from) frag.appendChild(doc.createTextNode(text.slice(from, idx)));
        const span = doc.createElement('span'); span.setAttribute('data-highlight-id', it.id); span.className = 'user-highlight'; span.textContent = text.slice(idx, idx + t.length); frag.appendChild(span); from = idx + t.length;
      }
      node.parentNode.replaceChild(frag, node);
    }
  }
}

// 应用"结构"（设置/标记词/脚注上标）并应用高亮。
function iframeApplyAll(doc: Document, cleanHtml: string, s: IframeSettings, wordsSet: Set<string>, list: IframeHighlight[]) {
  doc.body.innerHTML = cleanHtml;
  iframeApplySettings(doc, s);
  iframeApplyMarks(doc, wordsSet);
  iframeApplyHighlights(doc, list);
  iframeMarkFootnoteRefs(doc);
}

function buildSrcDoc(
  content: string,
  bookCss: string,
  settings: { fontSize: number; lineHeight: number; theme: string; readerMode?: 'scroll' | 'page' },
): string {
  const themeClass = `reader-theme-${settings.theme}`;
  const pageClass = settings.readerMode === 'page' ? ' reader-page-mode' : '';
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${bookCss || ''}</style>
<style>${READER_BASE_CSS}</style>
</head>
<body class="reader-html-content ${themeClass}${pageClass}">
${content}
</body>
</html>`;
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
