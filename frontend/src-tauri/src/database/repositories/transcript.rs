use crate::api::{TranscriptSearchResult, TranscriptSegment};
use crate::database::models::Transcript;
use chrono::Utc;
use sqlx::{Connection, Error as SqlxError, SqlitePool};
use std::collections::{HashMap, HashSet};
use tracing::{error, info};
use uuid::Uuid;

pub struct TranscriptsRepository;

#[derive(Debug, Clone)]
pub struct TranscriptTextUpdate {
    pub id: String,
    pub original_text: String,
    pub previous_polished_text: Option<String>,
    pub polished_text: String,
}

impl TranscriptsRepository {
    /// Loads every transcript segment for a meeting in playback order.
    pub async fn get_meeting_transcripts(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<Transcript>, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        sqlx::query_as::<_, Transcript>(
            "SELECT * FROM transcripts
             WHERE meeting_id = ?
             ORDER BY audio_start_time ASC, rowid ASC",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await
    }

    /// Atomically stores derived transcript text after verifying that the preview
    /// is still based on the current complete transcript and polish revision.
    pub async fn apply_text_updates(
        pool: &SqlitePool,
        meeting_id: &str,
        updates: &[TranscriptTextUpdate],
    ) -> Result<u64, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let mut transaction = pool.begin().await?;
        let current_rows = sqlx::query_as::<_, (String, String, Option<String>)>(
            "SELECT id, transcript, polished_transcript FROM transcripts WHERE meeting_id = ?",
        )
        .bind(meeting_id)
        .fetch_all(&mut *transaction)
        .await?;

        if current_rows.len() != updates.len() {
            return Err(SqlxError::Protocol(
                "Transcript changed after the AI preview was generated".to_string(),
            ));
        }

        let current_by_id = current_rows
            .into_iter()
            .map(|(id, original, polished)| (id, (original, polished)))
            .collect::<HashMap<_, _>>();
        let mut seen_ids = HashSet::with_capacity(updates.len());

        for update in updates {
            if !seen_ids.insert(update.id.as_str()) {
                return Err(SqlxError::Protocol(
                    "AI preview contains a duplicate transcript segment".to_string(),
                ));
            }

            let (current_original, current_polished) =
                current_by_id.get(&update.id).ok_or_else(|| {
                    SqlxError::Protocol(
                        "AI preview does not match the current transcript".to_string(),
                    )
                })?;

            if current_original != &update.original_text
                || current_polished != &update.previous_polished_text
            {
                return Err(SqlxError::Protocol(
                    "Transcript changed after the AI preview was generated".to_string(),
                ));
            }

            if !update.original_text.trim().is_empty() && update.polished_text.trim().is_empty() {
                return Err(SqlxError::Protocol(
                    "AI preview contains an empty replacement".to_string(),
                ));
            }
        }

        if seen_ids.len() != current_by_id.len() {
            return Err(SqlxError::Protocol(
                "AI preview is missing transcript segments".to_string(),
            ));
        }

        let changed_count = updates
            .iter()
            .filter(|update| update.original_text != update.polished_text)
            .count() as u64;
        for update in updates {
            if update.previous_polished_text.as_deref() == Some(update.polished_text.as_str()) {
                continue;
            }

            let result = sqlx::query(
                "UPDATE transcripts
                 SET polished_transcript = ?
                 WHERE meeting_id = ?
                   AND id = ?
                   AND transcript = ?
                   AND (polished_transcript = ? OR (polished_transcript IS NULL AND ? IS NULL))",
            )
            .bind(&update.polished_text)
            .bind(meeting_id)
            .bind(&update.id)
            .bind(&update.original_text)
            .bind(&update.previous_polished_text)
            .bind(&update.previous_polished_text)
            .execute(&mut *transaction)
            .await?;

            if result.rows_affected() != 1 {
                return Err(SqlxError::Protocol(
                    "Transcript changed while the AI result was being applied".to_string(),
                ));
            }
        }

        if !updates.is_empty() {
            sqlx::query("UPDATE meetings SET updated_at = ? WHERE id = ?")
                .bind(Utc::now())
                .bind(meeting_id)
                .execute(&mut *transaction)
                .await?;
        }

        transaction.commit().await?;
        Ok(changed_count)
    }

    /// Removes the derived AI-edited version while keeping the original ASR text.
    pub async fn clear_polished_text(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<u64, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let mut transaction = pool.begin().await?;
        let result = sqlx::query(
            "UPDATE transcripts SET polished_transcript = NULL
             WHERE meeting_id = ? AND polished_transcript IS NOT NULL",
        )
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

        if result.rows_affected() > 0 {
            sqlx::query("UPDATE meetings SET updated_at = ? WHERE id = ?")
                .bind(Utc::now())
                .bind(meeting_id)
                .execute(&mut *transaction)
                .await?;
        }

        transaction.commit().await?;
        Ok(result.rows_affected())
    }

