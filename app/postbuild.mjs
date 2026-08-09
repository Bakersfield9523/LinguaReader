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

// Create minimal package.json so Node.js treats dist/ as a package root.
// 必须声明 "type": "module"，因为 boot.js 使用 import.meta.dirname 等 ESM 专属语法，
// 否则 Node 在最近的 package.json 缺省时会按 CommonJS 加载而抛出 SyntaxError。
fs.writeFileSync(
  path.join('dist', 'package.json'),
  JSON.stringify({ name: 'lingua-reader-server', private: true, type: 'module' }, null, 2)
);
console.log('[postbuild] Created dist/package.json');
