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
    project: Mutex<Option<Project>>,
    last_file: Mutex<Option<PathBuf>>,
}

struct Project {
    url: String,
    token: String,
    dir: PathBuf,
}

impl Drop for Project {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Preview {
    token: String,
    manifest: String,
    audio_ready: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    url: String,
    api_key: String,
    #[serde(default)]
    gemini_key: String,
    #[serde(default)]
    token: String,
    #[serde(default)]
    template: String,
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
    cmd.env_remove("DEEPSEEK_API_KEY")
        .env_remove("GEMINI_API_KEY")
        .stdin(Stdio::null());
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

fn post_url(input: &str) -> Result<String, String> {
    let u = tauri::Url::parse(input.trim()).map_err(|_| "네이버 블로그 글 주소를 입력하세요.")?;
    let parts: Vec<_> = u.path().trim_matches('/').split('/').collect();
    if u.scheme() != "https"
        || !matches!(u.host_str(), Some("blog.naver.com" | "m.blog.naver.com"))
        || u.port().is_some()
        || !u.username().is_empty()
        || u.password().is_some()
        || parts.len() != 2
        || parts[0].is_empty()
        || parts[1].is_empty()
        || !parts[0]
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        || !parts[1].bytes().all(|b| b.is_ascii_digit())
    {
        return Err("아이디와 글 번호가 있는 네이버 블로그 주소를 입력하세요.".into());
    }
    Ok(format!("https://blog.naver.com/{}/{}", parts[0], parts[1]))
}

fn key(value: &str, variable: &str) -> String {
    if value.trim().is_empty() {
        env::var(variable).unwrap_or_default().trim().to_owned()
    } else {
        value.trim().to_owned()
    }
}

fn stamp() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .map_err(|e| e.to_string())
}

fn engine(app: &AppHandle, job: &Job, project: &Project) -> Result<Command, String> {
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
        .arg(&project.url)
        .env("SHORTS_SESSION", &project.dir)
        .env("FFMPEG", job.ffmpeg.trim())
        .env("SHORTS_PLANNER", "deepseek")
        .env("SHORTS_VOICE", "gemini")
        .env_remove("SHORTS_TEMPLATE")
        .env_remove("SHORTS_PLAN_PATH")
        .env_remove("POST_HTML")
        .env_remove("PHOTO_DIR");
    Ok(worker)
}

fn execute(app: &AppHandle, worker: &mut Command, secret: &str) -> Result<(), String> {
    let mut child = worker
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
                let _ = handle.emit("render-progress", "대본과 장면 구성을 확인했습니다.");
            } else if line.starts_with("Gemini 음성 · ")
                || line.starts_with("영상 합성 · ")
                || line.starts_with("미리보기 · ")
            {
                let _ = handle.emit("render-progress", line);
            }
        }
    });
    let result = child
        .wait_with_output()
        .map_err(|e| format!("렌더링 상태 확인 실패. {e}"))?;
    let _ = progress.join();
    if !result.status.success() {
        let mut stderr = String::from_utf8_lossy(&result.stderr).into_owned();
        if !secret.is_empty() {
            stderr = stderr.replace(secret, "[비공개]");
        }
        let message = stderr
            .lines()
            .find(|s| s.starts_with("Error:"))
            .unwrap_or(stderr.trim());
        return Err(message.chars().take(850).collect());
    }
    Ok(())
}

