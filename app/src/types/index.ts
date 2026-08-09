// 文件夹类型
export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  updatedAt?: number;
}

// 支持的语言
export type Language = 'en' | 'fr' | 'de' | 'ja' | 'uk' | 'pl';

// 语言名称映射（共享常量，避免多处重复定义）
export const LANGUAGE_NAMES: Record<Language, { zh: string; en: string; label: string }> = {
  en: { zh: '英语', en: 'English', label: '英文' },
  fr: { zh: '法语', en: 'French', label: '法文' },
  de: { zh: '德语', en: 'German', label: '德文' },
  ja: { zh: '日语', en: 'Japanese', label: '日文' },
  uk: { zh: '乌克兰语', en: 'Ukrainian', label: '乌克兰文' },
  pl: { zh: '波兰语', en: 'Polish', label: '波兰文' },
};


// 书籍类型
export interface Book {
  id: string;
  title: string;
  author?: string;
  cover?: string;
  language: Language;
  format: 'epub' | 'pdf' | 'txt';
  fileData: string; // base64 encoded file data for IndexedDB compatibility
  fileType: string;
  createdAt: number;
  lastReadAt?: number;
  progress?: number;
  currentChapter?: number;
  scrollPosition?: number; // 滚动位置（百分比 0-100）
  totalWords?: number;
  chapters?: Chapter[];
  folderId?: string; // 所属文件夹ID
}

// 章节类型 - 支持多级目录
export interface Chapter {
  id: string;
  title: string;
  index: number;
  href?: string;
  wordCount?: number;
  level?: number; // 层级：0=卷/部，1=章，2=节
  type?: 'volume' | 'part' | 'chapter' | 'frontmatter' | 'section';
  children?: Chapter[]; // 子章节（用于多级导航）
  parentId?: string; // 父章节ID
  isFrontMatter?: boolean; // 是否为卷首内容（前言/版权等）
}

// AI对话消息
export interface AIChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  word?: string; // 关联的单词
}

// 单词标记类型
export interface WordMarker {
  id: string;
  word: string;
  bookId: string;
  chapterId?: string;
  context?: string;
  translation?: string;
  dictionaryDef?: DictionaryDefinition;
  aiExplanation?: string; // 标记单词时 AI 给出的解析（保留在单词本中）
  language: Language; // 单词所属语言
  createdAt: number;
  reviewCount: number;
  lastReviewAt?: number;
  masteryLevel: 0 | 1 | 2 | 3 | 4 | 5; // 0-5 掌握程度
}

// 词典定义类型
export interface DictionaryDefinition {
  word: string;
  phonetic?: string;
  ukPhonetic?: string;
  usPhonetic?: string;
  partOfSpeech?: string;
  definitions: string[];
  examples?: string[];
  audio?: string;
  ukAudio?: string;
  usAudio?: string;
}

// 阅读进度类型
export interface ReadingProgress {
  bookId: string;
  chapterId?: string;
  position: number;
  percentage: number;
  updatedAt: number;
}

// 阅读日历（每日阅读时长记录）
export interface ReadingDay {
  date: string; // YYYY-MM-DD
  minutes: number;
  bookCount: number;
}

// 书签类型
export interface Bookmark {
  id: string; // bookId-chapterIndex-timestamp
  bookId: string;
  chapterIndex: number; // 章节在扁平列表中的索引
  chapterTitle?: string;
  note?: string; // 用户备注
  scrollPosition?: number; // 滚动位置（百分比 0-100）
  createdAt: number;
}

// 文本高亮/下划线类型
export interface Highlight {
  id: string; // bookId-chapterIndex-timestamp
  bookId: string;
  chapterIndex: number;
  chapterId?: string; // 章节ID，用于直接查找内容
  chapterTitle?: string;
  text: string; // 高亮的文本内容
  note?: string; // 用户备注
  color?: string; // 高亮颜色
  type?: 'underline' | 'highlight'; // 下划线 或 高亮（背景色）
  // PDF 模式下记录选中的词索引区间，用于精确定位（避免同页重复文本总匹配第一个）。
  // EPUB/TXT 不使用；旧数据无此字段时回退到文本匹配。
  startIndex?: number;
  endIndex?: number;
  createdAt: number;
}

// 阅读设置
export interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  theme: 'light' | 'dark' | 'sepia';
  fontFamily: string;
}

// 应用状态
export interface AppState {
  currentView: 'library' | 'reader' | 'vocabulary';
  currentBookId?: string;
  readerSettings: ReaderSettings;
}

// 导入书籍表单数据
export interface ImportBookForm {
  title: string;
  author: string;
  language: Language;
  type: 'epub' | 'pdf' | 'txt';
  cover?: string;
}

// EPUB 内容项
export interface EPUBContentItem {
  id: string;
  href: string;
  title?: string;
  content: string;
}

// PDF 页面内容
export interface PDFPageContent {
  pageNum: number;
  text: string;
  textItems: PDFTextItem[];
}

// PDF 文本项（带位置信息）
export interface PDFTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName?: string;
  fontSize?: number;
}

// 渲染内容块
export interface RenderedContent {
  type: 'epub' | 'pdf' | 'txt';
  chapters?: Chapter[];
  currentChapter: number;
  content: string;
  totalPages?: number;
  currentPage?: number;
}
