use super::provider::{TranscriptResult, TranscriptionError, TranscriptionProvider};
use async_trait::async_trait;
use reqwest::multipart::{Form, Part};
use serde::Deserialize;
use std::time::Duration;

#[derive(Debug, Deserialize)]
struct OpenAiTranscriptionResponse {
    text: String,
}

/// A provider for servers implementing OpenAI's `POST /v1/audio/transcriptions`
/// contract. It is used for user-managed FunASR servers and Meetily's managed
/// MLX-Audio Qwen3-ASR process.
pub struct OpenAiCompatibleProvider {
    provider_name: &'static str,
    endpoint: String,
    model: String,
    api_key: Option<String>,
    client: reqwest::Client,
}

impl OpenAiCompatibleProvider {
    pub fn new(
        provider_name: &'static str,
        endpoint: String,
        model: String,
        api_key: Option<String>,
    ) -> Result<Self, TranscriptionError> {
        let endpoint = Self::transcriptions_url(&endpoint)?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|error| TranscriptionError::EngineFailed(error.to_string()))?;

        Ok(Self {
            provider_name,
            endpoint,
            model,
            api_key,
            client,
        })
    }

    fn transcriptions_url(base_url: &str) -> Result<String, TranscriptionError> {
        let base_url = base_url.trim().trim_end_matches('/');
        if base_url.is_empty() {
            return Err(TranscriptionError::EngineFailed(
                "An OpenAI-compatible transcription service URL is required".to_string(),
            ));
        }
        if base_url.ends_with("audio/transcriptions") {
            Ok(base_url.to_string())
        } else {
            Ok(format!("{base_url}/audio/transcriptions"))
        }
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
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
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

    fn qwen3_language(language: &str) -> Option<&'static str> {
        match language.trim().to_ascii_lowercase().as_str() {
            "zh" | "chinese" => Some("Chinese"),
            "yue" | "cantonese" => Some("Cantonese"),
            "en" | "english" => Some("English"),
            "de" | "german" => Some("German"),
            "es" | "spanish" => Some("Spanish"),
            "fr" | "french" => Some("French"),
            "it" | "italian" => Some("Italian"),
            "pt" | "portuguese" => Some("Portuguese"),
            "ru" | "russian" => Some("Russian"),
            "ko" | "korean" => Some("Korean"),
            "ja" | "japanese" => Some("Japanese"),
            _ => None,
        }
    }
}

#[async_trait]
impl TranscriptionProvider for OpenAiCompatibleProvider {
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

        let part = Part::bytes(Self::encode_wav(audio))
            .file_name("meetily-chunk.wav")
            .mime_str("audio/wav")
            .map_err(|error| TranscriptionError::EngineFailed(error.to_string()))?;
        let mut form = Form::new()
            .text("model", self.model.clone())
            .part("file", part);

        if self.provider_name == "Qwen3-ASR" {
            // MLX-Audio defaults to NDJSON. Ask for the stable OpenAI JSON shape
            // and translate Meetily's ISO language codes to Qwen3-ASR's names.
            form = form.text("response_format", "json");
            if let Some(language) = language
                .as_deref()
                .filter(|value| *value != "auto" && *value != "auto-translate")
            {
                if let Some(qwen_language) = Self::qwen3_language(language) {
                    form = form.text("language", qwen_language);
                } else {
                    log::warn!(
                        "Qwen3-ASR does not support language '{}'; using automatic detection",
                        language
                    );
                }
            }
        } else if let Some(language) =
            language.filter(|value| value != "auto" && value != "auto-translate")
        {
            form = form.text("language", language);
        }

        let mut request = self.client.post(&self.endpoint).multipart(form);
        if let Some(api_key) = self
            .api_key
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            request = request.bearer_auth(api_key);
        }

        let response = request.send().await.map_err(|error| {
            TranscriptionError::EngineFailed(format!(
                "{} request failed: {error}",
                self.provider_name
            ))
        })?;
        let status = response.status();
        let body = response.text().await.map_err(|error| {
            TranscriptionError::EngineFailed(format!(
                "{} response failed: {error}",
                self.provider_name
            ))
        })?;

        if !status.is_success() {
            return Err(TranscriptionError::EngineFailed(format!(
                "{} returned HTTP {}: {}",
                self.provider_name,
                status,
                body.chars().take(500).collect::<String>()
            )));
        }

        let response: OpenAiTranscriptionResponse =
            serde_json::from_str(&body).map_err(|error| {
                TranscriptionError::EngineFailed(format!(
                    "{} returned an invalid response: {error}",
                    self.provider_name
                ))
            })?;

        Ok(TranscriptResult {
            text: response.text.trim().to_string(),
            confidence: None,
            is_partial: false,
        })
    }

    async fn is_model_loaded(&self) -> bool {
        true
    }

    async fn get_current_model(&self) -> Option<String> {
        Some(self.model.clone())
    }

    fn provider_name(&self) -> &'static str {
        self.provider_name
    }
}

#[cfg(test)]
mod tests {
    use super::OpenAiCompatibleProvider;

    #[test]
    fn creates_a_valid_pcm_wav_file() {
        let wav = OpenAiCompatibleProvider::encode_wav(vec![0.0, 1.0, -1.0]);
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(wav.len(), 50);
    }

    #[test]
    fn accepts_base_or_full_transcription_urls() {
        assert_eq!(
            OpenAiCompatibleProvider::transcriptions_url("http://127.0.0.1:8000/v1").unwrap(),
            "http://127.0.0.1:8000/v1/audio/transcriptions"
        );
        assert_eq!(
            OpenAiCompatibleProvider::transcriptions_url(
                "http://127.0.0.1:8000/v1/audio/transcriptions/"
            )
            .unwrap(),
            "http://127.0.0.1:8000/v1/audio/transcriptions"
        );
    }

    #[test]
    fn maps_supported_qwen_languages_and_rejects_unsupported_ones() {
        assert_eq!(
            OpenAiCompatibleProvider::qwen3_language("zh"),
            Some("Chinese")
        );
        assert_eq!(
            OpenAiCompatibleProvider::qwen3_language("JA"),
            Some("Japanese")
        );
        assert_eq!(OpenAiCompatibleProvider::qwen3_language("ar"), None);
    }
}
