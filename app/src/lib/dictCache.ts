/**
 * 阅读器侧栏的词典结果缓存（4.4.22）。
 *
 * 背景：Reader.tsx 原先把「查不到」的 null 结果也永久缓存在组件级 Map 里。
 * 只要用户在后端尚未就绪的启动窗口期（或任何一次网络抖动时）点过某个词，
 * 之后即使后端恢复，同一个词在这个窗口里永远显示「找不到解析」——
 * 这正是「后端明明修好了、词典还是出不来」的放大环节。
 *
 * 约定：成功结果长期缓存；失败结果只缓存 15s（与 dictionary.ts 的
 * onlineDefCache 一致），过期后允许重新查。undefined = 未命中，null = 已查过且无结果。
 * 15s 是实测折中：后端掉线后 Rust watchdog 约 2s 发现、再约 5s 让 Node 冷启动
 * 到 listen，恢复约 7s；TTL 取 15s 保证用户重试时一定已过失败缓存，
 * 又保留防抖，避免狂点同一个生僻词反复打两个在线源。
 */
export const DICT_FAIL_TTL_MS = 15_000;

export interface DictCacheEntry<T> {
  v: T | null;
  exp: number;
}

export type DictCacheMap<T> = Map<string, DictCacheEntry<T>>;

/** 返回 undefined 表示缓存未命中（含已过期），null 表示命中了「查过且没结果」 */
export function readDictCache<T>(
  map: DictCacheMap<T>,
  key: string,
  now: number = Date.now(),
): T | null | undefined {
  const hit = map.get(key);
  if (!hit) return undefined;
  if (hit.exp <= now) {
    map.delete(key);
    return undefined;
  }
  return hit.v;
}

export function writeDictCache<T>(
  map: DictCacheMap<T>,
  key: string,
  value: T | null,
  now: number = Date.now(),
  failTtlMs: number = DICT_FAIL_TTL_MS,
): void {
  map.set(key, {
    v: value,
    exp: value ? Number.MAX_SAFE_INTEGER : now + failTtlMs,
  });
}

/** 「重试」按钮用它清掉该词的失败记录 */
export function invalidateDictCache<T>(map: DictCacheMap<T>, key: string): void {
  map.delete(key);
}

/**
 * 「重试词典」按钮用它清掉所有失败项（成功项保留）。
 * 按单词 key 清会因 selectedWord 与 cleanWord 的标点/大小写规范化不一致而漏清，
 * 所以直接扫一遍失败项全清，不依赖 key。
 */
export function clearDictFailures<T>(map: DictCacheMap<T>): void {
  for (const [key, entry] of map) {
    if (!entry.v) map.delete(key);
  }
}
