import { describe, it, expect } from 'vitest';
import { buildOutlineChapters, clampPage, type OutlineEntry } from '../pdfOutline';
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

describe('clampPage', () => {
  it('低于 1 收敛到 1', () => {
    expect(clampPage(0, 100)).toBe(1);
    expect(clampPage(-5, 100)).toBe(1);
  });
  it('超过总页数收敛到总页数', () => {
    expect(clampPage(999, 100)).toBe(100);
  });
  it('numPages 为 0（尚未拿到页数）时不设上限', () => {
    expect(clampPage(42, 0)).toBe(42);
  });
  it('四舍五入', () => {
    expect(clampPage(7.6, 100)).toBe(8);
  });
});

describe('buildOutlineChapters', () => {
  it('T1: 空 outline 返回空数组（由调用方 fallback 到逐页）', async () => {
    await expect(buildOutlineChapters([], resolver({}), 10)).resolves.toEqual([]);
  });

  it('T2: 顶层条目按 dest 解析出正确页码，href 是 1 基页码字符串', async () => {
    const outline: OutlineEntry[] = [
      { title: 'Chapter 1', dest: ['ref'] },
      { title: 'Chapter 2', dest: ['ref'] },
    ];
    const chapters = await buildOutlineChapters(outline, resolver({ 'Chapter 1': 3, 'Chapter 2': 17 }), 50);
    expect(chapters.map((c) => c.href)).toEqual(['3', '17']);
    expect(chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2']);
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

  it('T4: 三层嵌套同样不撞号、顺序正确', async () => {
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
  });

  it('T5: 页码超出总页数时被钳制', async () => {
    const outline: OutlineEntry[] = [{ title: 'X', dest: ['r'] }];
    const chapters = await buildOutlineChapters(outline, resolver({ X: 999 }), 20);
    expect(chapters[0].href).toBe('20');
  });

  it('T6: dest 解析失败时沿用上一个已解析页（而不是退化成 idx+1）', async () => {
    const outline: OutlineEntry[] = [
      { title: 'ok', dest: ['r'] },
      { title: 'broken', dest: ['r'] },
      { title: 'broken2', dest: null },
    ];
    const chapters = await buildOutlineChapters(outline, resolver({ ok: 12 }), 100);
    expect(chapters.map((c) => c.href)).toEqual(['12', '12', '12']);
  });

  it('T7: 无 title 时用「第 N 页」兜底', async () => {
    const chapters = await buildOutlineChapters([{ dest: ['r'] }], resolver({}), 100);
    expect(chapters[0].title).toBe('第 1 页');
  });

  it('T8: resolvePage 抛异常不会中断整棵树的解析', async () => {
    const boom = async (): Promise<number | null> => { throw new Error('pdfjs died'); };
    const chapters = await buildOutlineChapters([{ title: 'a', dest: ['r'] }, { title: 'b', dest: ['r'] }], boom, 100);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].href).toBe('1');
  });
});
