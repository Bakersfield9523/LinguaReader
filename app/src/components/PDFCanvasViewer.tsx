import { useEffect, useLayoutEffect, useRef, useState, useCallback, memo } from 'react';
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { HighlightDB } from '@/lib/db';
import { ZoomIn, ZoomOut, Maximize, ChevronLeft, ChevronRight } from 'lucide-react';
import type { WordMarker } from '@/types';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface WordBox {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sentence: string;
}

interface HlEntry {
  range: [number, number];
  type?: 'underline' | 'highlight';
}

interface LinkAnnotation {
  rect: [number, number, number, number];
  dest: string | any[] | null;
  url?: string;
  action?: any;
}

interface PDFCanvasViewerProps {
  fileData: string;
  pageNum: number;
  bookId?: string;
  chapterIndex?: number;
  onTextSelect?: (text: string, sentence?: string, range?: [number, number]) => void;
  onPageCount?: (count: number) => void;
  onPageChange?: (page: number) => void;
  highlightVersion?: number;
  wordMarkers?: WordMarker[];
  // 保留以兼容父组件调用；本组件现已通过"提交后安全网"自行重绘，不再依赖此 prop 触发。
  showSidebar?: boolean;
}

const MIN_SCALE = 0.3;
const MAX_SCALE = 4.0;

function clean(str: string): string {
  return str.replace(/[\u00AD\u200B-\u200F\u2060\uFEFF]/g, '');
}

/**
 * 检测两个单词是否在同一视觉行上。
 * 使用中点垂直距离判断，允许因字体差异（如上下标）带来的微小偏移。
 * 阈值取两个单词平均高度的 45%，兼容同行的字号变化。
 */
function isSameLine(a: WordBox, b: WordBox): boolean {
  const midA = a.y + a.h / 2;
  const midB = b.y + b.h / 2;
  return Math.abs(midA - midB) < (a.h + b.h) / 2 * 0.45;
}

/**
 * 动态溢出补偿：pdf.js 文本坐标与实际渲染字体存在系统偏差。
 * pdf.js 返回的是字体度量边界(em box)，而 Canvas 渲染的实际字形(glyph)往往超出这个范围，
 * 差异量与字号成正比。此函数返回按字号等比缩放的 padding。
 *
 * 关键观察（来自用户截图）：
 *   - 高度方向偏差大：字形顶部/底部常超出 em box，需较大补偿
 *   - 宽度方向偏差小：字形的左右边界通常在 em box 内，过多补偿会溢出到相邻词
 */
function wordOverflow(h: number): { padLeft: number; padTop: number; padW: number; padH: number } {
  const base = Math.max(6, h);
  return {
    padLeft: Math.max(1, Math.round(base * 0.08)),   // 左溢出 ~1px (防溢出到前一个词)
    padTop:  Math.max(4, Math.round(base * 0.55)),   // 上溢出 ~4-8px (盖住 ascender)
    padW:    Math.max(3, Math.round(base * 0.28)),   // 宽度增量 ~3-5px (防溢出到后一个词)
    padH:    Math.max(9, Math.round(base * 0.90)),   // 高度增量 ~9-13px (盖住 descender)
  };
}

