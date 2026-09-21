/// Embedded default templates using compile-time inclusion
///
/// These templates are bundled into the binary and serve as fallbacks
/// when custom templates are not available.

/// Standard meeting notes template
pub const STANDARD_MEETING: &str = include_str!("../../../templates/standard_meeting.json");

/// Project progress template
pub const PROJECT_SYNC: &str = include_str!("../../../templates/project_sync.json");

/// General content summary template
pub const CONTENT_SUMMARY: &str = include_str!("../../../templates/content_summary.json");

/// Registry of all built-in templates
///
/// Maps template identifiers to their embedded JSON content
pub fn get_builtin_templates() -> Vec<(&'static str, &'static str)> {
    vec![
        ("standard_meeting", STANDARD_MEETING),
        ("project_sync", PROJECT_SYNC),
        ("content_summary", CONTENT_SUMMARY),
    ]
}

/// Get a built-in template by identifier
///
/// # Arguments
/// * `id` - Template identifier (e.g., "standard_meeting", "content_summary")
///
/// # Returns
/// The template JSON content if found, None otherwise
pub fn get_builtin_template(id: &str) -> Option<&'static str> {
    match id {
        "standard_meeting" => Some(STANDARD_MEETING),
        "project_sync" => Some(PROJECT_SYNC),
        "content_summary" => Some(CONTENT_SUMMARY),
        _ => None,
    }
}

/// List all built-in template identifiers
pub fn list_builtin_template_ids() -> Vec<&'static str> {
    vec!["standard_meeting", "project_sync", "content_summary"]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_builtin_templates_valid_json() {
        for (id, content) in get_builtin_templates() {
            let result = serde_json::from_str::<serde_json::Value>(content);
            assert!(
                result.is_ok(),
                "Built-in template '{}' contains invalid JSON: {:?}",
                id,
                result.err()
            );
        }
    }

    #[test]
    fn test_get_builtin_template() {
        assert!(get_builtin_template("standard_meeting").is_some());
        assert!(get_builtin_template("project_sync").is_some());
        assert!(get_builtin_template("content_summary").is_some());
        assert!(get_builtin_template("nonexistent").is_none());
    }
}
