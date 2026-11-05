import { describe, it, expect } from 'vitest';
import {
  buildOutlineChapters,
  buildPageRepTable,
  findActiveTocChapterId,
  shouldWriteBackPdfChapters,
  type OutlineEntry,
} from '../pdfOutline';
import type { Chapter } from '@/types';

function flatten(items: Chapter[]): Chapter[] {
  const out: Chapter[] = [];
  for (const c of items) {
    out.push(c);
    if (c.children) out.push(...flatten(c.children));
  }
  return out;
}

/** 按条目 title 在 map 里查页码；查不到返回 null（模拟 dest 解析失败） */
function resolver(pageByTitle: Record<string, number>) {
  return async (item: OutlineEntry): Promise<number | null> =>
    item.title && pageByTitle[item.title] != null ? pageByTitle[item.title] : null;
}

describe('buildOutlineChapters', () => {
  it('T1: 空 outline 返回空数组（由调用方 fallback 到逐页）', async () => {
    await expect(buildOutlineChapters([], resolver({}), 10)).resolves.toEqual([]);
  });

  it('T2: 解析出正确页码，page 与 href 同步，dest 被保留，depth 从 0 开始', async () => {
    const outline: OutlineEntry[] = [
      { title: 'Chapter 1', dest: ['ref'] },
      { title: 'Chapter 2', dest: ['ref'] },
    ];
    const chapters = await buildOutlineChapters(
      outline,
      resolver({ 'Chapter 1': 3, 'Chapter 2': 17 }),
      50,
    );
    expect(chapters.map((c) => c.page)).toEqual([3, 17]);
    expect(chapters.map((c) => c.href)).toEqual(['3', '17']);
    expect(chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(chapters.map((c) => c.depth)).toEqual([0, 0]);
    expect(chapters[0].dest).toEqual(['ref']);
  });

  it('T3: id 唯一且与扁平顺序一致（含旧算法必撞号的 idx=0 场景）', async () => {
    // 旧代码：顶层 pdf-ch-${idx}，子项 pdf-ch-${idx*100+ci}
    // → 第 0 章的子项 id 就是 pdf-ch-0/1/2…，与顶层完全重叠
    const outline: OutlineEntry[] = [
      {
        title: 'Part I',
        dest: ['r'],
        items: [
          { title: 'I-1', dest: ['r'] },
          { title: 'I-2', dest: ['r'] },
          { title: 'I-3', dest: ['r'] },
          { title: 'I-4', dest: ['r'] },
          { title: 'I-5', dest: ['r'] },
        ],
      },
      { title: 'A', dest: ['r'] },
      { title: 'B', dest: ['r'] },
      { title: 'C', dest: ['r'] },
      { title: 'D', dest: ['r'] },
      { title: 'E', dest: ['r'] },
    ];
    const chapters = await buildOutlineChapters(outline, resolver({}), 100);
    const flat = flatten(chapters);
    expect(new Set(flat.map((c) => c.id)).size).toBe(flat.length);
    // 顺序：Part I(0) → 5 个子项(1..5) → A..E(6..10)
    expect(flat.map((c) => c.id)).toEqual([
      'pdf-ch-0', 'pdf-ch-1', 'pdf-ch-2', 'pdf-ch-3', 'pdf-ch-4', 'pdf-ch-5',
      'pdf-ch-6', 'pdf-ch-7', 'pdf-ch-8', 'pdf-ch-9', 'pdf-ch-10',
    ]);
    flat.forEach((c, i) => expect(c.index).toBe(i));
  });

  it('T4: 三层嵌套不撞号、顺序正确，depth 逐层递增', async () => {
    const outline: OutlineEntry[] = [
      {
        title: 'L1',
        dest: ['r'],
        items: [
          { title: 'L1a', dest: ['r'], items: [{ title: 'L1a-i', dest: ['r'] }, { title: 'L1a-ii', dest: ['r'] }] },
          { title: 'L1b', dest: ['r'] },
        ],
      },
      { title: 'L2', dest: ['r'] },
    ];
    const flat = flatten(await buildOutlineChapters(outline, resolver({}), 100));
    expect(flat.map((c) => c.title)).toEqual(['L1', 'L1a', 'L1a-i', 'L1a-ii', 'L1b', 'L2']);
    expect(new Set(flat.map((c) => c.id)).size).toBe(flat.length);
    expect(flat.map((c) => c.depth)).toEqual([0, 1, 2, 2, 1, 0]);
  });

  it('T5: 页码超出总页数视为解析失败（不钳制，page 为 null）', async () => {
    const outline: OutlineEntry[] = [{ title: 'X', dest: ['r'] }];
    const chapters = await buildOutlineChapters(outline, resolver({ X: 999 }), 20);
    expect(chapters[0].page).toBeNull();
    expect(chapters[0].href).toBe('');
  });

  it('T6: 解析失败就是 null，绝不沿用上一个成功页码（4.4.20 核心回归）', async () => {
    const outline: OutlineEntry[] = [
      { title: 'ok', dest: ['r'] },
      { title: 'broken', dest: ['r'] },
      { title: 'broken2', dest: null },
    ];
    const chapters = await buildOutlineChapters(outline, resolver({ ok: 12 }), 100);
    expect(chapters.map((c) => c.page)).toEqual([12, null, null]);
    expect(chapters.map((c) => c.href)).toEqual(['12', '', '']);
    // 明确断言：失败条目不会变成 12
    expect(chapters[1].page).not.toBe(12);
    expect(chapters[2].page).not.toBe(12);
  });

  it('T7: title 兜底——成功用「第 N 页」，失败用「目录项」', async () => {
    const ok = await buildOutlineChapters([{ title: '', dest: ['r'] }], async () => 5, 100);
    expect(ok[0].title).toBe('第 5 页');

    const bad = await buildOutlineChapters([{ dest: ['r'] }], resolver({}), 100);
    expect(bad[0].title).toBe('目录项');
  });

  it('T8: resolvePage 抛异常不会中断整棵树，全部降级为 null', async () => {
    const boom = async (): Promise<number | null> => { throw new Error('pdfjs died'); };
    const chapters = await buildOutlineChapters(
      [{ title: 'a', dest: ['r'] }, { title: 'b', dest: ['r'] }],
      boom,
      100,
    );
    expect(chapters).toHaveLength(2);
    expect(chapters.every((c) => c.page === null)).toBe(true);
    expect(chapters.every((c) => c.href === '')).toBe(true);
  });

  it('T9: 只有数组/字符串 dest 会被挂到章节上（保证可序列化）', async () => {
    const outline = [
      { title: 'arr', dest: ['r'] as unknown },
      { title: 'str', dest: 'named' as unknown },
      { title: 'obj', dest: { num: 1, gen: 0 } as unknown },
      { title: 'none', dest: undefined },
    ];
    const chapters = await buildOutlineChapters(outline, resolver({}), 100);
    expect(chapters[0].dest).toEqual(['r']);
    expect(chapters[1].dest).toBe('named');
    expect(chapters[2].dest).toBeUndefined();
    expect(chapters[3].dest).toBeUndefined();
  });
});

describe('buildPageRepTable / findActiveTocChapterId', () => {
  function ch(id: string, page: number | null, depth: number, children?: Chapter[]): Chapter {
    return { id, title: id, index: 0, page, depth, children };
  }

  it('同一页有多个条目时，取嵌套更深的作为代表', () => {
    const tree = [ch('a', 10, 0, [ch('a1', 10, 1)])];
    const rep = buildPageRepTable(tree);
    expect(rep.get(10)).toBe('a1');
  });

  it('同一页同深度时保留先到者', () => {
    const rep = buildPageRepTable([ch('first', 10, 0), ch('second', 10, 0)]);
    expect(rep.get(10)).toBe('first');
  });

  it('page 为 null 的条目不进代表表', () => {
    const rep = buildPageRepTable([ch('a', null, 0), ch('b', 20, 0)]);
    expect(rep.size).toBe(1);
    expect(rep.get(20)).toBe('b');
  });

  it('当前页取「起始页 ≤ 当前页」里最大的那个', () => {
    const rep = buildPageRepTable([ch('p10', 10, 0), ch('p20', 20, 0), ch('p30', 30, 0)]);
    expect(findActiveTocChapterId(rep, 25)).toBe('p20');
    expect(findActiveTocChapterId(rep, 30)).toBe('p30');
    expect(findActiveTocChapterId(rep, 99)).toBe('p30');
  });

  it('当前页早于所有条目时不高亮任何项', () => {
    const rep = buildPageRepTable([ch('p10', 10, 0)]);
    expect(findActiveTocChapterId(rep, 5)).toBeNull();
  });

  it('全部条目解析失败时不高亮（回归：旧版全塌到第 1 页导致全亮）', () => {
    const rep = buildPageRepTable([ch('a', null, 0), ch('b', null, 1)]);
    expect(rep.size).toBe(0);
    expect(findActiveTocChapterId(rep, 1)).toBeNull();
  });

  it('任何输入下最多只返回一个 id', () => {
    const rep = buildPageRepTable([ch('a', 1, 0), ch('b', 1, 1), ch('c', 2, 0)]);
    const id = findActiveTocChapterId(rep, 2);
    expect(typeof id).toBe('string');
    expect([...rep.values()].filter((v) => v === id)).toHaveLength(1);
  });
});

describe('shouldWriteBackPdfChapters', () => {
  const mk = (pages: (number | null)[]): Chapter[] =>
    pages.map((p, i) => ({ id: `c${i}`, title: `c${i}`, index: i, page: p, depth: 0 }));

  it('全部解析成功 → 允许写回', () => {
    expect(shouldWriteBackPdfChapters(mk([1, 2, 3]))).toBe(true);
  });

  it('全部失败 → 拒绝写回（避免用差数据覆盖库里旧目录）', () => {
    expect(shouldWriteBackPdfChapters(mk([null, null, null, null, null]))).toBe(false);
  });

  it('刚好 80% 成功 → 允许写回', () => {
    expect(shouldWriteBackPdfChapters(mk([1, 2, 3, 4, null]))).toBe(true);
  });

  it('低于 80% → 拒绝写回', () => {
    expect(shouldWriteBackPdfChapters(mk([1, null, null, null, null]))).toBe(false);
  });

  it('空目录视为通过（交给调用方处理）', () => {
    expect(shouldWriteBackPdfChapters([])).toBe(true);
  });
});
