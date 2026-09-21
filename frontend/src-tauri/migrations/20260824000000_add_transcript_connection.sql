-- Store connection details for OpenAI-compatible transcription providers.
-- Existing provider-specific API-key columns are preserved for backward compatibility.
ALTER TABLE transcript_settings ADD COLUMN endpoint TEXT;
ALTER TABLE transcript_settings ADD COLUMN apiKey TEXT;
