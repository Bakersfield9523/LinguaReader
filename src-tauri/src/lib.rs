use std::process::{Command, Child, Stdio};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::time::Duration;
use std::fs::OpenOptions;
use std::path::PathBuf;
use serde::Serialize;
use tauri::Manager;
use tauri::State;
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

static BACKEND: Mutex<Option<Child>> = Mutex::new(None);

// 4.4.22：主窗口销毁时置位，让守护线程停止，避免应用退出后继续拉起后端。
static BACKEND_WATCHDOG_STOP: AtomicBool = AtomicBool::new(false);

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

            // 4.4.22：守护线程兜底。实测后端会「启动成功后被外部终止」（无崩溃堆栈），
            // 只靠启动一次不够；掉线后自动重拉，用户点词才有稳定可用的后端。
            BACKEND_WATCHDOG_STOP.store(false, Ordering::Relaxed);
            spawn_backend_watchdog(app.handle().clone(), port);

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // 只认主窗口；先置停止位再 kill，避免守护线程把刚 kill 的后端又拉起来。
                if window.label() == "main" {
                    BACKEND_WATCHDOG_STOP.store(true, Ordering::Relaxed);
                    if let Some(ref mut child) = *BACKEND.lock().unwrap() {
                        let _ = child.kill();
                    }
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

        let mut cmd = Command::new(&node_bin);
        cmd.arg(&script_abs)
            .current_dir(&work_abs)
            .env("NODE_ENV", "production")
            .env("PORT", port.to_string())
            .stdout(log_stdio(&log_path))
            .stderr(log_stdio(&log_path));
        // 4.4.23：node.exe 是 Windows 控制台子系统程序。不加 CREATE_NO_WINDOW(0x08000000)
        // 时，Windows 会为它单独分配一个可见控制台窗口——也就是用户每次打开软件
        // 都看到的那个"终端"。后端 stdout/stderr 已重定向到 backend.log，隐藏窗口
        // 完全不影响字典/登录/云同步/AI 等任何功能，watchdog 重拉也走同一路径。
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        match cmd.spawn() {

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

// ============ 4.4.22 后端守护 ============

/// 端口上是否真的有服务在监听（后端只绑 127.0.0.1）。
/// 连到未监听的回环端口会立刻 ECONNREFUSED，不会真的等满超时。
fn backend_port_alive(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

/// 后端 child 是否仍在运行（没有 child 也算 false）。
fn backend_child_running() -> bool {
    let mut guard = BACKEND.lock().unwrap();
    match guard.as_mut() {
        Some(child) => matches!(child.try_wait(), Ok(None)),
        None => false,
    }
}

/// 分段休眠：应用退出时守护线程能在 100ms 内结束，而不是卡在整段 sleep。
fn watchdog_sleep(secs: u32) -> bool {
    for _ in 0..secs.saturating_mul(10) {
        if BACKEND_WATCHDOG_STOP.load(Ordering::Relaxed) {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    !BACKEND_WATCHDOG_STOP.load(Ordering::Relaxed)
}

/// 后端守护线程。
///
/// 4.4.22 真机排查发现：后端会「启动成功（Server running）后被外部终止」，
/// backend.log 里没有任何 Node 崩溃堆栈，代码里也没有 process.exit。此时
/// WebView 查词得到 ERR_CONNECTION_REFUSED，用户看到「找不到解析」。
/// 守护线程不追究终止原因，只要端口掉线就在数秒内重新拉起。
///
/// ⚠️ 必须复用启动时写进 BackendState 的同一个 port：前端 initBackendPort()
/// 只在启动时读一次端口，重新 find_free_port 会让前端继续连旧端口。
fn spawn_backend_watchdog(handle: tauri::AppHandle, port: u16) {
    std::thread::spawn(move || {
        let log_path: Option<PathBuf> = handle
            .path()
            .app_data_dir()
            .ok()
            .map(|d| d.join("backend.log"));

        let mut misses: u32 = 0;
        let mut cooldown_secs: u32 = 0;
        // 是否曾真正就绪过（端口可连）。就绪前算「启动中」，就绪后才算「掉线」。
        let mut ever_ready = false;
        let mut started_at = std::time::Instant::now();

        loop {
            if !watchdog_sleep(1) {
                return;
            }
            if cooldown_secs > 0 {
                cooldown_secs -= 1;
                continue;
            }

            // 端口可连即视为后端可用（若同端口是另一个实例，词典照样能用，不抢）。
            if backend_port_alive(port) {
                ever_ready = true;
                misses = 0;
                continue;
            }

            // ⚠️ 关键：不能只给固定秒数的「启动宽限」。
            // Node 加载 1MB boot.js + better-sqlite3 + @libsql/client 到真正 listen
            // 需要 5s 以上；宽限给短了，watchdog 会把刚拉起的后端自己 kill 掉，
            // 形成「重启 → 还没 listen → 判定掉线 → 再 kill」的无限重启循环
            // （4.4.22 首版真机日志 63048→85152→15920→83096 就是这个循环）。
            // 判据改为：从未就绪时，进程还在就耐心等它启动（45s），
            // 进程已退出说明启动失败，5s 后即重试；一旦就绪过，掉线立即按 2 次探测处理。
            if !ever_ready {
                let running = backend_child_running();
                let wait_secs = if running { 45 } else { 5 };
                if started_at.elapsed() < Duration::from_secs(wait_secs) {
                    continue;
                }
            }

            // 连续 2 次失联才动手
            misses += 1;
            if misses < 2 {
                continue;
            }
            misses = 0;

            if BACKEND_WATCHDOG_STOP.load(Ordering::Relaxed) {
                return;
            }

            let child_running = backend_child_running();
            append_backend_diag(
                &log_path,
                &format!(
                    "[rust/wd] backend down on 127.0.0.1:{} (ever_ready={}, child_running={}), restarting",
                    port, ever_ready, child_running
                ),
            );

            let ok = {
                let mut guard = BACKEND.lock().unwrap();
                if let Some(ref mut old) = *guard {
                    let _ = old.kill();
                    let _ = old.wait();
                }
                match start_backend(&handle, port) {
                    Some(child) => {
                        append_backend_diag(
                            &log_path,
                            &format!("[rust/wd] backend restarted, pid={}", child.id()),
                        );
                        *guard = Some(child);
                        true
                    }
                    None => {
                        append_backend_diag(&log_path, "[rust/wd] restart failed, will retry");
                        *guard = None;
                        false
                    }
                }
            };
            // 重启后重新进入「启动中」状态，等新 Node 真正 listen
            ever_ready = false;
            started_at = std::time::Instant::now();
            // 连续重启失败时限速，避免日志刷屏与 CPU 空转
            if !ok {
                cooldown_secs = 10;
            }
        }
    });
}
