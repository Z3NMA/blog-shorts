#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
struct Studio {
    busy: AtomicBool,
    last_file: Mutex<Option<PathBuf>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    url: String,
    api_key: String,
    #[serde(default)]
    gemini_key: String,
    output_folder: String,
    ffmpeg: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Defaults {
    has_key: bool,
    has_gemini_key: bool,
    output_folder: String,
    ffmpeg: String,
}

fn adjacent(name: &str) -> Option<PathBuf> {
    let item = env::current_exe().ok()?.parent()?.join(name);
    item.is_file().then_some(item)
}

fn tool(variable: &str, filename: &str) -> String {
    env::var(variable)
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| adjacent(filename).map(|p| p.to_string_lossy().into_owned()))
        .unwrap_or_else(|| filename.to_string())
}

#[tauri::command]
fn defaults(app: AppHandle) -> Result<Defaults, String> {
    let folder = app
        .path()
        .video_dir()
        .or_else(|_| app.path().document_dir())
        .map_err(|e| e.to_string())?
        .join("Blog Shorts");
    Ok(Defaults {
        has_key: env::var("DEEPSEEK_API_KEY").is_ok_and(|v| !v.trim().is_empty()),
        has_gemini_key: env::var("GEMINI_API_KEY").is_ok_and(|v| !v.trim().is_empty()),
        output_folder: folder.to_string_lossy().into_owned(),
        ffmpeg: tool("FFMPEG", "ffmpeg.exe"),
    })
}

fn command(executable: &str) -> Command {
    let mut cmd = Command::new(executable);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.env_remove("DEEPSEEK_API_KEY").env_remove("GEMINI_API_KEY").stdin(Stdio::null());
    cmd
}

fn preflight(executable: &str, args: &[&str], name: &str) -> Result<(), String> {
    let result = command(executable)
        .args(args)
        .output()
        .map_err(|e| format!("{name} 실행 경로를 확인하세요. {e}"))?;
    if !result.status.success() {
        return Err(format!("{name} 설치와 실행 경로를 확인하세요."));
    }
    Ok(())
}

