use crate::api::TranscriptSegment;
use crate::audio::transcription::{
    FunAsrLocalProvider, OpenAiCompatibleProvider, TranscriptionEngine,
};
use anyhow::Result;
use log::{debug, info};
use once_cell::sync::Lazy;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};
use uuid::Uuid;

static ENGINE_LIFECYCLE_LOCK: Lazy<Arc<AsyncMutex<()>>> =
    Lazy::new(|| Arc::new(AsyncMutex::new(())));

pub(crate) async fn acquire_engine_lifecycle_lock() -> OwnedMutexGuard<()> {
    ENGINE_LIFECYCLE_LOCK.clone().lock_owned().await
}

/// Initialize the provider and model selected by an import or retranscription job.
/// Endpoint credentials for external FunASR come from the saved transcription
/// settings; batch dialogs never copy secrets into command arguments.
pub(crate) async fn init_batch_transcription_engine<R: Runtime>(
    app: &AppHandle<R>,
    provider: Option<&str>,
    model: Option<&str>,
) -> Result<TranscriptionEngine> {
    let saved_config =
        crate::api::api::api_get_transcript_config(app.clone(), app.clone().state(), None)
            .await
            .map_err(anyhow::Error::msg)?
            .unwrap_or(crate::api::api::TranscriptConfig {
                provider: "parakeet".to_string(),
                model: crate::config::DEFAULT_PARAKEET_MODEL.to_string(),
                endpoint: None,
                api_key: None,
            });

    let selected_provider = provider
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&saved_config.provider);
    let selected_model = model
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .or_else(|| {
            (selected_provider == saved_config.provider).then(|| saved_config.model.clone())
        });

    match selected_provider {
        "localWhisper" | "whisper" => {
            crate::whisper_engine::commands::whisper_init()
                .await
                .map_err(anyhow::Error::msg)?;
            let engine = {
                let guard = crate::whisper_engine::commands::WHISPER_ENGINE
                    .lock()
                    .unwrap_or_else(|error| error.into_inner());
                guard.as_ref().cloned()
            }
            .ok_or_else(|| anyhow::anyhow!("Whisper engine failed to initialize"))?;
            let target_model =
                selected_model.unwrap_or_else(|| crate::config::DEFAULT_WHISPER_MODEL.to_string());
            if engine.get_current_model().await.as_deref() != Some(target_model.as_str()) {
                if let Err(error) = engine.discover_models().await {
                    log::warn!("Whisper model discovery failed: {error}");
                }
                engine.load_model(&target_model).await.map_err(|error| {
                    anyhow::anyhow!("Failed to load Whisper model '{target_model}': {error}")
                })?;
            }
            Ok(TranscriptionEngine::Whisper(engine))
        }
        "parakeet" => {
            crate::parakeet_engine::commands::parakeet_init()
                .await
                .map_err(anyhow::Error::msg)?;
            let engine = {
                let guard = crate::parakeet_engine::commands::PARAKEET_ENGINE
                    .lock()
                    .unwrap_or_else(|error| error.into_inner());
                guard.as_ref().cloned()
            }
            .ok_or_else(|| anyhow::anyhow!("Parakeet engine failed to initialize"))?;
            let target_model =
                selected_model.unwrap_or_else(|| crate::config::DEFAULT_PARAKEET_MODEL.to_string());
            if engine.get_current_model().await.as_deref() != Some(target_model.as_str()) {
                if let Err(error) = engine.discover_models().await {
                    log::warn!("Parakeet model discovery failed: {error}");
                }
                engine.load_model(&target_model).await.map_err(|error| {
                    anyhow::anyhow!("Failed to load Parakeet model '{target_model}': {error}")
                })?;
            }
            Ok(TranscriptionEngine::Parakeet(engine))
        }
        "qwen3Asr" => {
            let target_model = selected_model
                .ok_or_else(|| anyhow::anyhow!("Select a Qwen3-ASR model in Settings first"))?;
            crate::audio::transcription::qwen3_asr_local_provider::validate_local_model_ready(
                app,
                &target_model,
            )
            .await
            .map_err(anyhow::Error::msg)?;
            let (endpoint, model_path) =
                crate::audio::transcription::qwen3_asr_local_provider::ensure_service(
                    app,
                    &target_model,
                )
                .await
                .map_err(anyhow::Error::msg)?;
            let provider = OpenAiCompatibleProvider::new("Qwen3-ASR", endpoint, model_path, None)?;
            Ok(TranscriptionEngine::Provider(Arc::new(provider)))
        }
        "funasrLocal" => {
            crate::audio::transcription::funasr_local_provider::validate_local_model_ready(app)
                .await
                .map_err(anyhow::Error::msg)?;
            Ok(TranscriptionEngine::Provider(Arc::new(
                FunAsrLocalProvider::new(app).map_err(anyhow::Error::msg)?,
            )))
        }
        "funasr" => {
            if saved_config.provider != "funasr" {
                return Err(anyhow::anyhow!(
                    "Configure and save the external FunASR service in Settings first"
                ));
            }
            let endpoint = saved_config
                .endpoint
                .ok_or_else(|| anyhow::anyhow!("The saved FunASR service URL is empty"))?;
            let target_model = selected_model
                .ok_or_else(|| anyhow::anyhow!("The saved FunASR model name is empty"))?;
            let provider = OpenAiCompatibleProvider::new(
                "FunASR",
                endpoint,
                target_model,
                saved_config.api_key,
            )?;
            Ok(TranscriptionEngine::Provider(Arc::new(provider)))
        }
        other => Err(anyhow::anyhow!(
            "Unsupported transcription provider for batch audio: {other}"
        )),
    }
}

