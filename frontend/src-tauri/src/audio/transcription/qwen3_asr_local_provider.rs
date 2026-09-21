use futures_util::StreamExt;
use once_cell::sync::Lazy;
use serde::Serialize;
use std::fs::OpenOptions;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex as StdMutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

const UV_VERSION: &str = "0.11.24";
const UV_ARCHIVE_URL: &str =
    "https://github.com/astral-sh/uv/releases/download/0.11.24/uv-aarch64-apple-darwin.tar.gz";
const UV_ARCHIVE_SHA256: &str = "7578c6087c5cd76981732b1f5d126248101faebdf81016ba780a65ce03653cdf";
const UV_ARCHIVE_BYTES: u64 = 21_190_959;
const PYTHON_VERSION: &str = "3.12";
const MLX_AUDIO_VERSION: &str = "0.5.1";
const RUNTIME_MARKER: &str = "mlx-audio=0.5.1\npython=3.12\n";
const SERVER_ENTRYPOINT: &str = r#"
import os
import threading
import time

meetily_parent = int(os.environ["MEETILY_PARENT_PID"])

def stop_if_parent_exits():
    while os.getppid() == meetily_parent:
        time.sleep(1)
    os._exit(0)

threading.Thread(target=stop_if_parent_exits, daemon=True).start()

from mlx_audio.server import main
main()
"#;

#[derive(Clone, Copy)]
struct Qwen3AsrModelSpec {
    id: &'static str,
    display_name: &'static str,
    directory: &'static str,
    model_bytes: u64,
}

const MODEL_SPECS: [Qwen3AsrModelSpec; 2] = [
    Qwen3AsrModelSpec {
        id: "mlx-community/Qwen3-ASR-0.6B-8bit",
        display_name: "Qwen3-ASR 0.6B 8-bit",
        directory: "Qwen3-ASR-0.6B-8bit",
        model_bytes: 1_006_229_426,
    },
    Qwen3AsrModelSpec {
        id: "mlx-community/Qwen3-ASR-1.7B-8bit",
        display_name: "Qwen3-ASR 1.7B 8-bit",
        directory: "Qwen3-ASR-1.7B-8bit",
        model_bytes: 2_463_307_541,
    },
];

static DOWNLOAD_STATE: Lazy<StdMutex<DownloadState>> = Lazy::new(|| {
    StdMutex::new(DownloadState {
        model_id: None,
        stage: "runtime_download",
        progress: 0,
    })
});
static MANAGED_SERVICE: Lazy<Mutex<Option<ManagedService>>> = Lazy::new(|| Mutex::new(None));

struct DownloadState {
    model_id: Option<String>,
    stage: &'static str,
    progress: u8,
}

