import type { DictionaryDefinition, Language } from '@/types';
import { lemmatize } from './lemmatize';

// Merriam-Webster Learner's Dictionary API（英文在线词典）
const MW_BASE_URL = 'https://www.dictionaryapi.com/api/v3/references/learners/json';
// Key 从环境变量读取（见 .env.example），避免明文写入源码 / git 历史
const MW_API_KEY = import.meta.env.VITE_MW_API_KEY ?? '';

// 本地词典条目通用接口
interface LocalDictEntry {
  word: string;
  phonetic?: string;
  partOfSpeech: string;
  definitions: string[];
  examples?: string[];
  reading?: string; // 日语特有
}

// 词典配置加载器（按需动态 import）
const DICT_LOADERS: Record<string, () => Promise<{
  lookup: (word: string) => LocalDictEntry | undefined;
  dict: Record<string, LocalDictEntry>;
  getPhonetic: (e: LocalDictEntry) => string | undefined;
  matchKey: (key: string, word: string) => boolean;
}>> = {
  fr: async () => {
    const m = await import('./frenchDictionary');
    return {
      lookup: m.getFrenchDefinition,
      dict: m.frenchDictionary,
      getPhonetic: (e: LocalDictEntry) => e.phonetic,
      matchKey: (key: string, word: string) => key === word,
    };
  },
  de: async () => {
    const m = await import('./germanDictionary');
    return {
      lookup: m.getGermanDefinition,
      dict: m.germanDictionary,
      getPhonetic: (e: LocalDictEntry) => e.phonetic,
      matchKey: (key: string, word: string) => key === word,
    };
  },
  ja: async () => {
    const m = await import('./japaneseDictionary');
    return {
      lookup: m.getJapaneseDefinition,
      dict: m.japaneseDictionary,
      getPhonetic: (e: LocalDictEntry) => e.phonetic || e.reading || undefined,
      matchKey: (key: string, word: string) => key === word,
    };
  },
  uk: async () => {
    const m = await import('./ukrainianDictionary');
    return {
      lookup: m.getUkrainianDefinition,
      dict: m.ukrainianDictionary,
      getPhonetic: (e: LocalDictEntry) => e.phonetic,
      matchKey: (key: string, word: string) => key === word,
    };
  },
  pl: async () => {
    const m = await import('./polishDictionary');
    return {
      lookup: m.getPolishDefinition,
      dict: m.polishDictionary,
      getPhonetic: (e: LocalDictEntry) => e.phonetic,
      matchKey: (key: string, word: string) => key === word,
    };
  },
};

// 已加载的词典配置缓存
const dictCache: Record<string, Awaited<ReturnType<typeof DICT_LOADERS[string]>>> = {};

// 获取词典配置（按需加载 + 缓存）
async function getDictConfig(lang: string) {
  if (dictCache[lang]) return dictCache[lang];
  const loader = DICT_LOADERS[lang];
  if (!loader) return null;
  const config = await loader();
  dictCache[lang] = config;
  return config;
}

// 通用本地词典查询函数（异步，首次调用时动态加载词典）
async function lookupLocalDict(word: string, lang: string): Promise<DictionaryDefinition | null> {
  const cfg = await getDictConfig(lang);
  if (!cfg) return null;

  // 1. 直接通过 lookup 函数查询
  const entry = cfg.lookup(word);
  if (entry) {
    return {
      word: entry.word,
      phonetic: cfg.getPhonetic(entry),
      partOfSpeech: entry.partOfSpeech,
      definitions: entry.definitions,
      examples: entry.examples,
    };
  }

  // 2. 遍历词典 keys 做模糊匹配
  const normalized = word.toLowerCase().trim();
  for (const [key, dictEntry] of Object.entries(cfg.dict)) {
    if (cfg.matchKey(key, normalized) || dictEntry.word.toLowerCase() === normalized) {
      return {
        word: dictEntry.word,
        phonetic: cfg.getPhonetic(dictEntry),
        partOfSpeech: dictEntry.partOfSpeech,
        definitions: dictEntry.definitions,
        examples: dictEntry.examples,
      };
    }
  }
  return null;
}