pub(crate) async fn transcribe_batch_segment(
    engine: &TranscriptionEngine,
    samples: Vec<f32>,
    language: Option<String>,
) -> Result<(String, f32)> {
    match engine {
        TranscriptionEngine::Whisper(engine) => {
            let (text, confidence, _) = engine
                .transcribe_audio_with_confidence(samples, language)
                .await?;
            Ok((text, confidence))
        }
        TranscriptionEngine::Parakeet(engine) => {
            let text = engine.transcribe_audio(samples).await?;
            Ok((text, 0.9))
        }
        TranscriptionEngine::Provider(provider) => {
            let result = provider.transcribe(samples, language).await?;
            Ok((result.text, result.confidence.unwrap_or(0.9)))
        }
    }
}

/// Unload the transcription engine after a batch job (import or retranscription).
/// Skips unloading if a live recording is currently in progress, since recording
/// may be using the same engine or managed service.
pub(crate) async fn unload_engine_after_batch<R: Runtime>(
    app: &AppHandle<R>,
    provider: Option<&str>,
) {
    let _engine_lifecycle_guard = acquire_engine_lifecycle_lock().await;

    if crate::audio::recording_commands::is_recording().await {
        log::info!("Skipping model unload after batch: recording in progress");
        return;
    }

    let resolved_provider = match provider.filter(|value| !value.trim().is_empty()) {
        Some(provider) => provider.to_string(),
        None => crate::api::api::api_get_transcript_config(app.clone(), app.clone().state(), None)
            .await
            .ok()
            .flatten()
            .map(|config| config.provider)
            .unwrap_or_else(|| "parakeet".to_string()),
    };

    match resolved_provider.as_str() {
        "parakeet" => {
            let engine = {
                let guard = crate::parakeet_engine::commands::PARAKEET_ENGINE
                    .lock()
                    .unwrap_or_else(|error| error.into_inner());
                guard.as_ref().cloned()
            };
            if let Some(engine) = engine {
                engine.unload_model().await;
            }
        }
        "localWhisper" | "whisper" => {
            let engine = {
                let guard = crate::whisper_engine::commands::WHISPER_ENGINE
                    .lock()
                    .unwrap_or_else(|error| error.into_inner());
                guard.as_ref().cloned()
            };
            if let Some(engine) = engine {
                engine.unload_model().await;
            }
        }
        "qwen3Asr" => {
            if let Err(error) =
                crate::audio::transcription::qwen3_asr_local_provider::shutdown_managed_service()
                    .await
            {
                log::warn!("Failed to stop MLX-Audio after batch transcription: {error}");
            }
        }
        _ => {}
    }
}

/// Create transcript segments from transcription results.
/// Each tuple is (text, start_ms, end_ms) from VAD timestamps.
pub(crate) fn create_transcript_segments(
    transcripts: &[(String, f64, f64)],
) -> Vec<TranscriptSegment> {
    transcripts
        .iter()
        .map(|(text, start_ms, end_ms)| {
            let start_seconds = start_ms / 1000.0;
            let end_seconds = end_ms / 1000.0;
            let duration = end_seconds - start_seconds;

            TranscriptSegment {
                id: format!("transcript-{}", Uuid::new_v4()),
                text: text.trim().to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
                audio_start_time: Some(start_seconds),
                audio_end_time: Some(end_seconds),
                duration: Some(duration),
            }
        })
        .collect()
}

/// Write transcripts.json to a meeting folder (atomic write with temp file)
pub(crate) fn write_transcripts_json(folder: &Path, segments: &[TranscriptSegment]) -> Result<()> {
    let transcript_path = folder.join("transcripts.json");
    let temp_path = folder.join(".transcripts.json.tmp");

    let json = serde_json::json!({
        "version": "1.0",
        "last_updated": chrono::Utc::now().to_rfc3339(),
        "total_segments": segments.len(),
        "segments": segments.iter().enumerate().map(|(i, s)| {
            serde_json::json!({
                "id": s.id,
                "text": s.text,
                "timestamp": s.timestamp,
                "audio_start_time": s.audio_start_time,
                "audio_end_time": s.audio_end_time,
                "duration": s.duration,
                "sequence_id": i
            })
        }).collect::<Vec<_>>()
    });

    let json_string = serde_json::to_string_pretty(&json)?;
    std::fs::write(&temp_path, &json_string)?;
    std::fs::rename(&temp_path, &transcript_path)?;

    info!(
        "Wrote transcripts.json with {} segments to {}",
        segments.len(),
        transcript_path.display()
    );
    Ok(())
}

