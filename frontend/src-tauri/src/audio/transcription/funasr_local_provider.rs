use super::provider::{TranscriptResult, TranscriptionError, TranscriptionProvider};
use async_trait::async_trait;
use futures_util::StreamExt;
use once_cell::sync::Lazy;
use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::Mutex;

const MODEL_NAME: &str = "sensevoice-small-q8";
const MODEL_FILE: &str = "sensevoice-small-q8.gguf";
const RUNTIME_VERSION: &str = "0.2.0";

const RUNTIME_ARCHIVE_URL: &str = "https://github.com/modelscope/FunASR/releases/download/runtime-llamacpp-v0.2.0/funasr-llamacpp-macos-arm64.tar.gz";
const RUNTIME_ARCHIVE_SHA256: &str =
    "416cbb289e31cb7575365d382155074e922fd061807a37b9ca0247dabd9bc6f9";
const MODEL_URL: &str =
    "https://huggingface.co/FunAudioLLM/SenseVoiceSmall-GGUF/resolve/main/sensevoice-small-q8.gguf";
const MODEL_SHA256: &str = "4ae45c94422de949b387e2e0fb10d7e14e4c42c69db30c3444ecc7d4b844b7c5";

const RUNTIME_ARCHIVE_BYTES: u64 = 7_353_175;
const MODEL_BYTES: u64 = 254_208_320;
const TOTAL_DOWNLOAD_BYTES: u64 = RUNTIME_ARCHIVE_BYTES + MODEL_BYTES;

static DOWNLOAD_IN_PROGRESS: Lazy<Mutex<bool>> = Lazy::new(|| Mutex::new(false));

#[derive(Clone)]
struct FunAsrLocalPaths {
    root_dir: PathBuf,
    runtime_dir: PathBuf,
    runtime_archive: PathBuf,
    binary: PathBuf,
    model: PathBuf,
}

#[derive(Debug, Serialize)]
pub struct FunAsrLocalStatus {
    pub supported: bool,
    pub is_ready: bool,
    pub model_ready: bool,
    pub runtime_ready: bool,
    pub is_downloading: bool,
    pub model_name: String,
    pub model_size_mb: u64,
    pub runtime_size_mb: u64,
}

fn is_supported_platform() -> bool {
    cfg!(target_os = "macos") && cfg!(target_arch = "aarch64")
}

fn unsupported_platform_message() -> String {
    "FunASR local mode currently requires an Apple Silicon Mac (macOS arm64).".to_string()
}

fn local_paths<R: Runtime>(app: &AppHandle<R>) -> Result<FunAsrLocalPaths, String> {
    let root_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate the application data directory: {error}"))?
        .join("models")
        .join("funasr");
    let runtime_dir = root_dir.join("runtime").join(RUNTIME_VERSION);

    Ok(FunAsrLocalPaths {
        runtime_archive: root_dir.join(format!("funasr-runtime-{RUNTIME_VERSION}.tar.gz")),
        binary: runtime_dir.join("llama-funasr-sensevoice"),
        model: root_dir.join(MODEL_FILE),
        root_dir,
        runtime_dir,
    })
}

async fn has_gguf_magic(path: &Path) -> bool {
    let Ok(mut file) = tokio::fs::File::open(path).await else {
        return false;
    };
    let mut magic = [0_u8; 4];
    file.read_exact(&mut magic).await.is_ok() && magic == *b"GGUF"
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
    let actual_checksum = String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    output.status.success() && actual_checksum == expected_sha256
}

async fn has_valid_gguf(path: &Path, expected_size: u64, expected_sha256: &str) -> bool {
    let Ok(metadata) = tokio::fs::metadata(path).await else {
        return false;
    };
    metadata.len() == expected_size
        && has_gguf_magic(path).await
        && sha256_matches(path, expected_sha256).await
}

async fn paths_are_ready(paths: &FunAsrLocalPaths) -> bool {
    paths.binary.is_file() && has_valid_gguf(&paths.model, MODEL_BYTES, MODEL_SHA256).await
}

