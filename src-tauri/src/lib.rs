use std::process::{Command, Child, Stdio};
use std::sync::Mutex;
use std::net::{TcpListener, Ipv4Addr};
use std::fs::OpenOptions;
use std::path::PathBuf;
use serde::Serialize;
use tauri::Manager;
use tauri::State;
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

static BACKEND: Mutex<Option<Child>> = Mutex::new(None);

// 后端实际监听端口：Rust 在启动时探测空闲端口后写入，前端通过 get_backend_port 读取。
// 这样即使 3000 被常驻软件占用，也能自动换端口，避免 "Failed to fetch"。
struct BackendState {
    port: Mutex<u16>,
}

/// 从 start 起探测一个未被占用的 TCP 端口（node 端也做兜底重试）
fn find_free_port(start: u16) -> u16 {
    for port in start..(start + 200) {
        if TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok() {
            return port;
        }
    }
    start
}

/// 前端读取后端实际端口，避免端口冲突导致无法连接
#[tauri::command]
fn get_backend_port(state: State<BackendState>) -> u16 {
    *state.port.lock().unwrap()
}

/// 打开日志文件句柄（把 node 后端 stdout/stderr 落盘，便于排查启动失败）
fn log_stdio(log_path: &Option<PathBuf>) -> Stdio {
    match log_path {
        Some(p) => {
            if let Some(parent) = p.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            match OpenOptions::new().create(true).append(true).open(p) {
                Ok(f) => Stdio::from(f),
                Err(_) => Stdio::null(),
            }
        }
        None => Stdio::null(),
    }
}

// ============ AI API 命令（从 Rust 进程发请求，绕过 WebView CORS） ============

#[derive(Serialize)]
struct AiTestKeyResult {
    success: bool,
    error: Option<String>,
}

#[derive(Serialize)]
struct AiChatResult {
    content: Option<String>,
    error: Option<String>,
}

fn get_provider_config(provider: &str) -> Option<(&'static str, &'static str)> {
    match provider {
        "kimi" => Some(("https://api.moonshot.cn/v1", "moonshot-v1-8k")),
        "deepseek" => Some(("https://api.deepseek.com/v1", "deepseek-chat")),
        "openai" => Some(("https://api.openai.com/v1", "gpt-3.5-turbo")),
        "gemini" => Some(("https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.0-flash")),
        _ => None,
    }
}

/// 测试 API Key 是否有效
/// 前端调用：invoke('ai_test_key', { provider: 'kimi', apiKey: 'xxx' })
#[tauri::command]
async fn ai_test_key(provider: String, api_key: String) -> Result<AiTestKeyResult, String> {
    let (api_base, model) = match get_provider_config(&provider) {
        Some(c) => c,
        None => return Ok(AiTestKeyResult {
            success: false,
            error: Some(format!("未知的 AI 提供商: {}", provider)),
        }),
    };

    if api_key.is_empty() {
        return Ok(AiTestKeyResult {
            success: false,
            error: Some("API Key 不能为空".to_string()),
        });
    }

    let url = format!("{}/chat/completions", api_base);
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": "Hi"}],
        "max_tokens": 5,
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await;

    match response {
        Ok(resp) => {
            if resp.status().is_success() {
                Ok(AiTestKeyResult { success: true, error: None })
            } else {
                let status = resp.status().as_u16();
                let error_text = resp.text().await.unwrap_or_default();
                let error_msg = serde_json::from_str::<serde_json::Value>(&error_text)
                    .ok()
                    .and_then(|v| v.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()).map(|s| s.to_string()))
                    .unwrap_or_else(|| format!("HTTP {}", status));
                Ok(AiTestKeyResult { success: false, error: Some(error_msg) })
            }
        }
        Err(e) => Ok(AiTestKeyResult {
            success: false,
            error: Some(format!("网络请求失败: {}", e)),
        }),
    }
}