#[derive(Clone)]
struct Qwen3AsrPaths {
    root_dir: PathBuf,
    models_dir: PathBuf,
    runtime_dir: PathBuf,
    uv_archive: PathBuf,
    uv_binary: PathBuf,
    uv_cache: PathBuf,
    python_install_dir: PathBuf,
    venv_dir: PathBuf,
    python_binary: PathBuf,
    server_binary: PathBuf,
    runtime_marker: PathBuf,
    log_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
pub struct Qwen3AsrModelStatus {
    pub id: String,
    pub display_name: String,
    pub size_bytes: u64,
    pub is_downloaded: bool,
}

#[derive(Debug, Serialize)]
pub struct Qwen3AsrLocalStatus {
    pub supported: bool,
    pub runtime_ready: bool,
    pub is_downloading: bool,
    pub download_model_id: Option<String>,
    pub download_stage: String,
    pub download_progress: u8,
    pub service_running: bool,
    pub models: Vec<Qwen3AsrModelStatus>,
}

struct ManagedService {
    child: Child,
    endpoint: String,
    model_id: String,
}

fn is_supported_platform() -> bool {
    cfg!(target_os = "macos") && cfg!(target_arch = "aarch64")
}

fn unsupported_platform_message() -> String {
    "Managed Qwen3-ASR currently requires an Apple Silicon Mac (macOS arm64).".to_string()
}

fn local_paths<R: Runtime>(app: &AppHandle<R>) -> Result<Qwen3AsrPaths, String> {
    let root_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate the application data directory: {error}"))?
        .join("models")
        .join("qwen3-asr");
    let runtime_dir = root_dir.join("runtime");
    let venv_dir = runtime_dir
        .join(format!("mlx-audio-{MLX_AUDIO_VERSION}"))
        .join("venv");

    Ok(Qwen3AsrPaths {
        models_dir: root_dir.join("models"),
        uv_archive: runtime_dir.join(format!("uv-{UV_VERSION}-macos-arm64.tar.gz")),
        uv_binary: runtime_dir.join(format!("uv-{UV_VERSION}")).join("uv"),
        uv_cache: runtime_dir.join("uv-cache"),
        python_install_dir: runtime_dir.join("python"),
        python_binary: venv_dir.join("bin").join("python"),
        server_binary: venv_dir.join("bin").join("mlx_audio.server"),
        runtime_marker: venv_dir.join(".meetily-runtime-version"),
        log_dir: root_dir.join("logs"),
        root_dir,
        runtime_dir,
        venv_dir,
    })
}

fn model_spec(model_id: &str) -> Result<Qwen3AsrModelSpec, String> {
    MODEL_SPECS
        .iter()
        .copied()
        .find(|spec| spec.id == model_id)
        .ok_or_else(|| format!("Unsupported managed Qwen3-ASR model: {model_id}"))
}

fn model_path(paths: &Qwen3AsrPaths, spec: Qwen3AsrModelSpec) -> PathBuf {
    paths.models_dir.join(spec.directory)
}

async fn model_is_ready(path: &Path, spec: Qwen3AsrModelSpec) -> bool {
    let required_files = [
        path.join("config.json"),
        path.join("tokenizer_config.json"),
        path.join("model.safetensors"),
    ];
    if !required_files.iter().all(|file| file.is_file()) {
        return false;
    }
    tokio::fs::metadata(path.join("model.safetensors"))
        .await
        .map(|metadata| metadata.len() == spec.model_bytes)
        .unwrap_or(false)
}

async fn runtime_is_ready(paths: &Qwen3AsrPaths) -> bool {
    if !paths.python_binary.is_file()
        || !paths.server_binary.is_file()
        || !paths.runtime_marker.is_file()
    {
        return false;
    }
    tokio::fs::read_to_string(&paths.runtime_marker)
        .await
        .map(|marker| marker == RUNTIME_MARKER)
        .unwrap_or(false)
}

fn emit_progress<R: Runtime>(app: &AppHandle<R>, model_id: &str, stage: &str, progress: u8) {
    if let Ok(mut download) = DOWNLOAD_STATE.lock() {
        download.model_id = Some(model_id.to_string());
        download.stage = match stage {
            "python" => "python",
            "mlx_audio" => "mlx_audio",
            "runtime_ready" => "runtime_ready",
            "model" => "model",
            _ => "runtime_download",
        };
        download.progress = progress.min(99);
    }
    let _ = app.emit(
        "qwen3-asr-download-progress",
        serde_json::json!({
            "model_id": model_id,
            "stage": stage,
            "progress": progress.min(99),
        }),
    );
}

async fn sha256_matches(path: &Path, expected_sha256: &str) -> bool {
    let Ok(output) = Command::new("shasum")
        .arg("-a")
        .arg("256")
        .arg(path)
        .output()
        .await
    else {
        return false;
    };
    let actual = String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    output.status.success() && actual == expected_sha256
}

async fn download_uv_archive<R: Runtime>(
    app: &AppHandle<R>,
    model_id: &str,
    destination: &Path,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(60 * 15))
        .build()
        .map_err(|error| format!("Failed to create the runtime download client: {error}"))?;
    let response =
        client.get(UV_ARCHIVE_URL).send().await.map_err(|error| {
            format!("Failed to download the Qwen3-ASR runtime bootstrap: {error}")
        })?;
    if !response.status().is_success() {
        return Err(format!(
            "Failed to download the Qwen3-ASR runtime bootstrap: HTTP {}",
            response.status()
        ));
    }

