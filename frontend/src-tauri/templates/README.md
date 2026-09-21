# Summary Templates

This directory contains template definitions for meeting and general content summary generation.

## Available Templates

### 1. `standard_meeting.json`
General-purpose meeting notes preserving context, decisions, actions, risks, and open questions.

**Sections:**
- Meeting Overview
- Topics & Discussion
- Decisions
- Action Items
- Risks & Open Questions

### 2. `project_sync.json`
Project status record focused on changes, milestones, risks, dependencies, and follow-up.

**Sections:**
- Overall Status
- Progress & Milestones
- Risks, Blockers & Dependencies
- Decisions & Changes
- Next Steps
- Open Questions

### 3. `content_summary.json`
Structured brief for videos, podcasts, lectures, interviews, and narrated content.

**Sections:**
- Overview
- Core Ideas
- Evidence & Important Details
- Practical Takeaways
- Conclusions & Open Questions
- Keywords

## Template Structure

Each template JSON file follows this schema:

```json
{
  "name": "Template Name",
  "description": "Brief description of the template's purpose",
  "prompt": "Optional overall goal and source-handling rules",
  "sections": [
    {
      "title": "Section Title",
      "instruction": "Instructions for the LLM on what to extract/include",
      "format": "paragraph|list|string",
      "item_format": "Optional: Markdown table format for list items"
    }
  ]
}
```

## Custom Templates

Users can add custom templates to the application data directory:

- **macOS**: `~/Library/Application Support/Meetily/templates/`
- **Windows**: `%APPDATA%\Meetily\templates\`
- **Linux**: `~/.config/Meetily/templates/`

Custom templates override built-in templates with the same filename.

## Template Fields

### Root Level
- `name` (required): Display name for the template
- `description` (required): Brief explanation of the template's use case
- `prompt` (optional): Overall template-specific goal applied before section instructions
- `sections` (required): Array of section definitions

### Section Object
- `title` (required): Section heading text
- `instruction` (required): LLM guidance for this section
- `format` (required): One of `"paragraph"`, `"list"`, or `"string"`
- `item_format` (optional): Markdown formatting hint for list items (e.g., table structure)
- `example_item_format` (optional): Alternative formatting hint

## Usage in Code

Templates are loaded using the `templates` module:

```rust
use crate::summary::templates;

// Get a specific template
let template = templates::get_template("standard_meeting")?;

// List available templates
let available = templates::list_templates();

// Validate custom template JSON
let custom_json = std::fs::read_to_string("custom.json")?;
let validated = templates::validate_and_parse_template(&custom_json)?;
```
