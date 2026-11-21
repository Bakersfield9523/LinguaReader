import { useEffect, useRef, useCallback } from 'react';

// 阅读时长"有效计时"hook。
// 旧实现：进入阅读到离开的整段挂钟时间（Date.now()-start），软件挂后台/挂前台
// 但人已离开时会被记成数小时，时长严重虚高。
//
// 新策略——活跃窗口累计：
//   - 只有「窗口可见 + 最近 ACTIVE_WINDOW_MS 内有用户活动」的一秒才计入。
//   - 每次用户活动把"接下来 ACTIVE_WINDOW_MS"标记为可计；持续交互则全程计入；
//     停止活动超过窗口后停止计时（挂机最多虚增 ACTIVE_WINDOW 秒）。
//   - 阈值取 60s：沉浸阅读时翻页/滚动通常远快于此，不会误伤；挂机 7 小时只会
//     在开头多记约 1 分钟。
//   - 不强制要求 document.hasFocus()：实测 Tauri 窗口后台启动/未点击时 hasFocus
//     可能为 false，强制判断会让正常阅读完全不计时。切走应用后用户不再操作，
//     60s 活跃窗口耗尽即自动停计，效果等价且更稳。
//   - 无法 100% 区分"盯着屏幕静止不动"与"人走开了"，这是所有基于输入的活跃
//     检测共同的边界；60s 是准确性与误伤率的折中。
//
// 信号：
//   - 全局 DOM 事件（pointerdown/keydown/wheel/scroll/touchstart）——主文档交互
//   - visibilitychange —— 切标签、最小化
//   - 显式 markActivity() —— iframe 内滚动、PDF 选词/翻页等事件到达不了父窗口的场景

const ACTIVE_WINDOW_MS = 60_000;
const TICK_MS = 1_000;

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function useReadingTimer(enabled: boolean) {
  const lastActivityRef = useRef<number>(Date.now());
  const activeSecondsRef = useRef<number>(0);
  const enabledRef = useRef<boolean>(enabled);
  enabledRef.current = enabled;

  // 由外部交互回调显式调用，刷新活跃时间戳
  const markActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    lastActivityRef.current = Date.now();
    activeSecondsRef.current = 0;

    const onActivity = () => { lastActivityRef.current = Date.now(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') lastActivityRef.current = Date.now(); };

    const events: Array<[EventTarget, string, EventListener]> = [
      [window, 'pointerdown', onActivity],
      [window, 'keydown', onActivity],
      [window, 'wheel', onActivity],
      [window, 'scroll', onActivity],
      [window, 'touchstart', onActivity],
      [document, 'visibilitychange', onVisibility],
    ];
    // capture=true 确保 iframe 滚动等冒泡前的事件也能被父窗口捕获到
    events.forEach(([target, type, handler]) => target.addEventListener(type, handler, true));

    const ticker = window.setInterval(() => {
      if (!enabledRef.current) return;
      const now = Date.now();
      const visible = document.visibilityState === 'visible';
      const active = now - lastActivityRef.current <= ACTIVE_WINDOW_MS;
      if (visible && active) {
        activeSecondsRef.current += TICK_MS / 1000;
      }
    }, TICK_MS);

    return () => {
      window.clearInterval(ticker);
      events.forEach(([target, type, handler]) => target.removeEventListener(type, handler, true));
      // 结算：只保存累计的有效秒数（取整分钟）
      const minutes = Math.round(activeSecondsRef.current / 60);
      activeSecondsRef.current = 0;
      if (minutes > 0) {
        const today = localDateStr(new Date());
        import('./db').then(({ ReadingDayDB }) => ReadingDayDB.addMinutes(today, minutes)).catch(() => {});
      }
    };
  }, [enabled]);

  return markActivity;
}