// 清理 Merriam-Webster 文本标记（{bc} 分隔符、{it} 斜体、{sup} 等）
function cleanMwText(t: string): string {
  return t
    .replace(/\{bc\}/g, ' ')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 递归遍历 MW 的 sseq 结构，提取释义（dt 中 text）与例句（vis/ex）
function walkMw(node: any, defs: string[], exs: string[]): void {
  if (Array.isArray(node)) {
    // MW dt 元素是二元组：[type, value]，如 ["text","..."] / ["vis",[...]] / ["sense",{...}]
    if (
      node.length === 2 &&
      typeof node[0] === 'string' &&
      (typeof node[1] === 'string' || Array.isArray(node[1]) || (node[1] && typeof node[1] === 'object'))
    ) {
      const typ = node[0];
      const val = node[1];
      if (typ === 'text' && typeof val === 'string') {
        defs.push(cleanMwText(val));
      } else if (typ === 'vis' && Array.isArray(val)) {
        for (const v of val) {
          if (v && typeof v.t === 'string') exs.push(cleanMwText(v.t));
        }
      } else if (typ === 'ex' && typeof val === 'string') {
        exs.push(cleanMwText(val));
      } else {
        walkMw(val, defs, exs); // sense/bs/uns/pseq 等嵌套结构
      }
    } else {
      for (const item of node) walkMw(item, defs, exs);
    }
  } else if (node && typeof node === 'object') {
    for (const v of Object.values(node)) walkMw(v, defs, exs);
  }
}

// 按 MW 规则拼接音频 URL：bix_/gg_ 前缀、数字开头→number、否则取首字母
function buildMwAudioUrl(audio: string): string {
  let dir: string;
  if (audio.startsWith('bix')) dir = 'bix';
  else if (audio.startsWith('gg')) dir = 'gg';
  else if (/^\d/.test(audio)) dir = 'number';
  else dir = audio[0];
  return `https://www.dictionaryapi.com/api/v3/references/learners/audio/${dir}/${audio}.mp3`;
}

// 在线释义结果缓存：避免同一单词重复发起网络请求（查词/标记卡顿优化）。
// 命中缓存时直接返回，省去每次点击单词/标记单词时的网络往返。
const onlineDefCache = new Map<string, DictionaryDefinition | null>();

// 获取英文单词定义（在线 API - Merriam-Webster Learner's）
async function getEnglishDefinition(word: string): Promise<DictionaryDefinition | null> {
  const cacheKey = word.toLowerCase();
  if (onlineDefCache.has(cacheKey)) return onlineDefCache.get(cacheKey)!;
  let result: DictionaryDefinition | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const url = `${MW_BASE_URL}/${encodeURIComponent(cacheKey)}?key=${MW_API_KEY}`;
    const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!response.ok) { onlineDefCache.set(cacheKey, null); return null; }

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) { onlineDefCache.set(cacheKey, null); return null; }

    // MW 查不到时返回字符串数组（拼写建议）；只保留对象词条
    const entries = data.filter((e: any) => e && typeof e === 'object');
    if (entries.length === 0) { onlineDefCache.set(cacheKey, null); return null; }

    const firstEntry = entries[0];
    const wordOut = (firstEntry?.meta?.id || firstEntry?.hw || word).replace(/:\d+$/, '');

    // 音标 / 音频：跨所有义项取第一个有效值（MW 为美式，不区分英/美音）
    let phonetic: string | undefined;
    let audio: string | undefined;
    for (const e of entries) {
      const prs: any[] = e?.prs || [];
      for (const p of prs) {
        if (!phonetic && p?.mw) phonetic = p.mw;
        const a = p?.sound?.audio;
        if (!audio && a) audio = buildMwAudioUrl(a);
        if (phonetic && audio) break;
      }
      if (phonetic && audio) break;
    }

    // 释义 / 例句：遍历所有义项
    const defs: string[] = [];
    const exs: string[] = [];
    for (const e of entries) {
      for (const d of e?.def || []) {
        walkMw(d?.sseq || [], defs, exs);
      }
    }
    if (defs.length === 0) { onlineDefCache.set(cacheKey, null); return null; }

    result = {
      word: wordOut,
      phonetic,
      ukPhonetic: phonetic,
      usPhonetic: phonetic,
      partOfSpeech: firstEntry?.fl,
      definitions: defs.slice(0, 8),
      examples: exs.slice(0, 4),
      audio,
      ukAudio: audio,
      usAudio: audio,
    };
  } catch (error) {
    console.error('Dictionary API error:', error);
    result = null;
  }
  onlineDefCache.set(cacheKey, result);
  return result;
}