/// Split a long speech segment at the lowest-energy (silence) point near the target size.
///
/// Scans for 100ms windows with minimal RMS energy within +/-3 seconds of each target
/// split point. If no clear silence is found, falls back to a 1-second overlap split
/// to avoid cutting words at boundaries.
pub(crate) fn split_segment_at_silence(
    segment: &crate::audio::vad::SpeechSegment,
    max_samples: usize,
) -> Vec<crate::audio::vad::SpeechSegment> {
    const SAMPLE_RATE: usize = 16000;
    // 100ms window for energy measurement (1600 samples at 16kHz)
    const ENERGY_WINDOW: usize = SAMPLE_RATE / 10;
    // Search +/-3 seconds around the target split point
    const SEARCH_RADIUS: usize = SAMPLE_RATE * 3;
    // RMS threshold below which we consider a window "silent"
    const SILENCE_RMS_THRESHOLD: f32 = 0.02;
    // Overlap to use when no silence boundary is found (1 second)
    const FALLBACK_OVERLAP: usize = SAMPLE_RATE;

    let total = segment.samples.len();
    if total <= max_samples {
        return vec![segment.clone()];
    }

    let ms_per_sample =
        (segment.end_timestamp_ms - segment.start_timestamp_ms) / segment.samples.len() as f64;
    let mut result = Vec::new();
    let mut pos = 0usize;

    while pos < total {
        let remaining = total - pos;
        if remaining <= max_samples {
            // Last chunk - take everything remaining
            let chunk_samples = segment.samples[pos..].to_vec();
            let chunk_start_ms = segment.start_timestamp_ms + (pos as f64 * ms_per_sample);
            let chunk_end_ms = segment.end_timestamp_ms;
            result.push(crate::audio::vad::SpeechSegment {
                samples: chunk_samples,
                start_timestamp_ms: chunk_start_ms,
                end_timestamp_ms: chunk_end_ms,
                confidence: segment.confidence,
            });
            break;
        }

        // Target split point
        let target = pos + max_samples;

        // Search window: [target - SEARCH_RADIUS, target + SEARCH_RADIUS]
        let search_start = target.saturating_sub(SEARCH_RADIUS).max(pos + SAMPLE_RATE);
        let search_end = (target + SEARCH_RADIUS).min(total.saturating_sub(ENERGY_WINDOW));

        // Find the lowest-energy 100ms window in the search range
        let mut best_split = target.min(total); // fallback: exact target
        let mut best_rms = f32::MAX;

        if search_start + ENERGY_WINDOW <= search_end {
            let mut idx = search_start;
            while idx + ENERGY_WINDOW <= search_end {
                let window = &segment.samples[idx..idx + ENERGY_WINDOW];
                let rms = (window.iter().map(|s| s * s).sum::<f32>() / ENERGY_WINDOW as f32).sqrt();
                if rms < best_rms {
                    best_rms = rms;
                    best_split = idx + ENERGY_WINDOW / 2; // split at center of quiet window
                }
                // Step by 10ms (160 samples) for efficiency
                idx += SAMPLE_RATE / 100;
            }
        }

        let split_at = best_split;
        if best_rms <= SILENCE_RMS_THRESHOLD {
            debug!(
                "Splitting at silence boundary: sample {} (RMS={:.4})",
                split_at, best_rms
            );
        } else {
            debug!(
                "No silence found near target (best RMS={:.4}), splitting with overlap at sample {}",
                best_rms, split_at
            );
        }

        // Determine the actual end of this chunk (with overlap if no silence)
        let chunk_end = if best_rms > SILENCE_RMS_THRESHOLD {
            (split_at + FALLBACK_OVERLAP).min(total)
        } else {
            split_at
        };

        let chunk_samples = segment.samples[pos..chunk_end].to_vec();
        let chunk_start_ms = segment.start_timestamp_ms + (pos as f64 * ms_per_sample);
        let chunk_end_ms = segment.start_timestamp_ms + (chunk_end as f64 * ms_per_sample);

        result.push(crate::audio::vad::SpeechSegment {
            samples: chunk_samples,
            start_timestamp_ms: chunk_start_ms,
            end_timestamp_ms: chunk_end_ms,
            confidence: segment.confidence,
        });

        // Advance position to where the current chunk actually ends
        // to avoid transcribing the overlap region twice
        pos = chunk_end;
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_engine_lifecycle_lock_serializes_acquirers() {
        let guard = acquire_engine_lifecycle_lock().await;
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (acquired_tx, mut acquired_rx) = tokio::sync::oneshot::channel();
        let waiter = tokio::spawn(async {
            started_tx.send(()).unwrap();
            let _guard = acquire_engine_lifecycle_lock().await;
            acquired_tx.send(()).unwrap();
        });

        started_rx.await.unwrap();
        assert!(acquired_rx.try_recv().is_err());
        drop(guard);

        acquired_rx.await.unwrap();
        waiter.await.unwrap();
    }
}
