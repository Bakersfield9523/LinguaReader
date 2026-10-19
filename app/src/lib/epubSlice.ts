/**
 * EPUB 目录锚点切片的纯函数集合。
 *
 * 背景（4.4.18）：calibre 等工具转出的 EPUB 常把多个真章节塞进同一个 shard（XHTML 文件），
 * 只在目录里用锚点区分，例如：
 *     Volume 1     -> ..._split_001.html#filepos14732
 *     Introduction -> ..._split_001.html#filepos14916
 *     Chapter I    -> ..._split_001.html#filepos66604
 * 而 resolveHrefToSpine / canonicalKey 都会 .split('#')[0] 剥掉锚点，
 * 于是这些条目拿到完全相同的 id 与 href —— 目录里出现多条，点哪个都渲染同一份正文，
 * 侧边栏还会因为它们 id 相同而一起高亮（ChapterTree 的 isActive 按 id 定位）。
 *
 * 这里的三个函数把「锚点身份」与「按锚点切片」抽成纯字符串处理：
 * 不依赖 DOM、不 import epubjs / pdfjs，可在 vitest 的 node 环境直接单测。
 */

/** 把目录里的原始 href 拆成「文档部分 + 锚点」 */
export function splitHrefAnchor(rawHref: string): { docPart: string; anchor?: string } {
  const s = String(rawHref || '');
  const hash = s.indexOf('#');
  if (hash < 0) return { docPart: s };
  const docPart = s.slice(0, hash);
  const anchor = s.slice(hash + 1).trim();
  return { docPart, anchor: anchor || undefined };
}

/** 章节 id：文档路径 + 锚点。同文件不同锚点 => id 不同（修复重复条目共享 id 的根因） */
export function buildChapterId(docHref: string, anchor?: string): string {
  const doc = String(docHref || '');
  if (!doc) return '';
  return anchor ? `${doc}#${anchor}` : doc;
}

/** 判断某个开始标签上是否带 id/name == anchor（只看 id/name，不看 href，避免命中目录里的回链） */
function tagHasAnchor(tag: string, anchor: string): boolean {
  const re = /\b(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) {
    const val = m[1] ?? m[2] ?? m[3] ?? '';
    if (val === anchor) return true;
  }
  return false;
}

/** 在 HTML 里定位「锚点所在开始标签」的起始下标；找不到返回 -1 */
function findAnchorTagStart(html: string, anchor: string): number {
  if (!anchor) return -1;
  const tagRe = /<[a-zA-Z][^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    if (tagHasAnchor(m[0], anchor)) return m.index;
  }
  return -1;
}

/** 拆出 head 与 body 内部内容（保留 head 以便 processHTML 继续抽取书籍 CSS） */
function splitHeadBody(html: string): { head: string; bodyInner: string } | null {
  const bodyMatch = /<body[^>]*>([\s\S]*)<\/body\s*>/i.exec(html);
  if (!bodyMatch) return null;
  const headMatch = /<head[^>]*>([\s\S]*?)<\/head\s*>/i.exec(html);
  return { head: headMatch ? headMatch[1] : '', bodyInner: bodyMatch[1] };
}

/**
 * 截取 [anchor, nextAnchor) 之间的正文片段。
 *
 * @param html     整篇 shard 的 HTML
 * @param anchor   本章锚点（必需）
 * @param nextAnchor 同一份 shard 里下一章的锚点（按目录顺序）；省略表示切到文件末尾
 * @returns 拼好 head 的完整 HTML 字符串；**任何异常/边界情况都返回 null**，
 *          调用方回退整篇（表现永不差于修复前，不会白屏）
 */
export function sliceHtmlByAnchor(
  html: string,
  anchor: string,
  nextAnchor?: string
): string | null {
  if (!html || !anchor) return null;

  const parts = splitHeadBody(html);
  if (!parts) return null;
  const { head, bodyInner } = parts;

  const start = findAnchorTagStart(bodyInner, anchor);
  if (start < 0) return null; // 锚点在正文中不存在（书有问题）→ 回退整篇

  let end = bodyInner.length;
  if (nextAnchor && nextAnchor !== anchor) {
    const e = findAnchorTagStart(bodyInner, nextAnchor);
    if (e > start) end = e;
  }

  if (end <= start) return null;

  const slice = bodyInner.slice(start, end);
  if (!slice.trim()) return null;

  return `<html><head>${head}</head><body>${slice}</body></html>`;
}
