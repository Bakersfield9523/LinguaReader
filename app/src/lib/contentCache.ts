/**
 * 章节正文缓存的 LRU 淘汰（4.4.19）。
 *
 * 背景：Reader 的 contents Map 无上限，value 是 processHTML 后的整章 HTML，
 * 图片已全部内联成 base64 data URL——一张 300KB 的图内联后约 400KB，
 * 含 10 张图的章节可达数 MB；预加载上限 120 章，读长书时常驻内存持续膨胀。
 *
 * 淘汰是安全的：Reader 有三条「未命中就重新解析」的兜底路径
 * （开书初始章 / 切章 / 高亮跳章），被淘汰的章节下次回来只是多解析一次，内容不会丢。
 */
export interface PutContentOptions {
  /** 缓存上限（条目数） */
  max: number;
  /** 永不淘汰的 key（通常是当前章） */
  keepId?: string;
  /** 淘汰前回调：用于把字数等派生数据抢救出来，避免统计倒退 */
  onEvict?: (id: string, html: string) => void;
}

/**
 * 写入一条内容并返回新的 Map（不修改入参）。
 * 重新插入会把它排到末尾——Map 保持插入序，队首即最久未使用。
 */
export function putContent(
  cache: Map<string, string>,
  id: string,
  html: string,
  opts: PutContentOptions,
): Map<string, string> {
  const next = new Map(cache);
  next.delete(id); // 先删再插 → 排到末尾，成为最新
  next.set(id, html);

  const { max, keepId, onEvict } = opts;
  if (!(max > 0)) return next;

  while (next.size > max) {
    let victim: string | null = null;
    for (const k of next.keys()) {
      if (k !== id && k !== keepId) {
        victim = k;
        break; // 队首 = 最旧
      }
    }
    if (victim === null) break; // 只剩当前章 / keepId，不能淘汰
    if (onEvict) {
      try {
        onEvict(victim, next.get(victim) || '');
      } catch {
        /* 抢救失败不影响淘汰 */
      }
    }
    next.delete(victim);
  }
  return next;
}
