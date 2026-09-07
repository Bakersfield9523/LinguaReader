import { describe, it, expect } from 'vitest';
import {
  FONT_STACKS,
  GENERIC_FAMILY_RE,
  resolveFontStack,
  normalizeFontToken,
  type FontToken,
} from '../fonts';

describe('normalizeFontToken (旧值迁移)', () => {
  const cases: Array<[unknown, FontToken]> = [
    ['auto', 'auto'],
    ['serif', 'serif'],
    ['sans-serif', 'sans-serif'],
    // 旧版默认 'Georgia, serif' → 视为「跟随书籍」
    ['Georgia, serif', 'auto'],
    ['Times New Roman, serif', 'auto'],
    // 含 system-ui / -apple-system / sans-serif → sans
    ['system-ui, -apple-system, sans-serif', 'sans-serif'],
    ['-apple-system, sans-serif', 'sans-serif'],
    ['sans-serif', 'sans-serif'],
    // 异常值 → auto
    [undefined, 'auto'],
    ['', 'auto'],
    [null, 'auto'],
    [123, 'auto'],
  ];
  for (const [input, expected] of cases) {
    it(`normalizeFontToken(${JSON.stringify(input)}) === ${expected}`, () => {
      expect(normalizeFontToken(input)).toBe(expected);
    });
  }
});

describe('resolveFontStack (语言分支)', () => {
  it('auto / serif 拉丁语言走衬线栈', () => {
    expect(resolveFontStack('auto', 'en')).toContain('Georgia');
    expect(resolveFontStack('serif', 'en')).toContain('Georgia');
    expect(resolveFontStack('auto', 'en')).toBe(FONT_STACKS.serif);
  });

  it('sans-serif 拉丁语言走无衬线栈', () => {
    expect(resolveFontStack('sans-serif', 'en')).toContain('Segoe UI');
    expect(resolveFontStack('sans-serif', 'en')).toBe(FONT_STACKS.sans);
  });

  it('日语走日文字体栈', () => {
    expect(resolveFontStack('auto', 'ja')).toContain('Hiragino Mincho ProN');
    expect(resolveFontStack('sans-serif', 'ja')).toContain('Yu Gothic');
  });

  it('波兰语/乌克兰语（Latin-Ext / 西里尔）走拉丁衬线栈', () => {
    expect(resolveFontStack('auto', 'pl')).toContain('Georgia');
    expect(resolveFontStack('auto', 'uk')).toContain('Georgia');
    // Times New Roman / Arial 覆盖 Cyrillic 与 Latin-Extended-A
    expect(resolveFontStack('auto', 'uk')).toMatch(/Times New Roman|Arial/);
  });

  it('非法 token 兜底为 auto(衬线)', () => {
    expect(resolveFontStack('garbage', 'en')).toBe(FONT_STACKS.serif);
  });
});

describe('GENERIC_FAMILY_RE', () => {
  it('匹配 CSS 通用族关键字', () => {
    for (const f of ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-monospace', 'ui-rounded']) {
      expect(GENERIC_FAMILY_RE.test(f)).toBe(true);
    }
  });
  it('不匹配具体字体名', () => {
    expect(GENERIC_FAMILY_RE.test('Georgia')).toBe(false);
    expect(GENERIC_FAMILY_RE.test('PT-Serif')).toBe(false);
    expect(GENERIC_FAMILY_RE.test('"Bricolage Grotesque"')).toBe(false);
  });
});