// 未找到翻译的提示（按语言）
const NOT_FOUND_MSG: Record<string, string> = {
  fr: '（未找到翻译）',
  de: '（Übersetzung nicht gefunden）',
  ja: '（訳が見つかりません）',
  uk: '（Переклад не знайдено）',
  pl: '（Nie znaleziono tłumaczenia）',
};

// 主查询函数：支持单词和短语
export async function lookupWord(word: string, language: Language): Promise<DictionaryDefinition | null> {
  if (!word || word.trim().length === 0) return null;

  const cleanWord = word.trim().toLowerCase().replace(/[\p{P}\p{S}]/gu, '');
  if (cleanWord.length < 2) return null;

  // 若为短语（含空格、连字符、撇号），尝试以下策略：
  // 1. 先按完整短语查找
  // 2. 回退到短语中第一个单词的释义
  const isPhrase = word.trim().includes(' ') || /\p{Pd}/u.test(word);

  if (DICT_LOADERS[language]) {
    const phraseResult = await lookupLocalDict(cleanWord, language);
    if (phraseResult) return phraseResult;

    // 短语回退：取第一个单词
    if (isPhrase) {
      const firstWord = cleanWord.split(/\s+/)[0].replace(/[\p{P}\p{S}]/gu, '');
      if (firstWord.length >= 2) {
        const singleResult = await lookupLocalDict(firstWord, language);
        if (singleResult) {
          return {
            ...singleResult,
            word: word.trim(),  // 保持原始短语显示
            definitions: [`[短语 "${word.trim()}"] ` + singleResult.definitions[0], ...singleResult.definitions.slice(1)],
          };
        }
      }
    }

    // 词形还原回退（本地词典）：原词查不到时尝试还原后的原形
    for (const lemma of lemmatize(cleanWord, language)) {
      if (lemma === cleanWord) continue;
      const r = await lookupLocalDict(lemma, language);
      if (r) return { ...r, word: cleanWord, lemma };
    }
    return null;
  }

  // 英文：使用在线 API 查找（支持短语）
  const result = await getEnglishDefinition(cleanWord);
  if (result) return result;

  // 短语回退（英文）
  if (isPhrase) {
    const firstWord = cleanWord.split(/\s+/)[0].replace(/[\p{P}\p{S}]/gu, '');
    if (firstWord.length >= 2) {
      const singleResult = await getEnglishDefinition(firstWord);
      if (singleResult) {
        return {
          ...singleResult,
          word: word.trim(),
          definitions: [`[短语 "${word.trim()}"] ` + singleResult.definitions[0], ...singleResult.definitions.slice(1)],
        };
      }
    }
  }

  // 词形还原回退（英文 MW）：原词查不到时尝试还原后的原形
  for (const lemma of lemmatize(cleanWord, language)) {
    if (lemma === cleanWord) continue;
    const r = await getEnglishDefinition(lemma);
    if (r) return { ...r, word: cleanWord, lemma };
  }
  return null;
}

// 获取简单翻译（用于快速显示）
export async function getQuickTranslation(word: string, language: Language): Promise<string> {
  const definition = await lookupWord(word, language);
  if (!definition || definition.definitions.length === 0) {
    return NOT_FOUND_MSG[language] || '(No translation found)';
  }
  return definition.definitions[0];
}

// 获取词典统计（同步，若词典尚未加载则返回 0）
export function getDictionaryStats(language: Language): { total: number } {
  const cfg = dictCache[language];
  return cfg ? { total: Object.keys(cfg.dict).length } : { total: 0 };
}