/// AI Chat Completion 代理
/// 前端调用：invoke('ai_chat', { provider, apiKey, messages, temperature, maxTokens })
#[tauri::command]
async fn ai_chat(
    provider: String,
    api_key: String,
    messages: Vec<serde_json::Value>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
) -> Result<AiChatResult, String> {
    let (api_base, model) = match get_provider_config(&provider) {
        Some(c) => c,
        None => return Ok(AiChatResult {
            content: None,
            error: Some(format!("未知的 AI 提供商: {}", provider)),
        }),
    };

    if api_key.is_empty() {
        return Ok(AiChatResult {
            content: None,
            error: Some("API Key 未配置".to_string()),
        });
    }

    let url = format!("{}/chat/completions", api_base);
    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "temperature": temperature.unwrap_or(0.3),
        "max_tokens": max_tokens.unwrap_or(800),
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await;

    match response {
        Ok(resp) => {
            if resp.status().is_success() {
                let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
                let content = data
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("message"))
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_default();
                Ok(AiChatResult { content: Some(content), error: None })
            } else {
                let status = resp.status().as_u16();
                let error_text = resp.text().await.unwrap_or_default();
                let error_msg = serde_json::from_str::<serde_json::Value>(&error_text)
                    .ok()
                    .and_then(|v| v.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()).map(|s| s.to_string()))
                    .unwrap_or_else(|| format!("API 请求失败: {}", status));
                Ok(AiChatResult { content: None, error: Some(error_msg) })
            }
        }
        Err(e) => Ok(AiChatResult {
            content: None,
            error: Some(format!("网络请求失败: {}", e)),
        }),
    }
}

// ============ 应用启动 ============

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let backend_state = BackendState { port: Mutex::new(3000) };
    tauri::Builder::default()
        .manage(backend_state)
        .invoke_handler(tauri::generate_handler![ai_test_key, ai_chat, get_backend_port])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;

                // Ctrl+Shift+D 打开 DevTools
                let app_handle = app.handle().clone();
                let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyD);
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_shortcut(shortcut)?
                        .with_handler(move |_app, _sc, event| {
                            if event.state == ShortcutState::Pressed {
                                if let Some(window) = app_handle.get_webview_window("main") {
                                    window.open_devtools();
                                }
                            }
                        })
                        .build(),
                )?;
            }

            // Start Node.js backend on a dynamically chosen free port
            let port = find_free_port(3000);
            *app.state::<BackendState>().port.lock().unwrap() = port;
            let child = start_backend(app.handle(), port);
            if let Some(child) = child {
                log::info!("Backend started with PID: {} on port {}", child.id(), port);
                BACKEND.lock().unwrap().replace(child);
            } else {
                log::error!("Backend failed to start (node not found or spawn error)");
            }

            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(ref mut child) = *BACKEND.lock().unwrap() {
                    let _ = child.kill();
                }
            }
        })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
}

/// 往候选列表追加一个不重复的目录
fn push_unique(dirs: &mut Vec<PathBuf>, p: PathBuf) {
    if !dirs.iter().any(|d| d == &p) {
        dirs.push(p);
    }
}

/// 目录"像不像真正的后端运行目录"的打分。
/// 桌面根 exe 与 Desktop\LinguaReader\ 可能同时存在候选，靠它挑出带
/// node.exe / .env / node_modules 的那个，否则 CWD 一错位，.env 里的 MW Key、
/// better-sqlite3 原生模块、data/ 数据库全会跑到错误位置。
fn runtime_score(dir: &std::path::Path) -> i32 {
    let mut s = 0;
    if dir.join("node.exe").exists() { s += 4; }
    if dir.join(".env").exists() { s += 2; }
    if dir.join("node_modules").exists() { s += 1; }
    s
}

/// 收集所有可能存放后端 bundle 的目录，按完整度降序（稳定排序，同级保持加入顺序）。
///
/// 4.4.21：桌面根 exe（Desktop\LinguaReader.exe）与真正的运行目录
/// （Desktop\LinguaReader\，含 boot.js / node.exe / .env / node_modules）不在同一层。
/// 旧实现只查 exe 同目录 + resource_dir + 两个相对路径，全部落空 → 后端根本没启动。
/// 表现就是「词典所有词都找不到解析」，且登录 / 云同步 / AI 一并失效。
fn backend_dirs(handle: &tauri::AppHandle, exe_dir: Option<&std::path::Path>) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    // 1) 常规松散分发：exe 与 boot.js 同目录
    if let Some(d) = exe_dir {
        push_unique(&mut dirs, d.to_path_buf());
    }
    // 2) NSIS 安装包：boot.js 作为 resource 释放
    if let Ok(rd) = handle.path().resource_dir() {
        push_unique(&mut dirs, rd);
    }

    if let Some(d) = exe_dir {
        // 3) 桌面根 exe：运行目录是同名的子目录
        for name in ["LinguaReader", "linguareader", "LINGUAREADER", "runtime"] {
            push_unique(&mut dirs, d.join(name));
        }
        // 4) 兜底：扫一层子目录，只认「有 boot.js 且带运行依赖」的目录，
        //    避免用户把运行目录改了名字后又要改代码
        if let Ok(entries) = std::fs::read_dir(d) {
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_dir() || !p.join("boot.js").exists() {
                    continue;
                }
                if p.join("node.exe").exists()
                    || p.join(".env").exists()
                    || p.join("node_modules").exists()
                {
                    push_unique(&mut dirs, p);
                }
            }
        }
        // 5) 源码 / dev 布局
        push_unique(&mut dirs, d.join("app").join("dist"));
        push_unique(&mut dirs, d.join("dist"));
        if let Some(parent) = d.parent() {
            push_unique(&mut dirs, parent.join("app").join("dist"));
        }
    }

    // sort_by 是稳定排序：分数相同保持上面的优先级
    dirs.sort_by(|a, b| runtime_score(b).cmp(&runtime_score(a)));
    dirs
}

