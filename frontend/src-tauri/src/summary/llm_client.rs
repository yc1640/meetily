use crate::summary::{
    CustomOpenAIConfig, CustomOpenAIReasoningEffort, CustomOpenAIVerbosity, CustomOpenAIWireApi,
};
use reqwest::{header, Client};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use tracing::info;

const REQUEST_TIMEOUT_DURATION: Duration = Duration::from_secs(300);

#[derive(Debug, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Serialize)]
struct ResponsesRequest {
    model: String,
    instructions: String,
    input: String,
    store: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_output_tokens: Option<u32>,
    reasoning: ResponsesReasoning,
    text: ResponsesText,
}

#[derive(Debug, Serialize)]
struct ResponsesReasoning {
    effort: CustomOpenAIReasoningEffort,
}

#[derive(Debug, Serialize)]
struct ResponsesText {
    verbosity: CustomOpenAIVerbosity,
}

#[derive(Debug, Serialize)]
pub struct ClaudeRequest {
    pub model: String,
    pub max_tokens: u32,
    pub system: String,
    pub messages: Vec<ChatMessage>,
}

#[derive(Deserialize, Debug)]
pub struct ClaudeChatResponse {
    pub content: Vec<ClaudeChatContent>,
}

#[derive(Deserialize, Debug)]
pub struct ClaudeChatContent {
    pub text: String,
}

/// LLM Provider enumeration for multi-provider support
#[derive(Debug, Clone, PartialEq)]
pub enum LLMProvider {
    OpenAI,
    Claude,
    Groq,
    Ollama,
    OpenRouter,
    BuiltInAI,
    CustomOpenAI,
}

