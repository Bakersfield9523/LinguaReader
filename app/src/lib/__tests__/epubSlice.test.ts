import { describe, it, expect } from 'vitest';
import { splitHrefAnchor, buildChapterId, sliceHtmlByAnchor } from '../epubSlice';

/**
 * 4.4.18 回归测试：EPUB「同一 shard 内多章、靠锚点区分」导致的
 * 「目录多条指向同一章 / 多条一起被高亮」。
 *
 * fixture 结构照抄真书 History_of_the_Decline_and_Fall_split_001.html：
 *  - 正文开头有一张目录，里面是 <a href="#filepos..."> 回链（**不是**锚点目标）
 *  - 之后才是 <a id="filepos..."></a> 真正的小节锚点，紧跟该小节标题
 */

const FIXTURE =
  `<html><head><style>.calibre4{font-weight:bold}</style></head><body>` +
  // 书内目录（href 回链，绝不能被当成锚点目标）
  `<p class="calibre6"><a href="#filepos14732" class="calibre9">Volume 1</a></p>` +
  `<p class="calibre6"><a href="#filepos14916" class="calibre9">Introduction</a></p>` +
  `<p class="calibre6"><a href="#filepos66604" class="calibre9">Chapter I</a></p>` +
  // 真正的锚点目标 + 各自小节正文
  `<br class="calibre5"/><a id="filepos14732" class="calibre11"></a><p class="calibre6"> Vol. 1 </p>` +
  `<br class="calibre5"/><a id="filepos14916" class="calibre11"></a><p class="calibre6"> Preface By The Editor. </p>` +
  `<br class="calibre5"/><a id="filepos66604" class="calibre11"></a><p class="calibre6"> Chapter I: The Extent Of The Empire. </p>` +
  `</body></html>`;

describe('splitHrefAnchor', () => {
  it('T1 拆出文档与锚点', () => {
    const r = splitHrefAnchor('History_of_the_Decline_and_Fall_split_001.html#filepos14732');
    expect(r.docPart).toBe('History_of_the_Decline_and_Fall_split_001.html');
    expect(r.anchor).toBe('filepos14732');
  });

  it('T2 无锚点时 anchor 为 undefined', () => {
    const r = splitHrefAnchor('History_of_the_Decline_and_Fall_split_002.html');
    expect(r.docPart).toBe('History_of_the_Decline_and_Fall_split_002.html');
    expect(r.anchor).toBeUndefined();
  });

  it('T3 空 href 不抛异常', () => {
    expect(splitHrefAnchor('').docPart).toBe('');
    expect(splitHrefAnchor('').anchor).toBeUndefined();
  });

  it('T3b 只有锚点（无文档部分）', () => {
    const r = splitHrefAnchor('#onlyAnchor');
    expect(r.docPart).toBe('');
    expect(r.anchor).toBe('onlyAnchor');
  });
});

describe('buildChapterId', () => {
  const doc = 'History_of_the_Decline_and_Fall_split_001.html';

  it('T4 同一文档 + 不同锚点 => 4 个互不相同的 id（本 bug 的根因）', () => {
    const ids = [
      buildChapterId(doc, 'filepos14732'), // Volume 1
      buildChapterId(doc, 'filepos14916'), // Introduction
      buildChapterId(doc, 'filepos66604'), // Chapter I
      buildChapterId(doc, 'filepos168592'), // Chapter II
    ];
    expect(new Set(ids).size).toBe(4);
    expect(ids[0]).toBe(`${doc}#filepos14732`);
  });

  it('T4b 同文档 + 同锚点 => 同一个 id（真重复才能合并）', () => {
    expect(buildChapterId(doc, 'filepos14732')).toBe(buildChapterId(doc, 'filepos14732'));
  });

  it('T4c 无锚点时 id 就是文档路径', () => {
    expect(buildChapterId(doc)).toBe(doc);
  });

  it('T4d 文档为空时返回空串（由调用方回退 ch-N）', () => {
    expect(buildChapterId('')).toBe('');
  });
});

describe('sliceHtmlByAnchor', () => {
  it('T5 切片边界正确：取 [本锚点, 下一锚点)', () => {
    const out = sliceHtmlByAnchor(FIXTURE, 'filepos14732', 'filepos14916');
    expect(out).not.toBeNull();
    expect(out).toContain('Vol. 1');
    // 不能包含下一章的内容
    expect(out).not.toContain('Preface By The Editor.');
    expect(out).not.toContain('Chapter I: The Extent');
  });

  it('T6 无 nextAnchor 时切到文件末尾', () => {
    const out = sliceHtmlByAnchor(FIXTURE, 'filepos66604');
    expect(out).not.toBeNull();
    expect(out).toContain('Chapter I: The Extent');
    expect(out).not.toContain('Vol. 1');
  });

  it('T7 锚点不存在 => null（调用方回退整篇，不白屏）', () => {
    expect(sliceHtmlByAnchor(FIXTURE, 'not-exist')).toBeNull();
  });

  it('T7b 空 html / 空锚点 => null', () => {
    expect(sliceHtmlByAnchor('', 'filepos14732')).toBeNull();
    expect(sliceHtmlByAnchor(FIXTURE, '')).toBeNull();
  });

  it('T8 保留 head，保证 processHTML 仍能抽到书籍 CSS', () => {
    const out = sliceHtmlByAnchor(FIXTURE, 'filepos14732', 'filepos14916');
    expect(out).toContain('.calibre4{font-weight:bold}');
    expect(out).toContain('<style>');
  });

  it('T9 目录里的 href="#..." 回链不得被当成锚点目标', () => {
    const out = sliceHtmlByAnchor(FIXTURE, 'filepos14732', 'filepos14916');
    // 切片应从真正的 <a id=...> 开始，而不是从开头的书目回链开始
    expect(out).not.toContain('href="#filepos14732"');
    expect(out?.indexOf('id="filepos14732"')).toBeLessThan(out?.indexOf('Vol. 1') ?? -1);
  });

  it('T10 切出来的片段仍是完整 html 骨架', () => {
    const out = sliceHtmlByAnchor(FIXTURE, 'filepos14916', 'filepos66604');
    expect(out).toContain('Preface By The Editor.');
    expect(out).not.toContain('Vol. 1');
    expect(out).not.toContain('Chapter I: The Extent');
    expect(out!.startsWith('<html>')).toBe(true);
    expect(out!.endsWith('</html>')).toBe(true);
  });
});