    let partial_path = destination.with_extension("part");
    let file = tokio::fs::File::create(&partial_path)
        .await
        .map_err(|error| format!("Failed to create {}: {error}", partial_path.display()))?;
    let mut writer = BufWriter::new(file);
    let mut downloaded = 0_u64;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("Runtime download failed: {error}"))?;
        writer
            .write_all(&chunk)
            .await
            .map_err(|error| format!("Failed to save the runtime bootstrap: {error}"))?;
        downloaded += chunk.len() as u64;
        let progress = (downloaded.saturating_mul(5) / UV_ARCHIVE_BYTES).min(5) as u8;
        emit_progress(app, model_id, "runtime_download", progress);
    }
    writer
        .flush()
        .await
        .map_err(|error| format!("Failed to finish the runtime download: {error}"))?;
    drop(writer);

    if downloaded != UV_ARCHIVE_BYTES || !sha256_matches(&partial_path, UV_ARCHIVE_SHA256).await {
        return Err(
            "The downloaded Qwen3-ASR runtime bootstrap failed integrity verification.".to_string(),
        );
    }
    tokio::fs::rename(&partial_path, destination)
        .await
        .map_err(|error| format!("Failed to finalize the runtime bootstrap: {error}"))?;
    Ok(())
}

fn find_file_named(root: &Path, file_name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.file_name().and_then(|name| name.to_str()) == Some(file_name) {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_file_named(&path, file_name) {
                return Some(found);
            }
        }
    }
    None
}

fn largest_model_weight_file(root: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(root) else {
        return 0;
    };
    let mut largest = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.is_dir() {
            largest = largest.max(largest_model_weight_file(&path));
        } else if metadata.is_file()
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("model.safetensors"))
        {
            largest = largest.max(metadata.len());
        }
    }
    largest
}

async fn ensure_uv<R: Runtime>(
    app: &AppHandle<R>,
    model_id: &str,
    paths: &Qwen3AsrPaths,
) -> Result<(), String> {
    if paths.uv_binary.is_file() {
        return Ok(());
    }

    tokio::fs::create_dir_all(&paths.runtime_dir)
        .await
        .map_err(|error| format!("Failed to create the Qwen3-ASR runtime directory: {error}"))?;
    if !paths.uv_archive.is_file() || !sha256_matches(&paths.uv_archive, UV_ARCHIVE_SHA256).await {
        download_uv_archive(app, model_id, &paths.uv_archive).await?;
    }

    let extract_dir = paths.runtime_dir.join(format!("uv-{UV_VERSION}-extract"));
    if extract_dir.exists() {
        tokio::fs::remove_dir_all(&extract_dir)
            .await
            .map_err(|error| {
                format!("Failed to clean an incomplete runtime extraction: {error}")
            })?;
    }
    tokio::fs::create_dir_all(&extract_dir)
        .await
        .map_err(|error| format!("Failed to prepare runtime extraction: {error}"))?;
    let output = Command::new("tar")
        .arg("-xzf")
        .arg(&paths.uv_archive)
        .arg("-C")
        .arg(&extract_dir)
        .output()
        .await
        .map_err(|error| format!("Failed to extract the runtime bootstrap: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Failed to extract the runtime bootstrap: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let source = find_file_named(&extract_dir, "uv")
        .ok_or_else(|| "The runtime archive did not contain uv.".to_string())?;
    if let Some(parent) = paths.uv_binary.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("Failed to create the uv runtime directory: {error}"))?;
    }
    tokio::fs::copy(&source, &paths.uv_binary)
        .await
        .map_err(|error| format!("Failed to install the runtime bootstrap: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(&paths.uv_binary)
            .map_err(|error| format!("Failed to read uv permissions: {error}"))?
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&paths.uv_binary, permissions)
            .map_err(|error| format!("Failed to make uv executable: {error}"))?;
    }
    let _ = tokio::fs::remove_dir_all(&extract_dir).await;
    let _ = tokio::fs::remove_file(&paths.uv_archive).await;
    emit_progress(app, model_id, "runtime_download", 5);
    Ok(())
}

