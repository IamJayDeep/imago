use std::path::PathBuf;
use std::fs;

/// Resolves the default "Imago" directory under the native OS Pictures directory.
/// Creates the folder if it does not exist.
pub fn get_default_output_dir() -> Result<PathBuf, String> {
    let pic_dir = dirs::picture_dir()
        .ok_or_else(|| "Could not find the native OS Pictures directory.".to_string())?;
    
    let imago_dir = pic_dir.join("Imago");
    
    if !imago_dir.exists() {
        fs::create_dir_all(&imago_dir)
            .map_err(|e| format!("Failed to create default Imago folder: {}", e))?;
    }
    
    Ok(imago_dir)
}
