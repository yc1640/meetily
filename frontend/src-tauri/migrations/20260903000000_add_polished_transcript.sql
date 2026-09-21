-- Preserve the original ASR transcript and store the optional AI-edited version separately.
ALTER TABLE transcripts ADD COLUMN polished_transcript TEXT;