fn configure_uv_command(command: &mut Command, paths: &Qwen3AsrPaths) {
    command
        .env("UV_CACHE_DIR", &paths.uv_cache)
        .env("UV_PYTHON_INSTALL_DIR", &paths.python_install_dir)
        .env("UV_NO_PROGRESS", "1")
        .env("HF_HUB_DISABLE_TELEMETRY", "1");
}

fn log_tail(path: &Path) -> String {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return String::new();
    };
    contents
        .chars()
        .rev()
        .take(4_000)
        .collect::<String>()
        .chars()
        .rev()
        .collect()
}

async fn run_logged(command: &mut Command, log_path: &Path, operation: &str) -> Result<(), String> {
    if let Some(parent) = log_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("Failed to create the runtime log directory: {error}"))?;
    }
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|error| format!("Failed to open {}: {error}", log_path.display()))?;
    let error_log = log
        .try_clone()
        .map_err(|error| format!("Failed to clone the runtime log handle: {error}"))?;
    let status = command
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(error_log))
        .status()
        .await
        .map_err(|error| format!("Failed to start {operation}: {error}"))?;
    if status.success() {
        return Ok(());
    }
    let details = log_tail(log_path);
    Err(if details.trim().is_empty() {
        format!("{operation} exited with {status}")
    } else {
        format!("{operation} exited with {status}: {}", details.trim())
    })
}

async fn ensure_runtime<R: Runtime>(
    app: &AppHandle<R>,
    model_id: &str,
    paths: &Qwen3AsrPaths,
) -> Result<(), String> {
    if runtime_is_ready(paths).await {
        emit_progress(app, model_id, "runtime_ready", 25);
        return Ok(());
    }

    ensure_uv(app, model_id, paths).await?;
    tokio::fs::create_dir_all(&paths.log_dir)
        .await
        .map_err(|error| format!("Failed to create the Qwen3-ASR log directory: {error}"))?;
    emit_progress(app, model_id, "python", 7);

    let runtime_log = paths.log_dir.join("runtime-install.log");
    let mut venv_command = Command::new(&paths.uv_binary);
    venv_command
        .arg("venv")
        .arg("--clear")
        .arg("--managed-python")
        .arg("--python")
        .arg(PYTHON_VERSION)
        .arg(&paths.venv_dir);
    configure_uv_command(&mut venv_command, paths);
    run_logged(
        &mut venv_command,
        &runtime_log,
        "the managed Python environment setup",
    )
    .await?;

    emit_progress(app, model_id, "mlx_audio", 12);
    let mut install_command = Command::new(&paths.uv_binary);
    install_command
        .arg("pip")
        .arg("install")
        .arg("--python")
        .arg(&paths.python_binary)
        .arg(format!("mlx-audio[stt,server]=={MLX_AUDIO_VERSION}"));
    configure_uv_command(&mut install_command, paths);
    run_logged(
        &mut install_command,
        &runtime_log,
        "the MLX-Audio runtime installation",
    )
    .await?;

    if !paths.server_binary.is_file() {
        return Err("MLX-Audio was installed, but its server executable is missing.".to_string());
    }
    tokio::fs::write(&paths.runtime_marker, RUNTIME_MARKER)
        .await
        .map_err(|error| format!("Failed to mark the MLX-Audio runtime as ready: {error}"))?;
    emit_progress(app, model_id, "runtime_ready", 25);
    Ok(())
}

