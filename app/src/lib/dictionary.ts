import type { DictionaryDefinition, Language } from '@/types';
import { lemmatize } from './lemmatize';

// Merriam-Webster Learner's Dictionary API（英文在线词典）
const MW_BASE_URL = 'https://www.dictionaryapi.com/api/v3/references/learners/json';
// Key 从环境变量读取（见 .env.example），避免明文写入源码 / git 历史
const MW_API_KEY = import.meta.env.VITE_MW_API_KEY ?? '';

// 回退源：Wiktionary（维基词典）API —— 免费、无需 Key、覆盖极全。
// 为何选它而非 Free Dictionary：后者 (api.dictionaryapi.dev) 在本机 Cloudflare + 代理下 TLS 握手失败（curl exit 35），
// 而 Wiktionary 同环境稳定 200；且浏览器/WebView 不能自定义 User-Agent，Wiktionary 不强制要求。
const WT_API = 'https://en.wiktionary.org/w/api.php';
// 超时：原先 10s 太长，且失败后会串行再试短语和词形还原（最坏 30s+）。
// 现在两源并发，最坏只等 MW_TIMEOUT_MS。
const MW_TIMEOUT_MS = 5000;
const WT_TIMEOUT_MS = 6000;
// 失败结果只缓存这么久：网络抖动不应该把某个词"永久判死"
const ONLINE_FAIL_TTL_MS = 60_000;

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
// 在线释义缓存：成功长期缓存，失败只缓存 ONLINE_FAIL_TTL_MS
const onlineDefCache = new Map<string, { v: DictionaryDefinition | null; exp: number }>();

// 带超时的 JSON 拉取（失败一律返回 null，交由上层回退）
async function fetchJson(url: string, ms: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// 回退源：Wiktionary（维基词典）API。
// 解析英文词条 wikitext：真实释义是 `===Noun===` 等词性小节下以 `#` 开头的条目
// （`#:` 是近义词/例句子项、`#*` 是引文，均排除）；词性标题可能是 3 或 4 个等号（多词源时为 `====Noun====`）。
function cleanWikiText(t: string): string {
  return t
    .replace(/\[\[([^\]|\n]+)\|([^\]\n]+)\]\]/g, '$2') // [[w|disp]] -> disp
    .replace(/\[\[([^\]\n]+)\]\]/g, '$1')              // [[w]] -> w
    .replace(/'''/g, '')
    .replace(/''/g, '')
    .replace(/\{\{lb\|en\|([^}]*)\}\}/g, '($1) ')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseWiktionary(wt: string): { pos: string | undefined; defs: string[] } | null {
  const m = wt.match(/==English==([\s\S]*?)(?=\n==[A-Z][a-z]|$)/);
  const en = m ? m[1] : '';
  if (!en) return null;
  const POS: Record<string, string> = {
    Noun: 'noun', Verb: 'verb', Adjective: 'adj', Adverb: 'adv', Pronoun: 'pron',
    Preposition: 'prep', Conjunction: 'conj', Interjection: 'intj', Determiner: 'det',
    Article: 'art', Numeral: 'num', Particle: 'particle', Abbreviation: 'abbr',
    ProperNoun: 'propn', Auxiliary: 'aux', Suffix: 'suffix', Prefix: 'prefix',
    Symbol: 'symbol', Phrase: 'phrase', Idiom: 'idiom',
  };
  const defs: string[] = [];
  let pos: string | undefined;
  let firstPos: string | undefined;
  for (const line of en.split('\n')) {
    const h = line.match(/^={3,4}([A-Za-z]+)/);
    if (h) { pos = POS[h[1]]; continue; }
    if (pos !== undefined && /^#(?![:*])/.test(line)) {
      const txt = cleanWikiText(line.replace(/^#+\s*/, ''));
      if (txt && !/^[\*\|\}]/.test(txt)) {
        if (!firstPos) firstPos = pos;
        defs.push(txt);
      }
    }
  }
  return defs.length ? { pos: firstPos, defs: defs.slice(0, 8) } : null;
}

async function getWiktionaryDefinition(word: string): Promise<DictionaryDefinition | null> {
  try {
    const url = `${WT_API}?action=parse&page=${encodeURIComponent(word)}&prop=wikitext&format=json&redirects=1`;
    const data = await fetchJson(url, WT_TIMEOUT_MS);
    const wt = data?.parse?.wikitext?.['*'];
    if (typeof wt !== 'string' || !wt) return null;
    const parsed = parseWiktionary(wt);
    if (!parsed) return null;
    return {
      word,
      phonetic: undefined,
      partOfSpeech: parsed.pos,
      definitions: parsed.defs,
      examples: [],
    };
  } catch {
    return null;
  }
}

// Merriam-Webster Learner's（主源，质量最好）
async function getMwDefinition(word: string): Promise<DictionaryDefinition | null> {
  const cacheKey = word.toLowerCase();
  let result: DictionaryDefinition | null = null;
  try {
    const url = `${MW_BASE_URL}/${encodeURIComponent(cacheKey)}?key=${MW_API_KEY}`;
    const data = await fetchJson(url, MW_TIMEOUT_MS);
    if (!Array.isArray(data) || data.length === 0) return null;

    // MW 查不到时返回字符串数组（拼写建议）；只保留对象词条
    const entries = data.filter((e: any) => e && typeof e === 'object');
    if (entries.length === 0) return null;

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
    if (defs.length === 0) return null;

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
    console.error('Dictionary API error (MW):', error);
    result = null;
  }
  return result;
}

// 英文主查询：MW 优先（质量最好），Free Dictionary 回退。
// 两源并发发起——串行的话 MW 一挂就要等满超时才轮到回退源，用户感知就是"又慢又查不到"。
async function getEnglishDefinition(word: string): Promise<DictionaryDefinition | null> {
  const cacheKey = word.toLowerCase();
  const hit = onlineDefCache.get(cacheKey);
  if (hit && hit.exp > Date.now()) return hit.v;

  const fdPromise = getWiktionaryDefinition(cacheKey);
  const mwPromise = getMwDefinition(cacheKey);

  let result: DictionaryDefinition | null = null;
  try {
    result = await mwPromise;
  } catch {
    result = null;
  }
  if (!result) {
    try {
      result = await fdPromise;
    } catch {
      result = null;
    }
  }
  // 成功长期缓存；失败只缓存 60s，网络恢复后可重试
  onlineDefCache.set(cacheKey, {
    v: result,
    exp: result ? Number.MAX_SAFE_INTEGER : Date.now() + ONLINE_FAIL_TTL_MS,
  });
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