fn preview_project(app: &AppHandle, job: Job) -> Result<Preview, String> {
    let url = post_url(&job.url)?;
    let state = app.state::<Studio>();
    let mut slot = state.project.lock().map_err(|e| e.to_string())?;
    if slot.as_ref().map(|p| &p.url) != Some(&url) {
        let token = format!("{}-{}", std::process::id(), stamp()?);
        let dir = env::temp_dir().join(format!("blog-shorts-studio-{token}"));
        fs::create_dir(&dir).map_err(|e| format!("임시 작업 폴더를 만들지 못했습니다. {e}"))?;
        *slot = Some(Project { url, token, dir });
    }
    let project = slot.as_ref().ok_or("글을 다시 확인하세요.")?;
    let manifest = project.dir.join("preview.json");
    if !manifest.is_file() {
        let secret = key(&job.api_key, "DEEPSEEK_API_KEY");
        if secret.is_empty() && !project.dir.join("plan.json").is_file() {
            return Err("대본 생성에 사용할 DeepSeek API 키를 입력하세요.".into());
        }
        let mut worker = engine(app, &job, project)?;
        worker
            .arg("-")
            .env("SHORTS_ACTION", "prepare")
            .env("DEEPSEEK_API_KEY", &secret);
        execute(app, &mut worker, &secret)?;
    }
    Ok(Preview {
        audio_ready: project.dir.join("voice.ready").is_file(),
        token: project.token.clone(),
        manifest: fs::read_to_string(manifest).map_err(|e| e.to_string())?,
    })
}

fn render(app: &AppHandle, job: Job) -> Result<String, String> {
    let url = post_url(&job.url)?;
    let state = app.state::<Studio>();
    let slot = state.project.lock().map_err(|e| e.to_string())?;
    let project = slot
        .as_ref()
        .filter(|p| p.token == job.token && p.url == url && p.dir.join("preview.json").is_file())
        .ok_or("현재 글의 미리보기를 다시 확인하세요.")?;
    let secret = key(&job.gemini_key, "GEMINI_API_KEY");
    if secret.is_empty() && !project.dir.join("voice.ready").is_file() {
        return Err("Gemini API 키를 입력하세요.".into());
    }
    let folder = PathBuf::from(job.output_folder.trim());
    if !folder.is_absolute() {
        return Err("저장 폴더의 전체 경로를 입력하세요.".into());
    }
    fs::create_dir_all(&folder).map_err(|e| format!("저장 폴더를 열 수 없습니다. {e}"))?;
    let stamp = stamp()?;
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

    let mut worker = engine(app, &job, project)?;
    worker
        .arg(&partial)
        .env("SHORTS_ACTION", "render")
        .env("SHORTS_PLAN_PATH", plan)
        .env("SHORTS_TEMPLATE", &job.template)
        .env("GEMINI_API_KEY", &secret);
    if let Err(error) = execute(app, &mut worker, &secret) {
        let _ = fs::remove_file(&partial);
        return Err(error);
    }
    if fs::metadata(&partial).map(|m| m.len()).unwrap_or(0) == 0 {
        return Err("결과 MP4를 확인할 수 없습니다.".into());
    }
    fs::rename(&partial, &file).map_err(|e| format!("완성 파일을 저장할 수 없습니다. {e}"))?;
    app.asset_protocol_scope()
        .allow_file(&file)
        .map_err(|e| e.to_string())?;
    *app.state::<Studio>()
        .last_file
        .lock()
        .map_err(|e| e.to_string())? = Some(file.clone());
    Ok(file.to_string_lossy().into_owned())
}

async fn run_task<T: Send + 'static>(
    app: AppHandle,
    job: Job,
    task: fn(&AppHandle, Job) -> Result<T, String>,
) -> Result<T, String> {
    if app.state::<Studio>().busy.swap(true, Ordering::AcqRel) {
        return Err("이미 진행 중인 작업이 있습니다.".into());
    }
    let handle = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || task(&handle, job)).await;
    app.state::<Studio>().busy.store(false, Ordering::Release);
    result.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn prepare(app: AppHandle, job: Job) -> Result<Preview, String> {
    run_task(app, job, preview_project).await
}

#[tauri::command]
async fn generate(app: AppHandle, job: Job) -> Result<String, String> {
    run_task(app, job, render).await
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
        .invoke_handler(tauri::generate_handler![
            defaults,
            prepare,
            generate,
            open_output
        ])
        .build(tauri::generate_context!())
        .expect("Blog Shorts startup failed")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Ok(mut slot) = app.state::<Studio>().project.try_lock() {
                    slot.take();
                }
            }
        });
}
