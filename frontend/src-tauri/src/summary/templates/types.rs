use serde::{Deserialize, Serialize};

/// Represents a single section in a summary template
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateSection {
    /// Section title (e.g., "Summary", "Action Items")
    pub title: String,

    /// Instruction for the LLM on what to extract/include
    pub instruction: String,

    /// Format type: "paragraph", "list", or "string"
    pub format: String,

    /// Optional markdown formatting hint for list items (e.g., table structure)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_format: Option<String>,

    /// Alternative formatting hint
    #[serde(skip_serializing_if = "Option::is_none")]
    pub example_item_format: Option<String>,
}

/// Represents a complete summary template
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Template {
    /// Template display name
    pub name: String,

    /// Brief description of the template's purpose
    pub description: String,

    /// Optional template-specific guidance applied before section instructions
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,

    /// List of sections in the template
    pub sections: Vec<TemplateSection>,
}

impl Template {
    /// Validates the template structure
    pub fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("Template name cannot be empty".to_string());
        }

        if self.name.chars().count() > 80 {
            return Err("Template name cannot exceed 80 characters".to_string());
        }

        if self.description.trim().is_empty() {
            return Err("Template description cannot be empty".to_string());
        }

        if self.description.chars().count() > 500 {
            return Err("Template description cannot exceed 500 characters".to_string());
        }

        if self
            .prompt
            .as_deref()
            .is_some_and(|prompt| prompt.chars().count() > 20_000)
        {
            return Err("Template prompt cannot exceed 20000 characters".to_string());
        }

        if self.sections.is_empty() {
            return Err("Template must have at least one section".to_string());
        }

        if self.sections.len() > 20 {
            return Err("Template cannot contain more than 20 sections".to_string());
        }

        for (i, section) in self.sections.iter().enumerate() {
            if section.title.trim().is_empty() {
                return Err(format!("Section {} has empty title", i));
            }

            if section.title.chars().count() > 120 {
                return Err(format!(
                    "Section '{}' title cannot exceed 120 characters",
                    section.title
                ));
            }

            if section.instruction.trim().is_empty() {
                return Err(format!("Section '{}' has empty instruction", section.title));
            }

            if section.instruction.chars().count() > 4_000 {
                return Err(format!(
                    "Section '{}' instruction cannot exceed 4000 characters",
                    section.title
                ));
            }

            match section.format.as_str() {
                "paragraph" | "list" | "string" => {},
                other => return Err(format!(
                    "Section '{}' has invalid format '{}'. Must be 'paragraph', 'list', or 'string'",
                    section.title, other
                )),
            }
        }

        Ok(())
    }

    /// Generates a clean markdown template structure
    pub fn to_markdown_structure(&self) -> String {
        let mut markdown = String::from("# <Add Title here>\n\n");

        for section in &self.sections {
            markdown.push_str(&format!("## {}\n\n", section.title));
        }

        markdown
    }

    /// Generates section-specific instructions for the LLM
    pub fn to_section_instructions(&self) -> String {
        let mut instructions = String::new();

        if let Some(prompt) = self
            .prompt
            .as_deref()
            .filter(|prompt| !prompt.trim().is_empty())
        {
            instructions.push_str("**TEMPLATE-SPECIFIC GOAL:**\n");
            instructions.push_str(prompt.trim());
            instructions.push_str("\n\n");
        }

        instructions.push_str(
            "- **For the main title (`# [AI-Generated Title]`):** Analyze the entire source and create a concise, descriptive title for the report.\n"
        );

        for section in &self.sections {
            instructions.push_str(&format!(
                "- **For the '{}' section:** {}\n",
                section.title,
                section.instruction.trim(),
            ));

            match section.format.as_str() {
                "paragraph" => instructions.push_str(
                    "  - Write this section as clear prose, using multiple short paragraphs only when they improve readability.\n",
                ),
                "list" => instructions.push_str(
                    "  - Use concise Markdown bullets unless a table format is specified below.\n",
                ),
                "string" => instructions.push_str(
                    "  - Return one short value or line, not a paragraph or list.\n",
                ),
                _ => {},
            }

            // Add item format instructions if present
            let item_format = section
                .item_format
                .as_ref()
                .or(section.example_item_format.as_ref());

            if let Some(format) = item_format {
                instructions.push_str(&format!(
                    "  - Use this exact Markdown table header and column order when the source contains rows to report:\n\n{}\n\n",
                    format
                ));
            }
        }

        instructions
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_valid_template() {
        let template = Template {
            name: "Test Template".to_string(),
            description: "A test template".to_string(),
            prompt: None,
            sections: vec![TemplateSection {
                title: "Summary".to_string(),
                instruction: "Provide a summary".to_string(),
                format: "paragraph".to_string(),
                item_format: None,
                example_item_format: None,
            }],
        };

        assert!(template.validate().is_ok());
    }

    #[test]
    fn test_validate_empty_name() {
        let template = Template {
            name: "".to_string(),
            description: "A test template".to_string(),
            prompt: None,
            sections: vec![],
        };

        assert!(template.validate().is_err());
    }

    #[test]
    fn test_validate_invalid_format() {
        let template = Template {
            name: "Test".to_string(),
            description: "Test".to_string(),
            prompt: None,
            sections: vec![TemplateSection {
                title: "Test".to_string(),
                instruction: "Test".to_string(),
                format: "invalid".to_string(),
                item_format: None,
                example_item_format: None,
            }],
        };

        assert!(template.validate().is_err());
    }

    #[test]
    fn template_prompt_is_included_in_generated_instructions() {
        let template = Template {
            name: "Test".to_string(),
            description: "Test template".to_string(),
            prompt: Some("Prioritize concrete outcomes.".to_string()),
            sections: vec![TemplateSection {
                title: "Summary".to_string(),
                instruction: "Summarize the source".to_string(),
                format: "paragraph".to_string(),
                item_format: None,
                example_item_format: None,
            }],
        };

        let instructions = template.to_section_instructions();
        assert!(instructions.contains("TEMPLATE-SPECIFIC GOAL"));
        assert!(instructions.contains("Prioritize concrete outcomes."));
    }
}