impl LLMProvider {
    /// Parse provider from string (case-insensitive)
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s.to_lowercase().as_str() {
            "openai" => Ok(Self::OpenAI),
            "claude" => Ok(Self::Claude),
            "groq" => Ok(Self::Groq),
            "ollama" => Ok(Self::Ollama),
            "openrouter" => Ok(Self::OpenRouter),
            "builtin-ai" | "local-llama" | "localllama" => Ok(Self::BuiltInAI),
            "custom-openai" => Ok(Self::CustomOpenAI),
            _ => Err(format!("Unsupported LLM provider: {}", s)),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ResponseFormat {
    ChatCompletions,
    Responses,
    Claude,
}

/// Builds an API URL from either a base URL or a URL already ending in a known API route.
pub(crate) fn custom_openai_api_url(endpoint: &str, wire_api: CustomOpenAIWireApi) -> String {
    let trimmed = endpoint.trim().trim_end_matches('/');
    let base = trimmed
        .strip_suffix("/chat/completions")
        .or_else(|| trimmed.strip_suffix("/responses"))
        .unwrap_or(trimmed)
        .trim_end_matches('/');
    format!("{base}/{}", wire_api.path())
}

/// Extracts all assistant text blocks from a raw Responses API JSON response.
pub(crate) fn extract_responses_output_text(value: &Value) -> Option<String> {
    if let Some(text) = value.get("output_text").and_then(Value::as_str) {
        let text = text.trim();
        if !text.is_empty() {
            return Some(text.to_string());
        }
    }

    let mut text_blocks = Vec::new();
    for item in value.get("output")?.as_array()? {
        if item.get("type").and_then(Value::as_str) != Some("message") {
            continue;
        }
        let Some(content) = item.get("content").and_then(Value::as_array) else {
            continue;
        };
        for part in content {
            if part.get("type").and_then(Value::as_str) == Some("output_text") {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    let text = text.trim();
                    if !text.is_empty() {
                        text_blocks.push(text);
                    }
                }
            }
        }
    }

    (!text_blocks.is_empty()).then(|| text_blocks.join("\n"))
}

fn extract_chat_output_text(value: &Value) -> Option<String> {
    let content = value
        .get("choices")?
        .as_array()?
        .first()?
        .get("message")?
        .get("content")?;

    if let Some(text) = content.as_str() {
        let text = text.trim();
        return (!text.is_empty()).then(|| text.to_string());
    }

    let text_blocks = content
        .as_array()?
        .iter()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>();
    (!text_blocks.is_empty()).then(|| text_blocks.join("\n"))
}

fn response_excerpt(body: &str) -> String {
    const MAX_CHARS: usize = 4_000;
    let mut chars = body.chars();
    let excerpt = chars.by_ref().take(MAX_CHARS).collect::<String>();
    if chars.next().is_some() {
        format!("{excerpt}…")
    } else {
        excerpt
    }
}

/// Generates a summary using the specified LLM provider.
#[allow(clippy::too_many_arguments)]
pub async fn generate_summary(
    client: &Client,
    provider: &LLMProvider,
    model_name: &str,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
    ollama_endpoint: Option<&str>,
    custom_openai_config: Option<&CustomOpenAIConfig>,
    app_data_dir: Option<&PathBuf>,
    cancellation_token: Option<&CancellationToken>,
) -> Result<String, String> {
    if let Some(token) = cancellation_token {
        if token.is_cancelled() {
            return Err("Summary generation was cancelled".to_string());
        }
    }

    if provider == &LLMProvider::BuiltInAI {
        let app_data_dir = app_data_dir
            .ok_or_else(|| "app_data_dir is required for BuiltInAI provider".to_string())?;

        return crate::summary::summary_engine::generate_with_builtin(
            app_data_dir,
            model_name,
            system_prompt,
            user_prompt,
            cancellation_token,
        )
        .await
        .map_err(|e| e.to_string());
    }

    let (api_url, mut headers, response_format) = match provider {
        LLMProvider::OpenAI => (
            "https://api.openai.com/v1/chat/completions".to_string(),
            header::HeaderMap::new(),
            ResponseFormat::ChatCompletions,
        ),
        LLMProvider::Groq => (
            "https://api.groq.com/openai/v1/chat/completions".to_string(),
            header::HeaderMap::new(),
            ResponseFormat::ChatCompletions,
        ),
        LLMProvider::OpenRouter => (
            "https://openrouter.ai/api/v1/chat/completions".to_string(),
            header::HeaderMap::new(),
            ResponseFormat::ChatCompletions,
        ),
        LLMProvider::Ollama => {
            let host = ollama_endpoint.unwrap_or("http://localhost:11434");
            (
                format!("{}/v1/chat/completions", host.trim_end_matches('/')),
                header::HeaderMap::new(),
                ResponseFormat::ChatCompletions,
            )
        }
        LLMProvider::CustomOpenAI => {
            let config = custom_openai_config
                .ok_or_else(|| "Custom OpenAI endpoint not configured".to_string())?;
            let response_format = match config.wire_api {
                CustomOpenAIWireApi::Responses => ResponseFormat::Responses,
                CustomOpenAIWireApi::ChatCompletions => ResponseFormat::ChatCompletions,
            };
            (
                custom_openai_api_url(&config.endpoint, config.wire_api),
                header::HeaderMap::new(),
                response_format,
            )
        }
        LLMProvider::Claude => {
            let mut header_map = header::HeaderMap::new();
            header_map.insert(
                "x-api-key",
                api_key
                    .parse()
                    .map_err(|_| "Invalid API key format".to_string())?,
            );
            header_map.insert(
                "anthropic-version",
                "2023-06-01"
                    .parse()
                    .map_err(|_| "Invalid anthropic version".to_string())?,
            );
            (
                "https://api.anthropic.com/v1/messages".to_string(),
                header_map,
                ResponseFormat::Claude,
            )
        }
        LLMProvider::BuiltInAI => unreachable!("BuiltInAI is handled before this match"),
    };

    if provider != &LLMProvider::Claude && !api_key.trim().is_empty() {
        headers.insert(
            header::AUTHORIZATION,
            format!("Bearer {}", api_key)
                .parse()
                .map_err(|_| "Invalid authorization header".to_string())?,
        );
    }
    headers.insert(
        header::CONTENT_TYPE,
        "application/json"
            .parse()
            .map_err(|_| "Invalid content type".to_string())?,
    );

    let request_body = match response_format {
        ResponseFormat::Responses => {
            let config = custom_openai_config
                .ok_or_else(|| "Custom OpenAI endpoint not configured".to_string())?;
            serde_json::to_value(ResponsesRequest {
                model: model_name.to_string(),
                instructions: system_prompt.to_string(),
                input: user_prompt.to_string(),
                store: false,
                max_output_tokens: config.max_tokens.and_then(|value| value.try_into().ok()),
                reasoning: ResponsesReasoning {
                    effort: config.reasoning_effort,
                },
                text: ResponsesText {
                    verbosity: config.verbosity,
                },
            })
            .map_err(|e| format!("Failed to build Responses request: {e}"))?
        }
        ResponseFormat::ChatCompletions => {
            let max_tokens = if provider == &LLMProvider::CustomOpenAI {
                custom_openai_config
                    .and_then(|config| config.max_tokens)
                    .and_then(|value| value.try_into().ok())
            } else {
                None
            };
            serde_json::to_value(ChatRequest {
                model: model_name.to_string(),
                messages: vec![
                    ChatMessage {
                        role: "system".to_string(),
                        content: system_prompt.to_string(),
                    },
                    ChatMessage {
                        role: "user".to_string(),
                        content: user_prompt.to_string(),
                    },
                ],
                max_tokens,
            })
            .map_err(|e| format!("Failed to build Chat Completions request: {e}"))?
        }
        ResponseFormat::Claude => serde_json::to_value(ClaudeRequest {
            system: system_prompt.to_string(),
            model: model_name.to_string(),
            max_tokens: 2048,
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: user_prompt.to_string(),
            }],
        })
        .map_err(|e| format!("Failed to build Claude request: {e}"))?,
    };

    info!(
        "LLM request: provider={}, model={}",
        provider_name(provider),
        model_name
    );

    let request_future = client
        .post(api_url)
        .headers(headers)
        .json(&request_body)
        .timeout(REQUEST_TIMEOUT_DURATION)
        .send();

    let response = if let Some(token) = cancellation_token {
        tokio::select! {
            result = request_future => {
                result.map_err(|e| {
                    if e.is_timeout() {
                        format!("LLM request timed out after {} seconds", REQUEST_TIMEOUT_DURATION.as_secs())
                    } else {
                        format!("Failed to send request to LLM: {e}")
                    }
                })?
            }
            _ = token.cancelled() => {
                return Err("Summary generation was cancelled".to_string());
            }
        }
    } else {
        request_future.await.map_err(|e| {
            if e.is_timeout() {
                format!(
                    "LLM request timed out after {} seconds",
                    REQUEST_TIMEOUT_DURATION.as_secs()
                )
            } else {
                format!("Failed to send request to LLM: {e}")
            }
        })?
    };

    let status = response.status();
    let response_body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read LLM response: {e}"))?;

    if !status.is_success() {
        return Err(format!(
            "LLM API request failed with status {}: {}",
            status,
            response_excerpt(&response_body)
        ));
    }

    match response_format {
        ResponseFormat::Claude => {
            let response: ClaudeChatResponse = serde_json::from_str(&response_body)
                .map_err(|e| format!("Failed to parse Claude response: {e}"))?;
            let content = response
                .content
                .first()
                .ok_or("No content in Claude response")?
                .text
                .trim();
            (!content.is_empty())
                .then(|| content.to_string())
                .ok_or_else(|| "No text content in Claude response".to_string())
        }
        ResponseFormat::Responses => {
            let value: Value = serde_json::from_str(&response_body)
                .map_err(|e| format!("Failed to parse Responses API response: {e}"))?;
            extract_responses_output_text(&value)
                .ok_or_else(|| "Responses API returned no output_text content".to_string())
        }
        ResponseFormat::ChatCompletions => {
            let value: Value = serde_json::from_str(&response_body)
                .map_err(|e| format!("Failed to parse Chat Completions response: {e}"))?;
            extract_chat_output_text(&value)
                .ok_or_else(|| "Chat Completions API returned no message.content".to_string())
        }
    }
}