pub async fn validate_local_model_ready<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if !is_supported_platform() {
        return Err(unsupported_platform_message());
    }

    let paths = local_paths(app)?;
    if !paths.binary.is_file() {
        return Err(
            "FunASR local runtime is not installed. Download SenseVoiceSmall from Settings > Transcription first."
                .to_string(),
        );
    }
    if !has_valid_gguf(&paths.model, MODEL_BYTES, MODEL_SHA256).await {
        return Err(
            "FunASR local model is not ready. Download SenseVoiceSmall from Settings > Transcription first."
                .to_string(),
        );
    }

    Ok(())
}

fn encode_wav(audio: Vec<f32>) -> Vec<u8> {
    const SAMPLE_RATE: u32 = 16_000;
    const CHANNELS: u16 = 1;
    const BITS_PER_SAMPLE: u16 = 16;

    let pcm: Vec<u8> = audio
        .into_iter()
        .flat_map(|sample| {
            let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
            value.to_le_bytes()
        })
        .collect();
    let data_len = pcm.len() as u32;
    let byte_rate = SAMPLE_RATE * CHANNELS as u32 * (BITS_PER_SAMPLE as u32 / 8);
    let block_align = CHANNELS * (BITS_PER_SAMPLE / 8);
    let mut wav = Vec::with_capacity(44 + pcm.len());

    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16_u32.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&CHANNELS.to_le_bytes());
    wav.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&BITS_PER_SAMPLE.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    wav.extend_from_slice(&pcm);
    wav
}

pub struct FunAsrLocalProvider {
    binary: PathBuf,
    model: PathBuf,
}

impl FunAsrLocalProvider {
    pub fn new<R: Runtime>(app: &AppHandle<R>) -> Result<Self, String> {
        let paths = local_paths(app)?;
        Ok(Self {
            binary: paths.binary,
            model: paths.model,
        })
    }
}

#[async_trait]
impl TranscriptionProvider for FunAsrLocalProvider {
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> Result<TranscriptResult, TranscriptionError> {
        if audio.is_empty() {
            return Err(TranscriptionError::AudioTooShort {
                samples: 0,
                minimum: 1,
            });
        }

        if let Some(language) =
            language.filter(|value| value != "auto" && value != "auto-translate")
        {
            log::debug!(
                "FunASR local SenseVoice uses its own language detection; ignoring language preference '{}'",
                language
            );
        }

        let mut audio_file = tempfile::NamedTempFile::new().map_err(|error| {
            TranscriptionError::EngineFailed(format!(
                "Failed to create temporary audio file: {error}"
            ))
        })?;
        audio_file.write_all(&encode_wav(audio)).map_err(|error| {
            TranscriptionError::EngineFailed(format!(
                "Failed to write temporary audio file: {error}"
            ))
        })?;

        let output = Command::new(&self.binary)
            .arg("-m")
            .arg(&self.model)
            .arg("-a")
            .arg(audio_file.path())
            .arg("--backend")
            .arg("cpu")
            .output()
            .await
            .map_err(|error| {
                TranscriptionError::EngineFailed(format!(
                    "Failed to start the FunASR local runtime: {error}"
                ))
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TranscriptionError::EngineFailed(format!(
                "FunASR local runtime exited with {}: {}",
                output.status,
                stderr.trim()
            )));
        }

        let text = String::from_utf8(output.stdout).map_err(|error| {
            TranscriptionError::EngineFailed(format!(
                "FunASR local runtime returned invalid text: {error}"
            ))
        })?;

        Ok(TranscriptResult {
            text: text.trim().to_string(),
            confidence: None,
            is_partial: false,
        })
    }

    async fn is_model_loaded(&self) -> bool {
        self.binary.is_file() && self.model.is_file()
    }

    async fn get_current_model(&self) -> Option<String> {
        Some(MODEL_NAME.to_string())
    }

    fn provider_name(&self) -> &'static str {
        "FunASR Local (SenseVoice)"
    }
}