const PDFCanvasViewer = memo(function PDFCanvasViewerInternal({
  fileData,
  pageNum,
  bookId,
  chapterIndex = 0,
  onTextSelect,
  onPageCount,
  onPageChange,
  highlightVersion = 0,
  wordMarkers = [],
  showSidebar = false,
}: PDFCanvasViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const wordsRef = useRef<WordBox[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startIdx: number; active: boolean }>({ startIdx: -1, active: false });
  const selRangeRef = useRef<[number, number] | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  // Force re-render for overlays (lightweight integer)
  const [, setTick] = useState(0);

  // hlEntries ref — never triggers React re-render, overlays drawn via DOM directly
  const hlEntriesRef = useRef<HlEntry[]>([]);
  const markedSetRef = useRef<Set<string>>(new Set());
  const linkAnnotationsRef = useRef<LinkAnnotation[]>([]);
  const viewportRef = useRef<pdfjs.PageViewport | null>(null);

  // Track whether a highlight reload was requested while words were not ready
  const pendingHighlightReloadRef = useRef(false);
  // Render generation counter to prevent stale async results from overwriting state
  const renderGenerationRef = useRef(0);

  // Sync marked words from props into ref
  // 不在此处调用 drawAllOverlays——下面的"高亮/标记变化" useLayoutEffect 会负责重绘，
  // 避免在 effect 阶段先重绘一次、再在 layout effect 阶段再重绘一次（双重开销）。
  useEffect(() => {
    markedSetRef.current = new Set((wordMarkers || []).map(w => w.word.toLowerCase()));
  }, [wordMarkers]);

  // Load saved highlights from DB into ref
  useEffect(() => {
    if (!bookId) { hlEntriesRef.current = []; return; }
    let cancelled = false;

    (async () => {
      let words = wordsRef.current;
      if (!words || words.length === 0) {
        await new Promise(r => setTimeout(r, 120));
        if (cancelled) return;
        words = wordsRef.current;
        if (!words || words.length === 0) return;
      }

      try {
        const all = await HighlightDB.getByBookId(bookId);
        if (cancelled) return;
        const pageHls = all.filter(h => h.chapterIndex === chapterIndex);
        const entries: HlEntry[] = [];
        for (const h of pageHls) {
          if (!h.text && h.startIndex == null) continue;
          const r = resolveHighlightRange(words, h);
          if (r) entries.push({ range: r, type: (h.type as 'underline' | 'highlight') || 'highlight' });
        }
        hlEntriesRef.current = entries;
        // 重绘由 [highlightVersion] useLayoutEffect 统一负责，避免重复
      } catch {
        /* ignore */
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, chapterIndex, highlightVersion]);

  // ===== Load PDF =====
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    pdfRef.current = null;
    wordsRef.current = [];
    hlEntriesRef.current = [];
    selRangeRef.current = null;
    if (overlayContainerRef.current) overlayContainerRef.current.innerHTML = '';

    (async () => {
      try {
        let base64 = fileData;
        if (fileData.includes(',')) base64 = fileData.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        let pdf: pdfjs.PDFDocumentProxy | undefined;
        try {
          pdf = await pdfjs.getDocument({ data: bytes }).promise;
        } catch (firstErr: any) {
          // 部分环境（如 Tauri 生产包）worker 加载/执行异常会导致加载失败，
          // 回退到禁用 worker 的主线程渲染模式
          pdfjs.GlobalWorkerOptions.workerSrc = '';
          pdf = await pdfjs.getDocument({ data: bytes }).promise;
        }
        if (cancelled) { pdf.destroy(); return; }
        pdfRef.current = pdf;
        setTotalPages(pdf.numPages);
        try { onPageCount?.(pdf.numPages); } catch (e) { /* ignore */ }
        setLoading(false);
      } catch (e: any) {
        if (!cancelled) { setError(e?.message || 'PDF 加载失败'); setLoading(false); }
      }
    })();
    return () => {
      cancelled = true;
      // 销毁 PDF 文档对象，释放 worker 和内存
      if (pdfRef.current) {
        pdfRef.current.destroy();
        pdfRef.current = null;
      }
    };
  }, [fileData, onPageCount]);

  // ===== Render page =====
  useEffect(() => {
    if (!pdfRef.current || pageNum < 1 || totalPages < 1) return;
    const generation = ++renderGenerationRef.current;
    let cancelled = false;
    wordsRef.current = [];
    hlEntriesRef.current = [];
    selRangeRef.current = null;
    // 清屏与重绘之间没有异步空隙；再加上提交后 useLayoutEffect 安全网，
    // 用户永远不会看到空白覆盖层。
    setRenderError(null);

    (async () => {
      try {
        const page = await pdfRef.current!.getPage(Math.min(pageNum, totalPages));
        if (cancelled || generation !== renderGenerationRef.current) return;
        const viewport = page.getViewport({ scale });
        const dpr = window.devicePixelRatio || 1;
        const cssW = Math.floor(viewport.width);
        const cssH = Math.floor(viewport.height);
        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.width = Math.floor(cssW * dpr);
        canvas.height = Math.floor(cssH * dpr);
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;

        const ctx = canvas.getContext('2d')!;
        ctx.save();
        ctx.scale(dpr, dpr);
        await page.render({ canvasContext: ctx, viewport }).promise;
        ctx.restore();
        viewportRef.current = viewport;

        if (cancelled || generation !== renderGenerationRef.current) return;

        // 加载链接注释（内部跳转、外部 URL）
        try {
          const annotations = await page.getAnnotations();
          if (cancelled || generation !== renderGenerationRef.current) return;
          linkAnnotationsRef.current = annotations
            .filter((a: any) => a.subtype === 'Link')
            .map((a: any) => ({
              rect: a.rect as [number, number, number, number],
              dest: a.dest || null,
              url: a.url,
              action: a.action,
            }));
        } catch (e) {
          linkAnnotationsRef.current = [];
        }

        if (cancelled || generation !== renderGenerationRef.current) return;

        try {
          const tc = await page.getTextContent();
          if (cancelled || generation !== renderGenerationRef.current) return;
          const items = tc?.items || [];
          const builtWords = buildBoxes(items, viewport);
          // Re-match highlights with new words
          let entries: HlEntry[] = [];
          if (bookId) {
            const all = await HighlightDB.getByBookId(bookId);
            if (cancelled || generation !== renderGenerationRef.current) return;
            const pageHls = all.filter(h => h.chapterIndex === chapterIndex);
            for (const h of pageHls) {
              if ((!h.text && h.startIndex == null) || !builtWords.length) continue;
              const r = resolveHighlightRange(builtWords, h);
              if (r) entries.push({ range: r, type: (h.type as 'underline' | 'highlight') || 'highlight' });
            }
          }
          if (cancelled || generation !== renderGenerationRef.current) return;
          wordsRef.current = builtWords;
          hlEntriesRef.current = entries;
          pendingHighlightReloadRef.current = false;
        } catch (e) {
          if (!cancelled && generation === renderGenerationRef.current) wordsRef.current = [];
        }

        if (!cancelled && generation === renderGenerationRef.current) {
          selRangeRef.current = null;
          // 在即将重绘的前一刻才清零覆盖层——与 drawAllOverlays 之间无异步间隙，
          // 彻底消除"闪白消失一阵子"的问题。
          if (overlayContainerRef.current) overlayContainerRef.current.innerHTML = '';
          drawAllOverlays();
        }
      } catch (e: any) {
        console.error('[PDF] render error:', e);
        if (!cancelled && generation === renderGenerationRef.current) {
          setRenderError(e?.message || 'PDF 页面渲染失败');
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNum, scale, totalPages]);

  // 当渲染/视图参数变化导致 words 重新计算时，强制重绘覆盖层。
  // 仅在 pageNum/scale/totalPages 变化时触发，不依赖父组件重渲染。
  useLayoutEffect(() => {
    if (wordsRef.current.length > 0) {
      // 清掉旧覆盖层并重绘（绕开任何 key 缓存）
      if (overlayContainerRef.current) overlayContainerRef.current.innerHTML = '';
      drawAllOverlays();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNum, scale]);

  // 高亮/标记数据变化时重绘（不依赖父组件 setState）
  useLayoutEffect(() => {
    if (wordsRef.current.length === 0) return;
    drawAllOverlays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightVersion, wordMarkers]);

  // 覆盖层容器：挂在 canvas 外层 containerRef 上（见 JSX return 中的 <div ref={overlayContainerRef}>），
  // 这样 absolute inset-0 的原点与词坐标（相对 canvas 左上角）严格对齐，高亮不会整体错位。
  // 该 div 在 JSX 中没有任何子节点，React 在 re-render 时不会触碰它的 innerHTML，
  // 所有绘制都通过 drawAllOverlays() 命令式完成——单一代码路径，无竞态、无"闪白"。
  const overlayContainerRef = useRef<HTMLDivElement>(null);

  const drawAllOverlays = useCallback(() => {
    const container = overlayContainerRef.current;
    if (!container) return;
    const words = wordsRef.current;
    // When words are empty (page is rendering), do NOT clear the container.
    if (!words || words.length === 0) { return; }

    // Build HTML string for all overlays (single innerHTML call = single reflow)
    const parts: string[] = [];
    const marked = markedSetRef.current;
    const hlEntries = hlEntriesRef.current;

    /**
     * 将索引数组按「连续序号 + 同行」合并为段，每段调用 render(firstWord, lastWord) 生成一个覆盖块。
     * 这是解决"高亮断裂"和"下划线切断"的关键：同行相邻单词合并为一个连续矩形/线条。
     */
    function pushMergedSegments(
      indices: number[],
      render: (first: WordBox, last: WordBox) => string,
    ) {
      if (indices.length === 0) return;
      let groupStart = 0;
      for (let i = 0; i < indices.length; i++) {
        const cur = indices[i];
        const next = indices[i + 1];
        // 分组边界：索引不连续 或 不在同一行
        const endOfGroup =
          next === undefined ||
          next !== cur + 1 ||
          !isSameLine(words[cur], words[next]);
        if (endOfGroup) {
          parts.push(render(words[indices[groupStart]], words[cur]));
          groupStart = i + 1;
        }
      }
    }

    // ── DB highlights & underlines ──
    for (const entry of hlEntries) {
      const [s, e] = entry.range;
      // 收集当前高亮范围内的所有单词索引
      const indices: number[] = [];
      for (let i = s; i <= e && i < words.length; i++) indices.push(i);

      if (entry.type === 'underline') {
        pushMergedSegments(indices, (first, last) => {
          const ov = wordOverflow(last.h);
          const top = Math.round(first.y + first.h + ov.padTop * 0.3);
          const left = Math.round(first.x - ov.padLeft);
          const width = Math.max(2, Math.round(last.x + last.w - first.x) + ov.padW);
          return `<div style="position:absolute;pointer-events:none;left:${left}px;top:${top}px;width:${width}px;height:2px;background:#e5a349;border-radius:1px;z-index:2;"></div>`;
        });
      } else {
        pushMergedSegments(indices, (first, last) => {
          const ov = wordOverflow(last.h);
          const top = Math.round(first.y - ov.padTop);
          const left = Math.round(first.x - ov.padLeft);
          const width = Math.max(2, Math.round(last.x + last.w - first.x) + ov.padW);
          const height = Math.max(6, Math.round(last.y + last.h - first.y) + ov.padH);
          return `<div style="position:absolute;pointer-events:none;left:${left}px;top:${top}px;width:${width}px;height:${height}px;background:rgba(229,163,73,0.55);border-radius:2px;z-index:1;"></div>`;
        });
      }
    }

    // ── Marked words（生词标记，跳过已被高亮覆盖的）──
    const covered = new Set<number>();
    for (const entry of hlEntries) {
      for (let i = entry.range[0]; i <= entry.range[1] && i < words.length; i++) covered.add(i);
    }
    const markedIndices: number[] = [];
    for (let i = 0; i < words.length; i++) {
      if (!covered.has(i) && marked.has(words[i].text.toLowerCase())) {
        markedIndices.push(i);
      }
    }
    pushMergedSegments(markedIndices, (first, last) => {
      const ov = wordOverflow(last.h);
      const top = Math.round(first.y - ov.padTop);
      const left = Math.round(first.x - ov.padLeft);
      const width = Math.max(2, Math.round(last.x + last.w - first.x) + ov.padW);
      const height = Math.max(6, Math.round(last.y + last.h - first.y) + ov.padH);
      return `<div style="position:absolute;pointer-events:none;left:${left}px;top:${top}px;width:${width}px;height:${height}px;background:rgba(229,163,73,0.40);border-radius:2px;z-index:1;"></div>`;
    });

    // ── 当前拖拽选中 ──
    const sel = selRangeRef.current;
    if (sel) {
      const selIndices: number[] = [];
      for (let i = sel[0]; i <= sel[1] && i < words.length; i++) selIndices.push(i);
      pushMergedSegments(selIndices, (first, last) => {
        const ov = wordOverflow(last.h);
        const top = Math.round(first.y - ov.padTop);
        const left = Math.round(first.x - ov.padLeft);
        const width = Math.max(2, Math.round(last.x + last.w - first.x) + ov.padW);
        const height = Math.max(6, Math.round(last.y + last.h - first.y) + ov.padH);
        return `<div data-sel-overlay="1" style="position:absolute;pointer-events:none;left:${left}px;top:${top}px;width:${width}px;height:${height}px;background:rgba(229,163,73,0.25);border-radius:2px;z-index:3;"></div>`;
      });
    }

    // ── Link annotations（PDF 内部跳转 / 外部链接点击区域）──
    const viewport = viewportRef.current;
    const links = linkAnnotationsRef.current;
    if (viewport && links && links.length > 0) {
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const [x1, y1, x2, y2] = link.rect;
        const pt1 = viewport.convertToViewportPoint(x1, y1);
        const pt2 = viewport.convertToViewportPoint(x2, y2);
        const left = Math.min(pt1[0], pt2[0]);
        const top = Math.min(pt1[1], pt2[1]);
        const width = Math.max(2, Math.abs(pt2[0] - pt1[0]));
        const height = Math.max(2, Math.abs(pt2[1] - pt1[1]));
        parts.push(`<div class="pdf-link-area" data-link-idx="${i}" style="position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;z-index:10;cursor:pointer;pointer-events:auto;background:rgba(0,0,0,0);border-radius:2px;"></div>`);
      }
    }

    container.innerHTML = parts.join('');
  }, []);

  // ===== 安全网与性能优化 =====
  // 之前每帧都重绘整张覆盖层——开启侧边栏时父组件重渲染会触发全量重绘，
  // 每次都是 O(N) 字符串拼接 + 一次 innerHTML 大块替换，N 较大时（500+ 词）会卡顿。
  //
  // 本轮改造：
  // 1) useLayoutEffect 仅在 words/标记/高亮变化时重绘，不依赖父组件每次重渲染
  // 2) 拖拽中（onMove）走"仅选区增量更新"路径，避免每帧全量重绘
  // 3) 移除"主动+被动双层防护"——那种方案在 500 词页面上就是 60fps 全量重绘，正是慢的根因
  //
  // 注："高亮消失"问题的根因不在覆盖层本身，而在于父组件（Reader）每次 setState
  // （如 setSelectedText / setShowSidebar）导致 memo 比较失败 → 整个 PDFCanvasViewer 重挂载 → 状态被清。
  // 修复点已转向 Reader 侧：selectedText 改为 ref + 显式 setState 时机。

  // Re-draw overlays when the container or its parent size changes (e.g. sidebar opens/closes)
  // 注意：仅在容器尺寸真正改变时（如侧边栏开关）触发，绝不与鼠标事件挂钩
  useEffect(() => {
    const target = outerRef.current || containerRef.current;
    if (!target) return;
    if (typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      if (raf) return; // 节流：每帧最多重绘一次
      raf = requestAnimationFrame(() => {
        raf = 0;
        drawAllOverlays();
      });
    });
    ro.observe(target);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [drawAllOverlays]);

  // ===== 关键：拦截 onMouseUp 全局冒泡，避免 React 在 onUp 后重渲染时意外重置覆盖层 =====
  // 当用户在 PDF 内 mousedown 后，浏览器原生 selection 仍可能存在；
  // 如果在 mouseup 之前页面有微小的 layout 抖动（侧边栏宽度变化、字体加载等），
  // 浏览器原生 drag-to-select 会显示一个蓝色 selection 框覆盖到我们的覆盖层之上，
  // 视觉上像"涂了一层橙色"——但那其实是浏览器原生的蓝色 + 我们橙色覆盖叠加。
  //
  // 解决：在 onUp 之前 e.preventDefault() 阻止浏览器原生 selection 接管。
  // 同时使用 `user-select: none` 配合 pointer-events 仅在拖拽期间临时禁用。
  // 但更简单的方案：在 onDown 时清掉任何现存浏览器 selection。
  // 见 onDown 内部。

  // ===== Hit test =====
  // 关键修复：pdf.js 文本层词框常有重叠，不能简单返回"第一个命中的词"。
  // 必须在所有命中的词中选中心点最近的那个，否则拖拽时可能错误包含相邻单词。
  const hitTest = useCallback((clientX: number, clientY: number): number => {
    const container = containerRef.current;
    if (!container) return -1;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const words = wordsRef.current;
    if (!words.length) return -1;

    // Step 1: 收集所有包含该点的词，选中心最近的（解决重叠词框误判）
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) {
        const cx = w.x + w.w / 2;
        const cy = w.y + w.h / 2;
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < bestDist) { bestDist = d; best = i; }
      }
    }
    if (best >= 0) return best;

    // Step 2: 回退——最近邻
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const d = Math.abs(x - (w.x + w.w / 2)) + Math.abs(y - (w.y + w.h / 2)) * 2;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return bestDist < 40 ? best : -1;
  }, []);

  // ===== Mouse handlers =====
  // 性能优化：拖拽过程中（onMove）只更新 selRangeRef，**不调用** drawAllOverlays。
  // 改为用一个轻量级"仅重绘选中段"的路径——如果容器中已有选中段 div 就只更新它，
  // 否则才走全量重绘。这样 500 词页面拖拽也不会卡。
  //
  // 全量重绘只在以下时机触发：
  //   - mousedown（开始选择）
  //   - mouseup（结束选择，需要清掉高亮指示）
  //   - 翻页/缩放/高亮数据变化
  const renderSelOnly = useCallback(() => {
    const container = overlayContainerRef.current;
    if (!container) return;
    const words = wordsRef.current;
    if (!words || words.length === 0) return;
    const sel = selRangeRef.current;
    // 删除所有旧的选中段
    const olds = container.querySelectorAll('[data-sel-overlay]');
    for (let i = 0; i < olds.length; i++) {
      olds[i].remove();
    }
    if (!sel) return;
    const [s, e] = sel;
    if (s < 0 || e >= words.length) return;
    let groupStart = 0;
    const selIndices: number[] = [];
    for (let i = s; i <= e; i++) selIndices.push(i);
    for (let i = 0; i < selIndices.length; i++) {
      const cur = selIndices[i];
      const next = selIndices[i + 1];
      const endOfGroup = next === undefined || next !== cur + 1 || !isSameLine(words[cur], words[next]);
      if (endOfGroup) {
        const first = words[selIndices[groupStart]];
        const last = words[cur];
        const ov = wordOverflow(last.h);
        const top = Math.round(first.y - ov.padTop);
        const left = Math.round(first.x - ov.padLeft);
        const width = Math.max(2, Math.round(last.x + last.w - first.x) + ov.padW);
        const height = Math.max(6, Math.round(last.y + last.h - first.y) + ov.padH);
        const div = document.createElement('div');
        div.setAttribute('data-sel-overlay', '1');
        div.style.cssText = `position:absolute;pointer-events:none;left:${left}px;top:${top}px;width:${width}px;height:${height}px;background:rgba(229,163,73,0.25);border-radius:2px;z-index:3;`;
        container.appendChild(div);
        groupStart = i + 1;
      }
    }
  }, []);

  const onDown = useCallback((e: React.MouseEvent) => {
    // 阻止浏览器原生 selection（蓝色高亮）。我们的橙色覆盖层会自己画。
    e.preventDefault();
    // 清除任何遗留的浏览器原生 selection
    try { window.getSelection()?.removeAllRanges(); } catch { /* noop */ }
    const idx = hitTest(e.clientX, e.clientY);
    dragRef.current = { startIdx: idx, active: idx >= 0 };
    selRangeRef.current = idx >= 0 ? [idx, idx] : null;
    // 只画/清选区，绝不重绘整张覆盖层（避免"满页变橙"+ 性能灾难）
    renderSelOnly();
  }, [hitTest, renderSelOnly]);

  const onMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current.active) return;
    const idx = hitTest(e.clientX, e.clientY);
    if (idx >= 0) {
      selRangeRef.current = [Math.min(dragRef.current.startIdx, idx), Math.max(dragRef.current.startIdx, idx)];
      // 仅重绘选区（O(1)），不动高亮/标记
      renderSelOnly();
    }
  }, [hitTest, renderSelOnly]);

  const onUp = useCallback(() => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;

    const range = selRangeRef.current;
    // 清空选区 ref，再 renderSelOnly() 把对应 div 移除
    selRangeRef.current = null;
    renderSelOnly();
    // 兜底：移除任何浏览器原生 selection
    try { window.getSelection()?.removeAllRanges(); } catch { /* noop */ }

    if (!range) return;
    const [s, en] = range;
    const words = wordsRef.current;
    if (!words.length) return;

    const parts: string[] = [];
    for (let i = s; i <= en && i < words.length; i++) parts.push(words[i].text);
    const text = parts.join(' ').trim();
    if (text.length < 1) return;

    // 上下文基于视觉位置动态提取，完全绕开字符偏移量（避免"找到页面其他位置同名词"的问题）
    const sentence = extractSentenceAt(words, s) || text;
    // 同时把选中的词索引区间传给父组件，便于持久化为 startIndex/endIndex，
    // 这样再次加载时能通过索引精确定位（解决"同一页多次出现相同文本时总匹配第一个"的问题）。
    if (typeof onTextSelect === 'function') {
      try { onTextSelect(text, sentence, range); } catch (e) { /* ignore */ }
    }
  }, [onTextSelect, renderSelOnly]);

  // ===== Link annotation click handler =====
  const handleLinkClick = useCallback(async (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const linkIdx = target.getAttribute('data-link-idx');
    if (linkIdx === null) return;

    e.stopPropagation();
    e.preventDefault();

    const link = linkAnnotationsRef.current[Number(linkIdx)];
    if (!link) return;

    if (link.url) {
      try { window.open(link.url, '_blank'); } catch (err) { console.error('打开链接失败:', err); }
      return;
    }

    if (link.dest && pdfRef.current) {
      try {
        let destArray: any[] | null = null;
        if (typeof link.dest === 'string') {
          destArray = await pdfRef.current.getDestination(link.dest);
        } else if (Array.isArray(link.dest)) {
          destArray = link.dest;
        }
        if (destArray && destArray[0]) {
          const pageIndex = await pdfRef.current.getPageIndex(destArray[0]);
          if (typeof pageIndex === 'number') {
            onPageChangeRef.current?.(pageIndex + 1);
          }
        }
      } catch (err) {
        console.error('PDF 链接跳转失败:', err);
      }
    }
  }, []);

  // ===== Zoom =====
  const zoomIn = useCallback(() => setScale(s => Math.min(MAX_SCALE, Math.round((s + 0.2) * 10) / 10)), []);
  const zoomOut = useCallback(() => setScale(s => Math.max(MIN_SCALE, Math.round((s - 0.2) * 10) / 10)), []);
  const zoomFit = useCallback(() => {
    const c = containerRef.current;
    if (!c || !pdfRef.current) return;
    const cw = c.clientWidth - 48;
    pdfRef.current.getPage(pageNum).then(p => {
      const uv = p.getViewport({ scale: 1 });
      setScale(Math.max(0.5, Math.min(2.5, Math.round((cw / uv.width) * 10) / 10)));
    }).catch(() => {});
  }, [pageNum]);

  // ===== Wheel: page turn when content fits, native scroll when zoomed in =====
  const pageNumRef = useRef(pageNum);
  pageNumRef.current = pageNum;
  const totalPagesRef = useRef(totalPages);
  totalPagesRef.current = totalPages;
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;

  useEffect(() => {
    const el = overlayContainerRef.current || containerRef.current;
    if (!el) return;
    // Find the nearest scrollable ancestor (the outer wrapper with overflow:auto)
    const scrollParent = (el.parentElement as HTMLElement) || el;
    let cooldown = false;

    const handler = (e: WheelEvent) => {
      // Only handle vertical scroll
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      if (Math.abs(e.deltaY) < 15) return;

      const canScrollY = scrollParent.scrollHeight > scrollParent.clientHeight + 1;

      if (canScrollY && scale > 1.5) {
        // Content is zoomed in and overflows — let native scrolling work
        // Don't call preventDefault, allow normal scroll behavior
        return;
      }

      // Content fits or only slightly zoomed — use wheel for page turn
      e.preventDefault();
      e.stopPropagation();
      if (cooldown) return;
      cooldown = true;
      setTimeout(() => { cooldown = false; }, 350);
      const pn = pageNumRef.current;
      const tp = totalPagesRef.current;
      if (e.deltaY > 0) {
        if (pn < tp) onPageChangeRef.current?.(pn + 1);
      } else {
        if (pn > 1) onPageChangeRef.current?.(pn - 1);
      }
    };
    // Capture phase to intercept before bubbling
    el.addEventListener('wheel', handler, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', handler, { capture: true });
  }, [scale]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn(); }
        else if (e.key === '-') { e.preventDefault(); zoomOut(); }
        else if (e.key === '0') { e.preventDefault(); zoomFit(); }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [zoomIn, zoomOut, zoomFit]);

  // Capture mousedown on link areas before React's synthetic handlers fire
  useEffect(() => {
    const container = overlayContainerRef.current;
    if (!container) return;
    container.addEventListener('mousedown', handleLinkClick, true);
    return () => container.removeEventListener('mousedown', handleLinkClick, true);
  }, [handleLinkClick]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-[#e5a349] border-t-transparent rounded-full" />
        <span className="ml-3 text-white/60">加载 PDF...</span>
      </div>
    );
  }
  if (error) return <div className="text-center py-20"><p className="text-red-400">{error}</p></div>;
  if (renderError) return <div className="text-center py-20"><p className="text-red-400">{renderError}</p></div>;

  return (
    <div ref={outerRef} className="relative w-full flex justify-center select-none" style={{ minHeight: '600px', maxHeight: 'calc(100vh - 120px)', overflow: 'auto', paddingBottom: '64px' }}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
    >
      <div ref={containerRef} className="relative inline-block">
        <canvas ref={canvasRef} className="block shadow-lg" style={{ cursor: 'text' }} />
        {/* 覆盖层：无 JSX 子节点，absolute inset-0 相对 canvas 外层对齐词坐标；
            pointer-events-none 让鼠标事件穿透到 canvas，由 outerRef 的 handler 处理。
            user-select:none 阻止浏览器原生蓝色 selection 出现——这是"涂橙"的真凶之一。 */}
        <div ref={overlayContainerRef} className="absolute inset-0 pointer-events-none" style={{ userSelect: 'none' }} />
      </div>

      {/* Bottom toolbar */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-[#282b2f]/95 backdrop-blur-sm px-5 py-2.5 rounded-full border border-white/10 shadow-2xl">
        <button onClick={() => onPageChange?.(Math.max(1, pageNum - 1))} disabled={pageNum <= 1}
          className="text-white/70 hover:text-white disabled:opacity-30 p-1">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-white/80 text-sm font-medium min-w-[70px] text-center select-none">{pageNum} / {totalPages}</span>
        <button onClick={() => onPageChange?.(Math.min(totalPages, pageNum + 1))} disabled={pageNum >= totalPages}
          className="text-white/70 hover:text-white disabled:opacity-30 p-1">
          <ChevronRight className="w-4 h-4" />
        </button>
        <div className="w-px h-5 bg-white/15 mx-1" />
        <button onClick={zoomOut} disabled={scale <= MIN_SCALE}
          className="text-white/70 hover:text-white disabled:opacity-30 p-1" title="缩小 (Ctrl+-)">
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="text-white/60 text-xs min-w-[42px] text-center select-none">{Math.round(scale * 100)}%</span>
        <button onClick={zoomIn} disabled={scale >= MAX_SCALE}
          className="text-white/70 hover:text-white disabled:opacity-30 p-1" title="放大 (Ctrl++)">
          <ZoomIn className="w-4 h-4" />
        </button>
        <button onClick={zoomFit}
          className="text-white/70 hover:text-white p-1" title="自适应 (Ctrl+0)">
          <Maximize className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
});

// ===== Build word boxes =====
function buildBoxes(items: any[], viewport: pdfjs.PageViewport): WordBox[] {
  const words: WordBox[] = [];
  const textItems: Array<{ rawStr: string; cleanStr: string; transform: number[]; width: number; charWidths?: number[] }> = [];

  for (const item of items) {
    if (!item || typeof item.str !== 'string' || !item.transform) continue;
    const rawStr = item.str;
    const cleanStr = clean(rawStr);
    if (!cleanStr) continue;
    textItems.push({ rawStr, cleanStr, transform: item.transform, width: item.width || 0, charWidths: item.chars || item.charWidths });
  }
  if (textItems.length === 0) return [];

  // NOTE: sentence 字段在 buildBoxes 阶段留空，
  // 改为在选中时通过 extractSentenceAt() 基于视觉位置动态提取，
  // 彻底避免字符偏移量累计误差导致找到错误的上下文。
  for (const item of textItems) {
    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontH = Math.hypot(tx[0], tx[1]);
    if (fontH <= 0) continue;

    const wordMatches = [...item.cleanStr.matchAll(/[^\s\p{P}\p{S}]+(?:[-'\u2010-\u2015][^\s\p{P}\p{S}]+)*/gu)];
    for (const match of wordMatches) {
      const word = match[0];
      const cleanStart = match.index!;
      const cleanEnd = cleanStart + word.length;

      let cleanPos = 0, rawStart = -1, rawEnd = item.rawStr.length;
      for (let ri = 0; ri < item.rawStr.length; ri++) {
        if (cleanPos === cleanStart) rawStart = ri;
        if (!/[\u00AD\u200B-\u200F\u2060\uFEFF]/.test(item.rawStr[ri])) cleanPos++;
        if (cleanPos === cleanEnd) { rawEnd = ri + 1; break; }
      }
      if (rawStart < 0) rawStart = 0;

      let prefixWidth = 0, wordWidth = 0;
      const totalScaledWidth = item.width * viewport.scale;
      if (item.charWidths && item.charWidths.length === item.rawStr.length) {
        const totalCharW = item.charWidths.reduce((a: number, b: number) => a + b, 0);
        const s2 = totalCharW > 0 ? totalScaledWidth / totalCharW : 0;
        for (let i = 0; i < rawStart; i++) prefixWidth += item.charWidths[i] * s2;
        for (let i = rawStart; i < rawEnd; i++) wordWidth += item.charWidths[i] * s2;
      } else {
        const totalCleanLen = item.cleanStr.length;
        if (totalCleanLen > 0) {
          const charW = totalScaledWidth / totalCleanLen;
          prefixWidth = cleanStart * charW;
          wordWidth = (cleanEnd - cleanStart) * charW;
        }
      }

      const cos = fontH > 0 ? tx[0] / fontH : 1;
      const sin = fontH > 0 ? tx[1] / fontH : 0;
      const startX = tx[4] + prefixWidth * cos;
      const startY = tx[5] + prefixWidth * sin;

      // 字体度量修正：pdf.js 的 transform 返回 em box 高度，
      // 但 Canvas 渲染的实际字形(glyph)几乎占满整个 em box。
      // 旧值 ascent=0.65/descent=0.15 (总高80%) 偏小，导致高亮盖不住文字。
      const ascent = fontH * 0.78;   // 覆盖大写字母 + ascender
      const descent = fontH * 0.22;  // 覆盖 descender (g, j, p, q, y)

      words.push({
        text: word,
        x: startX,
        y: startY - ascent,
        w: wordWidth,
        h: ascent + descent,
        sentence: '', // 留空，选中时动态提取
      });
    }
  }
  return words;
}

/**
 * 基于视觉位置动态提取所选词的上下文句子。
 *
 * 核心思路：完全绕开字符偏移量，直接用词框的 y 坐标判断行，
 * 找到包含目标词（索引 targetIdx）的"视觉段落"中最近的句子边界。
 *
 * 算法：
 * 1. 从 targetIdx 出发，向前后扩展，收集同一段落的词（段落边界 = 行间距突变 > 1.5 倍行高）
 * 2. 把收集到的词拼成文本，在其中做句子切分
 * 3. 找到包含目标词在段落文本中位置的那个句子返回
 *
 * 这样即使同一个单词在页面其他地方也出现，也能精确定位到选中位置的上下文。
 */
function extractSentenceAt(words: WordBox[], targetIdx: number): string {
  if (!words.length || targetIdx < 0 || targetIdx >= words.length) return '';

  const target = words[targetIdx];
  const avgH = target.h;

  // 向前扩展，直到遇到段落分隔（行间距突变）
  let start = targetIdx;
  for (let i = targetIdx - 1; i >= 0; i--) {
    const prev = words[i];
    const cur = words[i + 1];
    // 行间距突变：当前词底部到下一词顶部超过 1.5 倍平均行高 → 段落边界
    const rowGap = cur.y - (prev.y + prev.h);
    if (rowGap > avgH * 1.5) break;
    start = i;
    // 最多向前取 200 个词，避免跨越多个段落
    if (targetIdx - i > 200) break;
  }

  // 向后扩展
  let end = targetIdx;
  for (let i = targetIdx + 1; i < words.length; i++) {
    const prev = words[i - 1];
    const cur = words[i];
    const rowGap = cur.y - (prev.y + prev.h);
    if (rowGap > avgH * 1.5) break;
    end = i;
    if (i - targetIdx > 200) break;
  }

  // 把这段词拼成文本，同时记录目标词在拼接文本中的字符偏移
  let paragraphText = '';
  let targetCharOffset = -1;
  for (let i = start; i <= end; i++) {
    if (i === targetIdx) targetCharOffset = paragraphText.length;
    if (i > start) paragraphText += ' ';
    paragraphText += words[i].text;
  }

  if (targetCharOffset < 0) return paragraphText;

  // 在段落文本中切句，找包含 targetCharOffset 的那句
  const sentences = splitSentences(paragraphText);
  for (const s of sentences) {
    if (targetCharOffset >= s.offset && targetCharOffset < s.offset + s.text.length) {
      return s.text;
    }
  }

  // 回退：返回整个段落（不超过 300 字符，避免太长）
  return paragraphText.length > 300
    ? paragraphText.slice(Math.max(0, targetCharOffset - 150), targetCharOffset + 150).trim()
    : paragraphText;
}

function splitSentences(text: string): Array<{ text: string; offset: number }> {
  const result: Array<{ text: string; offset: number }> = [];
  // 改进的句子切分：
  // 1. 使用负向后瞻避免在缩写词（Mr. Dr. U.S. etc.）后切分
  // 2. 允许省略号（...）作为句子结束
  const regex = /[^.!?…]*(?:\.(?!\s*[a-z])|[!?]|…)+(?:\s+|$)/g;
  let m, lastEnd = 0;
  while ((m = regex.exec(text)) !== null) {
    const t = m[0].trim();
    if (t) result.push({ text: t, offset: m.index });
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd < text.length) {
    const trailing = text.slice(lastEnd).trim();
    if (trailing) result.push({ text: trailing, offset: lastEnd });
  }
  if (result.length === 0 && text.trim()) result.push({ text: text.trim(), offset: 0 });
  return result;
}

function findRange(words: WordBox[], target: string): [number, number] | null {
  if (!target || !words.length) return null;
  // 统一规范化：去除零宽字符 + 多空白折叠为一个空格
  const normTarget = target.toLowerCase().replace(/[\s\u00AD\u200B-\u200F\u2060\uFEFF]+/g, ' ').trim();
  if (!normTarget) return null;

  const targetWords = normTarget.split(' ');
  // 同时构建带标点和去标点两个版本的词表，优先精确匹配再回退去标点
  const wordTexts = words.map(w => w.text.toLowerCase());
  const wordTextsNoPunct = wordTexts.map(t => t.replace(/[\p{P}\p{S}]/gu, ''));
  const targetWordsNoPunct = targetWords.map(t => t.replace(/[\p{P}\p{S}]/gu, '')).filter(t => t.length > 0);

  // 方法1（优先）：按单词边界精确匹配
  for (let start = 0; start <= wordTexts.length - targetWords.length; start++) {
    let match = true;
    for (let j = 0; j < targetWords.length; j++) {
      if (wordTexts[start + j] !== targetWords[j]) {
        match = false;
        break;
      }
    }
    if (match) return [start, start + targetWords.length - 1];
  }

  // 方法1b：去标点后匹配（处理选中文本包含标点的情况，如 "Hello," vs word box "hello"）
  if (targetWordsNoPunct.length > 0) {
    for (let start = 0; start <= wordTextsNoPunct.length - targetWordsNoPunct.length; start++) {
      let match = true;
      for (let j = 0; j < targetWordsNoPunct.length; j++) {
        if (wordTextsNoPunct[start + j] !== targetWordsNoPunct[j]) {
          match = false;
          break;
        }
      }
      if (match) return [start, start + targetWordsNoPunct.length - 1];
    }
  }

  // 方法2（回退）：滑动窗口拼接匹配，适用于跨词合并的文本
  let bestRange: [number, number] | null = null;
  for (let start = 0; start < words.length; start++) {
    let combined = '';
    for (let end = start; end < Math.min(start + 40, words.length); end++) {
      if (end > start) combined += ' ';
      combined += words[end].text;
      if (combined.toLowerCase() === normTarget) {
        const curLen = end - start;
        const bestLen = bestRange ? bestRange[1] - bestRange[0] : Infinity;
        if (curLen < bestLen) bestRange = [start, end];
        break;
      }
      // 也尝试去标点后的拼接
      const combinedNoPunct = combined.replace(/[\p{P}\p{S}]/gu, '').toLowerCase();
      if (combinedNoPunct === normTarget.replace(/[\p{P}\p{S}]/gu, '')) {
        const curLen = end - start;
        const bestLen = bestRange ? bestRange[1] - bestRange[0] : Infinity;
        if (curLen < bestLen) bestRange = [start, end];
        break;
      }
      if (combined.length > normTarget.length + 20) break;
    }
  }
  return bestRange;
}

/**
 * 解析已保存高亮的词索引区间。
 * 优先使用持久化的 startIndex/endIndex（精确锚定到用户当时选中的那个出现位置，
 * 即使同一页该文本多次出现也不会错位）；缺失时回退到文本匹配 findRange。
 */
function resolveHighlightRange(
  words: WordBox[],
  h: { text?: string; startIndex?: number; endIndex?: number },
): [number, number] | null {
  if (
    h.startIndex != null &&
    h.endIndex != null &&
    h.startIndex >= 0 &&
    h.endIndex >= h.startIndex &&
    h.endIndex < words.length
  ) {
    return [h.startIndex, h.endIndex];
  }
  if (h.text) return findRange(words, h.text);
  return null;
}

export { PDFCanvasViewer };
export default PDFCanvasViewer;
