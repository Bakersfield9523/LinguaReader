/**
 * PDF 目录（outline / bookmark）→ Chapter[] 的纯逻辑。
 *
 * 抽成独立模块的原因：fileParser.ts 顶层 import 了 pdfjs 与 epubjs，在 vitest 的
 * node 环境下 import 不了 → 这里最易错的逻辑必须脱离 pdfjs 才能单测。
 * 调用方（PDFParser）只需注入一个「dest → 页码」的解析器。
 *
 * 修复历史：
 *  - 4.4.18 之前：`dest[0].num` 是 **PDF 对象号**，不是页码，几乎必然跳错页。
 *  - 4.4.19：改用 getDestination / getPageIndex 取真实页码，并修了 id 碰撞
 *    （旧代码顶层 `pdf-ch-${idx}`、子项 `pdf-ch-${idx*100+ci}`，idx=0 时完全重叠
 *    → React key 重复、`chapters.find(c => c.id === id)` 永远命中第一个）。
 *  - 4.4.20：**删掉「解析失败沿用上一个页码」**。旧逻辑下只要有一批条目连续解析失败
 *    （dest 缺失、命名目标查不到、dest[0] 是数字却交给 getPageIndex 抛错），
 *    它们就会全部塌陷到同一个页码——这正是「点不同目录项跳到同一页」的根因。
 *    现在失败就是 `page: null`：条目照常显示，点击时提示无法定位，绝不猜页码。
 */
import type { Chapter } from '@/types';

export interface OutlineEntry {
  title?: string;
  dest?: unknown;
  items?: OutlineEntry[];
}

/**
 * 把 outline 树转成章节树。
 *
 * @param outline      pdfjs 的 getOutline() 结果
 * @param resolvePage  把单个条目的 dest 解析成 1 基页码，失败返回 null
 * @param numPages     总页数，用于越界判定（传 0 表示未知，不校验上限）
 * @returns 章节树；outline 为空时返回空数组（由调用方 fallback 到「每页一章」）
 *
 * 注意必须**顺序 await**：并发会放大 pdfjs 内部页树遍历，且可能乱序。
 */
export async function buildOutlineChapters(
  outline: OutlineEntry[],
  resolvePage: (item: OutlineEntry) => Promise<number | null>,
  numPages: number,
): Promise<Chapter[]> {
  if (!Array.isArray(outline) || outline.length === 0) return [];

  const chapters: Chapter[] = [];
  // DFS 全局自增：id 与 index 同时唯一，且 index 与扁平顺序一致
  let seq = 0;

  const walk = async (item: OutlineEntry, depth: number): Promise<Chapter> => {
    const idx = seq++;
    let page: number | null = null;
    try {
      page = await resolvePage(item);
    } catch {
      page = null;
    }
    // 越界视为解析失败（与 pdf.js 官方一致：放弃，不钳制）
    if (page != null && (!Number.isInteger(page) || page < 1 || (numPages > 0 && page > numPages))) {
      page = null;
    }

    const chapter: Chapter = {
      id: `pdf-ch-${idx}`,
      title: (item?.title || '').trim() || (page != null ? `第 ${page} 页` : '目录项'),
      index: idx,
      // href 保留「1 基页码字符串」契约（字数缓存的 key 依赖它），失败时为空串。
      // 翻页路径已不再读 href，改用 page / dest。
      href: page != null ? String(page) : '',
      page,
      depth,
    };

    // 只挂载可序列化的 dest（跨 IndexedDB 结构化克隆）。
    // 非数组非字符串的 dest（如 RefProxy 类实例）不写库，避免克隆异常。
    if (typeof item?.dest === 'string' || Array.isArray(item?.dest)) {
      chapter.dest = item.dest;
    }

    if (Array.isArray(item?.items) && item.items.length > 0) {
      chapter.children = [];
      for (const child of item.items) {
        chapter.children.push(await walk(child, depth + 1));
      }
    }
    return chapter;
  };

  for (const item of outline) {
    chapters.push(await walk(item, 0));
  }
  return chapters;
}

/**
 * 建「页码 → 代表条目 id」表。
 *
 * 等价于 pdf.js `web/pdf_outline_viewer.js` 的 `_getPageNumberToDestHash`：
 * **同一页有多个条目时，取嵌套最深（最具体）的那个**作为该页代表。
 * 这样「当前章节」的判定天然唯一，不会出现多个条目一起高亮。
 *
 * `page` 为 null 的条目（解析失败）不参与。
 */
export function buildPageRepTable(chapters: Chapter[]): Map<number, string> {
  const rep = new Map<number, string>();
  const repDepth = new Map<number, number>();

  const walk = (list: Chapter[], fallbackDepth: number) => {
    for (const c of list) {
      const p = c.page;
      if (typeof p === 'number' && Number.isInteger(p) && p >= 1) {
        const depth = typeof c.depth === 'number' ? c.depth : fallbackDepth;
        const prevDepth = repDepth.get(p);
        if (prevDepth === undefined || depth > prevDepth) {
          rep.set(p, c.id);
          repDepth.set(p, depth);
        }
        // 同深度：先到者保留（与官方「first outline item at the lowest level」一致）
      }
      if (c.children && c.children.length > 0) {
        walk(c.children, fallbackDepth + 1);
      }
    }
  };

  walk(chapters, 0);
  return rep;
}

/**
 * 当前页对应的目录条目 id；没有合适条目时返回 null。
 *
 * 从当前页**倒序**往上找第一个有代表条目的页（等价于「起始页 ≤ 当前页的最大起始页」，
 * 也是 sioyek `get_current_chapter_index` 的做法）。因为 rep 每页只有一个条目，
 * 返回值天然唯一 → 目录里最多只有一个高亮。
 */
export function findActiveTocChapterId(
  rep: Map<number, string>,
  currentPage: number,
): string | null {
  if (!Number.isFinite(currentPage) || currentPage < 1 || rep.size === 0) return null;
  const start = Math.floor(currentPage);
  for (let p = start; p >= 1; p--) {
    const id = rep.get(p);
    if (id) return id;
  }
  return null;
}

/**
 * 是否允许把这次重解析的结果写回数据库。
 *
 * 目的：解析器整体抽风（例如一本 dest 全损坏的 PDF）时，不要用「全 null」的目录
 * 覆盖库里尚存的旧数据。门槛取 80%——正常 PDF 的 outline 极少有超过两成坏条目。
 *
 * ⚠️ 不能用「新旧成功数比较」：4.4.19 及更早的旧数据 href 恒非空（因为错误地继承了
 * 上一页），成功数恒为 100%，那种比较会永远拒绝新数据、让 bug 永远修不好。
 */
export function shouldWriteBackPdfChapters(chapters: Chapter[]): boolean {
  let total = 0;
  let ok = 0;
  const walk = (list: Chapter[]) => {
    for (const c of list) {
      total++;
      if (typeof c.page === 'number' && c.page >= 1) ok++;
      if (c.children && c.children.length > 0) walk(c.children);
    }
  };
  walk(chapters);
  if (total === 0) return true;
  return ok / total >= 0.8;
}