async fn download_model_snapshot<R: Runtime>(
    app: &AppHandle<R>,
    spec: Qwen3AsrModelSpec,
    paths: &Qwen3AsrPaths,
) -> Result<(), String> {
    let destination = model_path(paths, spec);
    if model_is_ready(&destination, spec).await {
        emit_progress(app, spec.id, "model", 99);
        return Ok(());
    }
    tokio::fs::create_dir_all(&destination)
        .await
        .map_err(|error| format!("Failed to create the Qwen3-ASR model directory: {error}"))?;

    let model_log = paths.log_dir.join("model-download.log");
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&model_log)
        .map_err(|error| format!("Failed to open {}: {error}", model_log.display()))?;
    let error_log = log
        .try_clone()
        .map_err(|error| format!("Failed to clone the model log handle: {error}"))?;
    let mut command = Command::new(&paths.python_binary);
    command
        .arg("-c")
        .arg(
            "from huggingface_hub import snapshot_download; import sys; snapshot_download(repo_id=sys.argv[1], local_dir=sys.argv[2])",
        )
        .arg(spec.id)
        .arg(&destination)
        .env("HF_HOME", paths.root_dir.join("huggingface-cache"))
        .env("HF_HUB_DISABLE_TELEMETRY", "1")
        .env("HF_HUB_DISABLE_PROGRESS_BARS", "1")
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(error_log));
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start the Qwen3-ASR model download: {error}"))?;

    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Failed to monitor the Qwen3-ASR model download: {error}"))?
        {
            if !status.success() {
                let details = log_tail(&model_log);
                return Err(if details.trim().is_empty() {
                    format!("The Qwen3-ASR model download exited with {status}")
                } else {
                    format!(
                        "The Qwen3-ASR model download exited with {status}: {}",
                        details.trim()
                    )
                });
            }
            break;
        }

        // huggingface_hub writes the large weight file under .cache before
        // atomically moving it into place, so account for either location.
        let destination_for_size = destination.clone();
        let downloaded =
            tokio::task::spawn_blocking(move || largest_model_weight_file(&destination_for_size))
                .await
                .unwrap_or(0);
        let model_progress = downloaded.saturating_mul(74) / spec.model_bytes;
        emit_progress(app, spec.id, "model", (25 + model_progress.min(74)) as u8);
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    if !model_is_ready(&destination, spec).await {
        return Err("The downloaded Qwen3-ASR model is incomplete or incompatible.".to_string());
    }
    emit_progress(app, spec.id, "model", 99);
    Ok(())
}

pub async fn validate_local_model_ready<R: Runtime>(
    app: &AppHandle<R>,
    model_id: &str,
) -> Result<(), String> {
    if !is_supported_platform() {
        return Err(unsupported_platform_message());
    }
    let spec = model_spec(model_id)?;
    let paths = local_paths(app)?;
    if !runtime_is_ready(&paths).await {
        return Err(
            "The managed MLX-Audio runtime is not ready. Download Qwen3-ASR in Settings > Transcription first."
                .to_string(),
        );
    }
    if !model_is_ready(&model_path(&paths, spec), spec).await {
        return Err(format!(
            "{} is not downloaded. Download it in Settings > Transcription first.",
            spec.display_name
        ));
    }
    Ok(())
}

fn reserve_loopback_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("Failed to reserve a local MLX-Audio port: {error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| format!("Failed to read the local MLX-Audio port: {error}"))
}

async fn stop_service_locked(service: &mut ManagedService) {
    if let Err(error) = service.child.kill().await {
        log::warn!("Failed to stop the managed MLX-Audio service: {error}");
    }
}

