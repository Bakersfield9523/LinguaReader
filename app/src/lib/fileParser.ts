import ePub from 'epubjs';
import * as pdfjs from 'pdfjs-dist';
import type { Book, Chapter, PDFTextItem } from '@/types';
import type { Language } from '@/types';

// 导入 worker URL（Vite 会自动处理为静态资源路径）
// @ts-ignore
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// ============ 生成唯一ID ============
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// ============ epub 内相对路径解析 ============
// epub 中 <img src> 是“相对于当前 xhtml 章节文件”的路径，而 zip 内资源键是“相对书籍根目录”的绝对路径。
// 直接用字符串模糊匹配容易漏配（尤其多层 ../、OEBPS 目录、反斜杠、URL 编码）。
// 这里用标准的 posix 路径归一化，把 “章节路径 + 图片相对路径” 解析成 zip 内的绝对键，
// 逻辑与 epub.js 自身的 Path.resolve 一致（参考 Koodo Reader 等成熟阅读器依赖 epub.js 原生资源解析的思路）。
function normalizeBookPath(p: string): string {
  const parts = p.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else out.push('..');
    } else {
      out.push(part);
    }
  }
  return out.join('/');
}

function resolveBookPath(baseHref: string, src: string): string {
  // 反斜杠统一为斜杠；去掉查询串与锚点
  let s = src.replace(/\\/g, '/').split('?')[0].split('#')[0];
  if (!s) return '';
  // 以 / 开头：相对书籍根目录
  if (s.startsWith('/')) return normalizeBookPath(s.slice(1));
  // 否则相对当前章节所在目录（章节 href 本身即“相对 OPF 目录”的路径）
  const idx = baseHref.lastIndexOf('/');
  const baseDir = idx >= 0 ? baseHref.slice(0, idx) : '';
  const combined = baseDir ? baseDir + '/' + s : s;
  return normalizeBookPath(combined);
}

// 把 zip 内“绝对键”转换为“相对 OPF 目录”的路径。
// epub.js 的章节 href 与图片引用都是“相对 OPF 目录”的，因此两边都化成同一基准即可稳健匹配，
// 不依赖于具体目录名（OEBPS/、OPS/、EPUB/ 甚至无子目录都适用）。参考 Koodo Reader 依赖 epub.js 原生
// 资源解析、而非写死目录名的做法。
function opfRelPath(absPath: string, opfDir: string): string {
  let p = absPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  const dir = opfDir.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '').toLowerCase();
  if (dir) {
    const prefix = dir + '/';
    if (p.toLowerCase().startsWith(prefix)) {
      p = p.slice(prefix.length);
    }
  }
  return p;
}