/// 生成 Node 能正常解析的绝对路径。
/// ⚠️ 绝不可用 `std::fs::canonicalize()`：Windows 上它返回 `\\?\C:\...` 长路径前缀，
/// Node 22 的 `realpathSync` 在解析入口脚本时会把 `C:` 当目录，直接抛
/// `EISDIR: illegal operation on a directory, lstat 'C:'`，后端起不来。
/// backend_dirs 里的候选本来就来自 current_exe()/resource_dir()，已是绝对路径，
/// 这里只对少数相对候选做一次不带 verbatim 前缀的补全。
fn plain_absolute(p: &std::path::Path) -> PathBuf {
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf())
    }
}

/// 把后端启动诊断写进 backend.log（release 构建没有日志插件，log::* 是空操作）
fn append_backend_diag(log_path: &Option<PathBuf>, msg: &str) {
    use std::io::Write;
    if let Some(p) = log_path {
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(p) {
            let _ = writeln!(f, "{}", msg);
        }
    }
}

fn start_backend(handle: &tauri::AppHandle, port: u16) -> Option<Child> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));

    // 日志路径：应用数据目录下的 backend.log（便于排查启动失败）
    let log_path: Option<PathBuf> = handle
        .path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("backend.log"));

    let searched = backend_dirs(handle, exe_dir.as_deref());
    let candidates: Vec<PathBuf> = searched
        .iter()
        .map(|d| d.join("boot.js"))
        .filter(|p| p.exists())
        .collect();

    if candidates.is_empty() {
        let msg = format!(
            "[rust] backend boot.js NOT FOUND | exe_dir={:?} | searched={:?}",
            exe_dir, searched
        );
        log::error!("{}", msg);
        append_backend_diag(&log_path, &msg);
        return None;
    }

    for backend_script in &candidates {
        let work_dir = backend_script
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));
        // 绝对路径：相对候选（app/dist/boot.js）在改了 current_dir 之后会解析错位。
        // 只能补成普通绝对路径，见 plain_absolute 里关于 \\?\ 前缀的说明。
        let script_abs = plain_absolute(backend_script);
        let work_abs = plain_absolute(&work_dir);

        // 4.4.21：node.exe 优先取 **boot.js 所在目录**，而不是 exe 所在目录。
        // 桌面根 exe 同目录没有 node.exe，旧实现会退化到系统 PATH 上的 node，
        // 而系统 Node 的 ABI 往往与运行目录里的 better-sqlite3 不匹配。
        let node_bin = [
            Some(work_abs.join("node.exe")),
            exe_dir.as_ref().map(|d| d.join("node.exe")),
            handle.path().resource_dir().ok().map(|d| d.join("node.exe")),
        ]
        .into_iter()
        .flatten()
        .find(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from("node"));

        let msg = format!(
            "[rust] starting backend on port {} | script={:?} | work_dir={:?} | node={:?}",
            port, script_abs, work_abs, node_bin
        );
        log::info!("{}", msg);
        append_backend_diag(&log_path, &msg);

        match Command::new(&node_bin)
            .arg(&script_abs)
            .current_dir(&work_abs)
            .env("NODE_ENV", "production")
            .env("PORT", port.to_string())
            .stdout(log_stdio(&log_path))
            .stderr(log_stdio(&log_path))
            .spawn()
        {
            Ok(child) => return Some(child),
            Err(e) => {
                let msg = format!("[rust] failed to start backend {:?}: {}", script_abs, e);
                log::error!("{}", msg);
                append_backend_diag(&log_path, &msg);
            }
        }
    }
    None
}
