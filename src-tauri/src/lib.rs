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

fn start_backend(handle: &tauri::AppHandle, port: u16) -> Option<Child> {
    // 优先使用 Tauri 资源目录中的 boot.js（生产安装包）
    let resource_dir = handle.path().resource_dir().ok()?;
    let candidates = vec![
        resource_dir.join("boot.js"),
        std::path::PathBuf::from("../app/dist/boot.js"),
        std::path::PathBuf::from("app/dist/boot.js"),
    ];

    // 日志路径：应用数据目录下的 backend.log（便于排查启动失败）
    let log_path: Option<PathBuf> = handle
        .path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("backend.log"));

    for backend_script in &candidates {
        if backend_script.exists() {
            log::info!("Starting backend: {:?} on port {}", backend_script, port);
            let work_dir = backend_script.parent().map(|p| p.to_path_buf()).unwrap_or(resource_dir.clone());
            match Command::new("node")
                .arg(backend_script)
                .current_dir(work_dir)
                .env("NODE_ENV", "production")
                .env("PORT", port.to_string())
                .stdout(log_stdio(&log_path))
                .stderr(log_stdio(&log_path))
                .spawn()
            {
                Ok(child) => return Some(child),
                Err(e) => log::error!("Failed to start backend: {}", e),
            }
        }
    }
    log::error!("Backend script not found");
    None
}
