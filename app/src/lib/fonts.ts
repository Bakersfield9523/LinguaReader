import type { Language } from '@/types';

// 通用字体族（CSS 关键字，非具体字体）。命中这些时应当用具体语言字体栈替换/兜底，
// 否则中文 Windows 上 serif/sans-serif 会回退到宋体/微软雅黑，导致拉丁字符呈全角观感。
export const GENERIC_FAMILY_RE = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded)$/i;

// 各语言的"兜底/覆盖"字体栈。仅在书籍未自带可用字体、或用户显式选择时才启用。
// 西里尔（uk）与波兰语 ąćęłńóśźż（pl）所需的 Latin-Extended-A 字形由 Georgia / Times New Roman /
// Arial / Segoe UI 覆盖；个别字体缺字时浏览器按字符逐级 fallback，不会出豆腐块。
export const FONT_STACKS = {
  serif: `'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,'Times New Roman',Times,'Liberation Serif','Noto Serif',serif`,
  sans: `'Segoe UI',system-ui,-apple-system,Roboto,'Helvetica Neue',Arial,'Liberation Sans','Noto Sans',sans-serif`,
  mono: `'Cascadia Mono',Consolas,'SF Mono',Menlo,Monaco,'Courier New',monospace`,
  jaSerif: `'Hiragino Mincho ProN','Yu Mincho',YuMincho,'MS PMincho','Noto Serif JP','Songti SC',serif`,
  jaSans: `'Hiragino Kaku Gothic ProN','Yu Gothic',Meiryo,'MS PGothic','Noto Sans JP',sans-serif`,
} as const;

export type FontToken = 'auto' | 'serif' | 'sans-serif';

/**
 * 把用户的字体偏好 token 解析为实际 font-family 栈。
 * - 'auto'：跟随书籍自带字体（不强制覆盖），返回衬线栈仅作继承兜底。
 * - 'serif'：衬线栈（拉丁 / 日语分栈）。
 * - 'sans-serif'：无衬线栈（拉丁 / 日语分栈）。
 * 日语书籍走日文字体栈，避免假名/汉字在纯拉丁字体下缺字。
 */
export function resolveFontStack(token: string, lang: Language): string {
  const t = normalizeFontToken(token);
  const isJa = lang === 'ja';
  if (t === 'sans-serif') {
    return isJa ? FONT_STACKS.jaSans : FONT_STACKS.sans;
  }
  // 'auto' 与 'serif' 都走衬线栈（auto 仅作继承兜底，serif 为显式衬线）
  return isJa ? FONT_STACKS.jaSerif : FONT_STACKS.serif;
}

/**
 * 把 localStorage 中可能存在的旧字体值迁移为新的 token：
 * - 'auto' / 'serif' / 'sans-serif' 原样保留
 * - 含 system-ui / -apple-system / sans-serif → 'sans-serif'
 * - 其它（含旧的默认 'Georgia, serif' 等）→ 'auto'（旧版「跟随书籍」语义）
 */
export function normalizeFontToken(v: unknown): FontToken {
  if (v === 'serif') return 'serif';
  if (v === 'sans-serif') return 'sans-serif';
  if (v === 'auto') return 'auto';
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  if (!s) return 'auto';
  if (s.includes('system-ui') || s.includes('-apple-system') || s.includes('sans-serif')) {
    return 'sans-serif';
  }
  // 旧版默认 'Georgia, serif' / 'system-ui,...' 等 → 视为「跟随书籍」
  return 'auto';
}