fn render(app: &AppHandle, job: Job) -> Result<String, String> {
    let url =
        tauri::Url::parse(job.url.trim()).map_err(|_| "네이버 블로그 글 주소를 입력하세요.")?;
    if url.scheme() != "https"
        || !matches!(url.host_str(), Some("blog.naver.com" | "m.blog.naver.com"))
    {
        return Err("https://blog.naver.com 또는 모바일 글 주소를 입력하세요.".into());
    }
    let key = if job.api_key.trim().is_empty() {
        env::var("DEEPSEEK_API_KEY").unwrap_or_default()
    } else {
        job.api_key.trim().to_owned()
    };
    if key.trim().is_empty() {
        return Err("DeepSeek API 키를 입력하세요.".into());
    }
    let gemini_key = if job.gemini_key.trim().is_empty() {
        env::var("GEMINI_API_KEY").unwrap_or_default()
    } else {
        job.gemini_key.trim().to_owned()
    };
    if gemini_key.trim().is_empty() {
        return Err("Google AI Studio에서 발급한 Gemini API 키를 입력하세요.".into());
    }
    let folder = PathBuf::from(job.output_folder.trim());
    if !folder.is_absolute() {
        return Err("저장 폴더의 전체 경로를 입력하세요.".into());
    }
    fs::create_dir_all(&folder).map_err(|e| format!("저장 폴더를 열 수 없습니다. {e}"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let stem = format!("blog-shorts-{stamp}-{}", std::process::id());
    let file = folder.join(format!("{stem}.mp4"));
    let partial = folder.join(format!("{stem}.partial.mp4"));
    let plan = folder.join(format!("{stem}.plan.json"));
    if partial.exists() || file.exists() || plan.exists() {
        return Err("파일 이름이 겹쳤습니다. 다시 실행하세요.".into());
    }
    let probe = folder.join(format!(".{stem}.write-test"));
    let file_test = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .map_err(|e| format!("저장 폴더에 쓸 수 없습니다. 다른 폴더를 선택하세요. {e}"))?;
    drop(file_test);
    fs::remove_file(&probe).map_err(|e| format!("저장 폴더를 사용할 수 없습니다. {e}"))?;

    let script = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("engine/shorts.mjs");
    let script = if script.is_file() {
        script
    } else if let Some(p) = adjacent("engine/shorts.mjs") {
        p
    } else if cfg!(debug_assertions) {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../shorts.mjs")
    } else {
        return Err("engine 폴더가 누락되었습니다. ZIP 전체를 새 폴더에 풀고 실행하세요.".into());
    };
    let node = tool("SHORTS_NODE", "node.exe");
    preflight(
        &node,
        &[
            "-e",
            "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)",
        ],
        "Node.js 22 이상",
    )?;
    preflight(job.ffmpeg.trim(), &["-version"], "FFmpeg")?;
    let mut worker = command(&node);
    worker
        .arg(script)
        .arg(url.as_str())
        .arg(&partial)
        .env("SHORTS_PLANNER", "deepseek")
        .env("SHORTS_PLAN_PATH", plan)
        .env("FFMPEG", job.ffmpeg.trim())
        .env_remove("SUPERTONIC_MODEL")
        .env("SHORTS_VOICE", "gemini")
        .env("GEMINI_API_KEY", gemini_key.trim())
        .env_remove("POST_HTML")
        .env_remove("PHOTO_DIR");
    let mut child = worker
        .env("DEEPSEEK_API_KEY", &key)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("제작 엔진을 시작할 수 없습니다. {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or("제작 엔진의 진행 상태를 열 수 없습니다.")?;
    let handle = app.clone();
    let progress = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if line.starts_with("Photos:") {
                let _ = handle.emit(
                    "render-progress",
                    "장면 구성이 끝났습니다. 음성과 영상을 제작하고 있습니다.",
                );
            } else if line.starts_with("Gemini 음성 · ") || line.starts_with("영상 합성 · ") {
                let _ = handle.emit("render-progress", line);
            }
        }
    });
    let result = child
        .wait_with_output()
        .map_err(|e| format!("렌더링 상태 확인 실패. {e}"))?;
    let _ = progress.join();
    if !result.status.success() {
        let _ = fs::remove_file(&partial);
        let mut stderr = String::from_utf8_lossy(&result.stderr).replace(&key, "[비공개]");
        if !gemini_key.trim().is_empty() {
            stderr = stderr.replace(gemini_key.trim(), "[비공개]");
        }
        let message = stderr
            .lines()
            .find(|s| s.starts_with("Error:"))
            .unwrap_or_else(|| stderr.trim());
        return Err(message.chars().take(850).collect());
    }
    if fs::metadata(&partial).map(|m| m.len()).unwrap_or(0) == 0 {
        return Err("결과 MP4를 확인할 수 없습니다.".into());
    }
    fs::rename(&partial, &file).map_err(|e| format!("완성 파일을 저장할 수 없습니다. {e}"))?;
    *app.state::<Studio>()
        .last_file
        .lock()
        .map_err(|e| e.to_string())? = Some(file.clone());
    Ok(file.to_string_lossy().into_owned())
}

#[tauri::command]
async fn generate(app: AppHandle, job: Job) -> Result<String, String> {
    if app.state::<Studio>().busy.swap(true, Ordering::AcqRel) {
        return Err("이미 제작 중인 영상이 있습니다.".into());
    }
    let handle = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || render(&handle, job)).await;
    app.state::<Studio>().busy.store(false, Ordering::Release);
    result.map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_output(app: AppHandle) -> Result<(), String> {
    let file = app
        .state::<Studio>()
        .last_file
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("완성된 영상이 없습니다.")?;
    command("explorer.exe")
        .arg(file.parent().ok_or("저장 폴더를 찾을 수 없습니다.")?)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(Studio::default())
        .invoke_handler(tauri::generate_handler![defaults, generate, open_output])
        .run(tauri::generate_context!())
        .expect("Blog Shorts startup failed");
}
