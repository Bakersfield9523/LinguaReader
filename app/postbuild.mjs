/**
 * Post-build script: copy native module dependencies to dist/
 * These packages can't be bundled by esbuild (contain .node binaries)
 * and must be available as external node_modules at runtime.
 *
 * On Windows, real-time antivirus (Defender) frequently locks freshly
 * written native binaries (.node/.dll/.pdb/.ilk) for a brief scan, causing
 * fs.cpSync to throw EPIPE/EPERM/ETXTBSY. We therefore copy entry-by-entry
 * with a retry, and only WARN (never abort) if a file stays locked — the
 * runtime only needs the .node binaries, which copy reliably on first try.
 */
import fs from 'fs';
import path from 'path';

const LOCK_CODES = new Set([
  'EPIPE', 'EPERM', 'ETXTBSY', 'EBUSY', 'EMFILE', 'ENOTEMPTY', 'ENOENT',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function robustCopy(src, dst, retries = 30) {
  try {
    const st = fs.lstatSync(src);
    if (st.isFile() && fs.existsSync(dst)) {
      // 已存在且大小一致则跳过：避免重复覆盖触发杀毒重新加锁
      const dstsz = fs.statSync(dst).size;
      if (dstsz === st.size && dstsz > 0) return;
    }
  } catch {
    /* dst 不存在或无法读取，继续复制 */
  }
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const st = fs.lstatSync(src);
      if (st.isSymbolicLink()) {
        return; // skip symlinks
      }
      if (st.isDirectory()) {
        if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
        const entries = fs.readdirSync(src);
        for (const e of entries) {
          await robustCopy(path.join(src, e), path.join(dst, e), retries);
        }
        return;
      }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      return;
    } catch (err) {
      const code = err && err.code ? err.code : '';
      if (attempt === retries - 1 || !LOCK_CODES.has(code)) {
        console.warn(
          `[postbuild] WARN skipped (locked/unreadable): ${src} -> ${code || err.message}`,
        );
        return;
      }
      await sleep(500);
    }
  }
}

/**
 * 关键原生二进制（better-sqlite3 / @libsql 的 .node）若因 Defender 锁未能复制，
 * 运行时加载会直接崩溃。这里做硬性校验：缺失则反复重试直复制成功，仍失败则退出非零。
 */
async function ensureNativeBinary(relPath) {
  const src = path.join('node_modules', relPath);
  const dst = path.join('dist', 'node_modules', relPath);
  if (!fs.existsSync(src)) {
    console.warn(`[postbuild] WARNING: source missing ${relPath}`);
    return;
  }
  const wantSize = fs.statSync(src).size;
  for (let i = 0; i < 30; i++) {
    try {
      const st = fs.statSync(dst);
      if (st.size === wantSize && st.size > 0) return; // 已就位
    } catch {
      /* dst 不存在，继续 */
    }
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      const st = fs.statSync(dst);
      if (st.size === wantSize && st.size > 0) {
        console.log(`[postbuild] Ensured native binary ${relPath}`);
        return;
      }
    } catch {
      /* 仍被锁，稍后重试 */
    }
    await sleep(500);
  }
  console.error(`[postbuild] FATAL: 无法复制关键原生二进制 ${relPath}`);
  process.exit(1);
}

const pkgs = ['better-sqlite3', 'bindings', 'file-uri-to-path'];

for (const pkg of pkgs) {
  const src = path.join('node_modules', pkg);
  if (fs.existsSync(src)) {
    await robustCopy(src, path.join('dist', 'node_modules', pkg));
    console.log(`[postbuild] Copied ${pkg}`);
  } else {
    console.warn(`[postbuild] WARNING: ${pkg} not found in node_modules`);
  }
}

/**
 * 复制 @libsql/client 的完整依赖闭包到 dist/node_modules。
 * 云同步（Turso/libSQL）的客户端在运行时按外部模块解析，必须随包分发；
 * 仅本地模式不会加载它（connection.ts 中动态 import，未配置则不会触发）。
 */
async function copyDepClosure(rootPkg, seen = new Set()) {
  if (seen.has(rootPkg)) return;
  seen.add(rootPkg);
  const src = path.join('node_modules', rootPkg);
  if (!fs.existsSync(src)) {
    console.warn(`[postbuild] WARNING: ${rootPkg} not found in node_modules`);
    return;
  }
  await robustCopy(src, path.join('dist', 'node_modules', rootPkg));
  const pjPath = path.join(src, 'package.json');
  if (fs.existsSync(pjPath)) {
    try {
      const pj = JSON.parse(fs.readFileSync(pjPath, 'utf-8'));
      const deps = {
        ...(pj.dependencies || {}),
        ...(pj.optionalDependencies || {}),
        ...(pj.peerDependencies || {}),
      };
      for (const d of Object.keys(deps)) {
        await copyDepClosure(d, seen);
      }
    } catch {
      /* 忽略无法解析的依赖 */
    }
  }
}

await copyDepClosure('@libsql/client');
console.log('[postbuild] Copied @libsql/client closure');

// 硬性校验关键原生二进制已就位（Defender 锁可能导致复制被跳过）
await ensureNativeBinary('better-sqlite3/build/Release/better_sqlite3.node');
await ensureNativeBinary('@libsql/win32-x64-msvc/index.node');

/**
 * Windows 实时杀毒在原生二进制写入后会短暂独占锁定（os error 32），
 * 若紧随其后的 cargo/tauri 资源扫描读取该文件会直接失败。这里轮询读取，
 * 主动触发并等待杀毒扫描释放锁，确保 build 脚本接手时文件可读。
 */
async function waitUnlocked(relPath) {
  const p = path.join('dist', 'node_modules', relPath);
  for (let i = 0; i < 40; i++) {
    try {
      fs.readFileSync(p);
      return;
    } catch {
      await sleep(500);
    }
  }
  console.warn(`[postbuild] WARN: ${relPath} 仍被锁定（忽略，继续构建）`);
}

await waitUnlocked('better-sqlite3/build/Release/better_sqlite3.node');
await waitUnlocked('@libsql/win32-x64-msvc/index.node');
console.log('[postbuild] 原生二进制锁定已释放，可安全进入 cargo 构建');

// Create minimal package.json so Node.js treats dist/ as a package root.
// 必须声明 "type": "module"，因为 boot.js 使用 import.meta.dirname 等 ESM 专属语法，
// 否则 Node 在最近的 package.json 缺省时会按 CommonJS 加载而抛出 SyntaxError。
fs.writeFileSync(
  path.join('dist', 'package.json'),
  JSON.stringify({ name: 'lingua-reader-server', private: true, type: 'module' }, null, 2),
);
console.log('[postbuild] Created dist/package.json');
