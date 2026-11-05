/**
 * PDF destination（命名目标 / 显式目标数组）→ 1 基页码 的纯逻辑（4.4.20）。
 *
 * 为什么单独成模块：fileParser.ts 顶层 `import * as pdfjs`，在 vitest 的 node
 * 环境下跑不起来。这里用 `import type`（编译期即被擦除）+ 可注入的 adapter，
 * 就能脱离 pdfjs 单测三态分支——这正是历史上反复出错的地方。
 *
 * ⚠️ 四条硬规则（照抄 pdf.js 官方 web/pdf_link_service.js 的 goToDestination）：
 *  1. **绝不读 `dest[0].num` 当页码**：那是 PDF 对象号，与页码没有任何换算关系。
 *  2. **`dest[0]` 是纯数字时，它本身就是 0 基页索引**，直接 `+1`。
 *     pdfjs core 的 `_isValidExplicitDest` 明确允许这种形态；
 *     而 `getPageIndex(ref)` 内部 `if (!isRefProxy(ref)) throw` → 传数字必然抛错。
 *     旧代码漏了这个分支，导致这类条目全部解析失败（4.4.20 修复）。
 *  3. **解析失败一律返回 null，绝不猜页码**。旧逻辑「沿用上一个成功页码」会把
 *     连续失败的一批条目塌陷到同一页 → 点不同目录项跳到同一页。
 *  4. 页码越界视为失败（官方也是直接放弃，不做钳制）。
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';

/** 解析 dest 所需的最小 pdfjs 能力集合。测试里用假对象即可。 */
export interface DestAdapter {
  /** 命名目标 → 显式 dest 数组（查 NameTree，查不到返回 null） */
  getDestination(name: string): Promise<unknown[] | null>;
  /** 对象引用 → 0 基页索引；pdfjs 规定只接受 RefProxy，传别的会抛错 */
  getPageIndex(ref: unknown): Promise<number>;
  /** 可选快路径：对象引用 → 1 基页码（页已加载时命中，未命中返回 null） */
  cachedPageNumber?(ref: unknown): number | null;
  /** 总页数，用于越界判定；0 表示未知，不做上限校验 */
  numPages: number;
}

function isRefLike(v: unknown): v is { num: number; gen: number } {
  return (
    !!v &&
    typeof v === 'object' &&
    Number.isInteger((v as { num?: unknown }).num) &&
    Number.isInteger((v as { gen?: unknown }).gen)
  );
}

/**
 * dest 的缓存键。
 * 旧实现用 `o:${d0?.num}:${d0?.gen}`，当 dest[0] 是**数字**时两者都是 undefined，
 * 所有数字型 dest 共享 `o::` 一个键 → 缓存互相污染。这里按类型分前缀。
 */
export function destCacheKey(dest: unknown): string {
  if (typeof dest === 'string') return `n:${dest}`;
  if (Array.isArray(dest)) {
    const d0 = dest[0];
    if (typeof d0 === 'number') return `i:${d0}`;
    if (isRefLike(d0)) return `o:${d0.num}:${d0.gen}`;
    if (d0 && typeof d0 === 'object') return `u:${String((d0 as { type?: unknown }).type ?? '')}`;
  }
  return 'x:invalid';
}

/**
 * dest → 1 基页码；无法确定时返回 null。
 *
 * 判定顺序与 pdf.js `goToDestination` 完全一致：
 *   string → getDestination()
 *   dest[0] 为整数 → +1（**不调用 getPageIndex**）
 *   dest[0] 为对象 → cachedPageNumber 快路径 → getPageIndex + 1
 *   其他 / 抛错 / 越界 → null
 */
export async function resolveDestToPage(
  dest: unknown,
  adapter: DestAdapter,
): Promise<number | null> {
  try {
    let explicit: unknown = dest;
    if (typeof dest === 'string') {
      explicit = await adapter.getDestination(dest);
    }
    if (!Array.isArray(explicit) || explicit.length === 0) return null;

    const ref: unknown = explicit[0];
    let page: number | null = null;

    if (typeof ref === 'number') {
      // 0 基页索引 → 1 基页码。绝不交给 getPageIndex。
      if (!Number.isInteger(ref)) return null;
      page = ref + 1;
    } else if (ref && typeof ref === 'object') {
      let cached: number | null = null;
      if (adapter.cachedPageNumber) {
        try {
          cached = adapter.cachedPageNumber(ref);
        } catch {
          cached = null;
        }
      }
      if (typeof cached === 'number' && Number.isInteger(cached) && cached >= 1) {
        page = cached;
      } else {
        const pageIndex = await adapter.getPageIndex(ref);
        if (typeof pageIndex !== 'number' || !Number.isFinite(pageIndex)) return null;
        page = pageIndex + 1;
      }
    } else {
      return null;
    }

    if (!Number.isInteger(page) || page < 1) return null;
    if (adapter.numPages > 0 && page > adapter.numPages) return null;
    return page;
  } catch {
    // getPageIndex 抛错（非 RefProxy / 页已删除）、getDestination 抛错 → 一律视为不可定位
    return null;
  }
}

/** 真实适配器：绑定一个 PDFDocumentProxy。 */
export function createPdfDestAdapter(pdf: PDFDocumentProxy): DestAdapter {
  return {
    async getDestination(name: string) {
      try {
        const d = await pdf.getDestination(name);
        return (d as unknown[] | null) ?? null;
      } catch {
        return null;
      }
    },
    async getPageIndex(ref: unknown) {
      return await pdf.getPageIndex(ref as never);
    },
    cachedPageNumber(ref: unknown) {
      try {
        const fn = (pdf as unknown as { cachedPageNumber?: (r: unknown) => number | null })
          .cachedPageNumber;
        const n = fn ? fn.call(pdf, ref) : null;
        return typeof n === 'number' ? n : null;
      } catch {
        return null;
      }
    },
    numPages: pdf.numPages,
  };
}

/**
 * 带缓存的解析器。**失败不缓存**——pdfjs 的页树可能还在加载，
 * 把 null 缓存下来会让「稍后再点一次」也永远失败。
 */
export function createDestPageResolver(
  adapter: DestAdapter,
): (dest: unknown) => Promise<number | null> {
  const cache = new Map<string, number>();
  return async (dest: unknown) => {
    const key = destCacheKey(dest);
    const hit = cache.get(key);
    if (hit != null) return hit;
    const page = await resolveDestToPage(dest, adapter);
    if (page != null) cache.set(key, page);
    return page;
  };
}