async fn download_asset<R: Runtime>(
    app: &AppHandle<R>,
    url: &str,
    destination: &Path,
    completed_before: u64,
    expected_size: u64,
    expected_sha256: &str,
    asset_name: &str,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(60 * 30))
        .build()
        .map_err(|error| format!("Failed to create download client: {error}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Failed to download {asset_name}: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download {asset_name}: server returned HTTP {}",
            response.status()
        ));
    }

    let total = response.content_length().unwrap_or(expected_size);
    let partial_path = destination.with_extension("part");
    let mut file = tokio::fs::File::create(&partial_path)
        .await
        .map_err(|error| format!("Failed to create {}: {error}", partial_path.display()))?;
    let start = Instant::now();
    let mut downloaded = 0_u64;
    let mut last_progress = u8::MAX;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|error| format!("Failed while downloading {asset_name}: {error}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|error| format!("Failed to save {asset_name}: {error}"))?;
        downloaded += chunk.len() as u64;

        let overall_downloaded = completed_before + downloaded;
        let progress =
            ((overall_downloaded.saturating_mul(100) / TOTAL_DOWNLOAD_BYTES) as u8).min(99);
        if progress != last_progress {
            let elapsed = start.elapsed().as_secs_f64().max(0.001);
            let _ = app.emit(
                "funasr-local-download-progress",
                serde_json::json!({
                    "progress": progress,
                    "downloaded_bytes": overall_downloaded,
                    "total_bytes": TOTAL_DOWNLOAD_BYTES,
                    "asset": asset_name,
                    "asset_downloaded_bytes": downloaded,
                    "asset_total_bytes": total,
                    "speed_mbps": downloaded as f64 / elapsed / 1024.0 / 1024.0,
                }),
            );
            last_progress = progress;
        }
    }

    file.flush()
        .await
        .map_err(|error| format!("Failed to finish saving {asset_name}: {error}"))?;
    drop(file);
    if downloaded != expected_size {
        return Err(format!(
            "Downloaded {asset_name} has an unexpected size (received {downloaded} bytes)."
        ));
    }
    if !sha256_matches(&partial_path, expected_sha256).await {
        return Err(format!(
            "Downloaded {asset_name} did not pass SHA-256 integrity verification."
        ));
    }
    tokio::fs::rename(&partial_path, destination)
        .await
        .map_err(|error| format!("Failed to finalize {asset_name}: {error}"))?;
    Ok(())
}

