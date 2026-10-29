/**
 * PDF 目录（outline / bookmark）→ Chapter[] 的纯逻辑（4.4.19）。
 *
 * 为什么抽成独立模块：fileParser.ts 顶层 import 了 pdfjs 与 epubjs，在 vitest 的
 * node 环境下 import 不了 → 这段最易错的逻辑必须脱离 pdfjs 才能单测。
 * 调用方（PDFParser）只需注入一个「dest → 页码」的解析器。
 *
 * 修复的两个历史 bug：
 *  1. 页码：`dest[0].num` 是 **PDF 对象号**，不是页码，几乎必然跳错页。
 *     正确做法是 getDestination()（命名目标）→ getPageIndex()（对象引用 → 0 基页索引）+1。
 *  2. id 碰撞：旧代码顶层用 `pdf-ch-${idx}`、子项用 `pdf-ch-${idx*100+ci}`，
 *     当 idx=0 时子项 id 就是 `pdf-ch-0/1/2…`，与顶层完全重叠 → React key 重复、
 *     `chapters.find(c => c.id === id)` 永远命中第一个 → 点子目录跳到顶层项。
 */
import type { Chapter } from '@/types';

export interface OutlineEntry {
  title?: string;
  dest?: unknown;
  items?: OutlineEntry[];
}

/** 把页码收敛到 1..numPages；numPages 为 0（尚未拿到）时不设上限 */
export function clampPage(page: number, numPages: number): number {
  const n = Math.round(page);
  if (!Number.isFinite(n) || n < 1) return 1;
  return numPages > 0 ? Math.min(n, numPages) : n;
}

/**
 * 把 outline 树转成章节树。
 *
 * @param outline      pdfjs 的 getOutline() 结果
 * @param resolvePage  把单个条目的 dest 解析成 1 基页码，失败返回 null
 * @param numPages     总页数，用于钳制（传 0 表示未知，不做上限钳制）
 * @returns 章节树；outline 为空时返回空数组（由调用方 fallback 到「每页一章」）
 *
 * 注意必须**顺序 await**：一是 outline 通常按页递增，解析失败时要沿用上一个已解析页；
 * 二是并发会放大 pdfjs 内部页树遍历，且可能乱序。
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
  // 解析失败时沿用上一个已解析页（比旧代码回退 idx+1 准得多）
  let lastPage = 1;

  const walk = async (item: OutlineEntry): Promise<Chapter> => {
    const idx = seq++;
    let resolved: number | null = null;
    try {
      resolved = await resolvePage(item);
    } catch {
      resolved = null;
    }
    const pageNum = clampPage(resolved ?? lastPage, numPages);
    lastPage = pageNum;

    const chapter: Chapter = {
      id: `pdf-ch-${idx}`,
      title: (item?.title || '').trim() || `第 ${pageNum} 页`,
      index: idx,
      // PDF 的 href 契约：1 基页码字符串（Reader 里 parseInt(ch.href) 取页码）
      href: String(pageNum),
    };

    if (Array.isArray(item?.items) && item.items.length > 0) {
      chapter.children = [];
      for (const child of item.items) {
        chapter.children.push(await walk(child));
      }
    }
    return chapter;
  };

  for (const item of outline) {
    chapters.push(await walk(item));
  }
  return chapters;
}
