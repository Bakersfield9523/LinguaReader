# LinguaReader

桌面端电子书阅读器（EPUB / PDF），基于 Tauri 2 + React + Vite + Rust 构建，内置生词本、词典、AI 辅助阅读等功能。阅读器主体由人工智能KIMI完成。部分技术实现参考了Koodo-reader的代码。

## 技术栈

- **前端**：React + TypeScript + Vite
- **后端**：Node (Hono) 内嵌于 Tauri，提供本地 API 与 SQLite 存储（better-sqlite3）
- **桌面壳**：Tauri 2（Rust），将前端打包为原生应用并启动本地后端进程
- **数据库**：SQLite（本地文件 `app/data/lingua.db`，已被 `.gitignore` 忽略）；可选 **Turso (libSQL) 托管数据库** 实现账户 + 阅读数据跨设备云同步

## 目录结构

```
kimi_book_platform/
├── app/                 # 前端 + Node 后端（boot.ts）
│   ├── src/             # React 源码（组件 / hooks / lib）
│   ├── api/             # Node 后端（Hono）
│   ├── db/              # Drizzle schema 与数据库访问
│   └── dist/            # 构建产物（gitignore）
├── src-tauri/           # Tauri / Rust 配置与入口
├── Cargo.toml           # Rust workspace
└── cdp_mw.mjs           # 词典 API 连通性自检脚本（开发用）
```

## 环境变量

复制 `app/.env.example` 为 `app/.env` 并填入以下值（`.env` 已被忽略，请勿提交）：

| 变量 | 说明 |
| --- | --- |
| `APP_ID` / `APP_SECRET` | 应用身份凭证 |
| `VITE_APP_ID` | 前端注入的应用 ID |
| `DATABASE_URL` | 数据库连接串。默认 `file:./data/lingua.db`（单机 SQLite）；填 `libsql://` 开头即开启 Turso 云同步 |
| `TURSO_AUTH_TOKEN` | Turso 数据库访问令牌，仅在使用云同步模式时填 |
| `VITE_MW_API_KEY` | Merriam-Webster 词典 API Key（前端注入，勿硬编码到源码） |

运行 `cdp_mw.mjs` 自检时通过 `MW_API_KEY=... node cdp_mw.mjs` 注入同一 Key。

## 云同步（跨设备）

默认数据为**单机本地 SQLite**，换设备/重装不通。开启真·跨设备同步只需把数据库换成 **Turso（托管版 SQLite）**：

1. 注册免费 Turso 账户：<https://turso.tech> ，创建一个数据库（如 `linguareader`）。
2. 获取数据库连接信息：
   - `turso db show linguareader --url` → 形如 `libsql://xxxx.turso.io`
   - `turso db tokens create linguareader` → 一长串令牌
3. 在 `app/.env` 中填入（**不要提交 .env**）：
   ```ini
   DATABASE_URL=libsql://xxxx.turso.io
   TURSO_AUTH_TOKEN=你的令牌
   ```
4. 正常 `npm run build` 与 `cargo tauri build` 即可。
5. 应用启动时会自动在远程库建好全部表；任意设备用同一账号登录，书籍/生词/高亮/书签/设置都会同步。

> 未配置 `DATABASE_URL`（或保留本地路径）时，仍按单机模式运行，行为与之前完全一致——云同步是**可选增强**，不配置也不会出错。

## 本地构建

```bash
# 1. 安装前端依赖
cd app && npm install

# 2. 构建前端（生成 dist/public 与 dist/boot.js）
npm run build

# 3. 构建 Tauri 桌面应用（开发模式）
cd ../src-tauri && cargo tauri dev
# 或产出安装包
cargo tauri build
```

## 说明

- 本仓库已配置 `.gitignore`，忽略 `.env`、依赖、构建产物、本地数据库与备份目录。
- 当前版本仅英语稳定使用
