import { describe, it, expect, vi } from 'vitest';
import {
  destCacheKey,
  resolveDestToPage,
  createDestPageResolver,
  type DestAdapter,
} from '../pdfDest';

type Ref = { num: number; gen: number };

interface AdapterOpts {
  /** 命名目标 → 显式 dest 数组 */
  dests?: Record<string, unknown[] | null>;
  /** RefProxy 对象号 → 0 基页索引；未列出的抛错（模拟 pdfjs "Invalid pageIndex request"） */
  pageOf?: Record<number, number>;
  /** 1 基页码快路径；未列出的返回 null */
  cachedOf?: Record<number, number>;
  numPages?: number;
}

function makeAdapter(opts: AdapterOpts = {}): DestAdapter & { getPageIndex: ReturnType<typeof vi.fn> } {
  const { dests = {}, pageOf = {}, cachedOf = {}, numPages = 100 } = opts;
  return {
    getDestination: async (name: string) => dests[name] ?? null,
    getPageIndex: vi.fn(async (ref: unknown) => {
      const num = (ref as Ref)?.num;
      if (num == null || !(num in pageOf)) throw new Error('Invalid pageIndex request.');
      return pageOf[num];
    }),
    cachedPageNumber: (ref: unknown) => {
      const num = (ref as Ref)?.num;
      return num != null && num in cachedOf ? cachedOf[num] : null;
    },
    numPages,
  };
}

describe('destCacheKey', () => {
  it('字符串用 n: 前缀', () => {
    expect(destCacheKey('chapter1')).toBe('n:chapter1');
  });

  it('数字 dest 用 i: 前缀（旧实现会退化成 o:: 并互相污染）', () => {
    expect(destCacheKey([7, { name: 'XYZ' }])).toBe('i:7');
    expect(destCacheKey([8])).toBe('i:8');
    expect(destCacheKey([7])).not.toBe(destCacheKey([8]));
  });

  it('RefProxy 用对象号区分', () => {
    expect(destCacheKey([{ num: 7, gen: 0 }])).not.toBe(destCacheKey([{ num: 8, gen: 0 }]));
  });

  it('数字 dest 与同号 RefProxy 不共用缓存键', () => {
    expect(destCacheKey([7])).not.toBe(destCacheKey([{ num: 7, gen: 0 }]));
  });

  it('非法 dest 统一为 x:invalid', () => {
    expect(destCacheKey(null)).toBe('x:invalid');
    expect(destCacheKey(42)).toBe('x:invalid');
    expect(destCacheKey({})).toBe('x:invalid');
  });
});

describe('resolveDestToPage', () => {
  it('RefProxy dest：getPageIndex 返回 0 基索引，结果 +1', async () => {
    const a = makeAdapter({ pageOf: { 9: 5 } });
    await expect(resolveDestToPage([{ num: 9, gen: 0 }], a)).resolves.toBe(6);
  });

  it('**数字 dest：直接 +1，且绝不调用 getPageIndex**（4.4.20 核心回归）', async () => {
    // pdfjs 的 getPageIndex 遇到非 RefProxy 会抛 "Invalid pageIndex request."
    // 旧代码把数字交给它 → 解析失败 → 沿用上一个页码 → 多个条目塌到同一页
    const a = makeAdapter();
    await expect(resolveDestToPage([7, { name: 'XYZ' }], a)).resolves.toBe(8);
    expect(a.getPageIndex).not.toHaveBeenCalled();
  });

  it('非整数数字 dest 视为无效', async () => {
    const a = makeAdapter();
    await expect(resolveDestToPage([7.5], a)).resolves.toBeNull();
  });

  it('命名目标：getDestination 命中后继续解析', async () => {
    const a = makeAdapter({ dests: { named: [{ num: 9, gen: 0 }] }, pageOf: { 9: 2 } });
    await expect(resolveDestToPage('named', a)).resolves.toBe(3);
  });

  it('命名目标查不到（返回 null）→ null', async () => {
    const a = makeAdapter();
    await expect(resolveDestToPage('missing', a)).resolves.toBeNull();
  });

  it('dest 为 null / 数字 / 普通对象 → null', async () => {
    const a = makeAdapter();
    await expect(resolveDestToPage(null, a)).resolves.toBeNull();
    await expect(resolveDestToPage(42, a)).resolves.toBeNull();
    await expect(resolveDestToPage({ num: 1 }, a)).resolves.toBeNull();
    await expect(resolveDestToPage([], a)).resolves.toBeNull();
  });

  it('getPageIndex 抛错 → null（不抛出到调用方）', async () => {
    const a = makeAdapter({ pageOf: {} });
    await expect(resolveDestToPage([{ num: 999, gen: 0 }], a)).resolves.toBeNull();
  });

  it('页码越界 → null（不钳制）', async () => {
    const a = makeAdapter({ pageOf: { 1: 100 }, numPages: 100 }); // → 101
    await expect(resolveDestToPage([{ num: 1, gen: 0 }], a)).resolves.toBeNull();

    const b = makeAdapter({ pageOf: { 1: -1 }, numPages: 100 }); // → 0
    await expect(resolveDestToPage([{ num: 1, gen: 0 }], b)).resolves.toBeNull();

    const c = makeAdapter({ pageOf: { 1: 0 }, numPages: 0 }); // numPages 未知时不做上限校验
    await expect(resolveDestToPage([{ num: 1, gen: 0 }], c)).resolves.toBe(1);
  });

  it('cachedPageNumber 快路径命中时不再调用 getPageIndex', async () => {
    const a = makeAdapter({ cachedOf: { 9: 4 } });
    await expect(resolveDestToPage([{ num: 9, gen: 0 }], a)).resolves.toBe(4);
    expect(a.getPageIndex).not.toHaveBeenCalled();
  });
});

describe('createDestPageResolver', () => {
  it('成功结果被缓存：同一条目只解析一次', async () => {
    const a = makeAdapter({ pageOf: { 9: 5 } });
    const resolve = createDestPageResolver(a);
    await expect(resolve([{ num: 9, gen: 0 }])).resolves.toBe(6);
    await expect(resolve([{ num: 9, gen: 0 }])).resolves.toBe(6);
    expect(a.getPageIndex).toHaveBeenCalledTimes(1);
  });

  it('失败结果不缓存：允许页树加载完成后再试一次', async () => {
    const pageOf: Record<number, number> = {};
    const a: DestAdapter = {
      getDestination: async () => null,
      getPageIndex: async (ref) => {
        const num = (ref as Ref)?.num;
        if (!(num in pageOf)) throw new Error('not ready');
        return pageOf[num];
      },
      numPages: 100,
    };
    const resolve = createDestPageResolver(a);
    await expect(resolve([{ num: 3, gen: 0 }])).resolves.toBeNull();
    pageOf[3] = 9; // 模拟页树就绪
    await expect(resolve([{ num: 3, gen: 0 }])).resolves.toBe(10);
  });

  it('数字 dest 与同号 RefProxy 各自缓存，互不串号', async () => {
    const a = makeAdapter({ pageOf: { 7: 1 } }); // RefProxy {num:7} → 页 2
    const resolve = createDestPageResolver(a);
    await expect(resolve([7])).resolves.toBe(8); // 数字 7 → 页 8
    await expect(resolve([{ num: 7, gen: 0 }])).resolves.toBe(2); // 对象 7 → 页 2
    await expect(resolve([7])).resolves.toBe(8);
    await expect(resolve([{ num: 7, gen: 0 }])).resolves.toBe(2);
  });
});
