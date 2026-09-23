//! Optional screen recording that is deliberately isolated from the audio pipeline.
//!
//! A failure here must never prevent meeting audio, transcription, or summarization.

#[cfg(not(target_os = "macos"))]
use std::path::PathBuf;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub use macos::{start, stop};

#[cfg(not(target_os = "macos"))]
pub async fn start(_output_path: PathBuf) -> Result<PathBuf, String> {
    Err("Screen recording is currently available only on macOS".to_string())
}

#[cfg(not(target_os = "macos"))]
pub async fn stop() -> Result<Option<PathBuf>, String> {
    Ok(None)
}