pub async fn ensure_service<R: Runtime>(
    app: &AppHandle<R>,
    model_id: &str,
) -> Result<(String, String), String> {
    validate_local_model_ready(app, model_id).await?;
    let spec = model_spec(model_id)?;
    let paths = local_paths(app)?;
    let canonical_model_path = tokio::fs::canonicalize(model_path(&paths, spec))
        .await
        .map_err(|error| format!("Failed to resolve the Qwen3-ASR model path: {error}"))?;

    let mut managed = MANAGED_SERVICE.lock().await;
    if let Some(service) = managed.as_mut() {
        let running = service
            .child
            .try_wait()
            .map_err(|error| format!("Failed to inspect the MLX-Audio service: {error}"))?
            .is_none();
        if running && service.model_id == model_id {
            return Ok((
                service.endpoint.clone(),
                canonical_model_path.to_string_lossy().to_string(),
            ));
        }
        if running {
            stop_service_locked(service).await;
        }
        *managed = None;
    }

    tokio::fs::create_dir_all(&paths.log_dir)
        .await
        .map_err(|error| format!("Failed to create the MLX-Audio log directory: {error}"))?;
    let port = reserve_loopback_port()?;
    let base_url = format!("http://127.0.0.1:{port}");
    let endpoint = format!("{base_url}/v1");
    let service_log_path = paths.log_dir.join("service.log");
    let service_log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&service_log_path)
        .map_err(|error| format!("Failed to open the MLX-Audio service log: {error}"))?;
    let service_error_log = service_log
        .try_clone()
        .map_err(|error| format!("Failed to clone the MLX-Audio log handle: {error}"))?;
    // Run the server in the managed Python process itself. The watchdog also
    // handles abnormal Meetily termination, where the normal exit hook cannot run.
    let mut child = Command::new(&paths.python_binary)
        .arg("-c")
        .arg(SERVER_ENTRYPOINT)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .current_dir(&paths.root_dir)
        .env("HF_HOME", paths.root_dir.join("huggingface-cache"))
        .env("HF_HUB_OFFLINE", "1")
        .env("HF_HUB_DISABLE_TELEMETRY", "1")
        .env("PYTHONUNBUFFERED", "1")
        .env("MEETILY_PARENT_PID", std::process::id().to_string())
        .stdout(Stdio::from(service_log))
        .stderr(Stdio::from(service_error_log))
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Failed to start the managed MLX-Audio service: {error}"))?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|error| format!("Failed to create the MLX-Audio health client: {error}"))?;
    let mut healthy = false;
    for _ in 0..240 {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Failed to inspect the MLX-Audio service: {error}"))?
        {
            return Err(format!(
                "MLX-Audio exited during startup with {status}: {}",
                log_tail(&service_log_path).trim()
            ));
        }
        if client
            .get(format!("{base_url}/"))
            .send()
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false)
        {
            healthy = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    if !healthy {
        let _ = child.kill().await;
        return Err(format!(
            "MLX-Audio did not become ready: {}",
            log_tail(&service_log_path).trim()
        ));
    }

    let model_path_string = canonical_model_path.to_string_lossy().to_string();
    let preload_response = match client
        .post(format!("{endpoint}/models"))
        .query(&[("model_name", model_path_string.as_str())])
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            let _ = child.kill().await;
            return Err(format!(
                "Failed to load the Qwen3-ASR model in MLX-Audio: {error}"
            ));
        }
    };
    if !preload_response.status().is_success() {
        let status = preload_response.status();
        let body = preload_response.text().await.unwrap_or_default();
        let _ = child.kill().await;
        return Err(format!(
            "MLX-Audio could not load {} (HTTP {status}): {}",
            spec.display_name,
            body.chars().take(1_000).collect::<String>()
        ));
    }

    log::info!(
        "Managed MLX-Audio service is ready on 127.0.0.1:{} with {}",
        port,
        spec.display_name
    );
    *managed = Some(ManagedService {
        child,
        endpoint: endpoint.clone(),
        model_id: model_id.to_string(),
    });
    Ok((endpoint, model_path_string))
}

pub async fn shutdown_managed_service() -> Result<(), String> {
    let mut managed = MANAGED_SERVICE.lock().await;
    if let Some(mut service) = managed.take() {
        service
            .child
            .kill()
            .await
            .map_err(|error| format!("Failed to stop the managed MLX-Audio service: {error}"))?;
        log::info!("Managed MLX-Audio service stopped");
    }
    Ok(())
}

async fn service_is_running() -> bool {
    let mut managed = MANAGED_SERVICE.lock().await;
    let Some(service) = managed.as_mut() else {
        return false;
    };
    match service.child.try_wait() {
        Ok(None) => true,
        Ok(Some(_)) | Err(_) => {
            *managed = None;
            false
        }
    }
}

