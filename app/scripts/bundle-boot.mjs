// 将 api/boot.ts 打包为 dist/boot.js。
// 关键：esbuild 在 Windows 上无法“覆盖”已存在的 dist/boot.js
// （genie-safe-delete 文件过滤驱动 / Defender 实时扫描会拦截 delete+recreate，
//  报 “Access is denied”）。因此先以重试方式删除旧文件，让 esbuild 始终“新建”，
//  从而绕开覆盖锁。delete 失败多因瞬时扫描锁，重试即可释放。
import { execFileSync } from "child_process";
import { rmSync, existsSync } from "fs";

const dest = "dist/boot.js";

for (let i = 0; i < 40; i++) {
  if (!existsSync(dest)) break;
  try {
    rmSync(dest, { force: true });
  } catch {
    // 短暂等待后重试（约 1s），让扫描锁释放
    try {
      execFileSync("ping", ["-n", "1", "127.0.0.1"], { stdio: "ignore" });
    } catch {}
  }
}

execFileSync(
  "node",
  [
    "node_modules/esbuild/bin/esbuild",
    "api/boot.ts",
    "--platform=node",
    "--bundle",
    "--format=esm",
    "--outdir=dist",
    "--external:better-sqlite3",
    "--external:@libsql/client",
    "--banner:js=import { createRequire } from 'module';const require = createRequire(import.meta.url);",
  ],
  { stdio: "inherit" }
);

console.log("boot.js bundled ->", dest);