async fn ensure_runtime<R: Runtime>(
    app: &AppHandle<R>,
    paths: &FunAsrLocalPaths,
) -> Result<(), String> {
    if paths.binary.is_file() {
        return Ok(());
    }

    tokio::fs::create_dir_all(&paths.runtime_dir)
        .await
        .map_err(|error| format!("Failed to create FunASR runtime directory: {error}"))?;
    download_asset(
        app,
        RUNTIME_ARCHIVE_URL,
        &paths.runtime_archive,
        0,
        RUNTIME_ARCHIVE_BYTES,
        RUNTIME_ARCHIVE_SHA256,
        "FunASR runtime",
    )
    .await?;

    let output = Command::new("tar")
        .arg("-xzf")
        .arg(&paths.runtime_archive)
        .arg("-C")
        .arg(&paths.runtime_dir)
        .output()
        .await
        .map_err(|error| format!("Failed to extract the FunASR runtime: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Failed to extract the FunASR runtime: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    if let Err(error) = tokio::fs::remove_file(&paths.runtime_archive).await {
        log::warn!("Failed to remove temporary FunASR archive: {error}");
    }

    if !paths.binary.is_file() {
        return Err(
            "The downloaded FunASR runtime did not contain the SenseVoice executable.".to_string(),
        );
    }

    Ok(())
}

async fn ensure_model<R: Runtime>(
    app: &AppHandle<R>,
    paths: &FunAsrLocalPaths,
) -> Result<(), String> {
    tokio::fs::create_dir_all(&paths.root_dir)
        .await
        .map_err(|error| format!("Failed to create FunASR model directory: {error}"))?;

    let completed_before = if paths.binary.is_file() {
        RUNTIME_ARCHIVE_BYTES
    } else {
        0
    };
    if !has_valid_gguf(&paths.model, MODEL_BYTES, MODEL_SHA256).await {
        download_asset(
            app,
            MODEL_URL,
            &paths.model,
            completed_before,
            MODEL_BYTES,
            MODEL_SHA256,
            "SenseVoiceSmall model",
        )
        .await?;
    }

    if !has_valid_gguf(&paths.model, MODEL_BYTES, MODEL_SHA256).await {
        return Err("The downloaded FunASR model files are invalid.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn funasr_local_get_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<FunAsrLocalStatus, String> {
    let is_downloading = *DOWNLOAD_IN_PROGRESS.lock().await;
    if !is_supported_platform() {
        return Ok(FunAsrLocalStatus {
            supported: false,
            is_ready: false,
            model_ready: false,
            runtime_ready: false,
            is_downloading,
            model_name: MODEL_NAME.to_string(),
            model_size_mb: MODEL_BYTES / 1024 / 1024,
            runtime_size_mb: RUNTIME_ARCHIVE_BYTES / 1024 / 1024,
        });
    }

    let paths = local_paths(&app)?;
    let model_ready = has_valid_gguf(&paths.model, MODEL_BYTES, MODEL_SHA256).await;
    let runtime_ready = paths.binary.is_file();
    Ok(FunAsrLocalStatus {
        supported: true,
        is_ready: model_ready && runtime_ready,
        model_ready,
        runtime_ready,
        is_downloading,
        model_name: MODEL_NAME.to_string(),
        model_size_mb: MODEL_BYTES / 1024 / 1024,
        runtime_size_mb: RUNTIME_ARCHIVE_BYTES / 1024 / 1024,
    })
}

#[tauri::command]
pub async fn funasr_local_add_existing_model<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    if !is_supported_platform() {
        return Err(unsupported_platform_message());
    }
    let app_for_dialog = app.clone();
    let selected = tokio::task::spawn_blocking(move || {
        app_for_dialog
            .dialog()
            .file()
            .add_filter("SenseVoice GGUF model", &["gguf"])
            .blocking_pick_file()
    })
    .await
    .map_err(|error| format!("Failed to open the model picker: {error}"))?;

    let Some(selected) = selected else {
        return Ok(None);
    };
    let source = PathBuf::from(selected.to_string());
    if !has_valid_gguf(&source, MODEL_BYTES, MODEL_SHA256).await {
        return Err(
            "The selected file is not the supported SenseVoiceSmall q8 GGUF model.".to_string(),
        );
    }

    let paths = local_paths(&app)?;
    crate::model_reference::link_existing_model(&source, &paths.model)?;
    Ok(Some(MODEL_NAME.to_string()))
}

#[tauri::command]
pub async fn funasr_local_download_model<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if !is_supported_platform() {
        return Err(unsupported_platform_message());
    }

    {
        let mut downloading = DOWNLOAD_IN_PROGRESS.lock().await;
        if *downloading {
            return Err("FunASR local model download is already in progress.".to_string());
        }
        *downloading = true;
    }

    let result = async {
        let paths = local_paths(&app)?;
        ensure_runtime(&app, &paths).await?;
        ensure_model(&app, &paths).await?;
        if !paths_are_ready(&paths).await {
            return Err("FunASR local model installation could not be verified.".to_string());
        }
        Ok(())
    }
    .await;

    *DOWNLOAD_IN_PROGRESS.lock().await = false;

    match result {
        Ok(()) => {
            let _ = app.emit(
                "funasr-local-download-complete",
                serde_json::json!({ "model_name": MODEL_NAME }),
            );
            Ok(())
        }
        Err(error) => {
            let _ = app.emit(
                "funasr-local-download-error",
                serde_json::json!({ "error": error }),
            );
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::encode_wav;

    #[test]
    fn creates_a_valid_pcm_wav_file() {
        let wav = encode_wav(vec![0.0, 1.0, -1.0]);
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(wav.len(), 50);
    }
}