#[tauri::command]
pub async fn qwen3_asr_get_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Qwen3AsrLocalStatus, String> {
    let paths = local_paths(&app)?;
    let mut models = Vec::with_capacity(MODEL_SPECS.len());
    for spec in MODEL_SPECS {
        models.push(Qwen3AsrModelStatus {
            id: spec.id.to_string(),
            display_name: spec.display_name.to_string(),
            size_bytes: spec.model_bytes,
            is_downloaded: model_is_ready(&model_path(&paths, spec), spec).await,
        });
    }
    let (download_model_id, download_stage, download_progress) = DOWNLOAD_STATE
        .lock()
        .map(|download| {
            (
                download.model_id.clone(),
                download.stage.to_string(),
                download.progress,
            )
        })
        .unwrap_or_else(|_| (None, "runtime_download".to_string(), 0));
    Ok(Qwen3AsrLocalStatus {
        supported: is_supported_platform(),
        runtime_ready: runtime_is_ready(&paths).await,
        is_downloading: download_model_id.is_some(),
        download_model_id,
        download_stage,
        download_progress,
        service_running: service_is_running().await,
        models,
    })
}

#[tauri::command]
pub async fn qwen3_asr_add_existing_model<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    if !is_supported_platform() {
        return Err(unsupported_platform_message());
    }
    let app_for_dialog = app.clone();
    let selected =
        tokio::task::spawn_blocking(move || app_for_dialog.dialog().file().blocking_pick_folder())
            .await
            .map_err(|error| format!("Failed to open the model folder picker: {error}"))?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let source = PathBuf::from(selected.to_string());
    let mut matched = None;
    for spec in MODEL_SPECS {
        if model_is_ready(&source, spec).await {
            matched = Some(spec);
            break;
        }
    }
    let spec = matched.ok_or_else(|| {
        "The selected folder is not a supported MLX Qwen3-ASR 0.6B or 1.7B 8-bit model.".to_string()
    })?;
    let paths = local_paths(&app)?;
    crate::model_reference::link_existing_model(&source, &model_path(&paths, spec))?;
    Ok(Some(spec.id.to_string()))
}

#[tauri::command]
pub async fn qwen3_asr_download_model<R: Runtime>(
    app: AppHandle<R>,
    model_id: String,
) -> Result<(), String> {
    if !is_supported_platform() {
        return Err(unsupported_platform_message());
    }
    let spec = model_spec(&model_id)?;
    {
        let mut download = DOWNLOAD_STATE
            .lock()
            .map_err(|error| format!("Failed to inspect Qwen3-ASR download state: {error}"))?;
        if download.model_id.is_some() {
            return Err("A managed Qwen3-ASR download is already in progress.".to_string());
        }
        download.model_id = Some(spec.id.to_string());
        download.stage = "runtime_download";
        download.progress = 0;
    }

    let result = async {
        let paths = local_paths(&app)?;
        ensure_runtime(&app, spec.id, &paths).await?;
        download_model_snapshot(&app, spec, &paths).await?;
        validate_local_model_ready(&app, spec.id).await
    }
    .await;
    if let Ok(mut download) = DOWNLOAD_STATE.lock() {
        download.model_id = None;
        download.progress = if result.is_ok() {
            100
        } else {
            download.progress
        };
    }

    match result {
        Ok(()) => {
            let _ = app.emit(
                "qwen3-asr-download-complete",
                serde_json::json!({ "model_id": spec.id }),
            );
            Ok(())
        }
        Err(error) => {
            let _ = app.emit(
                "qwen3-asr-download-error",
                serde_json::json!({ "model_id": spec.id, "error": error }),
            );
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{model_spec, reserve_loopback_port, MODEL_SPECS};

    #[test]
    fn exposes_the_supported_mlx_models() {
        assert_eq!(MODEL_SPECS.len(), 2);
        assert!(model_spec("mlx-community/Qwen3-ASR-0.6B-8bit").is_ok());
        assert!(model_spec("mlx-community/Qwen3-ASR-1.7B-8bit").is_ok());
        assert!(model_spec("Qwen/Qwen3-ASR-0.6B").is_err());
    }

    #[test]
    fn reserves_a_loopback_port() {
        assert_ne!(reserve_loopback_port().unwrap(), 0);
    }
}
