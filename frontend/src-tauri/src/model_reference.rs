use std::fs;
use std::path::Path;

/// Reference an existing model without copying its bytes into Meetily's data directory.
/// On Unix this creates a symbolic link; Windows uses a hard link when possible.
pub fn link_existing_model(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() {
        return Err("The selected model does not exist.".to_string());
    }
    if !source.is_file() && !source.is_dir() {
        return Err("The selected model is not a regular file or directory.".to_string());
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create the model directory: {error}"))?;
    }

    if let Ok(destination_metadata) = fs::symlink_metadata(destination) {
        let source_canonical = fs::canonicalize(source)
            .map_err(|error| format!("Failed to resolve the selected model path: {error}"))?;
        let destination_canonical = fs::canonicalize(destination).ok();
        if destination_canonical.as_deref() == Some(source_canonical.as_path()) {
            return Ok(());
        }

        // A moved or deleted source leaves a broken symbolic link behind. Let
        // the user repair the model reference by selecting a replacement.
        if destination_metadata.file_type().is_symlink() && destination_canonical.is_none() {
            #[cfg(unix)]
            fs::remove_file(destination).map_err(|error| {
                format!("Failed to replace the broken model reference: {error}")
            })?;
            #[cfg(windows)]
            fs::remove_dir(destination).map_err(|error| {
                format!("Failed to replace the broken model reference: {error}")
            })?;
        } else {
            return Err(format!(
                "A model already exists at {}. Remove it in Settings before adding another reference.",
                destination.display()
            ));
        }
    }

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source, destination)
            .map_err(|error| format!("Failed to link the existing model: {error}"))?;
    }

    #[cfg(windows)]
    {
        if source.is_dir() {
            std::os::windows::fs::symlink_dir(source, destination)
                .map_err(|error| format!("Failed to link the existing model directory: {error}"))?;
        } else {
            fs::hard_link(source, destination).map_err(|error| {
                format!(
                    "Failed to link the existing model. On Windows the model must be on the same drive: {error}"
                )
            })?;
        }
    }

    Ok(())
}

pub fn file_has_magic(path: &Path, accepted: &[&[u8]]) -> Result<bool, String> {
    use std::io::Read;

    let mut file = fs::File::open(path)
        .map_err(|error| format!("Failed to open the selected model: {error}"))?;
    let mut header = [0_u8; 4];
    file.read_exact(&mut header)
        .map_err(|error| format!("Failed to read the selected model header: {error}"))?;
    Ok(accepted.iter().any(|magic| header.as_slice() == *magic))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_without_copying_and_keeps_source_intact() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source.gguf");
        let destination = temp.path().join("models").join("model.gguf");
        fs::write(&source, b"GGUFmodel").unwrap();

        link_existing_model(&source, &destination).unwrap();

        assert_eq!(fs::read(&destination).unwrap(), b"GGUFmodel");
        fs::remove_file(&destination).unwrap();
        assert_eq!(fs::read(&source).unwrap(), b"GGUFmodel");
    }

    #[cfg(unix)]
    #[test]
    fn links_model_directories_without_copying() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source-model");
        let destination = temp.path().join("models").join("linked-model");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("model.onnx"), b"onnx").unwrap();

        link_existing_model(&source, &destination).unwrap();

        assert!(fs::symlink_metadata(&destination)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read(destination.join("model.onnx")).unwrap(), b"onnx");
        fs::remove_file(&destination).unwrap();
        assert_eq!(fs::read(source.join("model.onnx")).unwrap(), b"onnx");
    }

    #[cfg(unix)]
    #[test]
    fn replaces_a_broken_model_reference() {
        let temp = tempfile::tempdir().unwrap();
        let missing_source = temp.path().join("missing.gguf");
        let replacement = temp.path().join("replacement.gguf");
        let destination = temp.path().join("models").join("model.gguf");
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&missing_source, &destination).unwrap();
        fs::write(&replacement, b"GGUFreplacement").unwrap();

        link_existing_model(&replacement, &destination).unwrap();

        assert_eq!(fs::read(&destination).unwrap(), b"GGUFreplacement");
        assert_eq!(fs::canonicalize(&destination).unwrap(), replacement);
    }
}