// ============ 文件读取工具 ============
function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to convert blob to base64'));
    reader.readAsDataURL(blob);
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:application/octet-stream;base64,' + btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function base64ToText(base64: string): string {
  const binaryString = atob(base64.includes(',') ? base64.split(',')[1] : base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

// ============ 默认封面生成 ============
export function generateDefaultCover(title: string, subtitle?: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 600;
  const ctx = canvas.getContext('2d');
  
  if (ctx) {
    // 深色渐变背景
    const gradient = ctx.createLinearGradient(0, 0, 400, 600);
    gradient.addColorStop(0, '#1a1c1f');
    gradient.addColorStop(0.5, '#22262a');
    gradient.addColorStop(1, '#15171a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 400, 600);
    
    // 装饰线条
    ctx.strokeStyle = '#e5a349';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(40, 120);
    ctx.lineTo(360, 120);
    ctx.stroke();
    
    // 底部装饰线
    ctx.beginPath();
    ctx.moveTo(40, 480);
    ctx.lineTo(360, 480);
    ctx.stroke();
    
    // 书名 - 自动换行
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    
    const words = title.split(/\s+/);
    let line = '';
    let y = 220;
    const lineHeight = 44;
    const maxWidth = 340;
    ctx.font = 'bold 28px sans-serif';
    
    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i] + ' ';
      if (ctx.measureText(testLine).width > maxWidth && i > 0) {
        ctx.fillText(line.trim(), 200, y);
        line = words[i] + ' ';
        y += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line.trim(), 200, y);
    
    // 副标题
    if (subtitle) {
      ctx.fillStyle = '#ffffff60';
      ctx.font = '16px sans-serif';
      ctx.fillText(subtitle, 200, y + 50);
    }
    
    // 底部品牌
    ctx.fillStyle = '#e5a34980';
    ctx.font = '12px sans-serif';
    ctx.fillText('LinguaRead', 200, 540);
  }
  
  return canvas.toDataURL('image/png');
}

// ============ 章节处理：按原始目录顺序保留 ============

// 卷/部 关键词（仅用于标记 type，不过滤）
const VOLUME_PATTERNS = [
  /^part\s+[ivx\d]/i, /^book\s+[ivx\d]/i, /^volume\s+[ivx\d]/i,
  /^(第[一二三四五六七八九十\d]+部分)/i, /^(第[一二三四五六七八九十\d]+卷)/i, /^(第[一二三四五六七八九十\d]+部)/i,
  /^(partie\s+\w)/i, /^(livre\s+\w)/i, /^(tome\s+\w)/i,
  /^(teil\s+\w)/i, /^(buch\s+\w)/i,
];

// 卷首内容关键词（仅用于标记 type，不过滤）
const FRONT_MATTER_PATTERNS = [
  /^copyright/i, /^all rights/i, /^isbn/i, /^acknowledgements?/i,
  /^acknowledgments?/i, /^dedication$/i, /^epigraph$/i, /^foreword$/i,
  /^preface$/i, /^prologue$/i, /^introduction$/i, /^about the author/i,
];

// 附录关键词（仅用于标记 type，不过滤）
const BACK_MATTER_PATTERNS = [
  /^index$/i, /^appendix/i, /^bibliography/i, /^references$/i,
  /^afterword$/i, /^postscript$/i, /^glossary$/i,
];

/**
 * 分类章节类型（仅用于UI标记，不过滤任何章节）
 */
function classifyChapter(title: string): Chapter['type'] {
  if (!title || title.trim().length === 0) return 'section';
  // 目录
  if (/^(contents?|table of contents|toc)$/i.test(title)) return 'frontmatter';
  // 卷/部
  for (const p of VOLUME_PATTERNS) if (p.test(title)) return 'volume';
  // 卷首
  for (const p of FRONT_MATTER_PATTERNS) if (p.test(title)) return 'frontmatter';
  // 附录
  for (const p of BACK_MATTER_PATTERNS) if (p.test(title)) return 'frontmatter';
  return 'chapter';
}

/**
 * 扁平化章节树为数组
 */
function flattenChapters(chapters: Chapter[]): Chapter[] {
  const result: Chapter[] = [];
  for (const ch of chapters) {
    result.push(ch);
    if (ch.children) {
      result.push(...flattenChapters(ch.children));
    }
  }
  return result;
}

// ============ EPUB 解析器（改进版） ============
export class EPUBParser {
  private book: any;
  private resources: Map<string, string> = new Map(); // href -> base64
  private cssResources: Map<string, string> = new Map(); // href -> css text（书籍样式表）

  constructor(arrayBuffer: ArrayBuffer) {
    this.book = ePub(arrayBuffer);
  }

  async init(): Promise<void> {
    await this.book.ready;
  }

  getMetadata(): { title: string; author: string } {
    return {
      title: this.book.packaging?.metadata?.title || 'Unknown Book',
      author: this.book.packaging?.metadata?.creator || 'Unknown Author'
    };
  }

  // 从 EPUB 中提取资源文件并转为 base64
  async extractResources(): Promise<void> {
    try {
      // @ts-ignore - access internal archive (JSZip via epub.js)
      const archive = this.book.archive;
      if (!archive || !archive.zip) {
        console.warn('[EPUB] No archive available');
        return;
      }

      // Enumerate all files in the ZIP
      const allFiles = Object.keys(archive.zip.files || {});
      
      // Filter for image and font files
      const imageFiles = allFiles.filter(name => 
        /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(name)
      );
      
      if (imageFiles.length === 0) {
        console.log('[EPUB] No images found in archive');
        return;
      }

      console.log(`[EPUB] Found ${imageFiles.length} images in archive`);

      const mimeTypeMap: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
        bmp: 'image/bmp', ico: 'image/x-icon'
      };

      for (const path of imageFiles) {
        try {
          // Use archive.getBase64() - the official epub.js API
          const ext = path.split('.').pop()?.toLowerCase() || 'png';
          const mimeType = mimeTypeMap[ext] || 'image/png';
          
          // 优先用 JSZip 直接读取“纯 base64”——最可靠，不依赖 getBase64 对路径前缀/返回格式的假设
          let rawData: string | null = null;
          const zipEntry = archive.zip.files[path];
          if (zipEntry) {
            try {
              const arrayBuffer = await zipEntry.async('arraybuffer');
              const bytes = new Uint8Array(arrayBuffer);
              let binary = '';
              for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              rawData = btoa(binary);
            } catch {
              // 读取失败，下面用 getBase64 兜底
            }
          }

          // 兜底：尝试 getBase64。注意 epub.js 的 getBase64 内部用 url.substr(1) 定位，
          // 要求传入带前导 "/" 的路径；且它返回的是【完整 data URL】。
          if (!rawData && archive.getBase64) {
            try {
              const fixedPath = path.startsWith('/') ? path : '/' + path;
              const result = await archive.getBase64(fixedPath, mimeType);
              if (result && result.startsWith('data:')) {
                rawData = result; // 已是完整 data URL，直接使用
              } else if (result) {
                rawData = result; // 极少数情况返回纯 base64
              }
            } catch {
              // ignore
            }
          }

          if (!rawData) continue;

          // 统一为最终 data URL：若已是 data: 前缀则不再重复包装，避免双重前缀导致图片破图
          const dataUrl = rawData.startsWith('data:') ? rawData : `data:${mimeType};base64,${rawData}`;
          
          // 存储时做大小写与 URL 编码规范化，提升后续匹配命中率
          this.resources.set(path, dataUrl);
          this.resources.set(path.toLowerCase(), dataUrl);

          // 仅文件名（大小写两种）
          const fileName = path.split('/').pop()!;
          this.resources.set(fileName, dataUrl);
          this.resources.set(fileName.toLowerCase(), dataUrl);

          // 去掉 OPF 目录前缀，存为“相对 OPF 目录”的键（与章节 href 同一基准，通用解法，不写死 OEBPS/）
          const opfDir = (this.book?.directory || '').replace(/\\/g, '/').replace(/\/$/, '');
          const relOpf = opfRelPath(path, opfDir);
          if (relOpf && relOpf !== path) {
            this.resources.set(relOpf, dataUrl);
            this.resources.set(relOpf.toLowerCase(), dataUrl);
          }

          // 解码 %20 等 URL 编码后的版本（HTML 里常写成 my%20image.png）
          try {
            const decodedPath = decodeURIComponent(path);
            this.resources.set(decodedPath, dataUrl);
            this.resources.set(decodedPath.toLowerCase(), dataUrl);
            const decodedFile = decodedPath.split('/').pop()!;
            this.resources.set(decodedFile, dataUrl);
            this.resources.set(decodedFile.toLowerCase(), dataUrl);
          } catch {
            // ignore
          }
          
        } catch (e) {
          console.warn('[EPUB] Failed to extract image:', path, e);
        }
      }
      
      // 提取书籍样式表（.css），供章节 <link rel="stylesheet"> 解析后注入阅读器
      const cssFiles = allFiles.filter(name => /\.css$/i.test(name));
      for (const path of cssFiles) {
        try {
          const zipEntry = archive.zip.files[path];
          if (!zipEntry) continue;
          const text = await zipEntry.async('string');
          if (!text) continue;
          const store = (p: string) => {
            if (!p) return;
            this.cssResources.set(p, text);
            this.cssResources.set(p.toLowerCase(), text);
          };
          store(path);
          const fileName = path.split('/').pop()!;
          store(fileName);
          const opfDir = (this.book?.directory || '').replace(/\\/g, '/').replace(/\/$/, '');
          const relOpf = opfRelPath(path, opfDir);
          if (relOpf && relOpf !== path) store(relOpf);
          try {
            const decodedPath = decodeURIComponent(path);
            store(decodedPath);
            store(decodedPath.split('/').pop()!);
          } catch {
            // ignore
          }
        } catch (e) {
          console.warn('[EPUB] Failed to extract css:', path, e);
        }
      }

      console.log(`[EPUB] Successfully extracted ${this.resources.size} resource entries, ${this.cssResources.size} css files`);
    } catch (e) {
      console.warn('[EPUB] Failed to extract resources:', e);
    }
  }

  async getCoverUrl(): Promise<string | null> {
    try {
      // 策略1：通过 epub.js 标准 API 获取封面 URL
      const coverUrl = await this.book.coverUrl();
      if (coverUrl) {
        // 在已提取的资源中查找匹配
        for (const [path, base64] of this.resources) {
          if (coverUrl.includes(path) || path.includes(coverUrl)) return base64;
        }
        // 尝试直接 fetch
        try {
          const response = await fetch(coverUrl);
          if (response.ok) {
            const blob = await response.blob();
            return await blobToBase64(blob);
          }
        } catch {
          // fetch 可能对 blob: URL 失败，继续尝试其他策略
        }
      }

      // 策略2：从 OPF manifest 中查找 cover-image 属性
      try {
        const manifest = this.book.packaging?.manifest;
        if (manifest) {
          for (const item of Object.values(manifest) as any[]) {
            if (item.properties === 'cover-image' || item['properties'] === 'cover-image') {
              const href = item.href;
              if (href) {
                // 在已提取的资源中查找
                for (const [path, base64] of this.resources) {
                  if (path.includes(href) || href.includes(path)) return base64;
                }
              }
            }
          }
        }
      } catch {
        // manifest 访问失败，继续
      }

      // 策略3：从 OPF metadata 查找 cover meta 标签
      try {
        const metadata = this.book.packaging?.metadata;
        if (metadata) {
          // epub.js 可能把 meta 存在 metadata 中
          const coverMeta = (metadata as any).cover || (metadata as any)['cover'];
          if (coverMeta && typeof coverMeta === 'string') {
            // coverMeta 是 manifest item id
            const manifest = this.book.packaging?.manifest;
            if (manifest && manifest[coverMeta]) {
              const href = manifest[coverMeta].href;
              for (const [path, base64] of this.resources) {
                if (path.includes(href) || href.includes(path)) return base64;
              }
            }
          }
        }
      } catch {
        // 继续
      }

      // 策略4：在已提取的资源中按文件名查找含 "cover" 的图片
      const coverCandidates: string[] = [];
      const seen = new Set<string>();
      for (const [path, base64] of this.resources) {
        if (seen.has(base64)) continue; // 同一图片不同 key 只记录一次
        seen.add(base64);
        const lowerPath = path.toLowerCase();
        if (lowerPath.includes('cover') && !lowerPath.includes('css') && !lowerPath.includes('js')) {
          coverCandidates.push(path);
        }
      }
      if (coverCandidates.length > 0) {
        // 优先选择 cover.jpg/png，其次含 cover 的
        coverCandidates.sort((a, b) => {
          const aScore = a.toLowerCase().endsWith('cover.jpg') || a.toLowerCase().endsWith('cover.png') ? 0 : 1;
          const bScore = b.toLowerCase().endsWith('cover.jpg') || b.toLowerCase().endsWith('cover.png') ? 0 : 1;
          return aScore - bScore;
        });
        return this.resources.get(coverCandidates[0]) || null;
      }

      // 策略5：如果资源中只有少量图片，取第一张作为封面
      const uniqueImages: string[] = [];
      const seen2 = new Set<string>();
      for (const [path, base64] of this.resources) {
        if (seen2.has(base64)) continue;
        seen2.add(base64);
        uniqueImages.push(path);
      }
      if (uniqueImages.length === 1) {
        return this.resources.get(uniqueImages[0]) || null;
      }

      return null;
    } catch (e) {
      console.warn('Failed to get cover:', e);
      return null;
    }
  }

  async getChapters(): Promise<Chapter[]> {
    try {
      const navigation = await this.book.loaded.navigation;

      if (navigation && navigation.toc && navigation.toc.length > 0) {
        // 直接按TOC原始顺序和层级结构构建章节树，不过滤任何条目
        let globalIdx = 0;

        const buildTree = (items: any[], level: number): Chapter[] => {
          const result: Chapter[] = [];
          for (const item of items) {
            if (!item.label) continue;
            const ch: Chapter = {
              id: item.href || `ch-${globalIdx}`,
              title: item.label.trim() || `Section ${globalIdx + 1}`,
              index: globalIdx++,
              href: item.href || undefined,
              level,
              type: classifyChapter(item.label),
              isFrontMatter: false,
            };
            // 递归处理子项（保留原始层级）
            if (item.subitems && item.subitems.length > 0) {
              ch.children = buildTree(item.subitems, level + 1);
            }
            result.push(ch);
          }
          return result;
        };

        const treeChapters = buildTree(navigation.toc, 0);
        if (treeChapters.length > 0) {
          return treeChapters;
        }
      }

      // fallback: 从 spine 获取
      const spine = this.book.spine;
      if (spine && spine.items) {
        const spineChapters: Chapter[] = [];
        spine.items.forEach((item: any, index: number) => {
          spineChapters.push({
            id: item.href || `chapter-${index}`,
            title: `Section ${index + 1}`,
            index: index,
            href: item.href,
            level: 0,
            type: 'chapter' as const,
          });
        });
        return spineChapters;
      }
    } catch (e) {
      console.warn('Failed to get chapters:', e);
    }

    return [];
  }

  // 获取章节 HTML 内容（直接渲染，保留图片和格式）
  // 返回 { html: 清洗后的章节 HTML, css: 该章节涉及的书籍样式表（含内联与外部 link） }
  async getChapterContent(href: string): Promise<{ html: string; css: string }> {
    try {
      return await this.loadRawContent(href);
    } catch (e) {
      console.error('Error loading chapter:', e);
      return { html: '', css: '' };
    }
  }

  // 加载单个 href 的原始 HTML 内容（保留图片和格式）
  private async loadRawContent(href: string): Promise<string> {
    try {
      const item = await this.book.spine.get(href);
      if (!item) {
        try {
          const section = await this.book.section?.(href);
          if (section) {
            const html = section.output ? section.output() : (section.textContent || '');
            return this.processHTML(html, href);
          }
        } catch (e) {
          // ignore
        }
        return { html: '', css: '' };
      }

      await item.load(this.book.load.bind(this.book));

      // EPUB.js 的 item.contents 是 DocumentFragment，没有 innerHTML
      // 必须使用 item.output() 获取完整 HTML 字符串
      const html = typeof item.output === 'function' ? item.output() : '';
      if (!html) {
        // fallback: 尝试序列化 DocumentFragment
        try {
          const frag = item.contents;
          if (frag) {
            const serializer = new XMLSerializer();
            return this.processHTML(serializer.serializeToString(frag), href);
          }
        } catch {
          // ignore
        }
        return { html: '', css: '' };
      }

      return this.processHTML(html, href);
    } catch (e) {
      console.warn('Error loading raw content:', href, e);
      return { html: '', css: '' };
    }
  }

  /**
   * 处理 HTML：清理危险标签，替换图片 src 为 base64
   * 保留所有原始格式、样式、布局
   */
  private processHTML(html: string, baseHref?: string): { html: string; css: string } {
    if (!html) return { html: '', css: '' };

    const temp = document.createElement('div');
    temp.innerHTML = html;

    // 收集书籍自带 CSS（内联 <style> 与外部 <link rel="stylesheet">），
    // 稍后作用域化注入阅读器。若不收集，角标/引用等靠 class 定义的小字号排版会丢失。
    let bookCss = '';
    temp.querySelectorAll('style').forEach(el => {
      bookCss += '\n' + (el.textContent || '');
      el.remove();
    });
    temp.querySelectorAll('link').forEach(el => {
      const rel = (el.getAttribute('rel') || '').toLowerCase();
      const href = el.getAttribute('href') || '';
      const isSheet = rel.includes('stylesheet') || /\.css(\?|$)/i.test(href);
      if (isSheet) {
        const cssText = this.getCssResource(href, baseHref);
        if (cssText) bookCss += '\n' + cssText;
        el.remove();
      }
    });
    if (bookCss) bookCss = this.replaceResourceUrls(bookCss, baseHref);

    // 移除危险标签（style/link 已上方收集并处理）
    temp.querySelectorAll('script, nav, iframe, object, embed, base').forEach(el => el.remove());

    // XSS 防护：移除所有 on* 事件处理器属性
    temp.querySelectorAll('*').forEach(el => {
      // 收集要删除的属性（不能在遍历中直接删除）
      const attrsToRemove: string[] = [];
      for (let i = 0; i < el.attributes.length; i++) {
        const attr = el.attributes[i];
        // 移除所有 on* 事件属性
        if (attr.name.toLowerCase().startsWith('on')) {
          attrsToRemove.push(attr.name);
        }
        // 移除 javascript: 协议的 href/src
        if ((attr.name === 'href' || attr.name === 'src' || attr.name === 'xlink:href') &&
            attr.value.trim().toLowerCase().startsWith('javascript:')) {
          attrsToRemove.push(attr.name);
        }
      }
      attrsToRemove.forEach(name => el.removeAttribute(name));
    });

    // 处理图片：替换 src 为 base64
    temp.querySelectorAll('img').forEach((img) => {
      let src = img.getAttribute('src') || '';
      // srcset 兜底：没有 src 时退而使用 srcset 的第一张
      if (!src) {
        const srcset = img.getAttribute('srcset') || '';
        const first = srcset.split(',').map(s => s.trim().split(/\s+/)[0]).find(Boolean);
        if (first) {
          src = first;
          img.setAttribute('src', first);
        }
      }
      if (!src) return;

      // 尝试用 base64 替换 src（传入章节基准路径以正确解析相对引用）
      const base64 = this.findResourceBase64(src, baseHref);
      if (base64) {
        img.setAttribute('src', base64);
      }
      // 无论是否替换成功，都添加合适的样式
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      img.style.display = 'block';
      img.style.margin = '1em auto';
    });

    // 处理 SVG 中的 image 标签
    temp.querySelectorAll('svg image').forEach((img) => {
      let href = img.getAttribute('href') || img.getAttribute('xlink:href') || '';
      if (!href) return;
      const base64 = this.findResourceBase64(href, baseHref);
      if (base64) {
        img.setAttribute('href', base64);
        // Remove xlink:href if present
        img.removeAttribute('xlink:href');
      }
    });

    // 处理背景图片
    temp.querySelectorAll('[style*="url("]').forEach((el) => {
      const style = el.getAttribute('style') || '';
      const newStyle = this.replaceResourceUrls(style, baseHref);
      if (newStyle !== style) {
        el.setAttribute('style', newStyle);
      }
    });

    // 处理 <image> 标签（SVG 的 image 元素）
    temp.querySelectorAll('image').forEach((img) => {
      let href = img.getAttribute('href') || img.getAttribute('xlink:href') || '';
      if (!href) return;
      const base64 = this.findResourceBase64(href, baseHref);
      if (base64) {
        img.setAttribute('href', base64);
        img.removeAttribute('xlink:href');
      }
    });

    return { html: temp.innerHTML, css: bookCss };
  }

  /**
   * 根据 <link href> 解析并返回书籍样式表文本（从 cssResources 中查找）
   */
  private getCssResource(href: string, baseHref?: string): string | null {
    if (!href) return null;
    if (href.startsWith('data:') || href.startsWith('http') || href.startsWith('blob:')) return null;

    const candidates: string[] = [];
    const add = (s: string) => {
      if (!s) return;
      candidates.push(s);
      try { candidates.push(decodeURIComponent(s)); } catch { /* ignore */ }
      const lower = s.toLowerCase();
      candidates.push(lower);
      try { candidates.push(decodeURIComponent(lower)); } catch { /* ignore */ }
    };
    add(href);
    const stripped = href.replace(/^(\.\.\/)+/, '');
    if (stripped !== href) add(stripped);
    const file = href.split('/').pop() || '';
    if (file) add(file);
    if (baseHref) {
      const resolved = resolveBookPath(baseHref, href);
      if (resolved) add(resolved);
    }

    for (const c of candidates) {
      if (this.cssResources.has(c)) return this.cssResources.get(c)!;
    }
    return null;
  }

  /**
   * 查找资源的 base64 数据 URL
   * 尝试多种匹配方式
   */
  private findResourceBase64(src: string, baseHref?: string): string | null {
    if (!src) return null;

    // 如果已经是 data URL 或绝对 URL，直接返回
    if (src.startsWith('data:') || src.startsWith('http') || src.startsWith('blob:')) {
      return src;
    }

    // 构造候选 key：原始、解码 %20、小写、剥离 ../ 前缀后的各种组合，
    // 解决 epub 中“引用路径与 zip 内文件名大小写不一致 / 含 URL 编码空格”导致的匹配失败
    const candidates: string[] = [];
    const add = (s: string) => {
      candidates.push(s);
      try { candidates.push(decodeURIComponent(s)); } catch { /* ignore */ }
      const lower = s.toLowerCase();
      candidates.push(lower);
      try { candidates.push(decodeURIComponent(lower)); } catch { /* ignore */ }
    };
    add(src);
    // 剥离前导 ../ 后的路径
    const stripped = src.replace(/^(\.\.\/)+/, '');
    if (stripped !== src) add(stripped);
    // 文件名
    const srcFile = src.split('/').pop() || '';
    if (srcFile) add(srcFile);
    // 基于章节基准路径解析出的 zip 内“绝对路径”（最可靠的匹配键，解决多层../、OEBPS 目录、反斜杠等问题）
    if (baseHref) {
      const resolved = resolveBookPath(baseHref, src);
      if (resolved) add(resolved);
    }

    // 1) 直接匹配（大小写不敏感地查 Map）
    for (const c of candidates) {
      if (this.resources.has(c)) return this.resources.get(c)!;
    }

    // 2) 包含关系匹配（两边都小写化后比较，避免大小写漏配）
    const srcLower = src.toLowerCase();
    const srcFileLower = (src.split('/').pop() || '').toLowerCase();
    for (const [path, base64] of this.resources) {
      const pl = path.toLowerCase();
      if (pl.includes(srcLower) || srcLower.includes(pl)) return base64;
      const pf = (path.split('/').pop() || '').toLowerCase();
      if (pf && srcFileLower && pf === srcFileLower) return base64;
    }

    // 未找到匹配
    console.warn(`[EPUB] Image not found: ${src} (available: ${Array.from(this.resources.keys()).slice(0, 5).join(', ')}...)`);
    return null;
  }

  /**
   * 替换 CSS url() 中的资源引用为 base64
   */
  private replaceResourceUrls(css: string, baseHref?: string): string {
    return css.replace(/url\(['"]?([^'"\)]+)['"]?\)/g, (match, url) => {
      const base64 = this.findResourceBase64(url, baseHref);
      if (base64) return `url("${base64}")`;
      return match;
    });
  }

  // 获取章节纯文本（用于搜索/AI分析，不用于渲染）
  getPlainText(href: string): string {
    const html = this.rawCache.get(href) || '';
    if (!html) return '';
    const temp = document.createElement('div');
    temp.innerHTML = html;
    return (temp.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // 缓存原始 HTML 用于提取纯文本
  private rawCache: Map<string, string> = new Map();

  async getChapterContentWithCache(href: string): Promise<string> {
    const res = await this.getChapterContent(href);
    this.rawCache.set(href, res.html);
    return res.html;
  }

  async getAllContent(): Promise<{ chapters: Chapter[]; contents: Map<string, string> }> {
    // 先提取所有资源
    await this.extractResources();
    
    const chapters = await this.getChapters();
    const contents = new Map<string, string>();
    
    // 递归加载所有章节内容（包括子章节）
    const loadChapter = async (chapter: Chapter) => {
      if (chapter.href) {
        try {
          const content = await this.getChapterContent(chapter.href);
          contents.set(chapter.id, content.html);
        } catch (e) {
          console.warn(`Failed to load chapter ${chapter.id}:`, e);
          contents.set(chapter.id, '');
        }
      }
      // 递归加载子章节
      if (chapter.children && chapter.children.length > 0) {
        for (const child of chapter.children) {
          await loadChapter(child);
        }
      }
    };
    
    // 加载所有章节
    for (const chapter of chapters) {
      await loadChapter(chapter);
    }
    
    return { chapters, contents };
  }
}

// ============ PDF 解析器 ============
export class PDFParser {
  private pdf: pdfjs.PDFDocumentProxy | null = null;

  async init(arrayBuffer: ArrayBuffer): Promise<void> {
    // 设置 workerSrc 为 Vite 打包后的路径
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    // 传递 ArrayBuffer 的副本，避免被 worker transfer 后原始 buffer 被分离
    const data = new Uint8Array(arrayBuffer.slice(0));
    try {
      this.pdf = await pdfjs.getDocument({ data }).promise;
    } catch (e: any) {
      console.error('[PDF] getDocument failed:', e?.message || e);
      throw e;
    }
  }

  getMetadata(): { title: string; author: string } {
    return {
      title: 'PDF Document',
      author: 'Unknown Author'
    };
  }

  getNumPages(): number {
    return this.pdf?.numPages || 0;
  }

  async getPageText(pageNum: number): Promise<{ text: string; items: PDFTextItem[] }> {
    if (!this.pdf) return { text: '', items: [] };
    
    try {
      const page = await this.pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      const items: PDFTextItem[] = [];
      let fullText = '';
      
      const textItems = textContent.items.filter((item: any) => item.str && item.str.trim());
      const lines: Map<number, any[]> = new Map();
      
      textItems.forEach((item: any) => {
        const y = Math.round(item.transform[5] / 5) * 5;
        if (!lines.has(y)) lines.set(y, []);
        lines.get(y)!.push(item);
      });
      
      const sortedY = Array.from(lines.keys()).sort((a, b) => b - a);
      
      sortedY.forEach(y => {
        const lineItems = lines.get(y)!;
        lineItems.sort((a, b) => a.transform[4] - b.transform[4]);
        
        lineItems.forEach((item: any) => {
          items.push({
            text: item.str,
            x: item.transform[4],
            y: item.transform[5],
            width: item.width,
            height: item.height,
            fontName: item.fontName,
            fontSize: item.height
          });
          fullText += item.str;
        });
        fullText += '\n';
      });
      
      return { text: fullText.trim(), items };
    } catch (e) {
      console.error('Error getting page text:', e);
      return { text: '', items: [] };
    }
  }

  async getPageAsImage(pageNum: number, scale: number = 1.5): Promise<string | null> {
    if (!this.pdf) return null;
    
    try {
      const page = await this.pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // @ts-ignore
      await page.render({ canvasContext: ctx, viewport }).promise;
      
      return canvas.toDataURL('image/png');
    } catch (e) {
      console.error('Error rendering page:', e);
      return null;
    }
  }

  async getAllText(): Promise<{ pageNum: number; text: string; items: PDFTextItem[] }[]> {
    if (!this.pdf) return [];
    
    const results = [];
    for (let i = 1; i <= this.pdf.numPages; i++) {
      try {
        const { text, items } = await this.getPageText(i);
        results.push({ pageNum: i, text, items });
      } catch (e) {
        results.push({ pageNum: i, text: '', items: [] });
      }
    }
    return results;
  }

  async generateChaptersFromOutline(): Promise<Chapter[]> {
    if (!this.pdf) return [];
    
    // Try to get PDF outline (bookmarks) first
    let outline: any[] = [];
    try {
      outline = await this.pdf.getOutline() || [];
    } catch (e) {
      console.log('[PDF] No outline found');
    }
    
    if (outline.length > 0) {
      // Use PDF bookmarks as chapters
      const chapters: Chapter[] = [];
      const processOutlineItem = (item: any, idx: number): Chapter => {
        const dest = item.dest;
        let pageNum = idx + 1;
        
        // Try to resolve destination to page number
        if (dest) {
          if (typeof dest === 'string') {
            // Named destination - will be resolved later
          } else if (Array.isArray(dest) && dest[0] && typeof dest[0] === 'object') {
            pageNum = (dest[0] as any).num || idx + 1;
          }
        }
        
        const chapter: Chapter = {
          id: `pdf-ch-${idx}`,
          title: item.title || `第 ${pageNum} 页`,
          index: idx,
          href: String(pageNum),
        };
        
        if (item.items && item.items.length > 0) {
          chapter.children = item.items.map((child: any, ci: number) => 
            processOutlineItem(child, idx * 100 + ci)
          );
        }
        
        return chapter;
      };
      
      for (let i = 0; i < outline.length; i++) {
        chapters.push(processOutlineItem(outline[i], i));
      }
      
      return chapters;
    }
    
    // Fallback: one chapter per page
    const numPages = this.pdf.numPages;
    const chapters: Chapter[] = [];
    
    for (let i = 0; i < numPages; i++) {
      chapters.push({
        id: `page-${i + 1}`,
        title: `第 ${i + 1} 页`,
        index: i,
        href: String(i + 1),
      });
    }
    
    return chapters;
  }

  generateChapters(): Chapter[] {
    // Synchronous fallback - used during initial parse
    if (!this.pdf) return [];
    const numPages = this.pdf.numPages;
    const chapters: Chapter[] = [];
    
    for (let i = 0; i < numPages; i++) {
      chapters.push({
        id: `page-${i + 1}`,
        title: `第 ${i + 1} 页`,
        index: i,
        href: String(i + 1),
      });
    }
    
    return chapters;
  }
}

// ============ TXT 解析器 ============
export async function parseTXT(
  file: File,
  title: string,
  author: string,
  language: Language,
  customCover?: string
): Promise<Book> {
  let text: string;
  try {
    text = await readFileAsText(file);
  } catch (e) {
    throw new Error('无法读取文本文件');
  }
  
  if (!text || text.trim().length === 0) {
    throw new Error('文本文件为空');
  }
  
  const words = text.split(/\s+/).filter(w => w.length > 0).length;
  const finalTitle = title || file.name.replace(/\.txt$/i, '') || 'Text Document';
  const finalAuthor = author || 'Unknown Author';
  const cover = customCover || generateDefaultCover(finalTitle);
  
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const paragraphsPerChapter = 30;
  const chapters: Chapter[] = [];
  
  for (let i = 0; i < paragraphs.length; i += paragraphsPerChapter) {
    const chapterNum = Math.floor(i / paragraphsPerChapter) + 1;
    const _chapterParagraphs = paragraphs.slice(i, i + paragraphsPerChapter);
    void _chapterParagraphs;
    chapters.push({
      id: `chapter-${chapterNum}`,
      title: `第 ${chapterNum} 章`,
      index: chapterNum - 1,
    });
  }
  
  if (chapters.length === 0) {
    chapters.push({ id: 'chapter-1', title: '全文', index: 0 });
  }
  
  const textBytes = new TextEncoder().encode(text);
  const fileDataBase64 = arrayBufferToBase64(textBytes.buffer);
  
  return {
    id: generateId(),
    title: finalTitle,
    author: finalAuthor,
    cover,
    language,
    format: 'txt',
    fileData: fileDataBase64,
    fileType: 'text/plain',
    createdAt: Date.now(),
    chapters,
    totalWords: words,
    currentChapter: 0
  };
}

// ============ 主解析函数 ============
export async function parseBook(
  file: File,
  metadata: {
    title: string;
    author: string;
    language: Language;
    cover?: string;
  }
): Promise<Book> {
  const fileName = file.name.toLowerCase();
  const maxSize = 50 * 1024 * 1024; // 50MB
  
  if (file.size > maxSize) {
    throw new Error('文件过大，请上传小于 50MB 的文件');
  }
  
  try {
    if (fileName.endsWith('.epub')) {
      return await parseEPUB(file, metadata.title, metadata.author, metadata.language, metadata.cover);
    } else if (fileName.endsWith('.pdf')) {
      return await parsePDF(file, metadata.title, metadata.author, metadata.language, metadata.cover);
    } else if (fileName.endsWith('.txt')) {
      return await parseTXT(file, metadata.title, metadata.author, metadata.language, metadata.cover);
    } else {
      throw new Error('不支持的文件格式，请使用 EPUB、PDF 或 TXT 文件');
    }
  } catch (e: any) {
    console.error('Parse book error:', e);
    throw e;
  }
}

// ============ EPUB 解析（主函数） ============
async function parseEPUB(
  file: File,
  title: string,
  author: string,
  language: Language,
  customCover?: string
): Promise<Book> {
  let arrayBuffer: ArrayBuffer;
  
  try {
    arrayBuffer = await readFileAsArrayBuffer(file);
  } catch (e) {
    throw new Error('无法读取 EPUB 文件');
  }
  
  let parser: EPUBParser;
  try {
    parser = new EPUBParser(arrayBuffer);
    await parser.init();
  } catch (e) {
    console.error('Failed to parse EPUB:', e);
    throw new Error('无法解析 EPUB 文件，文件可能已损坏');
  }
  
  // 先提取所有图片资源
  await parser.extractResources();
  
  const meta = parser.getMetadata();
  const finalTitle = title || meta.title || 'Unknown Book';
  const finalAuthor = author || meta.author || 'Unknown Author';
  
  // 获取封面
  let cover: string;
  if (customCover) {
    cover = customCover;
  } else {
    const coverUrl = await parser.getCoverUrl();
    cover = coverUrl || generateDefaultCover(finalTitle);
  }
  
  // 获取章节（已过滤非正文）
  let chapters: Chapter[];
  try {
    chapters = await parser.getChapters();
  } catch (e) {
    chapters = [];
  }
  
  const fileDataBase64 = arrayBufferToBase64(arrayBuffer);
  
  return {
    id: generateId(),
    title: finalTitle,
    author: finalAuthor,
    cover,
    language,
    format: 'epub',
    fileData: fileDataBase64,
    fileType: 'application/epub+zip',
    createdAt: Date.now(),
    chapters: chapters.length > 0 ? chapters : undefined,
    currentChapter: 0
  };
}

// ============ PDF 解析（主函数） ============
async function parsePDF(
  file: File,
  title: string,
  author: string,
  language: Language,
  customCover?: string
): Promise<Book> {
  let arrayBuffer: ArrayBuffer;
  
  try {
    arrayBuffer = await readFileAsArrayBuffer(file);
  } catch (e) {
    throw new Error('无法读取 PDF 文件');
  }
  
  // 立即复制一份独立的 buffer 用于保存到数据库
  //（pdfjs.init() 会消耗/transfer 传进去的 ArrayBuffer）
  const saveBuffer = arrayBuffer.slice(0);
  
  let parser = new PDFParser();
  try {
    await parser.init(arrayBuffer);
  } catch (e: any) {
    console.error('[PDF] init error:', e);
    const detail = e?.message || String(e);
    throw new Error(`PDF 解析失败: ${detail}`);
  }
  
  const finalTitle = title || file.name.replace(/\.pdf$/i, '') || 'PDF Document';
  
  let cover: string;
  if (customCover) {
    cover = customCover;
  } else {
    const coverImage = await parser.getPageAsImage(1, 0.5);
    cover = coverImage || generateDefaultCover(finalTitle);
  }
  
  // Try to get chapters from PDF outline (bookmarks), fallback to per-page
  let chapters: Chapter[];
  try {
    chapters = await parser.generateChaptersFromOutline();
  } catch (e) {
    chapters = parser.generateChapters();
  }
  // 使用独立的 saveBuffer，不受 pdfjs 影响
  const fileDataBase64 = arrayBufferToBase64(saveBuffer);
  
  return {
    id: generateId(),
    title: finalTitle,
    author: author || 'Unknown Author',
    cover,
    language,
    format: 'pdf',
    fileData: fileDataBase64,
    fileType: 'application/pdf',
    createdAt: Date.now(),
    chapters,
    currentChapter: 0,
    totalWords: parser.getNumPages() * 250
  };
}

// ============ 获取书籍内容（阅读器用） ============
export async function getBookContent(
  book: Book
): Promise<{ parser: EPUBParser | PDFParser | null; chapters: Chapter[]; contents: Map<string, string> }> {
  const contents = new Map<string, string>();
  
  try {
    const arrayBuffer = base64ToArrayBuffer(book.fileData);
    
    if (book.format === 'epub') {
      let parser: EPUBParser;
      try {
        parser = new EPUBParser(arrayBuffer);
        await parser.init();
      } catch (e) {
        return { parser: null, chapters: book.chapters || [], contents };
      }
      
      // 提取图片资源
      await parser.extractResources();
      
      let chapters: Chapter[];
      try {
        chapters = await parser.getChapters();
      } catch (e) {
        chapters = book.chapters || [];
      }
      
      // 递归加载所有章节内容（包括子章节）
      const loadChapterRecursively = async (chapter: Chapter) => {
        if (chapter.href) {
          try {
            const content = await parser.getChapterContent(chapter.href);
            contents.set(chapter.id, content.html);
          } catch (e) {
            contents.set(chapter.id, '');
          }
        }
        if (chapter.children && chapter.children.length > 0) {
          for (const child of chapter.children) {
            await loadChapterRecursively(child);
          }
        }
      };
      
      if (chapters.length > 0) {
        for (const chapter of chapters) {
          await loadChapterRecursively(chapter);
        }
      }
      
      return { parser, chapters, contents };
      
    } else if (book.format === 'pdf') {
      let parser = new PDFParser();
      try {
        await parser.init(arrayBuffer);
      } catch (e) {
        return { parser: null, chapters: book.chapters || [], contents };
      }
      
      // Use existing chapters or regenerate from outline
      let chapters: Chapter[];
      if (book.chapters && book.chapters.length > 0) {
        chapters = book.chapters;
      } else {
        try {
          chapters = await parser.generateChaptersFromOutline();
        } catch (e) {
          chapters = parser.generateChapters();
        }
      }
      
      // PDF content is rendered on-demand by PDFCanvasViewer — no need to preload
      return { parser, chapters, contents };
      
    } else if (book.format === 'txt') {
      let text: string;
      try {
        text = base64ToText(book.fileData);
      } catch (e) {
        return { parser: null, chapters: book.chapters || [], contents };
      }
      
      const chapters = book.chapters || [];
      
      if (chapters.length > 0) {
        const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
        // 使用与 parseTXT 相同的固定分段逻辑（每章 30 段），确保章节边界一致
        const paragraphsPerChapter = 30;

        chapters.forEach((chapter, index) => {
          const startIdx = index * paragraphsPerChapter;
          const endIdx = Math.min((index + 1) * paragraphsPerChapter, paragraphs.length);
          contents.set(chapter.id, paragraphs.slice(startIdx, endIdx).join('\n\n'));
        });
      } else {
        contents.set('chapter-1', text);
      }
      
      return { parser: null, chapters, contents };
    }
  } catch (e) {
    console.error('Error getting book content:', e);
  }
  
  return { parser: null, chapters: book.chapters || [], contents };
}
