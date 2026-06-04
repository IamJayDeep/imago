mod dirs;
mod image_processor;

use image_processor::ToolSettings;

#[tauri::command]
fn get_default_output_dir() -> Result<String, String> {
    dirs::get_default_output_dir().map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
async fn select_files(app: tauri::AppHandle) -> Result<Option<Vec<String>>, String> {
    use tauri_plugin_dialog::DialogExt;
    
    let files = app.dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "avif"])
        .blocking_pick_files();
    
    match files {
        Some(paths) => {
            let mut path_strs = Vec::new();
            for p in paths {
                match p.into_path() {
                    Ok(path_buf) => path_strs.push(path_buf.to_string_lossy().to_string()),
                    Err(_) => return Err("Failed to resolve local file path".to_string()),
                }
            }
            Ok(Some(path_strs))
        }
        None => Ok(None)
    }
}

#[tauri::command]
async fn select_output_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    
    let folder = app.dialog()
        .file()
        .blocking_pick_folder();
    
    match folder {
        Some(path) => {
            match path.into_path() {
                Ok(path_buf) => Ok(Some(path_buf.to_string_lossy().to_string())),
                Err(_) => Err("Failed to resolve local folder path".to_string()),
            }
        }
        None => Ok(None)
    }
}

#[tauri::command]
async fn start_batch_processing(
    app: tauri::AppHandle,
    files: Vec<String>,
    output_dir: String,
    settings: ToolSettings,
) -> Result<(), String> {
    image_processor::process_batch(app, files, output_dir, settings).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_default_output_dir,
            select_files,
            select_output_folder,
            start_batch_processing
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
