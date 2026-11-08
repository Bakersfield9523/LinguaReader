import { describe, it, expect } from "vitest";
import {
  DICT_FAIL_TTL_MS,
  readDictCache,
  writeDictCache,
  invalidateDictCache,
  clearDictFailures,
  type DictCacheMap,
} from "../dictCache";

interface Def { word: string }
const make = () => new Map() as DictCacheMap<Def>;

describe("dictCache", () => {
  it("T1: 未命中返回 undefined（与 null 区分）", () => {
    expect(readDictCache(make(), "en::hello", 0)).toBeUndefined();
  });

  it("T2: 成功结果长期缓存", () => {
    const m = make();
    const v = { word: "hello" };
    writeDictCache(m, "en::hello", v, 0);
    expect(readDictCache(m, "en::hello", Number.MAX_SAFE_INTEGER - 1)).toEqual(v);
  });

  it("T3: 失败结果命中时返回 null，而不是 undefined", () => {
    const m = make();
    writeDictCache(m, "en::magnets", null, 0);
    expect(readDictCache(m, "en::magnets", 1000)).toBeNull();
  });

  it("T4: 失败结果 TTL 后过期，允许重新查询", () => {
    const m = make();
    writeDictCache(m, "en::magnets", null, 0);
    expect(readDictCache(m, "en::magnets", DICT_FAIL_TTL_MS - 1)).toBeNull();
    expect(readDictCache(m, "en::magnets", DICT_FAIL_TTL_MS)).toBeUndefined();
    expect(m.has("en::magnets")).toBe(false);
  });

  it("T5: 过期条目会被真正删除，不会无限堆积", () => {
    const m = make();
    writeDictCache(m, "a", null, 0);
    writeDictCache(m, "b", null, 0);
    readDictCache(m, "a", DICT_FAIL_TTL_MS + 1);
    readDictCache(m, "b", DICT_FAIL_TTL_MS + 1);
    expect(m.size).toBe(0);
  });

  it("T6: 自定义 TTL 生效", () => {
    const m = make();
    writeDictCache(m, "a", null, 100, 500);
    expect(readDictCache(m, "a", 599)).toBeNull();
    expect(readDictCache(m, "a", 600)).toBeUndefined();
  });

  it("T7: invalidate 后立即可重查（重试按钮语义）", () => {
    const m = make();
    writeDictCache(m, "en::magnets", null, 0);
    invalidateDictCache(m, "en::magnets");
    expect(readDictCache(m, "en::magnets", 1)).toBeUndefined();
  });

  it("T8: 失败后再次成功会升级为长期缓存", () => {
    const m = make();
    writeDictCache(m, "en::magnets", null, 0);
    const v = { word: "magnets" };
    writeDictCache(m, "en::magnets", v, 1000);
    expect(readDictCache(m, "en::magnets", 1000 + DICT_FAIL_TTL_MS + 1)).toEqual(v);
  });

  it("T9: 不同语言 / 不同词互不串缓存", () => {
    const m = make();
    writeDictCache(m, "en::book", null, 0);
    writeDictCache(m, "fr::book", { word: "livre" }, 0);
    expect(readDictCache(m, "en::book", 1)).toBeNull();
    expect(readDictCache(m, "fr::book", 1)).toEqual({ word: "livre" });
    expect(readDictCache(m, "de::book", 1)).toBeUndefined();
  });

  it("T10: clearDictFailures 只清失败项，成功项保留（重试按钮语义）", () => {
    const m = make();
    writeDictCache(m, "en::magnets", null, 0);
    writeDictCache(m, "en::hello", { word: "hello" }, 0);
    clearDictFailures(m);
    expect(m.has("en::magnets")).toBe(false);
    expect(readDictCache(m, "en::hello", 1)).toEqual({ word: "hello" });
  });

  it("T11: clearDictFailures 不需要单词 key，避免标点/大小写规范化漏清", () => {
    const m = make();
    // 写入时用的是 cleanWord，重试按钮拿到的可能是带标点的 selectedWord
    writeDictCache(m, "en::magnets", null, 0);
    writeDictCache(m, "en::because", null, 0);
    clearDictFailures(m);
    expect(m.size).toBe(0);
  });
});
