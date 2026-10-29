import { describe, it, expect, vi } from 'vitest';
import { putContent } from '../contentCache';

describe('putContent', () => {
  it('T1: 未超过上限时只追加，不淘汰', () => {
    let cache = new Map<string, string>();
    cache = putContent(cache, 'a', '<p>a</p>', { max: 5 });
    cache = putContent(cache, 'b', '<p>b</p>', { max: 5 });
    expect([...cache.keys()]).toEqual(['a', 'b']);
  });

  it('T2: 超过上限时淘汰最久未使用的（队首）', () => {
    let cache = new Map<string, string>();
    for (const k of ['a', 'b', 'c']) cache = putContent(cache, k, `<p>${k}</p>`, { max: 10 });
    cache = putContent(cache, 'd', '<p>d</p>', { max: 3 });
    expect([...cache.keys()]).toEqual(['b', 'c', 'd']);
    expect(cache.has('a')).toBe(false);
  });

  it('T3: 重复写入既有 key 会更新内容并置顶为最新', () => {
    let cache = new Map<string, string>();
    for (const k of ['a', 'b', 'c']) cache = putContent(cache, k, `<p>${k}</p>`, { max: 10 });
    cache = putContent(cache, 'a', '<p>a-updated</p>', { max: 3 });
    expect([...cache.keys()]).toEqual(['b', 'c', 'a']);
    expect(cache.get('a')).toBe('<p>a-updated</p>');
  });

  it('T4: keepId 永不淘汰（当前章节必须留在缓存里）', () => {
    let cache = new Map<string, string>();
    for (const k of ['a', 'b', 'c']) cache = putContent(cache, k, `<p>${k}</p>`, { max: 10 });
    cache = putContent(cache, 'a', '<p>a-new</p>', { max: 1, keepId: 'a' });
    expect(cache.has('a')).toBe(true);
    expect(cache.size).toBe(1);
  });

  it('T5: 淘汰时调用 onEvict 并带上被淘汰章节的正文', () => {
    let cache = new Map<string, string>();
    for (const k of ['a', 'b']) cache = putContent(cache, k, `<p>${k}</p>`, { max: 10 });
    const onEvict = vi.fn();
    cache = putContent(cache, 'c', '<p>c</p>', { max: 2, onEvict });
    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict).toHaveBeenCalledWith('a', '<p>a</p>');
  });

  it('T6: onEvict 抛异常不影响淘汰', () => {
    let cache = new Map<string, string>();
    for (const k of ['a', 'b']) cache = putContent(cache, k, `<p>${k}</p>`, { max: 10 });
    cache = putContent(cache, 'c', '<p>c</p>', {
      max: 2,
      onEvict: () => { throw new Error('boom'); },
    });
    expect(cache.size).toBe(2);
    expect(cache.has('a')).toBe(false);
  });

  it('T7: 不修改传入的 Map（返回新 Map）', () => {
    const original = new Map([['a', '1']]);
    const next = putContent(original, 'b', '2', { max: 5 });
    expect(original.size).toBe(1);
    expect(next.size).toBe(2);
  });

  it('T8: max <= 0 时视为不限制', () => {
    let cache = new Map<string, string>();
    for (const k of ['a', 'b', 'c']) cache = putContent(cache, k, k, { max: 0 });
    expect(cache.size).toBe(3);
  });
});