fn provider_name(provider: &LLMProvider) -> &str {
    match provider {
        LLMProvider::OpenAI => "OpenAI",
        LLMProvider::Claude => "Claude",
        LLMProvider::Groq => "Groq",
        LLMProvider::Ollama => "Ollama",
        LLMProvider::BuiltInAI => "Built-in AI",
        LLMProvider::OpenRouter => "OpenRouter",
        LLMProvider::CustomOpenAI => "Custom OpenAI",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_api_url_appends_selected_route() {
        assert_eq!(
            custom_openai_api_url(
                "https://example.test/codex/v1",
                CustomOpenAIWireApi::Responses
            ),
            "https://example.test/codex/v1/responses"
        );
        assert_eq!(
            custom_openai_api_url(
                "https://example.test/v1/",
                CustomOpenAIWireApi::ChatCompletions,
            ),
            "https://example.test/v1/chat/completions"
        );
    }

    #[test]
    fn custom_api_url_replaces_existing_known_route() {
        assert_eq!(
            custom_openai_api_url(
                "https://example.test/v1/chat/completions",
                CustomOpenAIWireApi::Responses,
            ),
            "https://example.test/v1/responses"
        );
        assert_eq!(
            custom_openai_api_url(
                "https://example.test/v1/responses/",
                CustomOpenAIWireApi::Responses,
            ),
            "https://example.test/v1/responses"
        );
    }

    #[test]
    fn extracts_responses_message_output_text() {
        let value = serde_json::json!({
            "output": [
                { "type": "reasoning", "summary": [] },
                {
                    "type": "message",
                    "content": [
                        { "type": "output_text", "text": "First" },
                        { "type": "output_text", "text": "Second" }
                    ]
                }
            ]
        });

        assert_eq!(
            extract_responses_output_text(&value).as_deref(),
            Some("First\nSecond")
        );
    }

    #[test]
    fn responses_request_disables_storage_and_uses_reasoning_controls() {
        let value = serde_json::to_value(ResponsesRequest {
            model: "gpt-test".to_string(),
            instructions: "System".to_string(),
            input: "User".to_string(),
            store: false,
            max_output_tokens: Some(512),
            reasoning: ResponsesReasoning {
                effort: CustomOpenAIReasoningEffort::High,
            },
            text: ResponsesText {
                verbosity: CustomOpenAIVerbosity::High,
            },
        })
        .unwrap();

        assert_eq!(value["store"], false);
        assert_eq!(value["reasoning"]["effort"], "high");
        assert_eq!(value["text"]["verbosity"], "high");
        assert_eq!(value["max_output_tokens"], 512);
        assert!(value.get("temperature").is_none());
        assert!(value.get("top_p").is_none());
    }
}
