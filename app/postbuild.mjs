/**
 * Post-build script: copy native module dependencies to dist/
 * These packages can't be bundled by esbuild (contain .node binaries)
 * and must be available as external node_modules at runtime.
 */
import fs from 'fs';
import path from 'path';

const pkgs = ['better-sqlite3', 'bindings', 'file-uri-to-path'];

for (const pkg of pkgs) {
  const src = path.join('node_modules', pkg);
  const dst = path.join('dist', 'node_modules', pkg);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dst, { recursive: true });
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
function copyDepClosure(rootPkg, seen = new Set()) {
  if (seen.has(rootPkg)) return;
  seen.add(rootPkg);
  const src = path.join('node_modules', rootPkg);
  if (!fs.existsSync(src)) {
    console.warn(`[postbuild] WARNING: ${rootPkg} not found in node_modules`);
    return;
  }
  const dst = path.join('dist', 'node_modules', rootPkg);
  fs.cpSync(src, dst, { recursive: true });
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
        copyDepClosure(d, seen);
      }
    } catch {
      /* 忽略无法解析的依赖 */
    }
  }
}

copyDepClosure('@libsql/client');
console.log('[postbuild] Copied @libsql/client closure');

// Create minimal package.json so Node.js treats dist/ as a package root.
// 必须声明 "type": "module"，因为 boot.js 使用 import.meta.dirname 等 ESM 专属语法，
// 否则 Node 在最近的 package.json 缺省时会按 CommonJS 加载而抛出 SyntaxError。
fs.writeFileSync(
  path.join('dist', 'package.json'),
  JSON.stringify({ name: 'lingua-reader-server', private: true, type: 'module' }, null, 2)
);
console.log('[postbuild] Created dist/package.json');
