# LinguaReader

桌面端电子书阅读器（EPUB / PDF），基于 Tauri 2 + React + Vite + Rust 构建，内置生词本、词典、AI 辅助阅读等功能。

## 技术栈

- **前端**：React + TypeScript + Vite
- **后端**：Node (Hono) 内嵌于 Tauri，提供本地 API 与 SQLite 存储（better-sqlite3）
- **桌面壳**：Tauri 2（Rust），将前端打包为原生应用并启动本地后端进程
- **数据库**：SQLite（本地文件 `app/data/lingua.db`，已被 `.gitignore` 忽略）

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
| `DATABASE_URL` | 数据库连接串（默认 `file:./data/lingua.db`） |
| `VITE_MW_API_KEY` | Merriam-Webster 词典 API Key（前端注入，勿硬编码到源码） |

运行 `cdp_mw.mjs` 自检时通过 `MW_API_KEY=... node cdp_mw.mjs` 注入同一 Key。

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
- 提交历史中不包含任何硬编码密钥；敏感配置一律走环境变量。
