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
    voice_cache: PathBuf,
}

struct Project {
    url: String,
    token: String,
    dir: PathBuf,
}

impl Project {
    fn story_dir(&self, story: Option<u8>) -> Result<PathBuf, String> {
        let id = story.filter(|id| *id < 3).ok_or("이야기를 다시 선택하세요.")?;
        Ok(self.dir.join(format!("story-{id}")))
    }
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
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    url: String,
    api_key: String,
    #[serde(default)]
    typecast_key: String,
    #[serde(default)]
    voice_id: String,
    #[serde(default)]
    voice_model: String,
    #[serde(default)]
    token: String,
    #[serde(default)]
    template: String,
    #[serde(default)]
    operation: String,
    story: Option<u8>,
    #[serde(default)]
    edit: String,
    output_folder: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Defaults {
    has_key: bool,
    has_typecast_key: bool,
    output_folder: String,
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
        has_typecast_key: env::var("TYPECAST_API_KEY").is_ok_and(|v| !v.trim().is_empty()),
        output_folder: folder.to_string_lossy().into_owned(),
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
        .env_remove("TYPECAST_API_KEY")
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

fn detect_ffmpeg() -> Result<PathBuf, String> {
    let configured = env::var_os("FFMPEG").map(PathBuf::from);
    let path = env::var_os("PATH").unwrap_or_default();
    let candidates = adjacent("ffmpeg.exe")
        .into_iter()
        .chain(configured)
        .chain(env::split_paths(&path).map(|dir| dir.join("ffmpeg.exe")));
    for candidate in candidates {
        if candidate.is_absolute()
            && candidate.is_file()
            && command(&candidate.to_string_lossy())
                .arg("-version")
                .output()
                .is_ok_and(|output| output.status.success())
        {
            return Ok(candidate);
        }
    }
    Err("FFmpeg를 실행할 수 없습니다. 배포용 blog-shorts.exe를 다시 실행하세요.".into())
}

#[tauri::command]
async fn choose_folder(
    window: tauri::WebviewWindow,
    current: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("MP4 저장 폴더 선택");
        let path = Path::new(&current);
        if path.is_absolute() {
            if let Some(dir) = path.ancestors().find(|dir| dir.is_dir()) {
                dialog = dialog.set_directory(dir);
            }
        }
        dialog
            .pick_folder()
            .map(|folder| folder.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())
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

fn node_script(app: &AppHandle, name: &str) -> Result<Command, String> {
    let resource = format!("engine/{name}");
    let script = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join(&resource);
    let script = if script.is_file() {
        script
    } else if let Some(p) = adjacent(&resource) {
        p
    } else if cfg!(debug_assertions) {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../engine").join(name)
    } else {
        return Err("제작 엔진을 찾을 수 없습니다. 배포용 blog-shorts.exe를 다시 실행하세요.".into());
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
    let mut worker = command(&node);
    worker.arg(script);
    Ok(worker)
}

fn engine(app: &AppHandle, project: &Project, workspace: &Path) -> Result<Command, String> {
    let mut worker = node_script(app, "shorts.mjs")?;
    worker
        .arg(&project.url)
        .env("SHORTS_SESSION", workspace)
        .env("SHORTS_SOURCE_DIR", &project.dir)
        .env_remove("SHORTS_STORY")
        .env("FFMPEG", detect_ffmpeg()?)
        .env("SHORTS_PLANNER", "deepseek")
        .env("SHORTS_VOICE", "typecast")
        .env_remove("SHORTS_TEMPLATE")
        .env_remove("SHORTS_PLAN_PATH")
        .env_remove("SHORTS_EDIT")
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
            } else if line.starts_with("타입캐스트 음성 · ")
                || line.starts_with("사진 확인 · ")
                || line.starts_with("DeepSeek 대본 · ")
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
    let action = match job.operation.as_str() {
        "" | "stories" => "stories",
        "story" | "photos" | "ending" | "apply" => job.operation.as_str(),
        _ => return Err("편집 작업을 확인하세요.".into()),
    };
    if action != "stories" && !slot.as_ref().is_some_and(|p| p.url == url && p.token == job.token) {
        return Err("현재 글의 미리보기를 다시 확인하세요.".into());
    }
    if slot.as_ref().map(|p| &p.url) != Some(&url) {
        let token = format!("{}-{}", std::process::id(), stamp()?);
        let dir = env::temp_dir().join(format!("blog-shorts-studio-{token}"));
        fs::create_dir(&dir).map_err(|e| format!("임시 작업 폴더를 만들지 못했습니다. {e}"))?;
        *slot = Some(Project { url, token, dir });
    }
    let project = slot.as_ref().ok_or("글을 다시 확인하세요.")?;
    let workspace = if action == "stories" {
        project.dir.clone()
    } else {
        project.story_dir(job.story)?
    };
    fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
    let manifest = workspace.join(match action {
        "stories" => "stories.json",
        "story" => "board.json",
        "photos" => "choices.json",
        "ending" => "suggestion.json",
        _ => "preview.json",
    });
    let secret = key(&job.api_key, "DEEPSEEK_API_KEY");
    let mut worker = engine(app, project, &workspace)?;
    if let Some(id) = job.story { worker.env("SHORTS_STORY", id.to_string()); }
    worker.arg("-").env("SHORTS_ACTION", action).env("DEEPSEEK_API_KEY", &secret);
    if !job.edit.is_empty() { worker.env("SHORTS_EDIT", &job.edit); }
    execute(app, &mut worker, &secret)?;
    Ok(Preview {
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
        .filter(|p| p.token == job.token && p.url == url)
        .ok_or("현재 글의 미리보기를 다시 확인하세요.")?;
    let workspace = project.story_dir(job.story)?;
    if !workspace.join("preview.json").is_file() {
        return Err("선택한 이야기의 장면 검토를 마쳐 주세요.".into());
    }
    let secret = key(&job.typecast_key, "TYPECAST_API_KEY");
    if job.voice_id.is_empty() || job.voice_model.is_empty() {
        return Err("내레이션에 사용할 타입캐스트 목소리를 선택하세요.".into());
    }
    let folder = PathBuf::from(job.output_folder.trim());
    if !folder.is_absolute() {
        return Err("MP4를 저장할 폴더를 선택하세요.".into());
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

    let mut worker = engine(app, project, &workspace)?;
    worker
        .arg(&partial)
        .env("SHORTS_ACTION", "render")
        .env("SHORTS_PLAN_PATH", plan)
        .env("SHORTS_TEMPLATE", &job.template)
        .env("TYPECAST_API_KEY", &secret)
        .env("TYPECAST_VOICE_ID", &job.voice_id)
        .env("TYPECAST_MODEL", &job.voice_model)
        .env("SHORTS_TYPECAST_CACHE", &state.voice_cache);
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

async fn run_task<J: Send + 'static, T: Send + 'static>(
    app: AppHandle,
    job: J,
    task: fn(&AppHandle, J) -> Result<T, String>,
) -> Result<T, String> {
    if app.state::<Studio>().busy.swap(true, Ordering::AcqRel) {
        return Err("이미 진행 중인 작업이 있습니다.".into());
    }
    let handle = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || task(&handle, job)).await;
    app.state::<Studio>().busy.store(false, Ordering::Release);
    result.map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VoiceRequest {
    action: String,
    api_key: String,
    #[serde(default)]
    id: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    text: String,
}

fn voice_request(app: &AppHandle, request: VoiceRequest) -> Result<String, String> {
    let state = app.state::<Studio>();
    let secret = key(&request.api_key, "TYPECAST_API_KEY");
    let mut worker = node_script(app, "typecast-voice.mjs")?;
    match request.action.as_str() {
        "list" => { worker.arg("list"); }
        "detail" => { worker.arg("detail").env("TYPECAST_VOICE_ID", request.id); }
        "preview" => {
            if request.text.trim().is_empty() || request.text.chars().count() > 2000 {
                return Err("미리 들을 대사를 1~2,000자로 입력하세요.".into());
            }
            worker.arg("preview").env("TYPECAST_TEXT", request.text)
                .env("TYPECAST_VOICE_ID", request.id).env("TYPECAST_MODEL", request.model)
                .env("SHORTS_TYPECAST_CACHE", &state.voice_cache);
        }
        _ => return Err("목소리 조회 또는 미리 듣기를 선택하세요.".into()),
    }
    let output = worker.env("TYPECAST_API_KEY", &secret).output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        let mut message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        if !secret.is_empty() { message = message.replace(&secret, "[비공개]"); }
        return Err(message.chars().take(850).collect());
    }
    let stdout = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;
    let value = stdout.lines().last().ok_or("타입캐스트 응답을 읽을 수 없습니다.")?;
    if request.action != "preview" { return Ok(value.to_owned()); }
    let digest = value.strip_suffix(".wav").ok_or("미리 듣기 파일을 확인할 수 없습니다.")?;
    if digest.len() != 64 || !digest.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("미리 듣기 파일 이름을 확인할 수 없습니다.".into());
    }
    let file = state.voice_cache.join(value);
    app.asset_protocol_scope().allow_file(&file).map_err(|e| e.to_string())?;
    Ok(file.to_string_lossy().into_owned())
}

#[tauri::command]
async fn typecast_voice(app: AppHandle, request: VoiceRequest) -> Result<String, String> {
    run_task(app, request, voice_request).await
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
        .manage(Studio {
            voice_cache: env::temp_dir().join(format!("blog-shorts-voices-{}-{}",
                std::process::id(), stamp().expect("voice cache timestamp"))),
            ..Studio::default()
        })
        .invoke_handler(tauri::generate_handler![
            defaults,
            choose_folder,
            typecast_voice,
            prepare,
            generate,
            open_output
        ])
        .build(tauri::generate_context!())
        .expect("Blog Shorts startup failed")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let _ = fs::remove_dir_all(&app.state::<Studio>().voice_cache);
                if let Ok(mut slot) = app.state::<Studio>().project.try_lock() {
                    slot.take();
                }
            }
        });
}