    /// Saves a new meeting and its associated transcript segments.
    /// This function uses a transaction to ensure that either both the meeting
    /// and all its transcripts are saved, or none of them are.
    pub async fn save_transcript(
        pool: &SqlitePool,
        meeting_title: &str,
        transcripts: &[TranscriptSegment],
        folder_path: Option<String>,
    ) -> Result<String, SqlxError> {
        let meeting_id = format!("meeting-{}", Uuid::new_v4());

        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        let now = Utc::now();

        // 1. Create the new meeting
        let result = sqlx::query(
            "INSERT INTO meetings (id, title, created_at, updated_at, folder_path) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&meeting_id)
        .bind(meeting_title)
        .bind(now)
        .bind(now)
        .bind(&folder_path)
        .execute(&mut *transaction)
        .await;

        if let Err(e) = result {
            error!("Failed to create meeting '{}': {}", meeting_title, e);
            transaction.rollback().await?;
            return Err(e);
        }

        info!("Successfully created meeting with id: {}", meeting_id);

        // 2. Save each transcript segment with audio timing fields
        for segment in transcripts {
            let transcript_id = format!("transcript-{}", Uuid::new_v4());
            let result = sqlx::query(
                "INSERT INTO transcripts (id, meeting_id, transcript, timestamp, audio_start_time, audio_end_time, duration)
                 VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&transcript_id)
            .bind(&meeting_id)
            .bind(&segment.text)
            .bind(&segment.timestamp)
            .bind(segment.audio_start_time)
            .bind(segment.audio_end_time)
            .bind(segment.duration)
            .execute(&mut *transaction)
            .await;

            if let Err(e) = result {
                error!(
                    "Failed to save transcript segment for meeting {}: {}",
                    meeting_id, e
                );
                transaction.rollback().await?;
                return Err(e);
            }
        }

        info!(
            "Successfully saved {} transcript segments for meeting {}",
            transcripts.len(),
            meeting_id
        );

        // Commit the transaction
        transaction.commit().await?;

        Ok(meeting_id)
    }

    /// Searches for a query string within the transcripts.
    /// It returns a list of matching transcripts with context.
    pub async fn search_transcripts(
        pool: &SqlitePool,
        query: &str,
    ) -> Result<Vec<TranscriptSearchResult>, SqlxError> {
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }

        let search_query = format!("%{}%", query.to_lowercase());

        let rows = sqlx::query_as::<_, (String, String, String, String)>(
            "SELECT m.id, m.title, COALESCE(t.polished_transcript, t.transcript), t.timestamp
             FROM meetings m
             JOIN transcripts t ON m.id = t.meeting_id
             WHERE LOWER(t.transcript) LIKE ?
                OR LOWER(COALESCE(t.polished_transcript, '')) LIKE ?",
        )
        .bind(&search_query)
        .bind(&search_query)
        .fetch_all(pool)
        .await?;

        let results = rows
            .into_iter()
            .map(|(id, title, transcript, timestamp)| {
                let match_context = Self::get_match_context(&transcript, query);
                TranscriptSearchResult {
                    id,
                    title,
                    match_context,
                    timestamp,
                }
            })
            .collect();

        Ok(results)
    }

    /// Helper function to extract a snippet of text around the first match of a query.
    fn get_match_context(transcript: &str, query: &str) -> String {
        let transcript_lower = transcript.to_lowercase();
        let query_lower = query.to_lowercase();

        match transcript_lower.find(&query_lower) {
            Some(match_index) => {
                let start_index = match_index.saturating_sub(100);
                let end_index = (match_index + query.len() + 100).min(transcript.len());

                let mut context = String::new();
                if start_index > 0 {
                    context.push_str("...");
                }
                context.push_str(&transcript[start_index..end_index]);
                if end_index < transcript.len() {
                    context.push_str("...");
                }
                context
            }
            None => transcript.chars().take(200).collect(), // Fallback to the start of the transcript
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE meetings (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE transcripts (
                id TEXT PRIMARY KEY,
                meeting_id TEXT NOT NULL,
                transcript TEXT NOT NULL,
                polished_transcript TEXT,
                timestamp TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO meetings (id, title, created_at, updated_at)
             VALUES ('meeting-1', 'Test', '2026-09-03T00:00:00Z', '2026-09-03T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO transcripts (id, meeting_id, transcript, timestamp)
             VALUES ('segment-1', 'meeting-1', '嗯这个这个方案可以', '10:00:00')",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn stores_and_clears_polished_text_without_changing_original() {
        let pool = test_pool().await;
        let updates = vec![TranscriptTextUpdate {
            id: "segment-1".to_string(),
            original_text: "嗯这个这个方案可以".to_string(),
            previous_polished_text: None,
            polished_text: "这个方案可以。".to_string(),
        }];

        let changed = TranscriptsRepository::apply_text_updates(&pool, "meeting-1", &updates)
            .await
            .unwrap();
        assert_eq!(changed, 1);

        let stored = sqlx::query_as::<_, (String, Option<String>)>(
            "SELECT transcript, polished_transcript FROM transcripts WHERE id = 'segment-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(stored.0, "嗯这个这个方案可以");
        assert_eq!(stored.1.as_deref(), Some("这个方案可以。"));

        let cleared = TranscriptsRepository::clear_polished_text(&pool, "meeting-1")
            .await
            .unwrap();
        assert_eq!(cleared, 1);

        let stored = sqlx::query_as::<_, (String, Option<String>)>(
            "SELECT transcript, polished_transcript FROM transcripts WHERE id = 'segment-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(stored.0, "嗯这个这个方案可以");
        assert_eq!(stored.1, None);
    }

    #[tokio::test]
    async fn rejects_a_preview_based_on_an_older_polished_version() {
        let pool = test_pool().await;
        sqlx::query(
            "UPDATE transcripts SET polished_transcript = '更新的整理稿' WHERE id = 'segment-1'",
        )
        .execute(&pool)
        .await
        .unwrap();

        let stale_update = vec![TranscriptTextUpdate {
            id: "segment-1".to_string(),
            original_text: "嗯这个这个方案可以".to_string(),
            previous_polished_text: Some("旧整理稿".to_string()),
            polished_text: "另一个整理结果".to_string(),
        }];

        assert!(TranscriptsRepository::apply_text_updates(&pool, "meeting-1", &stale_update)
            .await
            .is_err());
    }
}
